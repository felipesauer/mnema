/**
 * System invariants of the proof engine, checked over MANY generated chains
 * rather than a single hand-built one. The unit tests pin each piece; these pin
 * the properties that must hold for the whole verifier across shapes — the kind
 * of claim a one-off example can pass while a general truth quietly fails.
 *
 * The generator is deterministic (no wall clock, no randomness): chains vary by
 * event count and checkpoint cadence over a dense table, so a failure reproduces
 * exactly. Two invariants are asserted:
 *
 *   - HONESTY: a chain written honestly always verifies (`ok`), and
 *     `fullySigned` is true precisely when no event sits above the last
 *     checkpoint (`uncheckpointedEvents === 0`). The verdict never overstates
 *     (fullySigned with a residual) nor understates (a broken honest chain).
 *   - RESIDUAL ACCOUNTING: `uncheckpointedEvents` equals the events written
 *     after the last checkpoint fired — the declared, honest keyless window.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { taskCreated } from '../events/build.js';
import { openChainForWriting, verify } from './chain.js';

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
        // A checkpoint fires each time `every` more events accumulate, so
        // floor(count/every)*every events end up covered (0 when every > count,
        // all of them when every divides count).
        const covered = Math.floor(count / every) * every;
        const expectedResidual = count - covered;
        expect(r.uncheckpointedEvents).toBe(expectedResidual);
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
