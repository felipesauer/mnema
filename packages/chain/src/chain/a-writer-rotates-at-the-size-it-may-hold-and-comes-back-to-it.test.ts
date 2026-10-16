/**
 * Where a writer is in the segments of its tail: when it rolls onto the next one, where it
 * finds itself again after a restart, and what it says when the tail it finds is shorter than
 * what was signed.
 *
 * The cases of `writer.test.ts` roll a segment on every append (a cap of one byte), which a
 * writer does for any cap at or below the size of a line. Nothing there asks about the edge
 * itself: that a segment is full the moment it holds the cap, not one byte after; that a batch
 * counts toward the cap as the bytes it wrote; that a segment numbered past 9 is still found
 * by its number; that a torn fragment is not part of what the segment weighs. A writer that
 * gets one of these wrong still writes a tail every reader accepts, and the file it lands in
 * differs from the one the cap names.
 */

import {
  appendFileSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  truncateSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { identityFounded, taskBirth, taskCreated } from '../events/build.js';
import { catalogUpcasters } from '../events/registry.js';
import { openChainForWriting } from './chain.js';
import { type ChainLayout, tailProofPath } from './layout.js';
import { orderedSegments, readTailEntries } from './store.js';
import { type ChainWriter, TailDamagedError } from './writer.js';

let root: string;
let scratch: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mnema-writer-edge-'));
  scratch = mkdtempSync(join(tmpdir(), 'mnema-writer-edge-measure-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(scratch, { recursive: true, force: true });
});

const NEVER = 10_000;

const env = (w: ChainWriter, subject: string) => ({
  at: '2026-07-21T00:00:00.000Z',
  who: w.anchor,
  signerFp: w.signerFingerprint,
  subject,
});

function open(at: string, maxSegmentBytes: number): ChainWriter {
  return openChainForWriting(at, { keyRoot: at, maxSegmentBytes, maxUnsignedEvents: NEVER });
}

const found = (w: ChainWriter): void => {
  w.append(identityFounded(env(w, w.anchor), { foundingFp: w.signerFingerprint }));
};
const aTask = (w: ChainWriter, n: number): void => {
  w.append(taskCreated(env(w, `t-${n}`), { title: `task ${n}` }));
};
const aBirth = (w: ChainWriter, n: number): void => {
  w.appendAll(taskBirth(env(w, `b-${n}`), { title: `born ${n}`, initial: 'draft' }));
};

const layoutOf = (at: string): ChainLayout => ({ root: at });
const tailIn = (at: string): string => readdirSync(join(at, 'tails'))[0] as string;
const segmentsIn = (at: string): string[] => orderedSegments(layoutOf(at), tailIn(at));
const bytesOf = (file: string): number => readFileSync(file).length;

/**
 * The size of the first segment after `act`, measured in a root of its own with a cap nothing
 * reaches. A line weighs the same wherever it is written (the hashes and the fingerprints are
 * fixed-width), which the first assertion of each case below holds the measurement to.
 */
function weighed(act: (w: ChainWriter) => void): number {
  const w = open(scratch, 1_000_000);
  act(w);
  const only = segmentsIn(scratch);
  expect(only).toHaveLength(1);
  return bytesOf(only[0] as string);
}

describe('a segment is full when it holds the cap, not one byte after', () => {
  it('rolls onto the next segment when a single append finds the segment exactly at the cap', () => {
    const founding = weighed(found);
    const w = open(root, founding);
    found(w);
    expect(bytesOf(segmentsIn(root)[0] as string)).toBe(founding);
    aTask(w, 1);
    expect(segmentsIn(root)).toHaveLength(2);
  });

  it('stays in the segment when the cap is one byte above what it holds', () => {
    const founding = weighed(found);
    const w = open(root, founding + 1);
    found(w);
    aTask(w, 1);
    expect(segmentsIn(root)).toHaveLength(1);
  });

  it('rolls onto the next segment when a batch finds the segment exactly at the cap', () => {
    const founding = weighed(found);
    const w = open(root, founding);
    found(w);
    aBirth(w, 1);
    const segments = segmentsIn(root);
    expect(segments).toHaveLength(2);
    expect(bytesOf(segments[0] as string)).toBe(founding);
  });

  it('keeps a batch in the segment when the cap is one byte above what it holds', () => {
    const founding = weighed(found);
    const w = open(root, founding + 1);
    found(w);
    aBirth(w, 1);
    expect(segmentsIn(root)).toHaveLength(1);
  });

  it('counts a batch as the bytes it wrote, so the append after it rolls at the cap', () => {
    const both = weighed((w) => {
      found(w);
      aBirth(w, 1);
    });
    const w = open(root, both);
    found(w);
    aBirth(w, 1);
    expect(segmentsIn(root)).toHaveLength(1);
    expect(bytesOf(segmentsIn(root)[0] as string)).toBe(both);
    aTask(w, 1);
    expect(segmentsIn(root)).toHaveLength(2);
  });

  it('counts a batch as the bytes it wrote, so the append after it stays when the cap is above', () => {
    const both = weighed((w) => {
      found(w);
      aBirth(w, 1);
    });
    const w = open(root, both + 1);
    found(w);
    aBirth(w, 1);
    aTask(w, 1);
    expect(segmentsIn(root)).toHaveLength(1);
  });

  it('ends every line it writes with a newline, through either door', () => {
    const w = open(root, 1_000_000);
    found(w);
    aTask(w, 1);
    aBirth(w, 1);
    const text = readFileSync(segmentsIn(root)[0] as string, 'utf-8');
    expect(text.endsWith('\n')).toBe(true);
    expect(text.split('\n').filter((line) => line.length > 0)).toHaveLength(4);
    expect(text.split('\n')).toHaveLength(5);
  });
});

describe('a writer that comes back finds the segment it was in, and what it weighs', () => {
  it('finds a segment numbered past 9 by its whole number', () => {
    const first = open(root, 1);
    found(first);
    for (let i = 1; i <= 11; i += 1) aTask(first, i);
    expect(segmentsIn(root)).toHaveLength(12);

    const back = open(root, 1_000_000);
    aTask(back, 12);
    const segments = segmentsIn(root);
    expect(segments).toHaveLength(12);
    expect(
      readFileSync(segments[11] as string, 'utf-8')
        .split('\n')
        .filter(Boolean),
    ).toHaveLength(2);
  });

  it('weighs the segment it finds as the bytes it holds', () => {
    const founding = weighed(found);
    found(open(root, 1_000_000));
    const back = open(root, founding);
    aTask(back, 1);
    expect(segmentsIn(root)).toHaveLength(2);

    const rootAbove = mkdtempSync(join(tmpdir(), 'mnema-writer-edge-above-'));
    try {
      found(open(rootAbove, 1_000_000));
      aTask(open(rootAbove, founding + 1), 1);
      expect(segmentsIn(rootAbove)).toHaveLength(1);
    } finally {
      rmSync(rootAbove, { recursive: true, force: true });
    }
  });

  it('does not count a torn fragment among the bytes the segment holds', () => {
    const founding = weighed(found);
    found(open(root, 1_000_000));
    const file = segmentsIn(root)[0] as string;
    const fragment = '{"a":"torn half of a line';
    // The crash left half a line after the founding, which the writer cuts before it writes.
    appendFileSync(file, fragment);
    expect(bytesOf(file)).toBe(founding + fragment.length);

    const back = open(root, founding + 1);
    aTask(back, 1);
    const segments = segmentsIn(root);
    expect(segments).toHaveLength(1);
    expect(readFileSync(file, 'utf-8').split('\n').filter(Boolean)).toHaveLength(2);
  });

  it('writes on, from the coverage, when the line above it only lost its newline and stands alone', () => {
    const first = open(root, 1);
    found(first);
    aTask(first, 1);
    expect(first.checkpoint()?.toSeq).toBe(1);
    aTask(first, 2);
    const last = segmentsIn(root).at(-1) as string;
    expect(readFileSync(last, 'utf-8').split('\n').filter(Boolean)).toHaveLength(1);
    truncateSync(last, bytesOf(last) - 1);

    const back = open(root, 1);
    expect(() => aTask(back, 3)).not.toThrow();
    const entries = readTailEntries(layoutOf(root), tailIn(root), catalogUpcasters());
    expect(entries.map((entry) => entry.link.seq)).toEqual([0, 1, 2]);
    expect(entries.at(-1)?.event.subject).toBe('t-3');
  });
});

describe('a tail cut under its signature says how far it holds', () => {
  /** Founding and two tasks, all three signed, then the segment cut to `keep` complete lines. */
  function signedThroughTwoThenCut(keep: number): TailDamagedError {
    const w = open(root, 1_000_000);
    found(w);
    aTask(w, 1);
    aTask(w, 2);
    expect(w.checkpoint()?.toSeq).toBe(2);
    const file = segmentsIn(root)[0] as string;
    const text = readFileSync(file, 'utf-8');
    const lines = text.split('\n').filter(Boolean);
    const kept = lines
      .slice(0, keep)
      .map((line) => `${line}\n`)
      .join('');
    truncateSync(file, Buffer.byteLength(kept, 'utf-8'));

    const back = open(root, 1_000_000);
    try {
      aTask(back, 3);
    } catch (error) {
      expect(error).toBeInstanceOf(TailDamagedError);
      return error as TailDamagedError;
    }
    throw new Error('the write was not refused');
  }

  const sentence = (tail: string, found: string): string =>
    `this machine's tail ${tail} is signed through seq 2, and ${found}: a line ` +
    'its last checkpoint signed is cut, is missing or has lost its newline, which no crash ' +
    'leaves. This write was not appended, and the tail was left as it was. `mnema verify` fails ' +
    'on a signed line that is cut or missing, and passes on a signed line that only lost its ' +
    'newline, so a pass does not clear this tail: compare its files with the last copy you ' +
    'trust (the repository, a backup) and put them back before writing again.';

  it('says there is no complete line when the segment holds none', () => {
    const error = signedThroughTwoThenCut(0);
    expect(error.message).toBe(sentence(tailIn(root), 'no complete line'));
    expect([error.name, error.code, error.signedThrough, error.lastComplete]).toEqual([
      'TailDamagedError',
      'TAIL_DAMAGED',
      2,
      -1,
    ]);
  });

  it('names seq 0 when the founding is the only complete line left', () => {
    const error = signedThroughTwoThenCut(1);
    expect(error.message).toBe(sentence(tailIn(root), 'its last complete line is seq 0'));
    expect(error.lastComplete).toBe(0);
  });

  it('names seq 1 when two lines are left', () => {
    const error = signedThroughTwoThenCut(2);
    expect(error.message).toBe(sentence(tailIn(root), 'its last complete line is seq 1'));
    expect(error.lastComplete).toBe(1);
  });
});

describe('a tail is given its proof of ownership as a line of its own', () => {
  it('writes the proof ending in a newline', () => {
    const w = open(root, 1_000_000);
    found(w);
    const proof = readFileSync(tailProofPath(layoutOf(root), tailIn(root)), 'utf-8');
    expect(proof.endsWith('\n')).toBe(true);
    expect(proof.trimEnd().split('\n')).toHaveLength(1);
  });
});
