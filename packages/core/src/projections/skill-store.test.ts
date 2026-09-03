/**
 * THE SKILL PROJECTION ACROSS SQLITE — the boundary, asked directly.
 *
 * This module was at full line coverage with no test naming it. Two files execute it,
 * both one directory over: `cache.test.ts`, whose subject is the cache and which drives
 * four skills through `ProjectionCache.rebuild()`, and `advance.test.ts`, which compares
 * an advanced database against a replayed one — both sides of that comparison running
 * through this same code, so no mutation in here can move it.
 *
 * WHAT cache.test.ts DOES HOLD, said out loud so this file does not restate it: the
 * adoption instant reaching the column, `adopted_at` being the presence marker rather
 * than `adopted_by`, `proposedBy` crossing, and `created_at`/`updated_at` not swapping.
 * Those four were verified red under mutation and are left where they are.
 *
 * WHAT IT DOES NOT, and what is here for that reason. It writes `sk-1` before `sk-2`,
 * so `ORDER BY id` is invisible — measured: dropping it from BOTH queries leaves 4227
 * tests green. It never asks for an id nothing projected. It never materializes one
 * twice. And it compares the adoption with `toEqual`, which cannot tell `{ at }` from
 * `{ at, by: undefined }` — the very distinction the module's own comment says the two
 * NULL columns carry.
 *
 * THE FIXTURE IS THE FOLD'S. `projectSkills` is the only producer of a SkillProjection,
 * and the legal path into `adopted` is proposed to reviewed to adopted — a bare
 * proposed-to-adopted is a move the gate refuses, so writing one by hand would assert
 * over a skill that cannot exist. Ids are chosen, not minted, because `mintId` is
 * time-ordered: minted ids would make insertion order and id order coincide and the
 * ordering cases below would be satisfied by the wrong thing.
 */

import { type CatalogEvent, skillCreated, skillTransitioned } from '@mnema/chain';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureSchema } from '../db/schema.js';
import type { SqliteDatabase } from '../db/sqlite.js';
import { INITIAL_SKILL_STATE } from '../workflow/skill-states.js';
import { projectSkills, type SkillProjection } from './skill.js';
import { getSkill, listSkills, listSkillsByState, materializeSkills } from './skill-store.js';

let db: SqliteDatabase;

beforeEach(() => {
  db = new Database(':memory:');
  ensureSchema(db);
});

afterEach(() => {
  db.close();
});

const at = (n: number) => `2026-07-23T00:00:0${n}.000Z`;
const env = (subject: string, n: number, which?: string) => ({
  at: at(n),
  who: 'felipe',
  signerFp: 'fp-1',
  subject,
  ...(which !== undefined ? { which } : {}),
});

/** The birth pair — a lone `skill.created` is not projected, so both events or none. */
function birth(id: string, n: number, which?: string): CatalogEvent[] {
  return [
    skillCreated(env(id, n, which), { name: `name ${id}`, body: `body ${id}` }),
    skillTransitioned(env(id, n, which), { from: null, to: INITIAL_SKILL_STATE, action: 'create' }),
  ];
}

/** The legal walk into `adopted`: review with a note, then adopt with a note. */
function adopted(id: string, n: number, which?: string): CatalogEvent[] {
  return [
    ...birth(id, n, which),
    skillTransitioned(env(id, n + 1, which), {
      from: 'proposed',
      to: 'reviewed',
      action: 'review',
      fields: { note: 'it reads well' },
    }),
    skillTransitioned(env(id, n + 2, which), {
      from: 'reviewed',
      to: 'adopted',
      action: 'adopt',
      fields: { note: 'use it' },
    }),
  ];
}

/** The fold, which is the only producer of a SkillProjection in this product. */
const fold = (events: readonly CatalogEvent[]): Map<string, SkillProjection> =>
  projectSkills(events);

describe('skill-store — the adoption survives the round trip', () => {
  it('tells a person’s adoption from an agent’s, and both from none', () => {
    // Three skills, one of each shape, in one table — so a mutation that merged any two
    // of them has nowhere to hide.
    const events: CatalogEvent[] = [
      ...adopted('sk-person', 0),
      ...adopted('sk-agent', 3, 'agent-beta'),
      ...birth('sk-nobody', 6),
    ];
    const folded = fold(events);
    materializeSkills(db, folded.values());

    const person = getSkill(db, 'sk-person');
    const agent = getSkill(db, 'sk-agent');
    const nobody = getSkill(db, 'sk-nobody');

    // A PERSON acted: the adoption exists and carries an instant alone. The key set is
    // asserted, not just the value — `{ at, by: undefined }` passes a toEqual against
    // `{ at }`, and the module's own comment stakes the two columns on that difference.
    expect(Object.keys(person?.adoption ?? {})).toEqual(['at']);
    expect(person?.adoption?.at).toBe(at(2));
    // An AGENT executed it: the instant and the agent, joined.
    expect(agent?.adoption).toStrictEqual({ at: at(5), by: 'agent-beta' });
    // Nobody has: no adoption at all, and the key absent rather than undefined.
    expect(nobody).not.toHaveProperty('adoption');
  });

  it('round-trips the fold exactly, absent optionals included', () => {
    const events = [...adopted('sk-1', 0, 'agent-beta')];
    const folded = fold(events);
    materializeSkills(db, folded.values());
    // toStrictEqual against the fold's own object: the two sides cannot drift together,
    // and an optional the fold omitted must come back omitted.
    expect(getSkill(db, 'sk-1')).toStrictEqual(folded.get('sk-1'));
    // The birth and the last move are different instants, so a swap of the two columns
    // is visible here as well as in the cache's case.
    expect(getSkill(db, 'sk-1')?.createdAt).toBe(at(0));
    expect(getSkill(db, 'sk-1')?.updatedAt).toBe(at(2));
    expect(getSkill(db, 'sk-1')?.state).toBe('adopted');
  });
});

describe('skill-store — what the table answers', () => {
  /** Two adopted and one proposed, written in DESCENDING id order. */
  function threeOutOfOrder(): Map<string, SkillProjection> {
    return fold([...adopted('sk-c', 0), ...adopted('sk-b', 3), ...birth('sk-a', 6)]);
  }

  it('orders by id, not by the order the rows were written', () => {
    const folded = threeOutOfOrder();
    // Non-vacuity of the fixture: insertion order really is not id order.
    expect([...folded.keys()]).toEqual(['sk-c', 'sk-b', 'sk-a']);
    materializeSkills(db, folded.values());
    expect(listSkills(db).map((skill) => skill.id)).toEqual(['sk-a', 'sk-b', 'sk-c']);
  });

  it('orders the by-state read by id too — it is a second query, not the same one', () => {
    materializeSkills(db, threeOutOfOrder().values());
    // Two skills in ONE state, so this says something the case above does not: the rule
    // is written twice in this module, in two SQL strings, and one test cannot cover both.
    expect(listSkillsByState(db, 'adopted').map((skill) => skill.id)).toEqual(['sk-b', 'sk-c']);
    expect(listSkillsByState(db, INITIAL_SKILL_STATE).map((skill) => skill.id)).toEqual(['sk-a']);
  });

  it('matches a state literally, never as a pattern', () => {
    materializeSkills(db, threeOutOfOrder().values());
    // A `LIKE` here would make `%` return the whole table and `ADOPTED` return the
    // adopted ones — the state a caller asks with comes from a closed set, and the
    // store's job is to answer that set and nothing near it.
    expect(listSkillsByState(db, '%')).toEqual([]);
    expect(listSkillsByState(db, 'ADOPTED')).toEqual([]);
    expect(listSkillsByState(db, 'adopt%')).toEqual([]);
  });

  it('answers an id nothing projected with null, while the table holds others', () => {
    materializeSkills(db, threeOutOfOrder().values());
    // toBeNull exactly: the copilot's fall-through across trees is `if (skill === null)
    // continue`, so undefined and a throw are both wrong answers.
    expect(getSkill(db, 'sk-nowhere')).toBeNull();
    expect(getSkill(db, 'sk-b')?.id).toBe('sk-b');
  });

  it('is a plain insert, so a second materialize of an id is a hard error', () => {
    const folded = threeOutOfOrder();
    materializeSkills(db, folded.values());
    expect(() => materializeSkills(db, folded.values())).toThrow(
      /UNIQUE constraint failed: skills\.id/,
    );
  });
});
