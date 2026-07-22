/**
 * System invariants of the proof engine, checked over MANY generated chains
 * rather than a single hand-built one. The unit tests pin each piece; these pin
 * the properties that must hold for the whole verifier across shapes — the kind
 * of claim a one-off example can pass while a general truth quietly fails.
 *
 * The generator is deterministic (no wall clock, no randomness): chains vary by
 * event count and checkpoint cadence over a dense table, so a failure reproduces
 * exactly. The same invariants are asserted for a single tail AND for chains
 * aggregated from several tails (several machines merged into one chain) and
 * from tails spanning several segments — the shapes a real chain actually takes,
 * where a per-tail truth can hold while its aggregate quietly does not:
 *
 *   - HONESTY: a chain written honestly always verifies (`ok`), and
 *     `fullySigned` is true precisely when no event sits above a last
 *     checkpoint (`uncheckpointedEvents === 0`). The verdict never overstates
 *     (fullySigned with a residual) nor understates (a broken honest chain).
 *   - RESIDUAL ACCOUNTING: `uncheckpointedEvents` equals the events written
 *     after the last checkpoint fired — summed across every tail — the declared,
 *     honest keyless window.
 */

import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { taskCreated } from '../events/build.js';
import { openChainForWriting, verify } from './chain.js';
import { orderedSegments } from './store.js';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mnema-inv-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const env = (w: { anchor: string; signerFingerprint: string }, subject: string) => ({
  at: '2026-07-21T00:00:00.000Z',
  who: w.anchor,
  signerFp: w.signerFingerprint,
  subject,
});

/** Writes `count` events with the given checkpoint cadence and returns the writer. */
function writeChain(count: number, checkpointEvery: number) {
  const w = openChainForWriting(root, { checkpointEvery });
  for (let i = 0; i < count; i += 1) {
    w.append(taskCreated(env(w, `t-${i}`), { title: `task ${i}` }));
  }
  return w;
}

/**
 * The residual of one tail: the events left above its last checkpoint. A
 * checkpoint fires each time `every` more events accumulate, so
 * `floor(count/every)*every` events are covered (0 when `every > count`, all of
 * them when `every` divides `count`).
 */
function residualOf(count: number, every: number): number {
  return count - Math.floor(count / every) * every;
}

/** One tail's shape in a multi-tail chain. */
interface TailSpec {
  readonly count: number;
  readonly every: number;
  readonly maxSegmentBytes?: number;
}

/**
 * Writes each spec as its OWN tail (a separate root mints a distinct key, so the
 * tails never collide) and merges them all into `root`, the way independently
 * written machines are merged offline: copy each tail directory and its
 * committed public key. Returns the summed residual expected across the tails.
 */
function writeManyTails(specs: readonly TailSpec[]): number {
  let expectedResidual = 0;
  for (const spec of specs) {
    const tailRoot = mkdtempSync(join(tmpdir(), 'mnema-inv-tail-'));
    try {
      const w = openChainForWriting(tailRoot, {
        checkpointEvery: spec.every,
        maxSegmentBytes: spec.maxSegmentBytes,
      });
      for (let i = 0; i < spec.count; i += 1) {
        w.append(taskCreated(env(w, `t-${i}`), { title: `task ${i}` }));
      }
      mergeInto(tailRoot, root);
      expectedResidual += residualOf(spec.count, spec.every);
    } finally {
      rmSync(tailRoot, { recursive: true, force: true });
    }
  }
  return expectedResidual;
}

/** Copies every tail directory and committed public key from one chain into another. */
function mergeInto(fromRoot: string, intoRoot: string): void {
  const fromTails = join(fromRoot, 'tails');
  const intoTails = join(intoRoot, 'tails');
  for (const tail of readdirSync(fromTails)) {
    const dest = join(intoTails, tail);
    cpSync(join(fromTails, tail), dest, { recursive: true });
  }
  const fromKeys = join(fromRoot, 'keys');
  const intoKeys = join(intoRoot, 'keys');
  for (const key of readdirSync(fromKeys)) {
    if (key.endsWith('.pub')) {
      cpSync(join(fromKeys, key), join(intoKeys, key));
    }
  }
}

describe('invariant — an honestly written chain always verifies', () => {
  // A dense table of shapes: counts spanning empty/one/many, cadences that fire
  // never, exactly on boundaries, and mid-batch.
  const counts = [0, 1, 2, 3, 5, 8, 16, 33];
  const cadences = [1, 2, 3, 4, 8, 1000];

  for (const count of counts) {
    for (const every of cadences) {
      it(`ok is true for ${count} events, checkpointEvery=${every}`, () => {
        writeChain(count, every);
        const r = verify(root);
        expect(r.ok).toBe(true);
        expect(r.issues).toEqual([]);
      });
    }
  }
});

describe('invariant — fullySigned iff no residual, and residual accounting is exact', () => {
  const counts = [0, 1, 2, 3, 5, 8, 16, 33];
  const cadences = [1, 2, 4, 1000];

  for (const count of counts) {
    for (const every of cadences) {
      it(`fullySigned <=> uncheckpointed==0 for ${count} events, every=${every}`, () => {
        writeChain(count, every);
        const r = verify(root);
        // fullySigned is exactly "no event rests on the hash chain alone".
        expect(r.fullySigned).toBe(r.uncheckpointedEvents === 0);
        // The residual is the tail past the last checkpoint the cadence fired.
        expect(r.uncheckpointedEvents).toBe(residualOf(count, every));
      });
    }
  }

  it('a forced checkpoint drives the residual to zero and fullySigned to true', () => {
    writeChain(5, 1000); // no cadence checkpoint fires
    let r = verify(root);
    expect(r.fullySigned).toBe(false);
    expect(r.uncheckpointedEvents).toBe(5);
    openChainForWriting(root, { checkpointEvery: 1000 }).checkpoint();
    r = verify(root);
    expect(r.fullySigned).toBe(true);
    expect(r.uncheckpointedEvents).toBe(0);
  });
});

// A table of multi-tail shapes: several machines, each its own tail, merged into
// one chain. Cadences fire never / on boundaries / mid-batch, and counts span
// empty and many, so the aggregate mixes fully-signed tails with residual ones.
const MULTI_TAIL_SHAPES: readonly (readonly TailSpec[])[] = [
  [
    { count: 3, every: 2 },
    { count: 4, every: 4 },
  ],
  [
    { count: 5, every: 1 },
    { count: 0, every: 3 },
    { count: 8, every: 3 },
  ],
  [
    { count: 1, every: 1000 },
    { count: 2, every: 1000 },
    { count: 16, every: 8 },
  ],
  [
    { count: 7, every: 2 },
    { count: 7, every: 7 },
    { count: 6, every: 4 },
    { count: 1, every: 1 },
  ],
];

describe('invariant — an honestly written MULTI-TAIL chain always verifies', () => {
  for (const [i, specs] of MULTI_TAIL_SHAPES.entries()) {
    const label = specs.map((s) => `${s.count}/${s.every}`).join('+');
    it(`ok is true for ${specs.length} tails [${label}] (shape ${i})`, () => {
      writeManyTails(specs);
      const r = verify(root);
      expect(r.ok).toBe(true);
      expect(r.issues).toEqual([]);
      // Each spec becomes its own tail — none collided on merge.
      expect(r.tails).toHaveLength(specs.length);
      // One committed key per tail, all accounted for: no orphan.
      expect(r.census).toEqual([]);
    });
  }
});

describe('invariant — residual accounting sums across tails; fullySigned iff the SUM is zero', () => {
  for (const [i, specs] of MULTI_TAIL_SHAPES.entries()) {
    const label = specs.map((s) => `${s.count}/${s.every}`).join('+');
    it(`uncheckpointed == sum of per-tail residuals for [${label}] (shape ${i})`, () => {
      const expectedResidual = writeManyTails(specs);
      const r = verify(root);
      expect(r.uncheckpointedEvents).toBe(expectedResidual);
      expect(r.fullySigned).toBe(expectedResidual === 0);
    });
  }

  it('a fully-signed tail beside a residual one is NOT reported fullySigned', () => {
    // A tail whose cadence covered everything, merged with one that left a
    // residual: the aggregate must reflect the residual, never round up to
    // fullySigned because one of its tails happens to be complete.
    const expectedResidual = writeManyTails([
      { count: 4, every: 2 }, // fully covered
      { count: 3, every: 1000 }, // 3 residual
    ]);
    expect(expectedResidual).toBe(3);
    const r = verify(root);
    expect(r.ok).toBe(true);
    expect(r.fullySigned).toBe(false);
    expect(r.uncheckpointedEvents).toBe(3);
  });
});

describe('invariant — the invariants hold when a tail spans several segments', () => {
  // A small segment cap forces a single tail across many segment files; the
  // per-tail chain must still verify and account across the segment boundaries.
  const SMALL_CAP = 512;

  it('a multi-segment tail verifies and its residual is still exact', () => {
    const spec: TailSpec = { count: 20, every: 1000, maxSegmentBytes: SMALL_CAP };
    const expectedResidual = writeManyTails([spec]);
    // Sanity: the cap really did split the tail into several segments.
    const tail = readdirSync(join(root, 'tails'))[0] as string;
    const segments = orderedSegments({ root }, tail);
    expect(segments.length).toBeGreaterThan(1);

    const r = verify(root);
    expect(r.ok).toBe(true);
    expect(r.tails[0]?.entryCount).toBe(spec.count);
    expect(r.uncheckpointedEvents).toBe(expectedResidual);
  });

  it('multi-segment tails mixed with checkpoints still verify and account across tails', () => {
    const specs: readonly TailSpec[] = [
      { count: 24, every: 8, maxSegmentBytes: SMALL_CAP }, // checkpoints AND segment rotation
      { count: 10, every: 4, maxSegmentBytes: SMALL_CAP },
    ];
    const expectedResidual = writeManyTails(specs);
    const r = verify(root);
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([]);
    expect(r.tails).toHaveLength(2);
    expect(r.uncheckpointedEvents).toBe(expectedResidual);
    expect(r.fullySigned).toBe(expectedResidual === 0);
  });
});
