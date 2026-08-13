/**
 * The waiver: what it makes the verdict say, what it refuses at the door, and —
 * the half that matters most — everything it deliberately leaves alone.
 *
 * WHERE THE NEED CAME FROM, measured on a real 402-event tail before any of this
 * existed. Cut one line out of the middle: 102 findings (a seq gap, a range
 * mismatch, 100 checkpoint chain breaks in cascade). Cut the first hundred events:
 * 454. Delete the WHOLE tail: zero, `verified (T1 only)`, exit 0, and the sentence
 * `1 tail(s); no events yet` — the same one a tail that never wrote gets. The
 * product punished the honest cut and could not see the dishonest one.
 *
 * So the cases below come in two halves, and the second is the reason the first is
 * safe:
 *   - WITH a waiver, the census note names the account: who authorized it, how many
 *     events, through which head.
 *   - WITHOUT one, the note is byte for byte what it always was; a waiver never
 *     cures a break on a tail that is still there; a PARTIAL cut is untouched and
 *     stays as loud as it ever was; and the empty tail a read-only session leaves
 *     behind is not read as a cut and cannot be waived at all.
 */

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { identityFounded, tailPruned, taskCreated } from '../events/build.js';
import { catalogUpcasters } from '../events/registry.js';
import { openChainForWriting, verify } from './chain.js';
import { segmentPath, tailFingerprint } from './layout.js';
import { readTailEntries } from './store.js';
import { tailStanding } from './waiver.js';
import type { ChainWriter } from './writer.js';

const upcasters = catalogUpcasters();

let root: string;
let elsewhere: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mnema-waiver-'));
  elsewhere = mkdtempSync(join(tmpdir(), 'mnema-waiver-other-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(elsewhere, { recursive: true, force: true });
});

const env = (w: ChainWriter, subject: string) => ({
  at: '2026-08-12T00:00:00.000Z',
  who: w.anchor,
  signerFp: w.signerFingerprint,
  subject,
});

function open(chainRoot: string): ChainWriter {
  const w = openChainForWriting(chainRoot, { keyRoot: chainRoot });
  w.append(identityFounded(env(w, w.anchor), { foundingFp: w.signerFingerprint }));
  return w;
}

/** A second machine's tail, written elsewhere and merged in the way an offline copy is. */
function secondMachine(tasks: number): { tail: string; who: string; writer: ChainWriter } {
  const w = open(elsewhere);
  for (let i = 0; i < tasks; i += 1) {
    w.append(taskCreated(env(w, `t-${i}`), { title: `task ${i}` }));
  }
  w.checkpoint();
  mergeInto(elsewhere, root);
  return { tail: w.tail, who: w.anchor, writer: w };
}

/** Copies every tail directory and every committed public key across, like a merge. */
function mergeInto(from: string, into: string): void {
  for (const tail of readdirSync(join(from, 'tails'))) {
    mkdirSync(join(into, 'tails', tail), { recursive: true });
    for (const file of readdirSync(join(from, 'tails', tail))) {
      writeFileSync(
        join(into, 'tails', tail, file),
        readFileSync(join(from, 'tails', tail, file), 'utf-8'),
      );
    }
  }
  for (const key of readdirSync(join(from, 'keys'))) {
    if (!key.endsWith('.pub')) continue;
    writeFileSync(join(into, 'keys', key), readFileSync(join(from, 'keys', key), 'utf-8'));
  }
}

/** What the disk says about a merged tail — the claim an honest waiver carries. */
function standingOf(tail: string) {
  const standing = tailStanding({ root }, tail, upcasters);
  if (standing === undefined) throw new Error(`fixture: no standing for ${tail}`);
  return standing;
}

/** The cut itself, which the product never performs: the files simply go. */
function cut(tail: string): void {
  rmSync(join(root, 'tails', tail), { recursive: true, force: true });
}

/** The one census note about a key with no tail, or a failure naming what was there. */
function keyNote(result: ReturnType<typeof verify>) {
  const notes = result.census.filter((note) => note.kind === 'key-without-tail');
  expect(notes, `census was ${JSON.stringify(result.census)}`).toHaveLength(1);
  const note = notes[0];
  if (note?.kind !== 'key-without-tail') throw new Error('unreachable');
  return note;
}

describe('a cut tail with a waiver: the note names the account', () => {
  it('says who authorized it, how many events, and through which head', () => {
    const local = open(root);
    const other = secondMachine(3);
    const standing = standingOf(other.tail);

    local.append(
      tailPruned(env(local, standing.who), {
        tail: other.tail,
        throughHash: standing.throughHash,
        eventCount: standing.eventCount,
        reason: 'the person asked to be taken out of the record',
      }),
    );
    local.checkpoint();
    cut(other.tail);

    const result = verify(root);
    const note = keyNote(result);
    expect(note.fingerprint).toBe(tailFingerprint(other.tail));
    expect(note.detail).toContain('the record names the cut');
    expect(note.detail).toContain(other.tail);
    expect(note.detail).toContain(
      `${standing.eventCount} event(s) through ${standing.throughHash}`,
    );
    // WHO AUTHORIZED IT is the waiver's own `who` — the identity that signed the
    // declaration — and not the anchor the cut tail served, which is the SUBJECT.
    // The two are different identities here on purpose: one person authorizing the
    // removal of another's tail is the case the whole thing exists for.
    expect(note.detail).toContain(`authorized by ${local.anchor}`);
    expect(local.anchor).not.toBe(other.who);
    expect(note.waivers[0]?.who).toBe(local.anchor);
    // The waiver itself is on the note, so a reader is not left parsing the sentence.
    expect(note.waivers).toHaveLength(1);
    expect(note.waivers[0]?.reason).toBe('the person asked to be taken out of the record');
    expect(note.waivers[0]?.declaredOn).toBe(local.tail);
  });

  it('moves neither the verdict nor the level: an authorized cut is not a break', () => {
    // The same record twice — once with the waiver, once without it — cut the same
    // way. What the waiver may change is the SENTENCE of the note; what it may never
    // change is whether the record verifies, or how far the proof got.
    const local = open(root);
    const other = secondMachine(3);
    const standing = standingOf(other.tail);
    local.append(
      tailPruned(env(local, standing.who), {
        tail: other.tail,
        throughHash: standing.throughHash,
        eventCount: standing.eventCount,
        reason: 'a machine retired',
      }),
    );
    local.checkpoint();
    cut(other.tail);
    const withWaiver = verify(root);

    expect(withWaiver.ok).toBe(true);
    expect(withWaiver.issues).toEqual([]);
    expect(withWaiver.level).toBe('fully-signed');
    // And the census clause still says INFORMATIONAL, in the same words: the count
    // of notes is what the sentence carries, never their content.
    expect(withWaiver.summary).toContain(
      '1 committed key(s) without a tail (see census — informational, not a break)',
    );
  });
});

describe('a cut tail with NO waiver: the note is what it always was', () => {
  it('reads byte for byte as the ambiguity it has always been', () => {
    const local = open(root);
    const other = secondMachine(3);
    cut(other.tail);

    const result = verify(root);
    const note = keyNote(result);
    // The exact sentence, not a fragment of it: this is the non-regression that
    // protects the doctrine — three readings, and the disk cannot choose between
    // them. A waiver answers the third; with none, nothing is answered.
    expect(note.detail).toBe(
      'committed public key has no tail on disk — the tail may have been dropped ' +
        '(a botched merge), never written (an empty tail is not versioned), or removed',
    );
    expect(note.waivers).toEqual([]);
    expect(result.ok).toBe(true);
    // And `local` is still here, so the record is otherwise exactly as before.
    expect(local.tail).not.toBe(other.tail);
  });

  it('is not answered by a waiver for a DIFFERENT key', () => {
    // Two machines cut, one waiver. The note about the key that has none must not
    // borrow the account of the key that does — the match is by fingerprint, and a
    // note that read as accounted-for would be the worst possible false negative.
    const local = open(root);
    const waived = secondMachine(2);
    const third = mkdtempSync(join(tmpdir(), 'mnema-waiver-third-'));
    try {
      const w = open(third);
      w.append(taskCreated(env(w, 't-x'), { title: 'the third machine' }));
      w.checkpoint();
      mergeInto(third, root);

      const standing = standingOf(waived.tail);
      local.append(
        tailPruned(env(local, standing.who), {
          tail: waived.tail,
          throughHash: standing.throughHash,
          eventCount: standing.eventCount,
          reason: 'only this one was authorized',
        }),
      );
      local.checkpoint();
      cut(waived.tail);
      cut(w.tail);

      const result = verify(root);
      const notes = result.census.filter((note) => note.kind === 'key-without-tail');
      expect(notes).toHaveLength(2);
      const accounted = notes.filter((note) => note.detail.includes('the record names the cut'));
      expect(accounted).toHaveLength(1);
      expect(accounted[0]?.fingerprint).toBe(tailFingerprint(waived.tail));
    } finally {
      rmSync(third, { recursive: true, force: true });
    }
  });
});

describe('the door refuses a waiver the record does not bear out', () => {
  it('refuses a head hash the tail does not end at', () => {
    const local = open(root);
    const other = secondMachine(3);
    const standing = standingOf(other.tail);
    expect(() =>
      local.append(
        tailPruned(env(local, standing.who), {
          tail: other.tail,
          throughHash: 'f'.repeat(64),
          eventCount: standing.eventCount,
          reason: 'a head nobody wrote',
        }),
      ),
    ).toThrow(/ends at .*, not at the claimed/);
  });

  it('refuses a count the tail does not hold', () => {
    const local = open(root);
    const other = secondMachine(3);
    const standing = standingOf(other.tail);
    expect(() =>
      local.append(
        tailPruned(env(local, standing.who), {
          tail: other.tail,
          throughHash: standing.throughHash,
          eventCount: standing.eventCount + 1,
          reason: 'one more than there is',
        }),
      ),
    ).toThrow(/holds \d+ event\(s\), not the claimed/);
  });

  it('refuses a tail that is not in this record', () => {
    const local = open(root);
    expect(() =>
      local.append(
        tailPruned(env(local, local.anchor), {
          tail: `${'a'.repeat(64)}-nowhere`,
          throughHash: 'b'.repeat(64),
          eventCount: 7,
          reason: 'a tail from another world',
        }),
      ),
    ).toThrow(/holds events in this chain/);
  });

  it('refuses a waiver over the tail it is being written to', () => {
    const local = open(root);
    local.append(taskCreated(env(local, 't-0'), { title: 'something to point at' }));
    const standing = standingOf(local.tail);
    expect(() =>
      local.append(
        tailPruned(env(local, standing.who), {
          tail: local.tail,
          throughHash: standing.throughHash,
          eventCount: standing.eventCount,
          reason: 'it would be cut with it',
        }),
      ),
    ).toThrow(/cannot name the tail it is written to/);
  });

  it('refuses a subject that is not the anchor the cut tail served', () => {
    const local = open(root);
    const other = secondMachine(3);
    const standing = standingOf(other.tail);
    expect(() =>
      local.append(
        tailPruned(env(local, local.anchor), {
          tail: other.tail,
          throughHash: standing.throughHash,
          eventCount: standing.eventCount,
          reason: 'filed under the wrong identity',
        }),
      ),
    ).toThrow(/served .*, not the named subject/);
  });

  it('refuses every one of them in a BATCH too, leaving nothing behind', () => {
    // The second door onto a tail. A batch whose second event is a lying waiver must
    // not leave the first one on the record — the atom holds for this refusal as it
    // does for the reader's.
    const local = open(root);
    const other = secondMachine(2);
    const standing = standingOf(other.tail);
    const before = readTailEntries({ root }, local.tail, upcasters).length;
    expect(() =>
      local.appendAll([
        taskCreated(env(local, 't-batch'), { title: 'the honest half' }),
        tailPruned(env(local, standing.who), {
          tail: other.tail,
          throughHash: standing.throughHash,
          eventCount: standing.eventCount + 99,
          reason: 'the dishonest half',
        }),
      ]),
    ).toThrow(/refusing to seal a waiver/);
    expect(readTailEntries({ root }, local.tail, upcasters).length).toBe(before);
  });
});

describe('what a waiver does not touch', () => {
  it('does not cure a break on a tail that is still there', () => {
    // A waiver speaks of an ABSENCE. A tail that is present and corrupt keeps every
    // issue it had, waiver or no waiver — which is what keeps this from becoming a
    // way to sign away a tampering.
    const local = open(root);
    const other = secondMachine(3);
    const standing = standingOf(other.tail);
    local.append(
      tailPruned(env(local, standing.who), {
        tail: other.tail,
        throughHash: standing.throughHash,
        eventCount: standing.eventCount,
        reason: 'declared, but the tail is still here',
      }),
    );
    local.checkpoint();

    // Corrupt the tail the waiver names — in place, still present.
    const segment = segmentPath({ root }, other.tail, 1);
    const lines = readFileSync(segment, 'utf-8').split('\n').filter(Boolean);
    const tampered = (lines[1] as string).replace('task 0', 'task 0 edited');
    lines[1] = tampered;
    writeFileSync(segment, `${lines.join('\n')}\n`, 'utf-8');

    const result = verify(root);
    expect(result.ok).toBe(false);
    expect(result.level).toBe('broken');
    expect(result.issues.some((issue) => issue.tail === other.tail)).toBe(true);
    // And no census note appeared to soften it: the tail is present, so the waiver
    // is never even consulted.
    expect(result.census.filter((note) => note.kind === 'key-without-tail')).toEqual([]);
  });

  it('leaves a PARTIAL cut as loud as it has always been', () => {
    // The case this whole slice does NOT cover, pinned so it cannot quietly become
    // covered: one line out of the middle produces the seq gap and the cascade, with
    // a waiver sitting right there naming the same tail.
    const local = open(root);
    const other = secondMachine(4);
    const standing = standingOf(other.tail);
    local.append(
      tailPruned(env(local, standing.who), {
        tail: other.tail,
        throughHash: standing.throughHash,
        eventCount: standing.eventCount,
        reason: 'a waiver is not a licence to cut PART of a tail',
      }),
    );
    local.checkpoint();

    const segment = segmentPath({ root }, other.tail, 1);
    const lines = readFileSync(segment, 'utf-8').split('\n').filter(Boolean);
    lines.splice(2, 1);
    writeFileSync(segment, `${lines.join('\n')}\n`, 'utf-8');

    const result = verify(root);
    expect(result.ok).toBe(false);
    const detail = result.issues.map((issue) => issue.detail).join(' | ');
    expect(detail).toMatch(/seq gap: expected 2, found 3/);
    expect(result.issues.length).toBeGreaterThan(1);
  });

  it('cannot be written about the empty tail a read-only session leaves', () => {
    // The state that must never be read as a cut: opening a write context to READ
    // the anchor mints the tail directory and its ownership proof, and writes no
    // event. A tail with a proof and zero events is the ordinary residue of a
    // session that only read — not the signature of a removal.
    const reader = openChainForWriting(root, { keyRoot: root });
    expect(readTailEntries({ root }, reader.tail, upcasters)).toEqual([]);
    // There is nothing on disk to base a claim on, so no waiver can name it.
    expect(tailStanding({ root }, reader.tail, upcasters)).toBeUndefined();

    // And it is not a key without a tail either — the tail is right there, which is
    // why the census says nothing about it at all.
    const result = verify(root);
    expect(result.census.filter((note) => note.kind === 'key-without-tail')).toEqual([]);
  });
});
