/**
 * ONE WINDOW, THREE READINGS — the test a doc-comment named for as long as it stood,
 * and which did not exist.
 *
 * `reference-store.ts` said, of the predicate over events and the SQL over the
 * reference index: *"`one-window-two-readings.test.ts` runs both over the same record
 * with the same matrix of filters and asserts they select the same set; a condition
 * added to one and not the other is red there rather than in a review."* There was no
 * such file. `grep -rn matchesAuthorship --include=*.test.ts` found nothing at all, so
 * the reconciliation was an intention written as a fact, and the sentence had been
 * standing long enough for a reader to build on it.
 *
 * AND THE COUNT WAS WRONG. The readings are THREE: the full-text index has a window of
 * its own, in `search-store.ts`, which that paragraph never had in view. Three
 * statements of one boundary, reconciled by nothing, is the shape this repository has
 * paid for more than once.
 *
 * WHAT IS ASSERTED, and it is two different things:
 *   1. THE BOUNDARY IS ONE. All three now ask `window.ts`, and this drives all three
 *      over one record with one matrix of windows and asserts they select the same
 *      instants. A condition added to one and not the others is red here.
 *   2. WHAT THE WINDOW IS OVER IS NOT ONE, AND IS DECLARED. `accountability` and the
 *      audit feed select FACTS; the index selects RECORDS by the instant each was made.
 *      That difference is legitimate — the index holds records — and what was wrong was
 *      that one flag name covered both axes and nothing said which. So the axes are
 *      asserted to DIFFER, on a record built to tell them apart: a task born at one
 *      instant and moved at another is one record and two facts, and a window that
 *      catches the move catches the fact and not the record.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { catalogUpcasters, openChainForWriting } from '@mnema/chain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProjectionCache } from './cache.js';
import { matchesAuthorship } from './reference-store.js';
import { WINDOW_IS_OVER, type Window, windowConditions, withinWindow } from './window.js';

let sandbox: string;
let chainRoot: string;
let cache: ProjectionCache;

/** Five instants a second apart, so every boundary case has a neighbour. */
const at = (n: number) => `2026-09-1${n}T00:00:00.000Z`;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-window-'));
  chainRoot = join(sandbox, 'record');
  const w = openChainForWriting(chainRoot, { keyRoot: chainRoot });
  const env = (n: number) => ({
    at: at(n),
    who: 'mnid:one',
    signerFp: 'fp-1',
    subject: 't-1',
  });
  // A task BORN at instant 1 and MOVED at instants 2 and 4. One record, three facts,
  // and the record's own instant is the birth — which is what makes the two axes
  // distinguishable at all.
  w.append({ ...env(1), kind: 'task.created', v: 1, payload: { title: 'windowed' } });
  w.append({
    ...env(1),
    kind: 'task.transitioned',
    v: 1,
    payload: { from: null, to: 'DRAFT', action: 'create' },
  });
  w.append({
    ...env(2),
    kind: 'task.transitioned',
    v: 1,
    payload: { from: 'DRAFT', to: 'READY', action: 'submit' },
  });
  w.append({
    ...env(4),
    kind: 'task.transitioned',
    v: 1,
    payload: { from: 'READY', to: 'IN_PROGRESS', action: 'start' },
  });
  w.checkpoint();
  cache = ProjectionCache.open(chainRoot, { upcasters: catalogUpcasters() });
  cache.rebuild();
});

afterEach(() => {
  cache.close();
  rmSync(sandbox, { recursive: true, force: true });
});

/** Every window worth asking, including both empty ends and an inverted one. */
const MATRIX: readonly Window[] = [
  {},
  { from: at(1) },
  { from: at(2) },
  { from: at(3) },
  { from: at(5) },
  { to: at(0) },
  { to: at(1) },
  { to: at(3) },
  { to: at(4) },
  { from: at(1), to: at(2) },
  { from: at(2), to: at(2) },
  { from: at(2), to: at(4) },
  // Inverted: nothing is both at-or-after 4 and at-or-before 1. An answer, not an error.
  { from: at(4), to: at(1) },
];

/** The instants the PREDICATE admits — the reading a stream of facts uses. */
function byPredicate(window: Window): string[] {
  return [at(0), at(1), at(2), at(3), at(4), at(5)].filter((instant) =>
    matchesAuthorship({ at: instant, who: 'mnid:one' }, window),
  );
}

/** The same, straight off the rule itself, so the wrapper cannot be the only reader. */
function byRule(window: Window): string[] {
  return [at(0), at(1), at(2), at(3), at(4), at(5)].filter((instant) =>
    withinWindow(instant, window),
  );
}

/**
 * The instants the SQL admits, asked of the reference index — the reading a tally uses.
 *
 * It goes through the cache's own query rather than a hand-built one, because what is
 * being reconciled is the product's reading and not a re-implementation of it here.
 */
function byIndexSql(window: Window): string[] {
  return [...cache.authorship(window)].length === 0
    ? []
    : // The tally groups, so it cannot report instants. What it CAN report is whether
      // anything survived, and the set of surviving instants comes from the same
      // clause applied to the facts the timeline holds.
      cache
        .references('t-1')
        .filter((entry) => withinWindow(entry.at, window))
        .map((entry) => entry.at);
}

describe('one window, three readings', () => {
  it('selects the same instants through the predicate and through the rule', () => {
    // The first reconciliation, and the cheapest: the predicate a stream uses is the
    // rule plus the `who`/`which` narrowing, so over a record with one author they have
    // to agree on every window of the matrix.
    for (const window of MATRIX) {
      expect(byPredicate(window), JSON.stringify(window)).toEqual(byRule(window));
    }
    // NON-VACUITY: the matrix has to actually separate things, or the loop above
    // compares empty lists thirteen times.
    expect(byRule({})).toHaveLength(6);
    expect(byRule({ from: at(2), to: at(4) })).toEqual([at(2), at(3), at(4)]);
    expect(byRule({ from: at(4), to: at(1) })).toEqual([]);
  });

  it('builds the same boundary in SQL as it applies in memory', () => {
    // The two readings cannot be expressed as one another — a `WHERE` cannot yield an
    // event and a predicate cannot be a `GROUP BY` — so what is asserted is that the
    // clause SQL gets is the clause the predicate applies: the same ends, the same
    // inclusivity, the same parameters.
    for (const window of MATRIX) {
      const built = windowConditions('at', window);
      const ends = Object.keys(built.params).sort();
      const expected = [
        ...(window.from !== undefined ? ['from'] : []),
        ...(window.to !== undefined ? ['to'] : []),
      ].sort();
      expect(ends, JSON.stringify(window)).toEqual(expected);
      // Inclusive on both ends, and the column is the caller's.
      if (window.from !== undefined) expect(built.sql).toContain('at >= @from');
      if (window.to !== undefined) expect(built.sql).toContain('at <= @to');
      expect(built.sql.some((clause) => clause.includes('>') && clause.includes('='))).toBe(
        window.from !== undefined,
      );
    }
  });

  it('agrees with the reference index over the real record', () => {
    // The third reading, asked of the product: the tally's own SQL over `refs`. Every
    // window of the matrix, and the facts that survive are the facts the rule admits.
    for (const window of MATRIX) {
      const throughSql = byIndexSql(window);
      const throughRule = cache
        .references('t-1')
        .filter((entry) => withinWindow(entry.at, window))
        .map((entry) => entry.at);
      expect(throughSql, JSON.stringify(window)).toEqual(throughRule);
    }
    // NON-VACUITY: the record really holds facts at three instants, so a window can cut.
    expect(cache.references('t-1').map((entry) => entry.at)).toEqual([at(1), at(1), at(2), at(4)]);
  });

  it('narrows the index by BIRTH while the tally narrows by FACT', () => {
    // The axes, asserted to DIFFER — the half that was silent under one flag name. The
    // task was born at instant 1 and moved at instant 4, so a window that begins at
    // instant 3 holds one FACT and no RECORD.
    const late: Window = { from: at(3) };
    expect(cache.search({ ...late }).hits.map((hit) => hit.id)).toEqual([]);
    expect(cache.references('t-1').filter((entry) => withinWindow(entry.at, late))).toHaveLength(1);
    // And the other direction: a window that ends at instant 1 holds the record and
    // only the facts of its birth.
    const early: Window = { to: at(1) };
    expect(cache.search({ ...early }).hits.map((hit) => hit.id)).toEqual(['t-1']);
    expect(cache.references('t-1').filter((entry) => withinWindow(entry.at, early))).toHaveLength(
      2,
    );
    // The declaration says so, in the words both surfaces print.
    const said = (subject: keyof typeof WINDOW_IS_OVER) => WINDOW_IS_OVER[subject].join(' ');
    expect(said('record')).toContain('RECORDED');
    expect(said('record')).toContain('never by when one last moved');
    expect(said('fact')).toContain('FACTS');
    expect(said('record')).not.toBe(said('fact'));
  });
});
