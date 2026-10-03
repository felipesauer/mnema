/**
 * The tables a cache keeps so that it can be brought forward over what arrived: the
 * accumulators of the entity folds, the facts about who belongs to an identity, and the
 * moves that diverged. None of them is something a reader asks for by itself; each is what
 * one reading would otherwise have to re-derive from the whole order (see `advance.ts`).
 *
 * Like every store here it is a CACHE of the chain, written by a rebuild or an advance and
 * never authored.
 */

import type { CatalogEvent } from '@mnema/chain';
import type { SqliteDatabase } from '../db/sqlite.js';
import type { AccumulatorFold } from './accumulate.js';
import { type DivergentMove, divergentMoves, sortDivergent } from './divergent-moves.js';

/** Stores the accumulators a replay left, so the next advance finds them. */
export function materializeFoldState<A, P>(
  db: SqliteDatabase,
  fold: AccumulatorFold<A, P>,
  accumulators: ReadonlyMap<string, A>,
): void {
  const put = db.prepare('INSERT OR REPLACE INTO fold_state (fold, key, acc) VALUES (?, ?, ?)');
  for (const [key, acc] of accumulators) put.run(fold.name, key, fold.encode(acc));
}

/**
 * The kinds that say who belongs to an identity. The two readings that ask the order about
 * them (`identitiesFoundedBeside`, `rosterIn`) look at these kinds and no other, and what is
 * stored is the whole of what they read — which is why they can be answered without the
 * order.
 */
export function isMembershipFact(event: CatalogEvent): boolean {
  return (
    event.kind === 'identity.founded' ||
    event.kind === 'key.enrolled' ||
    event.kind === 'key.revoked'
  );
}

/**
 * Stores the membership facts among `events`, each at its position in the order. `from` is
 * where `events` begin, as for the reference index: 0 for a whole replay, and the count
 * already covered for what arrived.
 */
export function materializeMembership(
  db: SqliteDatabase,
  events: readonly CatalogEvent[],
  from = 0,
): void {
  const put = db.prepare('INSERT OR REPLACE INTO membership_facts (ord, event) VALUES (?, ?)');
  events.forEach((event, index) => {
    if (isMembershipFact(event)) put.run(from + index, JSON.stringify(event));
  });
}

/** The membership facts the cache holds, in the record's order. */
export function readMembership(db: SqliteDatabase): CatalogEvent[] {
  const rows = db.prepare('SELECT event FROM membership_facts ORDER BY ord').all() as {
    event: string;
  }[];
  return rows.map((row) => JSON.parse(row.event) as CatalogEvent);
}

/** Stores the divergent moves of a whole replay, one row per entity that has any. */
export function materializeDivergences(db: SqliteDatabase, events: readonly CatalogEvent[]): void {
  const byEntity = new Map<string, DivergentMove[]>();
  for (const move of divergentMoves(events)) {
    const moves = byEntity.get(move.entityId);
    if (moves === undefined) byEntity.set(move.entityId, [move]);
    else moves.push(move);
  }
  const put = db.prepare('INSERT OR REPLACE INTO divergences (entity, moves) VALUES (?, ?)');
  for (const [entity, moves] of byEntity) put.run(entity, JSON.stringify(moves));
}

/**
 * Reads the divergent moves of `entities` again, from the moves each of them made, and
 * replaces what the cache held for them.
 *
 * AN ENTITY'S DIVERGENCE IS A PROPERTY OF ITS OWN MOVES, which is what makes this exact: the
 * reading keeps every state by the entity it belongs to, and the one comparison it makes
 * across events — a move repeated byte for byte is one move read twice — is between moves of
 * one entity. So the whole record's answer is the entities' answers put together, and an
 * arrival that moved an entity changes that entity's row and no other. The moves come from
 * the reference index, which holds every event under its subject as it was written and which
 * the caller has already brought forward.
 */
export function reindexDivergences(db: SqliteDatabase, entities: Iterable<string>): void {
  const moves = db.prepare(
    `SELECT event FROM refs
      WHERE entity = ? AND role = 'subject'
        AND kind IN ('task.transitioned', 'decision.transitioned', 'skill.transitioned')
      ORDER BY ord`,
  );
  const drop = db.prepare('DELETE FROM divergences WHERE entity = ?');
  const put = db.prepare('INSERT INTO divergences (entity, moves) VALUES (?, ?)');
  for (const entity of entities) {
    const events = (moves.all(entity) as { event: string }[]).map(
      (row) => JSON.parse(row.event) as CatalogEvent,
    );
    drop.run(entity);
    const found = divergentMoves(events);
    if (found.length > 0) put.run(entity, JSON.stringify(found));
  }
}

/** Every divergent move the cache holds, in the order the whole-record reading reports them. */
export function readDivergences(db: SqliteDatabase): DivergentMove[] {
  const rows = db.prepare('SELECT moves FROM divergences').all() as { moves: string }[];
  return sortDivergent(rows.flatMap((row) => JSON.parse(row.moves) as DivergentMove[]));
}
