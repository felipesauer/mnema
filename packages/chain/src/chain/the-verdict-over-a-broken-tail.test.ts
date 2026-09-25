/**
 * THE WHOLE VERDICT OVER A TAIL THAT DOES NOT CHAIN — pinned, for the shapes where a shorter
 * route to a checkpoint's range could answer something else.
 *
 * The verifier finds the entries a checkpoint covers without walking the tail (`range.ts`).
 * For a tail whose seqs run 0, 1, 2 … every route agrees; these are the tails where routes
 * part: an entry appended twice, at the end and in the middle; a line cut out; two lines
 * swapped. T1 refuses every one of them, and that is not what is asked here. What is asked
 * is what EVERY layer says, because the T2/T4 findings over those same bytes, the coverage
 * and the count left unsigned are all part of the verdict a reader is handed — and a slice
 * taken by position would change each of them while T1 went on saying the same thing.
 *
 * Every expectation below is the verdict the verifier gave while it still took each range
 * with a `filter` over the whole tail: this file was run against that verifier, unchanged,
 * and passed there.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { identityFounded, memoryCaptured } from '../events/build.js';
import { openChainForWriting, verify } from './chain.js';
import { segmentPath } from './layout.js';
import { listTails } from './store.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mnema-broken-tail-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/**
 * A founded tail of six entries, seq 0 to 5, each its own act and each act signed — the
 * product's cadence, so checkpoint `i` covers exactly seq `i`. Returns the tail and the
 * stored lines of its one segment, in order, without the final newline.
 */
function sixSignedActs(): { tail: string; lines: string[] } {
  const w = openChainForWriting(root, { keyRoot: root });
  const at = (i: number) => `2026-09-25T00:00:0${i}.000Z`;
  w.append(
    identityFounded(
      { at: at(0), who: w.anchor, signerFp: w.signerFingerprint, subject: w.anchor },
      { foundingFp: w.signerFingerprint },
    ),
  );
  w.checkpoint();
  for (let i = 1; i <= 5; i += 1) {
    w.append(
      memoryCaptured(
        { at: at(i), who: w.anchor, signerFp: w.signerFingerprint, subject: `m-${i}` },
        { content: `note ${i}` },
      ),
    );
    w.checkpoint();
  }
  const [tail] = listTails({ root });
  if (tail === undefined) throw new Error('the writer left no tail');
  const lines = readFileSync(segmentPath({ root }, tail, 1), 'utf-8').split('\n');
  if (lines.pop() !== '' || lines.length !== 6) throw new Error('expected six stored lines');
  return { tail, lines };
}

/** Rewrites the tail's segment to hold exactly `lines`, in that order. */
function storeLines(tail: string, lines: readonly string[]): void {
  writeFileSync(segmentPath({ root }, tail, 1), `${lines.join('\n')}\n`, 'utf-8');
}

/** What the verdict says about the one tail, in the terms a reader is handed. */
function verdictOf(tail: string) {
  const result = verify(root);
  const [only] = result.tails;
  return {
    level: result.level,
    ok: result.ok,
    fullySigned: result.fullySigned,
    entryCount: only?.entryCount,
    checkpointedThrough: only?.checkpointedThrough,
    uncheckpointedEvents: result.uncheckpointedEvents,
    issues: result.issues,
    coverage: result.clauses.find((clause) => clause.of === 'coverage')?.text,
    tails: result.tails.map((t) => t.tail),
    tail,
  };
}

const chainBreak = (tail: string, seq: number) => ({
  tail,
  layer: 'T2/T4',
  seq,
  detail: 'checkpoint chain break: prev does not link to the previous checkpoint',
});

describe('the verdict over a tail that does not chain', () => {
  it('is the sound verdict over the sound tail, which every route agrees on', () => {
    const { tail } = sixSignedActs();
    expect(verdictOf(tail)).toEqual({
      level: 'fully-signed',
      ok: true,
      fullySigned: true,
      entryCount: 6,
      checkpointedThrough: 5,
      uncheckpointedEvents: 0,
      issues: [],
      coverage: 'all events are signature-covered',
      tails: [tail],
      tail,
    });
  });

  it('counts BOTH copies of an entry appended twice at the end, so its checkpoint fails', () => {
    const { tail, lines } = sixSignedActs();
    storeLines(tail, [...lines, lines[5] as string]);
    expect(verdictOf(tail)).toEqual({
      level: 'broken',
      ok: false,
      fullySigned: false,
      entryCount: 7,
      checkpointedThrough: 4,
      uncheckpointedEvents: 2,
      issues: [
        { tail, layer: 'T1', seq: 5, detail: 'seq gap: expected 6, found 5' },
        { tail, layer: 'T2/T4', seq: 5, detail: 'checkpoint failed: range-mismatch' },
      ],
      coverage:
        '2 event(s) above the last checkpoint are hash-chained but NOT yet signature-covered',
      tails: [tail],
      tail,
    });
  });

  it('counts both copies of an entry appended twice in the middle, and every later checkpoint loses its link', () => {
    const { tail, lines } = sixSignedActs();
    storeLines(tail, [...lines.slice(0, 3), lines[2] as string, ...lines.slice(3)]);
    expect(verdictOf(tail)).toEqual({
      level: 'broken',
      ok: false,
      fullySigned: false,
      entryCount: 7,
      checkpointedThrough: 1,
      uncheckpointedEvents: 5,
      issues: [
        { tail, layer: 'T1', seq: 2, detail: 'seq gap: expected 3, found 2' },
        { tail, layer: 'T2/T4', seq: 2, detail: 'checkpoint failed: range-mismatch' },
        chainBreak(tail, 3),
        chainBreak(tail, 4),
        chainBreak(tail, 5),
      ],
      coverage:
        '5 event(s) above the last checkpoint are hash-chained but NOT yet signature-covered',
      tails: [tail],
      tail,
    });
  });

  it('finds NOTHING under the checkpoint of a line cut out, rather than the entry after it', () => {
    const { tail, lines } = sixSignedActs();
    storeLines(tail, [...lines.slice(0, 2), ...lines.slice(3)]);
    expect(verdictOf(tail)).toEqual({
      level: 'broken',
      ok: false,
      fullySigned: false,
      entryCount: 5,
      checkpointedThrough: 1,
      uncheckpointedEvents: 3,
      issues: [
        { tail, layer: 'T1', seq: 3, detail: 'seq gap: expected 2, found 3' },
        { tail, layer: 'T2/T4', seq: 2, detail: 'checkpoint failed: range-mismatch' },
        chainBreak(tail, 3),
        chainBreak(tail, 4),
        chainBreak(tail, 5),
      ],
      coverage:
        '3 event(s) above the last checkpoint are hash-chained but NOT yet signature-covered',
      tails: [tail],
      tail,
    });
  });

  it('finds each entry of two swapped lines by its seq, so every checkpoint still verifies', () => {
    const { tail, lines } = sixSignedActs();
    storeLines(tail, [
      ...lines.slice(0, 2),
      lines[3] as string,
      lines[2] as string,
      ...lines.slice(4),
    ]);
    expect(verdictOf(tail)).toEqual({
      level: 'broken',
      ok: false,
      fullySigned: false,
      entryCount: 6,
      checkpointedThrough: 5,
      uncheckpointedEvents: 0,
      issues: [{ tail, layer: 'T1', seq: 3, detail: 'seq gap: expected 2, found 3' }],
      coverage: 'all events are signature-covered',
      tails: [tail],
      tail,
    });
  });
});
