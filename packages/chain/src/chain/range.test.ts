/**
 * The route to a checkpoint's range, held to the `filter` it replaced — over tails of every
 * shape a reader can meet.
 *
 * `entriesBetween` promises the filter's answer and nothing else: the entries whose seq lies
 * in the range, in the order the tail holds them. So the oracle here IS that filter, written
 * out beside every call, and what varies is the tail — sound, with an entry twice, with a
 * line gone, reordered, empty — and the range, including the ones no honest checkpoint names
 * (past the end, reversed, over a seq nobody holds). The entries are sealed by the product
 * (`sealEntry`), each its own object even when two carry the same line, which is what two
 * reads of a duplicated line produce; the answer is compared by POSITION in the tail, so a
 * route that returned an equal entry from the wrong place would not pass as the right one.
 */

import { describe, expect, it } from 'vitest';

import { memoryCaptured } from '../events/build.js';
import { type Entry, sealEntry } from './entry.js';
import { deriveAnchor, generateKeyPair } from './keys.js';
import { entriesBetween } from './range.js';

const { fingerprint } = generateKeyPair();
const TAIL = `${fingerprint}-0123456789abcdef0123456789abcdef`;
const WHO = deriveAnchor(fingerprint);

/** A sealed entry at `seq`; `nth` keeps two entries at one seq distinct in content. */
function entryAt(seq: number, nth = 0): Entry {
  return sealEntry({
    event: memoryCaptured(
      {
        at: '2026-09-25T00:00:00.000Z',
        who: WHO,
        signerFp: fingerprint,
        subject: `m-${seq}-${nth}`,
      },
      { content: `note ${seq}` },
    ),
    tail: TAIL,
    seq,
    prev: null,
  });
}

/** A tail holding entries at these seqs, in this order — a fresh object for each. */
function tailOf(seqs: readonly number[]): Entry[] {
  return seqs.map((seq, i) => entryAt(seq, i));
}

/** Positions in `entries` of what the route answered, and of what the filter answers. */
function bothAnswers(entries: readonly Entry[], fromSeq: number, toSeq: number) {
  const position = new Map(entries.map((entry, i) => [entry, i]));
  const at = (found: readonly Entry[]) => found.map((entry) => position.get(entry));
  return {
    route: at(entriesBetween(entries)(fromSeq, toSeq)),
    filter: at(entries.filter((e) => e.link.seq >= fromSeq && e.link.seq <= toSeq)),
  };
}

/** Every range from 0 to a little past the highest seq, reversed ones included. */
function everyRange(seqs: readonly number[]): Array<[number, number]> {
  const top = Math.max(0, ...seqs) + 2;
  const ranges: Array<[number, number]> = [];
  for (let from = 0; from <= top; from += 1) {
    for (let to = from - 2; to <= top; to += 1) if (to >= 0) ranges.push([from, to]);
  }
  return ranges;
}

const SHAPES: ReadonlyArray<readonly [string, readonly number[]]> = [
  ['an empty tail', []],
  ['a sound tail', [0, 1, 2, 3, 4, 5, 6, 7]],
  ['a tail of one entry', [0]],
  ['the last entry appended twice', [0, 1, 2, 3, 3]],
  ['an entry appended twice in the middle', [0, 1, 2, 2, 3, 4]],
  ['an entry appended three times', [0, 1, 1, 1, 2]],
  ['a line cut out of the middle', [0, 1, 3, 4, 5]],
  ['the first line cut out', [1, 2, 3]],
  ['two lines swapped', [0, 1, 3, 2, 4, 5]],
  ['the last line moved to the front', [5, 0, 1, 2, 3, 4]],
  ['a line pasted in from far behind', [0, 1, 2, 3, 1, 4]],
  ['a tail read backwards', [4, 3, 2, 1, 0]],
];

describe('the entries a checkpoint covers', () => {
  it.each(SHAPES)('are the filter’s over %s, for every range', (_shape, seqs) => {
    const entries = tailOf(seqs);
    for (const [fromSeq, toSeq] of everyRange(seqs)) {
      const { route, filter } = bothAnswers(entries, fromSeq, toSeq);
      expect({ fromSeq, toSeq, found: route }).toEqual({ fromSeq, toSeq, found: filter });
    }
  });

  it('are the filter’s over tails drawn at random, sorted or not, and ranges drawn with them', () => {
    // mulberry32: a fixed seed, so a red here reproduces.
    let s = 42;
    const random = (): number => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const upTo = (n: number) => Math.floor(random() * (n + 1));
    let compared = 0;
    for (let round = 0; round < 400; round += 1) {
      const length = upTo(30);
      const seqs: number[] = [];
      if (round % 2 === 0) {
        // Never falling: steps of 0 (an entry twice), 1 (sound) or 2 (a line gone).
        let seq = upTo(2);
        for (let i = 0; i < length; i += 1) {
          seqs.push(seq);
          seq += upTo(2);
        }
      } else {
        for (let i = 0; i < length; i += 1) seqs.push(upTo(35));
      }
      const entries = tailOf(seqs);
      for (let r = 0; r < 25; r += 1) {
        const fromSeq = upTo(38);
        const toSeq = Math.max(0, fromSeq - 2 + upTo(14));
        const { route, filter } = bothAnswers(entries, fromSeq, toSeq);
        expect({ seqs, fromSeq, toSeq, found: route }).toEqual({
          seqs,
          fromSeq,
          toSeq,
          found: filter,
        });
        compared += 1;
      }
    }
    // The comparison ran — a loop that never entered would be a green over nothing.
    expect(compared).toBe(400 * 25);
  });
});
