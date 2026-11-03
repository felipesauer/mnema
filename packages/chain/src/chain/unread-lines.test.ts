/**
 * THE LINES A READER READS PAST ARE TAKEN AND GROUPED IN ONE PLACE (`unreadLinesOf`,
 * `groupUnreadLines`, in `entry.ts`), the places `verify`'s census and every surface that names
 * what a newer mnema wrote ask (ADR-140). The grouping is the count a surface says, so what it
 * counts, and the order it says it in, are held here over entries made by hand.
 */

import { describe, expect, it } from 'vitest';
import { type ChainEntry, groupUnreadLines, unreadLinesOf } from './entry.js';

/** A line of a kind this reader does not know, as the chain hands it: only its envelope. */
function unread(kind: string, subject: string, seq: number): ChainEntry {
  return {
    unread: true,
    event: {
      v: 1,
      kind,
      at: '2026-11-03T10:00:00.000Z',
      who: 'mnid:0000000000000000',
      signerFp: 'fp',
      subject,
      payload: {},
    },
    written: {} as never,
    link: { tail: 't', seq, prev: null, hash: `h${seq}` },
  } as unknown as ChainEntry;
}

/** A line of a kind this reader knows. */
function known(seq: number): ChainEntry {
  return {
    event: { v: 1, kind: 'memory.captured', subject: 'm', payload: {} },
    written: {} as never,
    link: { tail: 't', seq, prev: null, hash: `h${seq}` },
  } as unknown as ChainEntry;
}

describe('the lines a reader reads past', () => {
  it('are the unread ones of a tail, in the tail order, with their kind, tail and subject', () => {
    const lines = unreadLinesOf('tail-a', [
      known(0),
      unread('x.one', 'subject-1', 1),
      known(2),
      unread('x.two', 'subject-2', 3),
    ]);
    expect(lines).toEqual([
      { kind: 'x.one', tail: 'tail-a', subject: 'subject-1' },
      { kind: 'x.two', tail: 'tail-a', subject: 'subject-2' },
    ]);
  });

  it('are none in a tail this reader reads whole', () => {
    expect(unreadLinesOf('tail-a', [known(0), known(1)])).toEqual([]);
  });

  it('group by kind in the order the kinds are first met, with the tails and the subjects', () => {
    const grouped = groupUnreadLines([
      { kind: 'x.one', tail: 'a', subject: 's1' },
      { kind: 'x.two', tail: 'a', subject: 's2' },
      { kind: 'x.one', tail: 'b', subject: 's1' },
      { kind: 'x.one', tail: 'b', subject: 's3' },
    ]);
    expect(grouped).toEqual([
      {
        kind: 'x.one',
        lines: 3,
        tails: ['a', 'b'],
        subjects: [
          ['s1', 2],
          ['s3', 1],
        ],
      },
      { kind: 'x.two', lines: 1, tails: ['a'], subjects: [['s2', 1]] },
    ]);
  });

  it('group to nothing when there are none', () => {
    expect(groupUnreadLines([])).toEqual([]);
  });
});
