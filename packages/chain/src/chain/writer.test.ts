/**
 * How a writer resumes an existing tail — and what it refuses to sign.
 *
 * Every operation in the product opens a NEW writer (one process, one write, one
 * forced checkpoint), so this resume path runs on every single write. Each of its
 * reads enters its file from the END and stops at what it came for: the last
 * checkpoint says how far the coverage reaches, the last entry gives the head and
 * the next seq, and the entries above the coverage are what the next checkpoint
 * owes a signature. The events appended in this process are kept in memory, so
 * signing never round-trips through the store.
 *
 * A partial read is only worth having if it answers what the whole read
 * answered, so the two describes below hold each one against the complete reader
 * it replaced. The rest of the value lives in the recovery edges — a crash, a
 * torn line, a line heavier than a read chunk, a range that spans segments, a
 * tail with no checkpoint at all — so each gets a case here. The last describe
 * pins what must NOT have changed: the bytes that get signed.
 */

import {
  appendFileSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { identityFounded, memoryCaptured, taskBirth, taskCreated } from '../events/build.js';
import { EventParseError } from '../events/parse.js';
import { catalogUpcasters } from '../events/registry.js';
import { openChainForWriting, verify } from './chain.js';
import {
  type Checkpoint,
  checkpointHash,
  serializeCheckpoint,
  signCheckpoint,
} from './checkpoint.js';
import type { Entry } from './entry.js';
import { loadOrCreateKeyPair } from './keystore.js';
import { type ChainLayout, checkpointsPath, segmentPath } from './layout.js';
import {
  lastTailCheckpoint,
  orderedSegments,
  readTailCheckpoints,
  readTailEntries,
  readTailTip,
} from './store.js';
import type { ChainWriter } from './writer.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mnema-writer-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const upcasters = catalogUpcasters();

/** A cadence high enough that no checkpoint ever fires on its own. */
const NEVER = 10_000;
/** A segment cap so small that every append rotates — one entry per segment. */
const ONE_PER_SEGMENT = 1;

/** The envelope carries the writer's real identity, as the core's writes do. */
const env = (w: ChainWriter, subject: string) => ({
  at: '2026-07-21T00:00:00.000Z',
  who: w.anchor,
  signerFp: w.signerFingerprint,
  subject,
});

/** Opens a writer whose key root is the chain root — the simple test layout. */
function openChain(opts?: { checkpointEvery?: number; maxSegmentBytes?: number }): ChainWriter {
  return openChainForWriting(root, { keyRoot: root, ...opts });
}

/**
 * Founds this writer's anchor (seq 0 of the tail). Every tail opens with it so
 * its later events satisfy the single identity rule and `verify` can go green.
 */
function found(w: ChainWriter): ChainWriter {
  w.append(identityFounded(env(w, w.anchor), { foundingFp: w.signerFingerprint }));
  return w;
}

function openFounded(opts?: { checkpointEvery?: number; maxSegmentBytes?: number }): ChainWriter {
  return found(openChain(opts));
}

/** Appends `count` tasks, numbered from `from` so their subjects stay distinct. */
function appendTasks(w: ChainWriter, count: number, from = 0): void {
  for (let i = 0; i < count; i += 1) {
    w.append(taskCreated(env(w, `t-${from + i}`), { title: `task ${from + i}` }));
  }
}

/**
 * Forces a checkpoint and insists there was a range to sign. Null means "nothing
 * uncovered", which in these cases would make the assertions that follow vacuous
 * rather than green.
 */
function forceCheckpoint(w: ChainWriter): Checkpoint {
  const cp = w.checkpoint();
  if (cp === null) throw new Error('expected a checkpoint over the uncovered range');
  return cp;
}

const layout = (): ChainLayout => ({ root });

function tailIdOf(): string {
  return readdirSync(join(root, 'tails'))[0] as string;
}

/** The entries physically stored in the tail's last segment. */
function linesInLastSegment(): number {
  const last = orderedSegments(layout(), tailIdOf()).at(-1) as string;
  return readFileSync(last, 'utf-8')
    .split('\n')
    .filter((line) => line.length > 0).length;
}

/**
 * The whole truth about a tail, from the reader that holds all of it. Every tip
 * has to agree with it: the same entries above the coverage, and the same last
 * entry. It cannot be list equality — the tip returns LESS on purpose, stopping
 * at the boundary instead of handing back whole segments — so the agreement is
 * stated over exactly what the tip promises.
 */
function tipAgreesWithTheWholeTail(minSeq: number): Entry[] {
  const all = readTailEntries(layout(), tailIdOf(), upcasters);
  const tip = readTailTip(layout(), tailIdOf(), upcasters, minSeq);
  expect(tip.filter((e) => e.link.seq > minSeq)).toEqual(all.filter((e) => e.link.seq > minSeq));
  expect(tip.at(-1)).toEqual(all.at(-1));
  return tip;
}

describe('reading the tip of a tail', () => {
  it('reads nothing from a tail that has no segment yet', () => {
    openChain(); // creates the tail directory and its proof, but no entry
    expect(readTailTip(layout(), tailIdOf(), upcasters, -1)).toEqual([]);
  });

  it('reads only the last segment when every event is already checkpointed', () => {
    const w = openFounded({ checkpointEvery: NEVER, maxSegmentBytes: ONE_PER_SEGMENT });
    appendTasks(w, 4);
    const cp = forceCheckpoint(w);
    expect(cp.toSeq).toBe(4); // the founding plus 4 tasks, all covered

    const tip = readTailTip(layout(), tailIdOf(), upcasters, cp.toSeq);
    // The last segment holds the last entry, which is all a covered tail is
    // asked for — so five segments are read one segment deep.
    expect(orderedSegments(layout(), tailIdOf())).toHaveLength(5);
    expect(linesInLastSegment()).toBe(1);
    expect(tip.map((e) => e.link.seq)).toEqual([4]);
  });

  it('walks back a segment when the uncheckpointed range crosses a boundary', () => {
    const w = openFounded({ checkpointEvery: NEVER, maxSegmentBytes: ONE_PER_SEGMENT });
    appendTasks(w, 1);
    expect(forceCheckpoint(w).toSeq).toBe(1);
    appendTasks(w, 3, 1); // seq 2, 3, 4 — one per segment

    // Everything above seq 1 is in hand, and the walk stopped at the segment
    // holding the boundary instead of reading the whole tail.
    const tip = readTailTip(layout(), tailIdOf(), upcasters, 1);
    expect(tip.map((e) => e.link.seq)).toEqual([1, 2, 3, 4]);
  });

  it('reads the whole tail when no checkpoint covers any of it', () => {
    const w = openFounded({ checkpointEvery: NEVER, maxSegmentBytes: ONE_PER_SEGMENT });
    appendTasks(w, 3);

    // minSeq -1: nothing is covered, so the next checkpoint has to start at seq
    // 0 and the tip owes every event. Reading the whole tail IS the answer.
    const tip = readTailTip(layout(), tailIdOf(), upcasters, -1);
    expect(tip.map((e) => e.link.seq)).toEqual([0, 1, 2, 3]);
  });

  it('walks past a last segment that the heal emptied', () => {
    const w = openFounded({ checkpointEvery: NEVER, maxSegmentBytes: ONE_PER_SEGMENT });
    appendTasks(w, 2); // seq 0..2, one per segment
    // A crash left a segment holding nothing but a torn fragment, which a
    // recovering writer truncated to empty. The walk must keep going back.
    writeFileSync(segmentPath(layout(), tailIdOf(), 4), '', 'utf-8');

    const tip = readTailTip(layout(), tailIdOf(), upcasters, 2);
    expect(tip.map((e) => e.link.seq)).toEqual([2]);
  });

  it('reads the lines above the coverage, not the segment holding them', () => {
    const w = openFounded({ checkpointEvery: NEVER });
    appendTasks(w, 200);
    expect(forceCheckpoint(w).toSeq).toBe(200);
    appendTasks(w, 2, 200); // seq 201, 202, into the same segment

    // 203 entries sit in that one segment; the walk stops after three lines.
    expect(linesInLastSegment()).toBe(203);
    expect(tipAgreesWithTheWholeTail(200).map((e) => e.link.seq)).toEqual([200, 201, 202]);
  });

  it('agrees with the whole tail on every shape of coverage', () => {
    const w = openFounded({ checkpointEvery: NEVER, maxSegmentBytes: ONE_PER_SEGMENT });
    appendTasks(w, 3); // seq 0..3, one per segment
    tipAgreesWithTheWholeTail(-1); // nothing covered: the tip owes the whole tail
    expect(forceCheckpoint(w).toSeq).toBe(3);
    tipAgreesWithTheWholeTail(3); // fully covered: only the head is owed
    appendTasks(w, 2, 3); // seq 4, 5
    tipAgreesWithTheWholeTail(3); // a boundary two segments back
  });

  it('agrees with the whole tail when a crash tore the last line', () => {
    const w = openFounded({ checkpointEvery: NEVER });
    appendTasks(w, 2);
    const segment = segmentPath(layout(), tailIdOf(), 1);
    writeFileSync(segment, `${readFileSync(segment, 'utf-8')}{"event":{"kin`, 'utf-8');

    // Both readers drop the fragment, so both see the same tail — the tolerance
    // is one rule, reached from either direction.
    expect(tipAgreesWithTheWholeTail(-1).map((e) => e.link.seq)).toEqual([0, 1, 2]);
  });
});

describe('reading the last checkpoint of a tail', () => {
  /**
   * The backward read has to answer exactly what taking the last of the whole
   * file answered — that is the behaviour it replaces, and the writer's coverage
   * and its checkpoint chain both hang off it.
   */
  function agreesWithTheWholeFile(): Checkpoint | undefined {
    const last = lastTailCheckpoint(layout(), tailIdOf());
    expect(last).toEqual(readTailCheckpoints(layout(), tailIdOf()).at(-1));
    return last;
  }

  it('finds nothing when the tail has never checkpointed', () => {
    openChain(); // the tail directory and its proof exist; the file does not
    expect(agreesWithTheWholeFile()).toBeUndefined();
  });

  it('finds nothing in an empty checkpoints file', () => {
    openFounded({ checkpointEvery: NEVER });
    writeFileSync(checkpointsPath(layout(), tailIdOf()), '', 'utf-8');
    expect(agreesWithTheWholeFile()).toBeUndefined();
  });

  it('finds the only checkpoint of a tail that has one', () => {
    const w = openFounded({ checkpointEvery: NEVER });
    const only = forceCheckpoint(w);
    expect(agreesWithTheWholeFile()).toEqual(only);
  });

  it('finds the last of many', () => {
    const w = openFounded({ checkpointEvery: NEVER });
    forceCheckpoint(w);
    appendTasks(w, 2);
    forceCheckpoint(w);
    appendTasks(w, 2, 2);
    const third = forceCheckpoint(w);
    expect(agreesWithTheWholeFile()).toEqual(third);
  });

  it('drops a torn last line that fails to parse and takes the one before it', () => {
    const w = openFounded({ checkpointEvery: NEVER });
    const intact = forceCheckpoint(w);
    appendFileSync(checkpointsPath(layout(), tailIdOf()), '{"tail":"m-', 'utf-8');

    expect(agreesWithTheWholeFile()).toEqual(intact);
  });

  it('takes a torn last line that happens to parse, as the whole-file read does', () => {
    const w = openFounded({ checkpointEvery: NEVER });
    appendTasks(w, 1);
    const last = forceCheckpoint(w);
    const file = checkpointsPath(layout(), tailIdOf());
    truncateSync(file, readFileSync(file).length - 1); // every byte but the newline

    expect(agreesWithTheWholeFile()).toEqual(last);
  });

  it('takes the last line STORED, not the highest seq it holds', () => {
    const w = openFounded({ checkpointEvery: NEVER });
    const first = forceCheckpoint(w);
    appendTasks(w, 2);
    const second = forceCheckpoint(w);
    const file = checkpointsPath(layout(), tailIdOf());
    const lines = readFileSync(file, 'utf-8')
      .split('\n')
      .filter((line) => line.length > 0);
    writeFileSync(file, `${[lines[1], lines[0]].join('\n')}\n`, 'utf-8');

    // A tail has one writer, so stored order IS seq order and the two readings
    // coincide; reading the highest instead would be a change of behaviour
    // dressed as an optimization. Out of order, the last one stored wins.
    expect(second.toSeq).toBeGreaterThan(first.toSeq); // else this proves nothing
    expect(agreesWithTheWholeFile()).toEqual(first);
  });

  it('is indifferent to corruption further up, which the whole-file read is not', () => {
    const w = openFounded({ checkpointEvery: NEVER });
    forceCheckpoint(w);
    appendTasks(w, 2);
    const last = forceCheckpoint(w);
    const file = checkpointsPath(layout(), tailIdOf());
    const lines = readFileSync(file, 'utf-8')
      .split('\n')
      .filter((line) => line.length > 0);
    writeFileSync(file, `{"tail":"broken"\n${lines[1]}\n`, 'utf-8');

    // The declared cost of not reading the file: a malformed line the writer no
    // longer trips over. It costs the proof nothing — the verifier reads every
    // checkpoint, and it is what reports the file.
    expect(() => readTailCheckpoints(layout(), tailIdOf())).toThrow();
    expect(lastTailCheckpoint(layout(), tailIdOf())).toEqual(last);
  });
});

describe('the writer resumes from the end of the tail', () => {
  it('starts a fresh tail at seq 0 with nothing to sign', () => {
    const w = openChain();
    expect(w.checkpoint()).toBeNull(); // no event, no range, no signature
    const first = w.append(identityFounded(env(w, w.anchor), { foundingFp: w.signerFingerprint }));
    expect(first.link.seq).toBe(0);
    expect(first.link.prev).toBeNull();
  });

  it('has nothing left to sign on a fully checkpointed tail, and continues the seq', () => {
    const first = openFounded({ checkpointEvery: NEVER });
    appendTasks(first, 3);
    expect(forceCheckpoint(first).toSeq).toBe(3);
    const headHash = readTailEntries(layout(), tailIdOf(), upcasters).at(-1)?.link.hash;

    const resumed = openChain({ checkpointEvery: NEVER });
    expect(resumed.checkpoint()).toBeNull(); // the buffer refilled empty
    const next = resumed.append(taskCreated(env(resumed, 't-next'), { title: 'next' }));
    expect(next.link.seq).toBe(4);
    expect(next.link.prev).toBe(headHash);
    expect(verify(root).ok).toBe(true);
  });

  it('signs the events a crash left uncheckpointed, contiguously from the coverage', () => {
    const crashed = openFounded({ checkpointEvery: NEVER });
    appendTasks(crashed, 2); // seq 0..2
    expect(forceCheckpoint(crashed).toSeq).toBe(2);
    appendTasks(crashed, 4, 2); // seq 3..6, and then the process dies

    const resumed = openChain({ checkpointEvery: NEVER });
    const cp = forceCheckpoint(resumed);
    // Coverage stays contiguous: the next checkpoint starts at the seq right
    // after the last covered one and reaches the head.
    expect(cp.fromSeq).toBe(3);
    expect(cp.toSeq).toBe(6);
    const result = verify(root);
    expect(result.ok).toBe(true);
    expect(result.fullySigned).toBe(true);
  });

  it('signs an uncheckpointed range that crosses segment boundaries whole', () => {
    const crashed = openFounded({ checkpointEvery: NEVER, maxSegmentBytes: ONE_PER_SEGMENT });
    appendTasks(crashed, 1);
    expect(forceCheckpoint(crashed).toSeq).toBe(1);
    appendTasks(crashed, 3, 1); // seq 2..4, one segment each

    const resumed = openChain({ checkpointEvery: NEVER, maxSegmentBytes: ONE_PER_SEGMENT });
    const cp = forceCheckpoint(resumed);
    expect(cp.fromSeq).toBe(2);
    expect(cp.toSeq).toBe(4);
    const result = verify(root);
    expect(result.ok).toBe(true);
    expect(result.fullySigned).toBe(true);
  });

  it('does not take a torn fragment that happens to parse as the head', () => {
    const w = openFounded({ checkpointEvery: NEVER });
    appendTasks(w, 2); // seq 0..2
    const survivor = readTailEntries(layout(), tailIdOf(), upcasters).at(-2);

    // A crash that wrote every byte of the last line but not its newline leaves
    // a fragment that PARSES. The heal truncates it, so it must not become the
    // head: an append chained to an entry no longer on disk would break the
    // chain for every later read.
    const segment = segmentPath(layout(), tailIdOf(), 1);
    truncateSync(segment, readFileSync(segment).length - 1);

    const resumed = openChain({ checkpointEvery: NEVER });
    const next = resumed.append(taskCreated(env(resumed, 't-after'), { title: 'after' }));
    expect(next.link.seq).toBe(2);
    expect(next.link.prev).toBe(survivor?.link.hash);
    resumed.checkpoint();
    const result = verify(root);
    expect(result.ok).toBe(true);
    expect(result.fullySigned).toBe(true);
  });

  it('does not take a torn fragment that fails to parse as the head', () => {
    const w = openFounded({ checkpointEvery: NEVER });
    appendTasks(w, 2);
    const head = readTailEntries(layout(), tailIdOf(), upcasters).at(-1);

    const segment = segmentPath(layout(), tailIdOf(), 1);
    writeFileSync(segment, `${readFileSync(segment, 'utf-8')}{"event":{"kin`, 'utf-8');

    const resumed = openChain({ checkpointEvery: NEVER });
    const next = resumed.append(taskCreated(env(resumed, 't-after'), { title: 'after' }));
    expect(next.link.seq).toBe(3);
    expect(next.link.prev).toBe(head?.link.hash);
    resumed.checkpoint();
    expect(verify(root).ok).toBe(true);
  });

  it('resumes a tail whose last entry outweighs a read chunk', () => {
    // A free-text field is capped at 64 KiB, so one entry can be heavier than
    // the chunk the backward walk reads in. Nothing may assume a line fits.
    const w = openFounded({ checkpointEvery: NEVER });
    w.append(memoryCaptured(env(w, 'm-big'), { content: 'z'.repeat(80 * 1024) }));
    const head = forceCheckpoint(w);

    const resumed = openChain({ checkpointEvery: NEVER });
    const next = resumed.append(taskCreated(env(resumed, 't-after'), { title: 'after' }));
    expect(next.link.seq).toBe(2);
    expect(lastTailCheckpoint(layout(), tailIdOf())).toEqual(head);
    resumed.checkpoint();
    expect(verify(root).ok).toBe(true);
  });

  it('heals a torn fragment heavier than a read chunk', () => {
    const w = openFounded({ checkpointEvery: NEVER });
    appendTasks(w, 1);
    const head = readTailEntries(layout(), tailIdOf(), upcasters).at(-1);
    const segment = segmentPath(layout(), tailIdOf(), 1);
    // A crash mid-append of a big entry: the fragment spans several chunks, and
    // the heal has to cut back to the newline above all of them.
    appendFileSync(segment, `{"event":{"kind":"${'k'.repeat(80 * 1024)}`, 'utf-8');

    const resumed = openChain({ checkpointEvery: NEVER });
    const next = resumed.append(taskCreated(env(resumed, 't-after'), { title: 'after' }));
    expect(next.link.seq).toBe(2);
    expect(next.link.prev).toBe(head?.link.hash);
    resumed.checkpoint();
    expect(verify(root).ok).toBe(true);
  });

  it('covers a batch bigger than the checkpoint cadence with one checkpoint', () => {
    const w = openChain({ checkpointEvery: 2 });
    found(w); // seq 0 — one event short of the cadence
    const batch = [
      ...taskBirth(env(w, 't-1'), { title: 'ship', initial: 'draft' }),
      ...taskBirth(env(w, 't-2'), { title: 'ship too', initial: 'draft' }),
      taskCreated(env(w, 't-3'), { title: 'third' }),
    ];
    w.appendAll(batch); // seq 1..5 in a single write

    // The cadence fires once, after the batch landed, and the one checkpoint it
    // signs covers the whole batch plus the founding below it.
    const result = verify(root);
    expect(result.ok).toBe(true);
    expect(result.fullySigned).toBe(true);
    expect(result.tails[0]?.checkpointedThrough).toBe(5);
  });

  it('refuses to sign when the buffered events do not fill the range', () => {
    const w = openFounded({ checkpointEvery: NEVER });
    appendTasks(w, 3); // seq 0..3, none of them covered

    // A lost line is a gap: the last entry still says seq 3, so the range is
    // 0..3, but only three events read back. Signing a content root over three
    // events while claiming four would be a silent break of the proof.
    const segment = segmentPath(layout(), tailIdOf(), 1);
    const lines = readFileSync(segment, 'utf-8')
      .split('\n')
      .filter((line) => line.length > 0);
    writeFileSync(segment, `${[lines[0], lines[2], lines[3]].join('\n')}\n`, 'utf-8');

    const resumed = openChain({ checkpointEvery: NEVER });
    expect(() => resumed.checkpoint()).toThrow(/seq 0\.\.3: the range covers 4 event\(s\) but 3/);
  });
});

describe('the bytes a checkpoint signs did not change', () => {
  /** What the previous implementation signed: a re-read of the whole tail, filtered to the range. */
  function signFromAReReadOfTheTail(fromSeq: number, toSeq: number, prev: string | null) {
    const events = readTailEntries(layout(), tailIdOf(), upcasters)
      .filter((e) => e.link.seq >= fromSeq && e.link.seq <= toSeq)
      .map((e) => e.event);
    return signCheckpoint({
      tail: tailIdOf(),
      fromSeq,
      events,
      prev,
      keyPair: loadOrCreateKeyPair({ root }),
    });
  }

  it('signs byte-identical checkpoints to the ones a re-read of the tail produces', () => {
    const w = openFounded({ checkpointEvery: NEVER });
    appendTasks(w, 3);

    // Ed25519 is deterministic, so equal bytes here means the signed message —
    // and therefore the content root over the events — is the same set.
    const firstReRead = signFromAReReadOfTheTail(0, 3, null);
    expect(serializeCheckpoint(forceCheckpoint(w))).toBe(serializeCheckpoint(firstReRead));

    // And again for a CHAINED checkpoint, where `prev` is part of the signed
    // message: a divergence in the link would show up here and nowhere else.
    appendTasks(w, 2, 3);
    const secondReRead = signFromAReReadOfTheTail(4, 5, checkpointHash(firstReRead));
    expect(serializeCheckpoint(forceCheckpoint(w))).toBe(serializeCheckpoint(secondReRead));
  });

  it('signs the canonical form of a payload the caller did not hand over in NFC', () => {
    // The one place an in-memory event and a re-read one could genuinely differ:
    // the stored line is canonical (NFC-normalized), so a writer signing what it
    // holds in memory must land on the same bytes as one signing what it read
    // back. A decomposed "café" is that case.
    // Spelled with escapes so a normalizing editor cannot quietly recompose it.
    const decomposed = 'cafe\u0301 — deja\u0300 vu';
    expect(decomposed).not.toBe(decomposed.normalize('NFC')); // else this proves nothing
    const w = openFounded({ checkpointEvery: NEVER });
    w.append(memoryCaptured(env(w, 'm-1'), { content: decomposed }));

    const reRead = signFromAReReadOfTheTail(0, 1, null);
    const signed = forceCheckpoint(w);
    expect(signed.contentRoot).toBe(reRead.contentRoot);
    expect(serializeCheckpoint(signed)).toBe(serializeCheckpoint(reRead));
    expect(verify(root).ok).toBe(true);
  });
});

/**
 * The floor under every writing path: what no reader could accept is never sealed.
 *
 * This is the guard that makes the property structural rather than adopted. The
 * core asks the same question at each of its write operations and reports a typed
 * refusal, which is what a person or an agent reads — but an operation added
 * tomorrow that forgot to ask, or a caller of `@mnema/chain` outside this
 * workspace, would otherwise put an unreadable entry on the tail and leave every
 * later read of that tree failing, forever. These two doors are the only way onto
 * a tail, so a check in them holds for all of them.
 *
 * The assertion is always the pair: it THREW, and the tail is byte-for-byte what
 * it was. A refusal that still moved the head, rotated a segment or buffered an
 * event for the next checkpoint would be worse than the corruption it prevents.
 */
describe('the writer refuses what no reader could accept', () => {
  /** Every byte of every segment of the tail, so "nothing changed" is checkable. */
  function tailBytes(): string {
    return orderedSegments(layout(), tailIdOf())
      .map((segment) => readFileSync(segment, 'utf-8'))
      .join('');
  }

  it('throws on append and leaves the tail exactly as it was', () => {
    const w = found(openChain({ checkpointEvery: NEVER }));
    w.append(memoryCaptured(env(w, 'm-1'), { content: 'a real memory' }));
    const before = tailBytes();

    expect(() => w.append(taskCreated(env(w, 't-1'), { title: '' }))).toThrow(EventParseError);
    expect(() => w.append(taskCreated(env(w, 't-1'), { title: '' }))).toThrow(
      /needs a non-empty string at payload\.title/,
    );
    expect(() => w.append(memoryCaptured(env(w, ''), { content: 'c' }))).toThrow(
      /needs a non-empty string at subject/,
    );

    expect(tailBytes()).toBe(before);
    // And the writer is still usable: a refusal is not a poisoned writer.
    const entry = w.append(memoryCaptured(env(w, 'm-2'), { content: 'after' }));
    expect(entry.link.seq).toBe(2);
  });

  it('throws on appendAll before sealing ANY of the batch', () => {
    // The atom has to hold for the refusal too. A birth pair whose SECOND event is
    // unreadable must not leave the first on the tail: a `task.created` with no
    // state burns the id permanently, because the projection drops a stateless
    // subject and every later move on it answers UNKNOWN_TASK.
    const w = found(openChain({ checkpointEvery: NEVER }));
    const before = tailBytes();

    const birth = taskBirth(env(w, 't-1'), { title: 'a real title', initial: 'DRAFT' });
    const torn = [birth[0], { ...birth[1], payload: { ...birth[1].payload, to: '' } }];
    expect(() => w.appendAll(torn as typeof birth)).toThrow(
      /needs a non-empty string at payload\.to/,
    );
    expect(tailBytes()).toBe(before);

    // The good pair still lands, whole.
    expect(w.appendAll(birth).length).toBe(2);
    expect(tailBytes()).not.toBe(before);
  });

  it('refuses BEFORE rotating a segment, so a bad event does not cost a file', () => {
    // Ordering, stated as behaviour: the check runs ahead of the size decision, so
    // a refused event never leaves a fresh empty segment behind for the next write
    // to land in.
    const w = found(openChain({ checkpointEvery: NEVER, maxSegmentBytes: ONE_PER_SEGMENT }));
    const segmentsBefore = orderedSegments(layout(), tailIdOf()).length;
    expect(() => w.append(taskCreated(env(w, 't-1'), { title: '' }))).toThrow(EventParseError);
    expect(orderedSegments(layout(), tailIdOf()).length).toBe(segmentsBefore);
  });

  it('never signs a checkpoint over an event it refused', () => {
    // The buffer is what the next checkpoint signs. A refused event that reached it
    // would make the coverage claim a range the bytes do not contain — an honest
    // tail then reads as tampered.
    const w = found(openChain({ checkpointEvery: NEVER }));
    expect(() => w.append(memoryCaptured(env(w, ''), { content: 'c' }))).toThrow(EventParseError);
    w.append(memoryCaptured(env(w, 'm-1'), { content: 'one' }));
    // The founding plus this one event is the whole range the checkpoint claims.
    // Had the refusal been buffered, the buffer would hold three where the range
    // covers two and signing would throw on the mismatch — which is the loud
    // version of the silent break this asserts against.
    const cp = forceCheckpoint(w);
    expect([cp.fromSeq, cp.toSeq]).toEqual([0, 1]);
    expect(verify(root).ok).toBe(true);
  });
});
