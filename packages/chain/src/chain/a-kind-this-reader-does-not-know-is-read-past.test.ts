/**
 * A LINE OF A KIND THIS READER DOES NOT KNOW IS READ PAST, IN BOTH READERS (ADR-113, `FORMAT.md`
 * section 7.1).
 *
 * A newer writer adds a kind; an older reader meets it. Before this rule the older reader refused
 * the whole record over it, so every kind added broke every reader already installed. Now it checks
 * the line for everything that does not need what it says (its envelope, its entry hash, its place
 * in the chain, that its signer is a member at its point, the checkpoint over it), reads none of
 * its payload, applies nothing of it, and names the kind in the census with the exit unchanged.
 *
 * What it does NOT loosen is held here beside it: the same line with one payload byte changed is a
 * broken hash; signed by a key no identity enrolled it is refused like any fact; above the last
 * checkpoint it is unsigned like any line; and a KNOWN kind carrying a field its contract does not
 * declare is refused as it always was. Every record is signed, chained and checkpointed with the
 * product's own primitives, so the one thing about it a reader can object to is what each case
 * puts there. Both readers are asked every time.
 *
 * It needs `python3` and fails rather than skips without it, as its siblings do.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { identityFounded, memoryCaptured } from '../events/build.js';
import { type CanonicalValue, canonicalStringify } from '../events/canonical.js';
import { catalogUpcasters } from '../events/registry.js';
import { verify } from './chain.js';
import { serializeCheckpoint, signCheckpoint } from './checkpoint.js';
import { entryHash, writtenAsStored } from './hash.js';
import { deriveAnchor, generateKeyPair, type KeyPair, publicKeyToPem } from './keys.js';
import { checkpointsPath, publicKeyPath, segmentPath, tailDir, tailProofPath } from './layout.js';
import { serializeTailProof, signTailProof } from './tailproof.js';
import { unreadKindSentence } from './verify.js';

const VERIFIER = fileURLToPath(new URL('../../verifier/mnema_verify.py', import.meta.url));

/** The kind no version declares (`UNREAD_VECTOR_KIND` in `events/vectors.ts`). */
const FUTURE = 'x.from-the-future';

interface Finding {
  readonly level: string;
  readonly section: string;
  readonly what: string;
}

function secondReading(record: string): { verdict: string; findings: readonly Finding[] } {
  const run = spawnSync('python3', ['-I', VERIFIER, '--json', 'record', record], {
    encoding: 'utf-8',
  });
  if (run.stdout === '') throw new Error(`the second reader produced no verdict: ${run.stderr}`);
  return JSON.parse(run.stdout) as { verdict: string; findings: readonly Finding[] };
}

type Line = Readonly<Record<string, CanonicalValue>>;

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mnema-unread-kind-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/**
 * One tail of `kp`, chained, with its birth proof and checkpoints over its first `covered` lines
 * (every line when left out), each line taken as written.
 */
function writeTail(kp: KeyPair, events: readonly Line[], covered = events.length): string {
  mkdirSync(join(root, 'keys'), { recursive: true });
  writeFileSync(publicKeyPath({ root }, kp.fingerprint), publicKeyToPem(kp.publicKey));
  const tailId = `${kp.fingerprint}-i1`;
  mkdirSync(tailDir({ root }, tailId), { recursive: true });
  const lines: string[] = [];
  let prev: string | null = null;
  events.forEach((event, seq) => {
    const hash = entryHash({ event: writtenAsStored(event), tail: tailId, seq, prev });
    lines.push(canonicalStringify({ event, link: { tail: tailId, seq, prev, hash } }));
    prev = hash;
  });
  writeFileSync(segmentPath({ root }, tailId, 1), `${lines.join('\n')}\n`);
  writeFileSync(
    tailProofPath({ root }, tailId),
    `${serializeTailProof(signTailProof(tailId, kp))}\n`,
  );
  const checkpoint = signCheckpoint({
    tail: tailId,
    fromSeq: 0,
    events: events.slice(0, covered).map(writtenAsStored),
    prev: null,
    keyPair: kp,
  });
  writeFileSync(checkpointsPath({ root }, tailId), `${serializeCheckpoint(checkpoint)}\n`);
  return tailId;
}

const asLine = (event: object): Line => event as Line;

/** The envelope of a fact signed by `kp` for the identity `who`. */
function head(kp: KeyPair, who: string, at: string, subject: string) {
  return { who, signerFp: kp.fingerprint, at, subject };
}

/** An identity founded, a memory, a line of `kind` (unknown or not), and a memory after it. */
function aRecordWith(kind: string, payload: Line, covered?: number): { tail: string; kp: KeyPair } {
  const kp = generateKeyPair();
  const anchor = deriveAnchor(kp.fingerprint);
  const founded = identityFounded(head(kp, anchor, '2026-11-03T00:00:01.000Z', anchor), {
    foundingFp: kp.fingerprint,
  });
  const before = memoryCaptured(head(kp, anchor, '2026-11-03T00:00:02.000Z', 'm-1'), {
    content: 'Written before the line a newer writer added.',
  });
  const future = {
    v: 1,
    kind,
    ...head(kp, anchor, '2026-11-03T00:00:03.000Z', 'f-1'),
    which: 'claude',
    payload,
  };
  const after = memoryCaptured(head(kp, anchor, '2026-11-03T00:00:04.000Z', 'm-2'), {
    content: 'Written after it, on the same tail.',
  });
  const tail = writeTail(kp, [founded, before, future, after].map(asLine), covered);
  return { tail, kp };
}

/** A payload no contract declares: fields of every type a newer writer could use. */
const NEW_PAYLOAD: Line = { says: 'what a newer mnema means', count: 3, nested: { yes: true } };

describe('a signed, covered line of a kind this reader does not know', () => {
  it('is read past by the product: verified, every line signed, and the kind named once', () => {
    const { tail } = aRecordWith(FUTURE, NEW_PAYLOAD);
    const here = verify(root, catalogUpcasters());
    expect(here.issues).toEqual([]);
    expect(here.ok).toBe(true);
    expect(here.fullySigned).toBe(true);
    // The line is a line of the tail: counted, and covered by the checkpoint like the others.
    expect(here.tails.map((t) => [t.entryCount, t.checkpointedThrough])).toEqual([[4, 3]]);
    const notes = here.census.filter((note) => note.kind === 'unread-kind');
    expect(notes).toEqual([
      {
        kind: 'unread-kind',
        eventKind: FUTURE,
        lines: 1,
        tails: [tail],
        detail: unreadKindSentence(FUTURE, 1, [tail]),
      },
    ]);
    expect(notes[0]?.detail).toBe(
      `1 line(s) of kind "x.from-the-future" in tail(s) ${tail}: a kind this reader does not ` +
        'know, so their hash, chain, signer and checkpoint were checked and what they say was not ' +
        'read and none of it applied (a newer mnema wrote them)',
    );
    // The verdict's sentence says so too, and still says nothing is broken.
    expect(here.summary).toContain(
      '1 kind(s) this reader does not know, checked and not read (see census: informational, not a break)',
    );
  });

  it('is read past by the second reader: VERIFIED, with the same sentence as the product', () => {
    const { tail } = aRecordWith(FUTURE, NEW_PAYLOAD);
    const there = secondReading(root);
    expect(there.findings.filter((f) => f.level === 'FAIL' || f.level === 'UNCHECKED')).toEqual([]);
    expect(there.verdict).toBe('VERIFIED');
    expect(there.findings.filter((f) => f.section === '7.1').map((f) => f.what)).toEqual([
      unreadKindSentence(FUTURE, 1, [tail]),
    ]);
  });

  it('names one line per kind, however many lines and tails carry it', () => {
    // Two lines of the kind on one tail: one note, counting both.
    const kp = generateKeyPair();
    const anchor = deriveAnchor(kp.fingerprint);
    const founded = identityFounded(head(kp, anchor, '2026-11-03T00:00:01.000Z', anchor), {
      foundingFp: kp.fingerprint,
    });
    const future = (at: string) =>
      asLine({ v: 2, kind: FUTURE, ...head(kp, anchor, at, 'f-1'), payload: {} });
    const tail = writeTail(kp, [
      asLine(founded),
      future('2026-11-03T00:00:02.000Z'),
      future('2026-11-03T00:00:03.000Z'),
    ]);
    const here = verify(root, catalogUpcasters());
    expect(here.ok).toBe(true);
    const said = unreadKindSentence(FUTURE, 2, [tail]);
    expect(here.census.filter((n) => n.kind === 'unread-kind').map((n) => n.detail)).toEqual([
      said,
    ]);
    expect(
      secondReading(root)
        .findings.filter((f) => f.section === '7.1')
        .map((f) => f.what),
    ).toEqual([said]);
  });
});

describe('what reading past does not loosen', () => {
  it('the same line with one payload byte changed is a broken hash, in both readers', () => {
    const { tail } = aRecordWith(FUTURE, NEW_PAYLOAD);
    const segment = segmentPath({ root }, tail, 1);
    const before = readFileSync(segment, 'utf-8');
    const after = before.replace('"count":3', '"count":4');
    expect(after).not.toBe(before);
    writeFileSync(segment, after);

    const here = verify(root, catalogUpcasters());
    expect(here.ok).toBe(false);
    expect(here.issues.map((issue) => [issue.layer, issue.seq, issue.detail])).toEqual([
      ['T1', 2, expect.stringContaining('entry hash mismatch')],
      expect.arrayContaining(['T2/T4']),
    ]);
    const there = secondReading(root);
    expect(there.verdict).not.toBe('VERIFIED');
    expect(there.findings.filter((f) => f.level === 'FAIL').map((f) => f.section)).toContain('3');
  });

  it('signed by a key no identity enrolled, it is refused as any fact would be, in both', () => {
    // The founder's tail, honest; and a second key, committed and owning its own tail, that no
    // identity ever enrolled, writing one line for the founder's identity.
    const { kp: founder } = aRecordWith('memory.captured', { content: 'An honest note.' });
    const stranger = generateKeyPair();
    const anchor = deriveAnchor(founder.fingerprint);
    const byStranger = (kind: string, payload: Line) =>
      asLine({
        v: 1,
        kind,
        ...head(stranger, anchor, '2026-11-03T00:00:05.000Z', 'f-2'),
        payload,
      });

    const strangerTail = writeTail(stranger, [byStranger(FUTURE, NEW_PAYLOAD)]);
    const unread = verify(root, catalogUpcasters());
    expect(unread.ok).toBe(false);
    const refusal = unread.issues.filter((issue) => issue.tail === strangerTail);
    expect(refusal.map((issue) => issue.detail)).toEqual([
      expect.stringMatching(/^event signer [0-9a-f]+ is not a key enrolled for mnid:/),
    ]);
    const there = secondReading(root);
    expect(there.verdict).toBe('REFUSED');
    const strangerSays = there.findings
      .filter((f) => f.level === 'FAIL')
      .map((f) => `${f.section}: ${f.what.replace(/[0-9a-f]{12}\.\.\./, 'K')}`);
    expect(strangerSays).toEqual([
      expect.stringMatching(/^6\.2: the signer K is not a key enrolled for /),
    ]);

    // The control: the same stranger writing a KNOWN kind there is refused in the same words.
    writeTail(stranger, [byStranger('memory.captured', { content: 'From a stranger.' })]);
    const known = verify(root, catalogUpcasters());
    expect(known.issues.filter((i) => i.tail === strangerTail).map((i) => i.detail)).toEqual(
      refusal.map((issue) => issue.detail),
    );
  });

  it('above the last checkpoint, it is an unsigned line like any other, in both readers', () => {
    // Covered through seq 1: the line of the unknown kind (seq 2) and the memory after it rest on
    // the hash chain alone.
    aRecordWith(FUTURE, NEW_PAYLOAD, 2);
    const here = verify(root, catalogUpcasters());
    const there = secondReading(root);
    // The control: the same record with a known kind in that place.
    rmSync(root, { recursive: true, force: true });
    mkdirSync(root);
    aRecordWith('memory.captured', { content: 'A known line in the same place.' }, 2);
    const control = verify(root, catalogUpcasters());
    const controlThere = secondReading(root);

    expect(here.ok).toBe(true);
    expect(here.fullySigned).toBe(false);
    expect([here.level, here.uncheckpointedEvents]).toEqual([
      control.level,
      control.uncheckpointedEvents,
    ]);
    expect(here.uncheckpointedEvents).toBe(2);
    expect(there.verdict).toBe(controlThere.verdict);
  });

  it('a malformed envelope is refused, whatever the kind, and named as no kind read past, in both readers', () => {
    // Each case is a line of a kind the readers do not know whose envelope is out of its
    // declarations: refused for that, by both, and so NOT a line read past. Neither reader may say
    // of it that its hash, chain, signer and checkpoint were checked: the census note is absent.
    const cases: { readonly line: Line; readonly product: string; readonly second: string }[] = [
      {
        line: { v: 1, kind: FUTURE, beside: 'a top-level key no envelope declares', payload: {} },
        product: `event "${FUTURE}" has an unknown event field "beside"`,
        second: "carries top-level field(s) ['beside']",
      },
      {
        line: { v: 1, kind: '', payload: {} },
        product: 'needs a non-empty string at kind',
        second: 'an event with no `kind`',
      },
    ];
    for (const { line, product, second } of cases) {
      rmSync(root, { recursive: true, force: true });
      mkdirSync(root);
      const kp = generateKeyPair();
      const anchor = deriveAnchor(kp.fingerprint);
      const founded = identityFounded(head(kp, anchor, '2026-11-03T00:00:01.000Z', anchor), {
        foundingFp: kp.fingerprint,
      });
      writeTail(kp, [
        asLine(founded),
        asLine({ ...head(kp, anchor, '2026-11-03T00:00:02.000Z', 'f-1'), ...line }),
      ]);
      const here = verify(root, catalogUpcasters());
      expect(here.ok).toBe(false);
      expect(here.issues.map((issue) => issue.detail)).toEqual([expect.stringContaining(product)]);
      expect(here.census.filter((note) => note.kind === 'unread-kind')).toEqual([]);
      const there = secondReading(root);
      expect(there.verdict).toBe('REFUSED');
      expect(there.findings.filter((f) => f.level === 'FAIL').map((f) => f.what)).toEqual([
        expect.stringContaining(second),
      ]);
      expect(there.findings.filter((f) => f.section === '7.1')).toEqual([]);
    }
  });

  it('a KNOWN kind carrying a field its contract does not declare is still refused, in both', () => {
    aRecordWith('memory.captured', { content: 'A known kind.', undeclared: 'rides along' });
    const here = verify(root, catalogUpcasters());
    expect(here.ok).toBe(false);
    expect(here.issues.map((issue) => issue.detail)).toEqual([
      expect.stringContaining('event "memory.captured" has an unknown payload field "undeclared"'),
    ]);
    const there = secondReading(root);
    expect(there.verdict).toBe('REFUSED');
    expect(there.findings.filter((f) => f.level === 'FAIL').map((f) => f.what)).toEqual([
      expect.stringContaining("carries payload field(s) ['undeclared']"),
    ]);
  });
});
