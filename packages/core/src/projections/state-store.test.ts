/**
 * The tables an advance keeps for the readings that used to ask the whole order: who belongs to an
 * identity, and the moves two machines made out of one state.
 */

import type { CatalogEvent } from '@mnema/chain';
import { describe, expect, it } from 'vitest';
import { ensureSchema } from '../db/schema.js';
import { IN_MEMORY, openDatabase } from '../db/sqlite.js';
import { divergentMoves } from './divergent-moves.js';
import { materializeReferences } from './reference-store.js';
import {
  isMembershipFact,
  materializeDivergences,
  materializeMembership,
  readDivergences,
  readMembership,
  reindexDivergences,
} from './state-store.js';

const fp = (c: string) => c.repeat(64);

const founded = (at: string): CatalogEvent =>
  ({
    kind: 'identity.founded',
    v: 1,
    at,
    who: 'mnid:one',
    signerFp: fp('a'),
    subject: 'mnid:one',
    payload: { foundingFp: fp('a') },
  }) as CatalogEvent;

const decided = (at: string, who: string, to: string): CatalogEvent =>
  ({
    kind: 'decision.transitioned',
    v: 1,
    at,
    who,
    signerFp: fp('b'),
    subject: 'a-decision',
    payload: { from: 'proposed', to, action: to === 'accepted' ? 'accept' : 'reject' },
  }) as CatalogEvent;

function database() {
  const db = openDatabase(IN_MEMORY);
  ensureSchema(db);
  return db;
}

describe('the membership facts', () => {
  it('are the three kinds that say who belongs, at their position in the order', () => {
    const memory = { kind: 'memory.captured', subject: 'm' } as CatalogEvent;
    const events = [memory, founded('2026-01-01T00:00:00.000Z')];
    expect(events.map(isMembershipFact)).toEqual([false, true]);

    const db = database();
    materializeMembership(db, events);
    const later = founded('2026-01-02T00:00:00.000Z');
    materializeMembership(db, [later], 2);
    expect(readMembership(db)).toEqual([events[1], later]);
    expect(
      (db.prepare('SELECT ord FROM membership_facts ORDER BY ord').all() as { ord: number }[]).map(
        (row) => row.ord,
      ),
    ).toEqual([1, 2]);
    db.close();
  });
});

describe('the moves that diverged', () => {
  const left = decided('2026-01-01T00:00:01.000Z', 'mnid:one', 'accepted');
  const right = decided('2026-01-01T00:00:02.000Z', 'mnid:two', 'rejected');

  it('are what the whole-record reading names, kept one entity at a time', () => {
    const db = database();
    materializeDivergences(db, [left, right]);
    expect(readDivergences(db)).toEqual(divergentMoves([left, right]));
    expect(readDivergences(db).map((move) => move.entityId)).toEqual(['a-decision']);
    db.close();
  });

  it('are read again for the entities an arrival moved, from the index, and replace what was there', () => {
    const db = database();
    materializeReferences(db, [left]);
    reindexDivergences(db, ['a-decision']);
    expect(readDivergences(db), 'one move out of a state is not a divergence').toEqual([]);

    materializeReferences(db, [right], 1);
    reindexDivergences(db, ['a-decision']);
    expect(readDivergences(db)).toEqual(divergentMoves([left, right]));

    // An entity that no longer has one leaves no row.
    db.prepare('DELETE FROM refs WHERE ord = 1').run();
    reindexDivergences(db, ['a-decision']);
    expect(readDivergences(db)).toEqual([]);
    db.close();
  });
});
