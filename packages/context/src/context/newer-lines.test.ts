/**
 * WHAT A NEWER MNEMA WROTE, as `newer-lines.ts` says it over the caches (ADR-140): the lines each
 * cache carried out of its reading, summed across the trees, grouped by kind in the order the kinds
 * are first met, and the same for the lines one record is the subject of. The caches are stood in
 * for by what the derivation asks of them (their `unread`); the real chain, built and read, is in
 * `code/tests/a-record-says-where-a-newer-mnema-wrote.test.ts`.
 */

import type { ProjectionCache } from '@mnema/core';
import { describe, expect, it } from 'vitest';
import { newerLinesAbout, newerLinesOf } from './newer-lines.js';

const cacheHolding = (...unread: { kind: string; tail: string; subject: string }[]) =>
  ({ unread }) as unknown as ProjectionCache;

describe('the lines a newer mnema wrote, over the trees asked about', () => {
  const trees = [
    cacheHolding(
      { kind: 'x.one', tail: 'a', subject: 'record-1' },
      { kind: 'x.two', tail: 'a', subject: 'record-2' },
    ),
    cacheHolding(),
    cacheHolding({ kind: 'x.one', tail: 'c', subject: 'record-1' }),
  ];

  it('are none, and say nothing, where no cache carries one', () => {
    expect(newerLinesOf([cacheHolding(), cacheHolding()])).toBeUndefined();
    expect(newerLinesOf([])).toBeUndefined();
  });

  it('sum across the trees and group by kind in the order the kinds are first met', () => {
    expect(newerLinesOf(trees)).toEqual({
      lines: 3,
      kinds: [
        { kind: 'x.one', lines: 2 },
        { kind: 'x.two', lines: 1 },
      ],
    });
  });

  it('are those whose subject is the record asked about, and none for another', () => {
    expect(newerLinesAbout(trees, 'record-1')).toEqual({
      lines: 2,
      kinds: [{ kind: 'x.one', lines: 2 }],
    });
    expect(newerLinesAbout(trees, 'record-2')).toEqual({
      lines: 1,
      kinds: [{ kind: 'x.two', lines: 1 }],
    });
    expect(newerLinesAbout(trees, 'record-3')).toBeUndefined();
  });
});
