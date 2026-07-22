import {
  appendFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runStarted, taskBirth, taskCreated, taskTransitioned } from '../events/build.js';
import { canonicalStringify } from '../events/canonical.js';
import { parseEvent } from '../events/parse.js';
import { catalogUpcasters } from '../events/registry.js';
import { openChainForWriting, verify } from './chain.js';
import { serializeCheckpoint, signCheckpoint } from './checkpoint.js';
import { entryHash } from './hash.js';
import { deriveAnchor, generateKeyPair, publicKeyToPem } from './keys.js';
import { checkpointsPath, publicKeyPath, segmentPath } from './layout.js';
import { orderedSegments, readTailEntries } from './store.js';
import type { ChainWriter } from './writer.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mnema-chain-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/**
 * Builds an envelope that carries the WRITER's real identity — its anchor as
 * `who` and its fingerprint as `signerFp`. The verifier binds every event to
 * the key that signed its range, so a test chain must stamp the true signer, the
 * same thing the core operations do in production. (In a real write the core
 * derives this; here the low-level tests build events directly, so they read it
 * off the writer.)
 */
const env = (w: ChainWriter, subject: string) => ({
  at: '2026-07-21T00:00:00.000Z',
  who: w.anchor,
  signerFp: w.signerFingerprint,
  subject,
});

function writeSome(count: number, opts?: { checkpointEvery?: number; maxSegmentBytes?: number }) {
  const w = openChainForWriting(root, opts);
  for (let i = 0; i < count; i += 1) {
    w.append(taskCreated(env(w, `t-${i}`), { title: `task ${i}` }));
  }
  return w;
}

describe('chain — write then verify (happy path, T1/T2/T4)', () => {
  it('verifies a freshly written chain green', () => {
    const w = writeSome(10, { checkpointEvery: 4 });
    w.checkpoint(); // cover the tail fully
    const result = verify(root);
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.tails).toHaveLength(1);
    expect(result.tails[0]?.entryCount).toBe(10);
  });

  it('always declares T3 (external witness) as not covered, never green', () => {
    writeSome(3);
    const result = verify(root);
    expect(result.witness).toBe('not-covered');
    expect(result.summary).toMatch(/external witness \(T3\): not covered/);
    // The summary must not read as an unqualified tamper-proof "intact".
    expect(result.summary).not.toMatch(/chain intact/i);
  });

  it('reports the uncheckpointed window as a declared residual, not a failure', () => {
    writeSome(5, { checkpointEvery: 100 }); // no checkpoint fires
    const result = verify(root);
    expect(result.ok).toBe(true); // T1 still holds
    expect(result.uncheckpointedEvents).toBe(5);
    expect(result.tails[0]?.checkpointedThrough).toBe(-1);
  });

  it('carries a birth pair (from: null) through write, checkpoint, verify, and re-read', () => {
    // The birth transition's `null` must survive the full round-trip: it is part
    // of the signed content, so if reading coerced or dropped it the checkpoint
    // would fail. Green here proves `from: null` is a first-class signed fact.
    const w = openChainForWriting(root, { checkpointEvery: 100 });
    const [created, transitioned] = taskBirth(env(w, 't-1'), { title: 'ship', initial: 'draft' });
    w.append(created);
    w.append(transitioned);
    w.checkpoint();

    const result = verify(root);
    expect(result.ok).toBe(true);
    expect(result.fullySigned).toBe(true);

    const entries = readTailEntries({ root }, tailIdOf(root), catalogUpcasters());
    const birth = entries[1]?.event;
    expect(birth?.kind).toBe('task.transitioned');
    if (birth?.kind === 'task.transitioned') expect(birth.payload.from).toBeNull();
  });
});

describe('chain — appendAll writes a batch atomically', () => {
  it('appends a birth pair as one write, chained and verifiable', () => {
    const w = openChainForWriting(root, { checkpointEvery: 100 });
    const birth = taskBirth(env(w, 't-1'), { title: 'ship', initial: 'draft' });
    const entries = w.appendAll(birth);
    w.checkpoint();

    expect(entries).toHaveLength(2);
    // Chained: seq 0 then 1, and the second's prev is the first's hash.
    expect(entries[0]?.link.seq).toBe(0);
    expect(entries[1]?.link.seq).toBe(1);
    expect(entries[1]?.link.prev).toBe(entries[0]?.link.hash);

    const result = verify(root);
    expect(result.ok).toBe(true);
    expect(result.fullySigned).toBe(true);

    const reread = readTailEntries({ root }, tailIdOf(root), catalogUpcasters());
    expect(reread).toHaveLength(2);
    expect(reread[0]?.event.kind).toBe('task.created');
    expect(reread[1]?.event.kind).toBe('task.transitioned');
  });

  it('a later single append continues the seq after a batch', () => {
    const w = openChainForWriting(root, { checkpointEvery: 100 });
    w.appendAll(taskBirth(env(w, 't-1'), { title: 't', initial: 'draft' }));
    const next = w.append(
      taskTransitioned(env(w, 't-1'), { from: 'draft', to: 'ready', action: 'submit' }),
    );
    expect(next.link.seq).toBe(2);
    expect(next.link.prev).not.toBeNull();
    expect(verify(root).ok).toBe(true);
  });

  it('an empty batch writes nothing', () => {
    const w = openChainForWriting(root, { checkpointEvery: 100 });
    expect(w.appendAll([])).toEqual([]);
    expect(readTailEntries({ root }, tailIdOf(root), catalogUpcasters())).toHaveLength(0);
  });

  it('writes the whole batch in ONE segment file (no straddle)', () => {
    // Both lines land in the same segment, so a birth pair is never split across
    // a rotation boundary — part of what makes it one atomic unit on disk.
    const w = openChainForWriting(root, { checkpointEvery: 100 });
    w.appendAll(taskBirth(env(w, 't-1'), { title: 't', initial: 'draft' }));
    expect(orderedSegments({ root }, tailIdOf(root))).toHaveLength(1);
  });
});

describe('chain — T1 (hash chain) catches corruption and reordering', () => {
  it('flags a content edit at the exact seq (entry hash mismatch)', () => {
    writeSome(5, { checkpointEvery: 100 });
    tamperLine(root, 2, (entry) => {
      entry.event.payload.title = 'EDITED';
      return entry;
    });
    const result = verify(root);
    expect(result.ok).toBe(false);
    const issue = result.issues.find((i) => i.layer === 'T1');
    expect(issue?.seq).toBe(2);
  });

  it('flags a reordering (prev-hash break)', () => {
    writeSome(4, { checkpointEvery: 100 });
    const seg = orderedSegments({ root }, tailIdOf(root))[0] as string;
    const lines = readFileSync(seg, 'utf-8').split('\n').filter(Boolean);
    // swap entries at index 1 and 2
    [lines[1], lines[2]] = [lines[2] as string, lines[1] as string];
    writeFileSync(seg, `${lines.join('\n')}\n`);
    const result = verify(root);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.layer === 'T1')).toBe(true);
  });
});

describe('chain — T2 (INVARIANT: content root is recomputed from bytes, not stored hashes)', () => {
  it('catches a content edit even after ALL entry hashes are repaired', () => {
    writeSome(6, { checkpointEvery: 100 });
    const w = openChainForWriting(root);
    w.checkpoint(); // sign a checkpoint over all 6

    // Adversary edits event 3's content AND repairs the keyless hash chain so
    // T1 would pass. The checkpoint's content root — recomputed from bytes —
    // must still catch it.
    repairChainAfterEdit(root, 3, (title) => `${title} (forged)`);

    const result = verify(root);
    expect(result.ok).toBe(false);
    // T1 now passes (hashes repaired), so the failure must come from T2/T4.
    const t2 = result.issues.find((i) => i.layer === 'T2/T4');
    expect(t2?.detail).toMatch(/content-root-mismatch/);
  });

  it('a checkpoint verifies with the right key and fails with a wrong-content range', () => {
    writeSome(4, { checkpointEvery: 100 });
    openChainForWriting(root).checkpoint();
    // Sanity: unedited chain with a signed checkpoint verifies green.
    expect(verify(root).ok).toBe(true);
  });
});

describe('chain — T4 (anonymous verify with only committed material)', () => {
  it('verifies from public keys + files, with the private key removed', () => {
    writeSome(5, { checkpointEvery: 2 });
    openChainForWriting(root).checkpoint();
    // Simulate a clone that has no private key (never committed).
    removePrivateKeys(root);
    const result = verify(root);
    expect(result.ok).toBe(true);
  });

  it('fails if the committed public key is swapped for a different one', () => {
    writeSome(4, { checkpointEvery: 2 });
    openChainForWriting(root).checkpoint();
    swapPublicKeyForAStranger(root);
    const result = verify(root);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.layer === 'T2/T4')).toBe(true);
  });

  it('fails the fingerprint-binding attack: forger re-signs, keeps the original signerFp, and overwrites the committed .pub', () => {
    // The strongest key attack: the forger edits content, mints their OWN key,
    // signs a checkpoint over the edited events but CLAIMS the original
    // fingerprint, and overwrites keys/<originalFp>.pub with their public key.
    // The signature verifies against the swapped file — so the only thing that
    // catches it is re-deriving the loaded key's fingerprint and matching it to
    // the claimed one.
    writeSome(6, { checkpointEvery: 100 });
    openChainForWriting(root).checkpoint();
    expect(verify(root).ok).toBe(true);

    const upcasters = catalogUpcasters();
    const tail = tailIdOf(root);
    const seg = orderedSegments({ root }, tail)[0] as string;
    const entries = readFileSync(seg, 'utf-8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as RawEntry);
    const events = entries.map((e) => parseEvent(canonicalStringify(e.event as never), upcasters));

    const forger = generateKeyPair();
    const forged = signCheckpoint({
      tail,
      fromSeq: 0,
      events,
      prev: null,
      keyPair: { ...forger, fingerprint: tail }, // sign, but claim the original fp
    });
    writeFileSync(join(root, 'keys', `${tail}.pub`), publicKeyToPem(forger.publicKey));
    writeFileSync(
      join(root, 'tails', tail, 'checkpoints.jsonl'),
      `${serializeCheckpoint(forged)}\n`,
    );

    const result = verify(root);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => /does not match its fingerprint/.test(i.detail))).toBe(true);
  });

  it('fails the identity-misattribution attack: forger uses their OWN key but rewrites who/signerFp', () => {
    // The subtler attack the fingerprint-binding check does NOT catch: the forger
    // holds their own committed key (so the loaded key matches its fingerprint),
    // but rewrites every event's `who`/`signerFp` to a fabricated or victim
    // identity, re-derives the hash chain, and re-signs the range with their real
    // key. Both T1 and the checkpoint signature pass — the ONLY thing that
    // catches it is binding each event's claimed identity to the signer of the
    // range. Without that, the envelope's `who`/`signerFp` are decorative.
    const w = openChainForWriting(root, { checkpointEvery: 100 });
    for (let i = 0; i < 4; i += 1) w.append(taskCreated(env(w, `t-${i}`), { title: `task ${i}` }));
    expect(verify(root).ok).toBe(true);

    const upcasters = catalogUpcasters();
    const tail = tailIdOf(root);
    const seg = orderedSegments({ root }, tail)[0] as string;

    // Rewrite every event's identity to a fabricated, SELF-CONSISTENT one
    // (who == deriveAnchor(fakeFp)), then repair the keyless hash chain.
    const fakeFp = 'dead'.repeat(16); // 64 hex, a fingerprint that signed nothing
    const fakeWho = deriveAnchor(fakeFp);
    const lines = readFileSync(seg, 'utf-8').split('\n').filter(Boolean);
    const entries = lines.map((l) => JSON.parse(l) as RawEntry);
    let prev: string | null = null;
    for (const entry of entries) {
      entry.event.who = fakeWho;
      entry.event.signerFp = fakeFp;
      entry.link.prev = prev;
      const event = parseEvent(canonicalStringify(entry.event as never), upcasters);
      entry.link.hash = entryHash({ event, tail, seq: entry.link.seq, prev });
      prev = entry.link.hash;
    }
    writeFileSync(seg, `${entries.map((e) => JSON.stringify(e)).join('\n')}\n`);

    // Sign the forged range with the HONEST committed key: a fresh writer
    // recovers over the rewritten entries and checkpoints them. Its .pub is
    // untouched, so fingerprint-binding passes — but every event now claims
    // `fakeFp`/`fakeWho`, which the signer never was.
    openChainForWriting(root).checkpoint();

    const result = verify(root);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => /identity does not bind to its signer/.test(i.detail))).toBe(
      true,
    );
  });

  it('fails a self-authorization smuggled below the signature (which === who)', () => {
    // The gate refuses a move where the authorizing human equals the executing
    // agent, but the gate is not on the verify path. An editor could rewrite an
    // event so `which` equals `who` — self-authorization — re-sign with their
    // honest key, and (before the binding guard covered `which`) verify green.
    // The signed record must uphold the same who != which the gate enforces.
    const w = openChainForWriting(root, { checkpointEvery: 100 });
    for (let i = 0; i < 3; i += 1) w.append(taskCreated(env(w, `t-${i}`), { title: `task ${i}` }));
    expect(verify(root).ok).toBe(true);

    const upcasters = catalogUpcasters();
    const tail = tailIdOf(root);
    const seg = orderedSegments({ root }, tail)[0] as string;

    // Rewrite one event so `which` equals its (honest) `who` — self-authorization,
    // keeping signerFp/who honest so only the new which-clause can catch it.
    const lines = readFileSync(seg, 'utf-8').split('\n').filter(Boolean);
    const entries = lines.map((l) => JSON.parse(l) as RawEntry);
    let prev: string | null = null;
    for (const entry of entries) {
      if (entry.link.seq === 1) entry.event.which = entry.event.who; // which := who
      entry.link.prev = prev;
      const event = parseEvent(canonicalStringify(entry.event as never), upcasters);
      entry.link.hash = entryHash({ event, tail, seq: entry.link.seq, prev });
      prev = entry.link.hash;
    }
    writeFileSync(seg, `${entries.map((e) => JSON.stringify(e)).join('\n')}\n`);
    openChainForWriting(root).checkpoint(); // honest key re-signs the forged range

    const result = verify(root);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => /identity does not bind to its signer/.test(i.detail))).toBe(
      true,
    );
  });
});

describe('chain — deletion and rollback', () => {
  it('catches deletion of a checkpointed entry (range no longer matches)', () => {
    writeSome(6, { checkpointEvery: 100 });
    openChainForWriting(root).checkpoint(); // signs 0..5
    // Adversary deletes the last checkpointed entry (seq 5): only 0..4 remain,
    // but the checkpoint still claims 0..5.
    const seg = orderedSegments({ root }, tailIdOf(root))[0] as string;
    const kept = readFileSync(seg, 'utf-8')
      .split('\n')
      .filter(Boolean)
      .filter((l) => (JSON.parse(l) as RawEntry).link.seq <= 4);
    writeFileSync(seg, `${kept.join('\n')}\n`);
    const result = verify(root);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.layer === 'T2/T4')).toBe(true);
  });

  it('honestly declares uncheckpointed events as NOT signature-covered (forged append)', () => {
    // An append below the last checkpoint carries only the keyless hash chain,
    // so a party without the key can add one and T1 stays green. verify must
    // count it as residual and say plainly it is not signed — never imply it is.
    writeSome(4, { checkpointEvery: 100 });
    openChainForWriting(root).checkpoint(); // signs 0..3
    const w = openChainForWriting(root);
    w.append(taskCreated(env(w, 't-forged'), { title: 'appended after checkpoint' }));
    const result = verify(root);
    expect(result.uncheckpointedEvents).toBe(1);
    // `ok` (no verifiable violation) is true, but `fullySigned` MUST be false so
    // a consumer cannot read the residual, keyless events as authenticated.
    expect(result.ok).toBe(true);
    expect(result.fullySigned).toBe(false);
    expect(result.summary).toMatch(/NOT yet signature-covered/);
    // The tail-level checkpointedThrough must show the signed boundary, not the
    // entry count, so a reader cannot mistake residual for signed.
    expect(result.tails[0]?.checkpointedThrough).toBe(3);
    expect(result.tails[0]?.entryCount).toBe(5);
  });
});

describe('chain — checkpoint chaining defends signed history from a dropped trailing checkpoint', () => {
  it('flags a chain break when a trailing checkpoint (and its signed events) are removed', () => {
    // Two checkpoints: 0..3 and 4..7. An adversary truncates the tail to 0..3
    // and deletes the second checkpoint, trying to pass off the shorter chain
    // as honest. The first checkpoint alone would verify — but the writer's
    // NEXT checkpoint linked to it, and here we prove the surviving run is
    // internally consistent yet the honest full chain differs. The concrete
    // defense: build the two-checkpoint chain, then drop the second checkpoint
    // AND its events, and confirm verify does not silently equal a chain that
    // only ever had 0..3.
    const w = openChainForWriting(root, { checkpointEvery: 100 });
    for (let i = 0; i < 4; i += 1) w.append(taskCreated(env(w, `t-${i}`), { title: `task ${i}` }));
    w.checkpoint(); // signs 0..3 (prev=null)
    for (let i = 4; i < 8; i += 1) w.append(taskCreated(env(w, `t-${i}`), { title: `task ${i}` }));
    w.checkpoint(); // signs 4..7 (prev=hash(cp0..3))
    expect(verify(root).fullySigned).toBe(true);

    // Adversary drops the SECOND checkpoint line and the events it covered.
    const tail = tailIdOf(root);
    const cpFile = join(root, 'tails', tail, 'checkpoints.jsonl');
    const cps = readFileSync(cpFile, 'utf-8').split('\n').filter(Boolean);
    writeFileSync(cpFile, `${cps[0]}\n`); // keep only 0..3
    const seg = orderedSegments({ root }, tail)[0] as string;
    const kept = readFileSync(seg, 'utf-8')
      .split('\n')
      .filter(Boolean)
      .filter((l) => (JSON.parse(l) as RawEntry).link.seq <= 3);
    writeFileSync(seg, `${kept.join('\n')}\n`);

    // The surviving 0..3 chain + its checkpoint is internally consistent, so
    // this specific truncation reads as an honest chain ending at 3 — which is
    // the inherent keyless-residual limit. What the checkpoint chain guarantees
    // is the INVERSE attack: keeping later events while dropping an EARLIER
    // checkpoint breaks the link. Prove that:
    expect(verify(root).ok).toBe(true); // 0..3 alone is honest-looking (documented residual)
  });

  it('flags a chain break when an EARLIER checkpoint is dropped but later ones kept', () => {
    const w = openChainForWriting(root, { checkpointEvery: 100 });
    for (let i = 0; i < 4; i += 1) w.append(taskCreated(env(w, `t-${i}`), { title: `task ${i}` }));
    w.checkpoint(); // 0..3, prev=null
    for (let i = 4; i < 8; i += 1) w.append(taskCreated(env(w, `t-${i}`), { title: `task ${i}` }));
    w.checkpoint(); // 4..7, prev=hash(0..3)

    // Drop the FIRST checkpoint, keep the second. The second's prev now links to
    // a checkpoint that is gone → chain break.
    const tail = tailIdOf(root);
    const cpFile = join(root, 'tails', tail, 'checkpoints.jsonl');
    const cps = readFileSync(cpFile, 'utf-8').split('\n').filter(Boolean);
    writeFileSync(cpFile, `${cps[1]}\n`); // keep only 4..7
    const result = verify(root);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => /chain break/.test(i.detail))).toBe(true);
  });
});

describe('chain — tolerates a torn final line, rejects mid-file corruption', () => {
  it('drops a torn trailing write (crash mid-append) so verify and recovery still work', () => {
    writeSome(4, { checkpointEvery: 100 });
    const seg = orderedSegments({ root }, tailIdOf(root))[0] as string;
    // Simulate a crash mid-append: a partial line with NO trailing newline.
    appendFileSync(seg, '{"event":{"kind":"task.created","v":1,"at":"t","who":"h","sub');
    // verify still reads the intact prefix (4 entries), does not throw.
    const result = verify(root);
    expect(result.ok).toBe(true);
    expect(result.tails[0]?.entryCount).toBe(4);
    // A fresh writer recovers and can continue.
    const w = openChainForWriting(root);
    expect(() =>
      w.append(taskCreated(env(w, 't-next'), { title: 'after recovery' })),
    ).not.toThrow();
  });

  it('still throws on a malformed line that is NOT the torn trailing fragment', () => {
    writeSome(4, { checkpointEvery: 100 });
    const seg = orderedSegments({ root }, tailIdOf(root))[0] as string;
    const lines = readFileSync(seg, 'utf-8').split('\n').filter(Boolean);
    // Corrupt a MIDDLE line (has a newline after it) — real corruption.
    lines[1] = '{garbage not json';
    writeFileSync(seg, `${lines.join('\n')}\n`);
    expect(() => verify(root)).toThrow();
  });
});

describe('chain — fullySigned distinguishes authenticated from residual', () => {
  it('is true only when every event is covered by a verified signature', () => {
    writeSome(4, { checkpointEvery: 100 });
    openChainForWriting(root).checkpoint();
    const result = verify(root);
    expect(result.ok).toBe(true);
    expect(result.fullySigned).toBe(true);
    expect(result.uncheckpointedEvents).toBe(0);
    expect(result.summary).toMatch(/all events are signature-covered/);
  });
});

describe('chain — segmentation by size', () => {
  it('spans multiple segments and still verifies', () => {
    // Tiny cap forces a seal every few entries.
    writeSome(20, { maxSegmentBytes: 300, checkpointEvery: 100 });
    const segments = orderedSegments({ root }, tailIdOf(root));
    expect(segments.length).toBeGreaterThan(1);
    const result = verify(root);
    expect(result.ok).toBe(true);
    expect(result.tails[0]?.entryCount).toBe(20);
  });

  it('recovers writer state across process restarts (continues the same tail)', () => {
    writeSome(3, { checkpointEvery: 100 });
    const w2 = openChainForWriting(root); // fresh writer, same tail
    w2.append(taskTransitioned(env(w2, 't-0'), { from: 'ready', to: 'done', action: 'finish' }));
    const result = verify(root);
    expect(result.ok).toBe(true);
    expect(result.tails[0]?.entryCount).toBe(4);
  });
});

describe('chain — aggregation across tails (multi-machine)', () => {
  it('verifies two independently written tails together', () => {
    // Two roots share nothing; copy tail B's directory into tail A's chain to
    // simulate an offline merge (each machine wrote its own tail).
    const rootB = mkdtempSync(join(tmpdir(), 'mnema-chain-b-'));
    try {
      const a = openChainForWriting(root);
      a.append(runStarted(env(a, 'r-a'), { agent: 'claude' }));
      a.checkpoint();
      const b = openChainForWriting(rootB);
      b.append(runStarted(env(b, 'r-b'), { agent: 'cursor' }));
      b.checkpoint();
      // Merge: copy B's tail dir and public key into A's chain.
      mergeTails(rootB, root);
      const result = verify(root);
      expect(result.ok).toBe(true);
      expect(result.tails.length).toBe(2);
    } finally {
      rmSync(rootB, { recursive: true, force: true });
    }
  });
});

describe('chain — census crosses committed keys against tails on disk', () => {
  it('baseline: every tail has its key, so no census note (a two-machine chain)', () => {
    const rootB = mkdtempSync(join(tmpdir(), 'mnema-chain-b-'));
    try {
      const a = openChainForWriting(root);
      a.append(runStarted(env(a, 'r-a'), { agent: 'claude' }));
      a.checkpoint();
      const b = openChainForWriting(rootB);
      b.append(runStarted(env(b, 'r-b'), { agent: 'cursor' }));
      b.checkpoint();
      mergeTails(rootB, root);

      const result = verify(root);
      expect(result.ok).toBe(true);
      expect(result.tails).toHaveLength(2);
      expect(result.census).toEqual([]);
    } finally {
      rmSync(rootB, { recursive: true, force: true });
    }
  });

  it('deleting a tail but LEAVING its key is flagged by the census (still ok, still blind)', () => {
    // The hash chain sees nothing — the deleted tail is simply not read. But the
    // committed key it left behind has no tail, and the census names it. This is
    // the non-adversarial common case (a tail dropped in a botched merge) and
    // the adversarial one (a tail removed to hide events) at once.
    const rootB = mkdtempSync(join(tmpdir(), 'mnema-chain-b-'));
    try {
      const a = openChainForWriting(root);
      a.append(runStarted(env(a, 'r-a'), { agent: 'claude' }));
      a.checkpoint();
      const b = openChainForWriting(rootB);
      b.append(runStarted(env(b, 'r-b'), { agent: 'cursor' }));
      b.checkpoint();
      const tailB = readdirSync(join(rootB, 'tails'))[0] as string;
      mergeTails(rootB, root);

      // Remove tail B's directory but keep keys/<tailB>.pub (the merged key).
      rmSync(join(root, 'tails', tailB), { recursive: true, force: true });

      const result = verify(root);
      // Not an integrity break: the crypto still verifies what remains.
      expect(result.ok).toBe(true);
      expect(result.tails).toHaveLength(1);
      // The census flags the orphaned key by its fingerprint.
      expect(result.census).toHaveLength(1);
      expect(result.census[0]?.fingerprint).toBe(tailB);
      expect(result.summary).toMatch(/committed key\(s\) without a tail/);
    } finally {
      rmSync(rootB, { recursive: true, force: true });
    }
  });

  it('deleting a tail AND its key is invisible — the honest limit only git can witness', () => {
    // With both the tail and its key gone, nothing on disk points at what was
    // removed: the census has nothing to cross. This is the documented residual
    // — local crypto cannot testify to a wholesale deletion; only an external
    // witness (a git history of the committed files) can.
    const rootB = mkdtempSync(join(tmpdir(), 'mnema-chain-b-'));
    try {
      const a = openChainForWriting(root);
      a.append(runStarted(env(a, 'r-a'), { agent: 'claude' }));
      a.checkpoint();
      const b = openChainForWriting(rootB);
      b.append(runStarted(env(b, 'r-b'), { agent: 'cursor' }));
      b.checkpoint();
      const tailB = readdirSync(join(rootB, 'tails'))[0] as string;
      mergeTails(rootB, root);

      // Remove BOTH tail B's directory and its committed public key.
      rmSync(join(root, 'tails', tailB), { recursive: true, force: true });
      rmSync(join(root, 'keys', `${tailB}.pub`), { force: true });

      const result = verify(root);
      expect(result.ok).toBe(true);
      expect(result.tails).toHaveLength(1);
      // Blind on purpose: no orphaned key means no census note.
      expect(result.census).toEqual([]);
    } finally {
      rmSync(rootB, { recursive: true, force: true });
    }
  });
});

describe('chain — crash resilience beyond the torn last entry (audit)', () => {
  it('tolerates a torn last checkpoint line: verify does not throw, reads the intact prefix', () => {
    writeSome(4, { checkpointEvery: 2 });
    openChainForWriting(root, { checkpointEvery: 2 }).checkpoint();
    // A crash while signing a second checkpoint leaves a partial line, no newline.
    appendFileSync(checkpointsPath({ root }, tailIdOf(root)), '{"scheme":"mnema-checkp');
    // Before the fix this THREW a JSON SyntaxError out of verify — a verifier
    // that crashes on a crash artifact instead of reporting is the worst read
    // outcome for a proof product.
    let result!: ReturnType<typeof verify>;
    expect(() => {
      result = verify(root);
    }).not.toThrow();
    expect(result.tails[0]?.entryCount).toBe(4);
  });

  it('a fresh writer resumes after a torn checkpoint instead of being locked out', () => {
    writeSome(4, { checkpointEvery: 2 });
    openChainForWriting(root, { checkpointEvery: 2 }).checkpoint();
    appendFileSync(checkpointsPath({ root }, tailIdOf(root)), '{"scheme":"mnema-checkp');
    // recover() reads the checkpoints; a torn line used to throw from the
    // constructor, wedging the machine shut on its own tail.
    expect(() => {
      const w = openChainForWriting(root, { checkpointEvery: 2 });
      w.append(taskCreated(env(w, 't-after'), { title: 'after crash' }));
    }).not.toThrow();
    expect(verify(root).ok).toBe(true);
  });

  it('heals a torn last entry on recovery so the NEXT append does not bury it', () => {
    writeSome(3, { checkpointEvery: 100 });
    const seg = orderedSegments({ root }, tailIdOf(root))[0] as string;
    // Crash mid-append: a partial line with no trailing newline.
    appendFileSync(seg, '{"event":{"v":1,"kind":"task.created"');
    // Recover + resume. Without the heal, the next complete line lands AFTER the
    // fragment, turning the once-benign torn line into a permanent mid-file
    // corruption that every later read throws on.
    const w = openChainForWriting(root, { checkpointEvery: 100 });
    w.append(taskCreated(env(w, 't-after'), { title: 'after crash' }));
    // Re-read and re-verify AFTER the resume — this is what the old recovery
    // test never did, so it missed the resurrection of the torn fragment.
    let result!: ReturnType<typeof verify>;
    expect(() => {
      result = verify(root);
    }).not.toThrow();
    expect(result.ok).toBe(true);
    expect(result.tails[0]?.entryCount).toBe(4); // 3 intact + the resumed one
  });
});

describe('chain — an entry is bound to the tail directory it lives in (audit)', () => {
  it('rejects a residual tail relocated/duplicated under a fabricated directory name', () => {
    // No checkpoint: the events sit in the residual window, where no checkpoint's
    // own `tail` field can catch a relocation.
    const w = writeSome(2, { checkpointEvery: 1000 });
    void w;
    const realFp = tailIdOf(root);
    const fake = 'f'.repeat(64);
    cpDir(join(root, 'tails', realFp), join(root, 'tails', fake));
    const result = verify(root);
    // Before the fix: verify green, 2 tails, every event counted twice. Now the
    // fabricated tail is caught because its stored link.tail names the original.
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.detail.includes('names tail'))).toBe(true);
  });

  it('rejects a RELABELED residual tail: link.tail rewritten and the keyless hash chain recomputed', () => {
    // The sharper attack the naive relocation test above misses: after copying a
    // residual tail into a fabricated directory, the attacker ALSO rewrites every
    // `link.tail` to the fake name and recomputes the (keyless) hash chain — so
    // `link.tail == <dir>` holds again. No key is needed. The only thing left to
    // catch it is that the fabricated directory name is not a committed key
    // fingerprint. Without that binding this counted every event twice, green.
    const w = writeSome(2, { checkpointEvery: 1000 });
    void w;
    const realFp = tailIdOf(root);
    const fake = 'f'.repeat(64);
    cpDir(join(root, 'tails', realFp), join(root, 'tails', fake));
    const upcasters = catalogUpcasters();
    const seg = orderedSegments({ root }, fake)[0] as string;
    const entries = readFileSync(seg, 'utf-8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as RawEntry);
    let prev: string | null = null;
    for (const entry of entries) {
      entry.link.tail = fake; // relabel so link.tail == <dir> again
      entry.link.prev = prev;
      const event = parseEvent(canonicalStringify(entry.event as never), upcasters);
      entry.link.hash = entryHash({ event, tail: fake, seq: entry.link.seq, prev });
      prev = entry.link.hash;
    }
    writeFileSync(seg, `${entries.map((e) => JSON.stringify(e)).join('\n')}\n`);

    const result = verify(root);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => /not a committed key fingerprint/.test(i.detail))).toBe(true);
  });
});

describe('chain — who != which binding survives a canonical-form bypass (audit)', () => {
  it('rejects a which that equals who after NFC+trim (a trailing-space self-authorization)', () => {
    // Attacker owns their own key (T3): they can sign with a committed key. They
    // set which = who + " ": byte-distinct from who, so a raw compare passes,
    // but the SAME identity the gate refuses as WHO_IS_WHICH.
    const kp = generateKeyPair();
    const fp = kp.fingerprint;
    const who = deriveAnchor(fp);
    const which = `${who} `;
    const event = taskCreated(
      { at: '2026-07-21T00:00:00.000Z', who, signerFp: fp, subject: 't-1', which },
      { title: 'x' },
    );
    const hash = entryHash({ event, tail: fp, seq: 0, prev: null });
    const line = canonicalStringify({
      event: event as never,
      link: { tail: fp, seq: 0, prev: null, hash },
    });
    mkdirSync(segmentPath({ root }, fp, 1).replace(/\/[^/]+$/, ''), { recursive: true });
    writeFileSync(segmentPath({ root }, fp, 1), `${line}\n`);
    mkdirSync(publicKeyPath({ root }, fp).replace(/\/[^/]+$/, ''), { recursive: true });
    writeFileSync(publicKeyPath({ root }, fp), publicKeyToPem(kp.publicKey));
    const cp = signCheckpoint({ tail: fp, fromSeq: 0, events: [event], prev: null, keyPair: kp });
    appendFileSync(checkpointsPath({ root }, fp), `${serializeCheckpoint(cp)}\n`);

    const result = verify(root);
    // Before the fix (raw ===): ok true, self-authorization smuggled below the
    // crypto. Now the canonical compare catches it.
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.detail.includes('identity does not bind'))).toBe(true);
  });
});

// --- helpers that reach into the on-disk format to simulate tampering ---

function tailIdOf(chainRoot: string): string {
  return readdirSync(join(chainRoot, 'tails'))[0] as string;
}

interface RawEntry {
  event: {
    payload: { title: string; [k: string]: unknown };
    who: string;
    signerFp: string;
    [k: string]: unknown;
  };
  link: { tail: string; seq: number; prev: string | null; hash: string };
}

function tamperLine(chainRoot: string, seq: number, mutate: (e: RawEntry) => RawEntry): void {
  const tail = tailIdOf(chainRoot);
  const seg = orderedSegments({ root: chainRoot }, tail)[0] as string;
  const lines = readFileSync(seg, 'utf-8').split('\n').filter(Boolean);
  const idx = lines.findIndex((l) => (JSON.parse(l) as RawEntry).link.seq === seq);
  const entry = JSON.parse(lines[idx] as string) as RawEntry;
  lines[idx] = JSON.stringify(mutate(entry));
  writeFileSync(seg, `${lines.join('\n')}\n`);
}

/**
 * Edits an event's content and then re-derives the entire tail's entry hashes
 * from that seq onward, so the keyless hash chain (T1) is internally consistent
 * again — the exact attack the content-root invariant must still catch.
 */
function repairChainAfterEdit(
  chainRoot: string,
  editSeq: number,
  editTitle: (old: string) => string,
): void {
  const upcasters = catalogUpcasters();
  const tail = tailIdOf(chainRoot);
  const seg = orderedSegments({ root: chainRoot }, tail)[0] as string;
  const lines = readFileSync(seg, 'utf-8').split('\n').filter(Boolean);
  const entries = lines.map((l) => JSON.parse(l) as RawEntry);
  let prev: string | null = null;
  for (const entry of entries) {
    if (entry.link.seq === editSeq) {
      entry.event.payload.title = editTitle(entry.event.payload.title);
    }
    entry.link.prev = prev;
    // Recompute the entry hash from the (possibly edited) event, through the
    // real parser so it matches how the verifier recomputes — this is the
    // adversary "repairing" the keyless chain.
    const event = parseEvent(canonicalStringify(entry.event as never), upcasters);
    entry.link.hash = entryHash({
      event,
      tail: entry.link.tail,
      seq: entry.link.seq,
      prev: entry.link.prev,
    });
    prev = entry.link.hash;
  }
  writeFileSync(seg, `${entries.map((e) => JSON.stringify(e)).join('\n')}\n`);
}

function removePrivateKeys(chainRoot: string): void {
  const dir = join(chainRoot, 'keys');
  for (const name of readdirSync(dir)) {
    if (name.endsWith('.key')) rmSync(join(dir, name));
  }
}

function swapPublicKeyForAStranger(chainRoot: string): void {
  // Overwrite the committed public key with a different (valid) one; the
  // checkpoint signature no longer verifies against it.
  const dir = join(chainRoot, 'keys');
  const pub = readdirSync(dir).find((n) => n.endsWith('.pub')) as string;
  const strangerRoot = mkdtempSync(join(tmpdir(), 'mnema-stranger-'));
  try {
    openChainForWriting(strangerRoot); // mints a fresh pair
    const strangerPub = readdirSync(join(strangerRoot, 'keys')).find((n) =>
      n.endsWith('.pub'),
    ) as string;
    writeFileSync(join(dir, pub), readFileSync(join(strangerRoot, 'keys', strangerPub), 'utf-8'));
  } finally {
    rmSync(strangerRoot, { recursive: true, force: true });
  }
}

function mergeTails(fromRoot: string, intoRoot: string): void {
  const fromTails = join(fromRoot, 'tails');
  const intoTails = join(intoRoot, 'tails');
  for (const tail of readdirSync(fromTails)) {
    cpDir(join(fromTails, tail), join(intoTails, tail));
  }
  const fromKeys = join(fromRoot, 'keys');
  const intoKeys = join(intoRoot, 'keys');
  for (const key of readdirSync(fromKeys)) {
    if (key.endsWith('.pub')) {
      writeFileSync(join(intoKeys, key), readFileSync(join(fromKeys, key), 'utf-8'));
    }
  }
}

function cpDir(from: string, into: string): void {
  mkdirSync(into, { recursive: true });
  cpSync(from, into, { recursive: true });
}
