/**
 * Persisting and querying the knowledge projection in SQLite.
 *
 * The pure folds produce the knowledge projections; this module writes them into
 * their tables and reads them back: captured memories into `memories`,
 * observations into `observations`, handoffs into `handoffs`, and link edges
 * into `links`. Like every projection store, it is a CACHE of the chain —
 * dropped and replayed on a rebuild, never authored directly — so nothing here
 * is a source of truth.
 */

import type { SqliteDatabase } from '../db/sqlite.js';
import type {
  HandoffProjection,
  LinkEdge,
  MemoryProjection,
  ObservationProjection,
} from './knowledge.js';

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

/** The `observations` row shape as stored. */
interface ObservationRow {
  readonly id: string;
  readonly about: string;
  readonly topic: string;
  readonly text: string;
  readonly who: string;
  readonly recorded_at: string;
}

/**
 * Inserts the given observation projections. Called during a rebuild after the
 * table has been recreated empty. The caller owns the surrounding transaction.
 */
export function materializeObservations(
  db: SqliteDatabase,
  observations: Iterable<ObservationProjection>,
): void {
  const insert = db.prepare(
    `INSERT INTO observations (id, about, topic, text, who, recorded_at)
     VALUES (@id, @about, @topic, @text, @who, @recordedAt)`,
  );
  for (const observation of observations) {
    insert.run(observation);
  }
}

/** Reads one observation by id, or null if it is not projected. */
export function getObservation(db: SqliteDatabase, id: string): ObservationProjection | null {
  const row = db.prepare('SELECT * FROM observations WHERE id = ?').get(id) as
    | ObservationRow
    | undefined;
  return row === undefined ? null : toObservation(row);
}

/** Lists observations about the given entity, ordered by time then id. */
export function listObservationsAbout(db: SqliteDatabase, about: string): ObservationProjection[] {
  const rows = db
    .prepare('SELECT * FROM observations WHERE about = ? ORDER BY recorded_at, id')
    .all(about) as ObservationRow[];
  return rows.map(toObservation);
}

function toObservation(row: ObservationRow): ObservationProjection {
  return {
    id: row.id,
    about: row.about,
    topic: row.topic,
    text: row.text,
    who: row.who,
    recordedAt: row.recorded_at,
  };
}

/** The `handoffs` row shape as stored. */
interface HandoffRow {
  readonly task: string;
  readonly from_agent: string;
  readonly to_agent: string;
  readonly who: string;
  readonly recorded_at: string;
}

/** The bound-parameter shape for a handoff insert. */
interface HandoffParams {
  readonly task: string;
  readonly fromAgent: string;
  readonly toAgent: string;
  readonly who: string;
  readonly recordedAt: string;
}

/**
 * Inserts the given handoffs, flattened across tasks. Called during a rebuild
 * after the table has been recreated empty. The caller owns the transaction.
 */
export function materializeHandoffs(
  db: SqliteDatabase,
  handoffsByTask: Iterable<HandoffProjection[]>,
): void {
  const insert = db.prepare(
    `INSERT INTO handoffs (task, from_agent, to_agent, who, recorded_at)
     VALUES (@task, @fromAgent, @toAgent, @who, @recordedAt)`,
  );
  for (const list of handoffsByTask) {
    for (const handoff of list) {
      insert.run(toHandoffParams(handoff));
    }
  }
}

/** Lists the handoffs on the given task, ordered by time. */
export function listHandoffs(db: SqliteDatabase, task: string): HandoffProjection[] {
  const rows = db
    .prepare('SELECT * FROM handoffs WHERE task = ? ORDER BY recorded_at')
    .all(task) as HandoffRow[];
  return rows.map(toHandoff);
}

function toHandoffParams(handoff: HandoffProjection): HandoffParams {
  return {
    task: handoff.task,
    fromAgent: handoff.fromAgent,
    toAgent: handoff.toAgent,
    who: handoff.who,
    recordedAt: handoff.recordedAt,
  };
}

function toHandoff(row: HandoffRow): HandoffProjection {
  return {
    task: row.task,
    fromAgent: row.from_agent,
    toAgent: row.to_agent,
    who: row.who,
    recordedAt: row.recorded_at,
  };
}

/** The `links` row shape as stored. */
interface LinkRow {
  readonly subject: string;
  readonly target: string;
  readonly rel: string;
  readonly who: string;
  readonly linked_at: string;
}

/**
 * Inserts the given link edges. Called during a rebuild after the table has been
 * recreated empty. The fold already collapsed duplicate edges, so every row is a
 * fresh insert with no primary-key clash. The caller owns the transaction.
 */
export function materializeLinks(db: SqliteDatabase, links: Iterable<LinkEdge>): void {
  const insert = db.prepare(
    `INSERT INTO links (subject, target, rel, who, linked_at)
     VALUES (@subject, @target, @rel, @who, @linkedAt)`,
  );
  for (const link of links) {
    insert.run(link);
  }
}

/** Lists the edges that link OUT of the given subject, ordered by target then rel. */
export function listLinksFrom(db: SqliteDatabase, subject: string): LinkEdge[] {
  const rows = db
    .prepare('SELECT * FROM links WHERE subject = ? ORDER BY target, rel')
    .all(subject) as LinkRow[];
  return rows.map(toLink);
}

/** Lists the edges that link INTO the given target, ordered by subject then rel. */
export function listLinksTo(db: SqliteDatabase, target: string): LinkEdge[] {
  const rows = db
    .prepare('SELECT * FROM links WHERE target = ? ORDER BY subject, rel')
    .all(target) as LinkRow[];
  return rows.map(toLink);
}

function toLink(row: LinkRow): LinkEdge {
  return {
    subject: row.subject,
    target: row.target,
    rel: row.rel,
    who: row.who,
    linkedAt: row.linked_at,
  };
}
