/**
 * THE TASK PROJECTION ACROSS SQLITE — the boundary, asked directly.
 *
 * This module was at full line coverage with no test naming it. Three files execute it:
 * `cache.test.ts`, whose subject is that the cache is not the source; `advance.test.ts`,
 * which compares an advanced database against a replayed one — both sides running
 * through this same code; and `tests/integration/cross-entity.test.ts`, which asks for
 * one field of one task. What crosses the boundary was never the subject of any of them.
 *
 * MEASURED, on a green tree: dropping `ORDER BY id`, turning the INSERT into an
 * `INSERT OR REPLACE`, turning `state = ?` into `state LIKE ?`, turning `id = ?` into
 * `id >= ?`, and answering an absent row with `undefined` instead of `null` ALL survive
 * the suite. Five of this module's six behaviours were unprotected at full line coverage.
 * That is the distance between a line running and a property being held, and it is why
 * this file exists.
 *
 * THE STATES ARE THE WORKFLOW'S. `cache.test.ts` writes lowercase `'done'` and
 * `'in-progress'`, which the gate never produces — harmless there, because nothing it
 * asserts is about a state's spelling, and fatal here, because the literal-match case
 * below is exactly about the spelling. Every state in this file comes from
 * `INITIAL_STATE` and from a row of `TRANSITIONS`, so a fixture cannot describe a task
 * the product could not have written.
 *
 * IDS ARE CHOSEN, NOT MINTED. `mintId` is time-ordered, so minted ids would make
 * insertion order and id order coincide and the ordering case would pass on the wrong
 * thing — which is the hole `cache.test.ts` fell into by writing `t-1` before `t-2`.
 */

import { type CatalogEvent, taskBirth, taskTransitioned } from '@mnema/chain';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureSchema } from '../db/schema.js';
import type { SqliteDatabase } from '../db/sqlite.js';
import { INITIAL_STATE } from '../workflow/states.js';
import { findTransition } from '../workflow/transitions.js';
import { projectTasks, type TaskProjection } from './task.js';
import { getTask, listTasks, listTasksByState, materializeTasks } from './task-store.js';

let db: SqliteDatabase;

beforeEach(() => {
  db = new Database(':memory:');
  ensureSchema(db);
});

afterEach(() => {
  db.close();
});

const at = (n: number) => `2026-07-21T00:00:0${n}.000Z`;
const env = (subject: string, n: number) => ({
  at: at(n),
  who: 'felipe',
  signerFp: 'fp-1',
  subject,
});

/** The state `submit` reaches from the initial one, read off the workflow's own table. */
const READY = findTransition(INITIAL_STATE, 'submit')?.to;

/** A task born and left where it was born. */
function born(id: string, n: number): CatalogEvent[] {
  return taskBirth(env(id, n), { title: `title ${id}`, initial: INITIAL_STATE });
}

/** A task born and then moved once, so its two instants differ. */
function moved(id: string, n: number): CatalogEvent[] {
  return [
    ...born(id, n),
    taskTransitioned(env(id, n + 1), {
      from: INITIAL_STATE,
      to: READY as string,
      action: 'submit',
    }),
  ];
}

/** The fold, which is the only producer of a TaskProjection in this product. */
const fold = (events: readonly CatalogEvent[]): Map<string, TaskProjection> => projectTasks(events);

/** Three tasks handed over in DESCENDING id order: two moved, one left at birth. */
function threeOutOfOrder(): Map<string, TaskProjection> {
  return fold([...moved('t-c', 0), ...moved('t-b', 2), ...born('t-a', 4)]);
}

describe('task-store — what goes in comes back out', () => {
  it('round-trips the fold exactly, with the two instants kept apart', () => {
    const folded = fold(moved('t-1', 0));
    materializeTasks(db, folded.values());
    // Against the fold's own object, so the two sides cannot drift together.
    expect(getTask(db, 't-1')).toStrictEqual(folded.get('t-1'));
    // The fixture MOVES the task, so birth time and last-moved time are different
    // instants — a swap of the two columns is invisible over a task that never moved.
    expect(getTask(db, 't-1')?.createdAt).toBe(at(0));
    expect(getTask(db, 't-1')?.updatedAt).toBe(at(1));
    expect(getTask(db, 't-1')?.state).toBe(READY);
  });

  it('writes every row of an ITERABLE, which is the shape its only caller passes', () => {
    const folded = threeOutOfOrder();
    // The Map iterator itself, not a spread of it: `rebuild.ts` hands over
    // `folded.tasks.values()`, so a loop that only understood arrays would write nothing
    // on every real rebuild and everything in a test that pre-spread.
    materializeTasks(db, folded.values());
    expect(listTasks(db)).toHaveLength(folded.size);
    expect(listTasks(db)).toHaveLength(3);
  });
});

describe('task-store — what the table answers', () => {
  it('orders by id, not by the order the rows were written', () => {
    const folded = threeOutOfOrder();
    // Non-vacuity of the fixture: insertion order really is not id order.
    expect([...folded.keys()]).toEqual(['t-c', 't-b', 't-a']);
    materializeTasks(db, folded.values());
    expect(listTasks(db).map((task) => task.id)).toEqual(['t-a', 't-b', 't-c']);
  });

  it('orders the by-state read by id too — it is a second query, not the same one', () => {
    materializeTasks(db, threeOutOfOrder().values());
    // Two tasks in ONE state, written in reverse id order. The rule is spelled twice in
    // this module, in two SQL strings, and the case above reaches only the first.
    expect(listTasksByState(db, READY as string).map((task) => task.id)).toEqual(['t-b', 't-c']);
    expect(listTasksByState(db, INITIAL_STATE).map((task) => task.id)).toEqual(['t-a']);
  });

  it('matches a state literally, never as a pattern', () => {
    materializeTasks(db, threeOutOfOrder().values());
    // A `LIKE` would make every one of these answer with rows: `%` the whole table,
    // the lowercase spelling the same set as the real one, the prefix its own set.
    expect(listTasksByState(db, '%')).toEqual([]);
    expect(listTasksByState(db, 'ready')).toEqual([]);
    expect(listTasksByState(db, 'READ%')).toEqual([]);
    // And the state that IS in the table still answers, so the four lines above are not
    // passing because the fixture is empty.
    expect(listTasksByState(db, READY as string)).toHaveLength(2);
  });

  it('answers an id nothing projected with null — the absent row, never the nearest', () => {
    materializeTasks(db, threeOutOfOrder().values());
    // `t-0` sorts BELOW every stored id, so a lookup that became `id >= ?` would hand
    // back `t-a` instead of nothing. Downstream, `locate.ts` decides an id is a known
    // entity with `getTask(id) !== null`, so a wrong answer here makes every unknown id
    // known.
    expect(getTask(db, 't-0')).toBeNull();
    // The positive discriminator, so a query that ignored its parameter is red too.
    expect(getTask(db, 't-b')?.id).toBe('t-b');
  });

  it('is a plain insert, so a second materialize of an id is a hard error', () => {
    const folded = threeOutOfOrder();
    materializeTasks(db, folded.values());
    // The contract is "the caller emptied the table for me". An upsert would turn a
    // rebuild that failed to clear into a plausible cache instead of a loud failure.
    expect(() => materializeTasks(db, folded.values())).toThrow(
      /UNIQUE constraint failed: tasks\.id/,
    );
  });
});

describe('the fixture describes a task the workflow could have written', () => {
  it('takes both states off the workflow rather than typing them', () => {
    // A state this product never produces would leave the literal-match case above
    // asserting over a world that cannot exist — the defect a lowercase `'done'` in a
    // fixture already hid once in this directory.
    expect(INITIAL_STATE).toBe('DRAFT');
    expect(READY).toBe('READY');
    expect(findTransition(INITIAL_STATE, 'submit')).toBeDefined();
  });
});
