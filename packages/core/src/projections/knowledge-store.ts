/**
 * Persisting and querying the knowledge projection in SQLite.
 *
 * The pure fold ({@link projectKnowledge}) produces the captured memories; this
 * module writes them into the `memories` table and reads them back. Like every
 * projection store, it is a CACHE of the chain — dropped and replayed on a
 * rebuild, never authored directly — so nothing here is a source of truth.
 */

import type { SqliteDatabase } from '../db/sqlite.js';
import type { MemoryProjection } from './knowledge.js';

/** The `memories` row shape as stored. */
interface MemoryRow {
  readonly id: string;
  readonly content: string;
  readonly who: string;
  readonly captured_at: string;
}

/**
 * Inserts the given memory projections. Called during a rebuild after the table
 * has been recreated empty, so every memory is a fresh insert. The caller owns
 * the surrounding transaction.
 */
export function materializeMemories(
  db: SqliteDatabase,
  memories: Iterable<MemoryProjection>,
): void {
  const insert = db.prepare(
    `INSERT INTO memories (id, content, who, captured_at)
     VALUES (@id, @content, @who, @capturedAt)`,
  );
  for (const memory of memories) {
    insert.run(memory);
  }
}

/** Reads one memory by id, or null if it is not projected. */
export function getMemory(db: SqliteDatabase, id: string): MemoryProjection | null {
  const row = db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as MemoryRow | undefined;
  return row === undefined ? null : toProjection(row);
}

/** Lists all projected memories, ordered by id for a stable result. */
export function listMemories(db: SqliteDatabase): MemoryProjection[] {
  const rows = db.prepare('SELECT * FROM memories ORDER BY id').all() as MemoryRow[];
  return rows.map(toProjection);
}

function toProjection(row: MemoryRow): MemoryProjection {
  return {
    id: row.id,
    content: row.content,
    who: row.who,
    capturedAt: row.captured_at,
  };
}
