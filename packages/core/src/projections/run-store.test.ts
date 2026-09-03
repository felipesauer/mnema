/**
 * THE RUN PROJECTION ACROSS SQLITE — the boundary, asked directly.
 *
 * This module was at full line coverage with no test naming it. What executes it is
 * `cache.test.ts` through `ProjectionCache`, and that file's subject is the cache: it
 * pins one open run's fields and `listOpenRuns` going empty, and its two-run case
 * compares one rebuild against another — a comparison SYMMETRIC under every mutation in
 * here, because both sides go through this same code. `advance.test.ts` is the same
 * shape at larger scale. So the boundary ran, and what it did to the values was never
 * looked at.
 *
 * WHAT THAT LEFT UNHELD. `ORDER BY id` is asserted nowhere in the repository;
 * `endedAt` leaving the database is asserted nowhere; a rebuild that materialized only
 * the FIRST run of a fold survives every case in this package, because the two-run
 * comparisons are rebuild-against-rebuild. And `toEqual`, the house matcher, cannot see
 * the defect this file exists to prevent: it reads a key set to `undefined` as absent, so
 * a store that turned every omitted optional into a present-but-undefined key would pass
 * it. Every round-trip below is `toStrictEqual` for that reason.
 *
 * NOTHING HERE HAND-WRITES A PROJECTION. `projectRuns` is the only thing in the product
 * that makes one, and `open` and `endedAt` are the same fact stated twice — the fold sets
 * `open: endedAt === undefined` — so a literal could assert a run that cannot exist. The
 * expectations compare against the fold's own values, which is also what keeps the two
 * sides from drifting together.
 */

import { type CatalogEvent, memoryCaptured, runEnded, runStarted } from '@mnema/chain';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureSchema } from '../db/schema.js';
import type { SqliteDatabase } from '../db/sqlite.js';
import { projectRuns, type RunProjection } from './run.js';
import { getRun, listOpenRuns, listRuns, materializeRuns } from './run-store.js';

let db: SqliteDatabase;

beforeEach(() => {
  db = new Database(':memory:');
  ensureSchema(db);
});

afterEach(() => {
  db.close();
});

const at = (n: number) => `2026-07-21T00:00:0${n}.000Z`;
const env = (subject: string, n: number, who = 'felipe') => ({
  at: at(n),
  who,
  signerFp: 'fp-1',
  subject,
});
/** A fact PINNED to a run — the envelope slot every event of a session carries. */
const inRun = (subject: string, n: number, run: string) => ({ ...env(subject, n), run });

/** The fold, which is the only producer of a RunProjection in this product. */
const fold = (events: readonly CatalogEvent[]): RunProjection[] => [
  ...projectRuns(events).values(),
];

/**
 * Three runs whose id order is not the order they are written in.
 *
 * `r-c` is born first and `r-a` last, so a query that returned rows in insertion order
 * would answer c, a, b — and the ordering case below would be vacuous if the fixture
 * happened to write them alphabetically.
 */
function threeOutOfOrder(): readonly CatalogEvent[] {
  return [
    runStarted(env('r-c', 0), { agent: 'claude' }),
    runStarted(env('r-b', 1), { agent: 'claude' }),
    runStarted(env('r-a', 2), { agent: 'claude' }),
  ];
}

describe('run-store — what goes in comes back out', () => {
  it('round-trips the fold exactly, absent optionals included', () => {
    const events: CatalogEvent[] = [
      runStarted(env('closed', 0), { agent: 'claude', goal: 'ship it' }),
      runEnded(env('closed', 1), { outcome: 'done' }),
      runStarted(env('open', 2), { agent: 'codex' }),
    ];
    const folded = fold(events);
    materializeRuns(db, folded);

    // toStrictEqual, not toEqual: an optional the fold OMITTED must come back omitted,
    // and toEqual reads `{ goal: undefined }` as equal to `{}`.
    expect(getRun(db, 'closed')).toStrictEqual(folded.find((run) => run.id === 'closed'));
    expect(getRun(db, 'open')).toStrictEqual(folded.find((run) => run.id === 'open'));
    // The absences, stated on their own, because a round-trip against the fold would
    // still pass if BOTH sides grew the same undefined key.
    expect(getRun(db, 'open')).not.toHaveProperty('endedAt');
    expect(getRun(db, 'open')).not.toHaveProperty('outcome');
    expect(getRun(db, 'open')).not.toHaveProperty('goal');
    // And the values that DO cross, so the case is not only about absence.
    expect(getRun(db, 'closed')?.endedAt).toBe(at(1));
    expect(getRun(db, 'closed')?.outcome).toBe('done');
    expect(getRun(db, 'closed')?.goal).toBe('ship it');
    expect(getRun(db, 'closed')?.open).toBe(false);
  });

  it('carries the instant a run last did something, and omits it when nothing was pinned', () => {
    const events: CatalogEvent[] = [
      runStarted(env('busy', 0), { agent: 'claude' }),
      memoryCaptured(inRun('m-1', 1, 'busy'), { content: 'the first' }),
      memoryCaptured(inRun('m-2', 3, 'busy'), { content: 'the last' }),
      runStarted(env('idle', 4), { agent: 'claude' }),
    ];
    materializeRuns(db, fold(events));

    // The greatest `at` of the facts pinned to it, not the run's own birth — this is
    // what idleness is read from, one surface over.
    expect(getRun(db, 'busy')?.lastFactAt).toBe(at(3));
    // A run nothing was pinned to has NO such key. Not null, not undefined: absent.
    expect(getRun(db, 'idle')).not.toHaveProperty('lastFactAt');
  });

  it('stores `open` as the integer a STRICT table can hold, and agrees with itself', () => {
    const events: CatalogEvent[] = [
      runStarted(env('a-closed', 0), { agent: 'claude' }),
      runEnded(env('a-closed', 1), { outcome: 'done' }),
      runStarted(env('b-open', 2), { agent: 'claude' }),
    ];
    materializeRuns(db, fold(events));

    // Past the mapper, at the column: a boolean or a '1' would not deep-equal a number.
    expect(db.prepare('SELECT id, open FROM runs ORDER BY id').all()).toEqual([
      { id: 'a-closed', open: 0 },
      { id: 'b-open', open: 1 },
    ]);
    // The two readings of "open" — the SQL filter and `row.open === 1` in the mapper —
    // over a set holding one of each, so neither can be vacuously right.
    expect(listOpenRuns(db).map((run) => run.id)).toEqual(
      listRuns(db)
        .filter((run) => run.open)
        .map((run) => run.id),
    );
    expect(listOpenRuns(db).map((run) => run.id)).toEqual(['b-open']);
  });
});

describe('run-store — what the table answers', () => {
  it('orders by id, not by the order the rows were written', () => {
    const folded = fold(threeOutOfOrder());
    // Non-vacuity of the fixture: the fold really does hand them over out of id order.
    expect(folded.map((run) => run.id)).toEqual(['r-c', 'r-b', 'r-a']);
    materializeRuns(db, folded);
    expect(listRuns(db).map((run) => run.id)).toEqual(['r-a', 'r-b', 'r-c']);
    expect(listOpenRuns(db).map((run) => run.id)).toEqual(['r-a', 'r-b', 'r-c']);
  });

  it('writes every run it is handed, and nothing when handed none', () => {
    materializeRuns(db, fold(threeOutOfOrder()));
    // Three, because a loop that wrote only the first survives every rebuild-against-
    // rebuild comparison in this package.
    expect(listRuns(db)).toHaveLength(3);
    db.prepare('DELETE FROM runs').run();
    materializeRuns(db, []);
    expect(listRuns(db)).toEqual([]);
  });

  it('answers an id nothing projected with null, while the table holds others', () => {
    materializeRuns(db, fold(threeOutOfOrder()));
    // toBeNull exactly: a lookup that stopped being an equality would hand back
    // SOMEONE ELSE'S run, and every caller in the product tests `=== null`.
    expect(getRun(db, 'r-nobody')).toBeNull();
    // The positive discriminator beside it, so a query that ignored its parameter and
    // returned the first row is red too.
    expect(getRun(db, 'r-b')?.id).toBe('r-b');
  });

  it('is a plain insert, so a second materialize of an id is a hard error', () => {
    const folded = fold(threeOutOfOrder());
    materializeRuns(db, folded);
    // The contract is "the caller emptied the table for me". An upsert here would turn a
    // rebuild that failed to clear into a plausible cache instead of a loud failure.
    expect(() => materializeRuns(db, folded)).toThrow(/UNIQUE constraint failed: runs\.id/);
  });
});
