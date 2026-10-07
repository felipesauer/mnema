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

import type { CatalogEvent } from '@mnema/chain';
import type { SqliteDatabase } from '../db/sqlite.js';
import {
  type HandoffProjection,
  type LinkEdge,
  linkOf,
  linkRetractionOf,
  type MemoryProjection,
  type NoteRetraction,
  type ObservationProjection,
  withdraws,
} from './knowledge.js';
import { verb } from './upsert.js';

/** The four retraction columns both note tables carry, as stored. */
interface RetractionColumns {
  readonly retracted_at: string | null;
  readonly retracted_who: string | null;
  readonly retracted_which: string | null;
  readonly retracted_reason: string | null;
}

/** The retraction columns' bound parameters: SQL NULL when the note was not taken back. */
function retractionParams(retracted: NoteRetraction | undefined): {
  retractedAt: string | null;
  retractedWho: string | null;
  retractedWhich: string | null;
  retractedReason: string | null;
} {
  return {
    retractedAt: retracted?.at ?? null,
    retractedWho: retracted?.who ?? null,
    retractedWhich: retracted?.which ?? null,
    retractedReason: retracted?.reason ?? null,
  };
}

/** The retraction a row holds, absent when it holds none. */
function retractionOf(row: RetractionColumns): { retracted?: NoteRetraction } {
  if (row.retracted_at === null || row.retracted_who === null || row.retracted_reason === null) {
    return {};
  }
  return {
    retracted: {
      at: row.retracted_at,
      who: row.retracted_who,
      ...(row.retracted_which !== null ? { which: row.retracted_which } : {}),
      reason: row.retracted_reason,
    },
  };
}

/**
 * The one condition every read that LISTS notes carries: a note the record took back is
 * not offered as standing knowledge. The reads by id do not carry it — they still serve the
 * note, saying it was retracted.
 */
const STANDING = 'retracted_at IS NULL';

/** The `memories` row shape as stored. */
interface MemoryRow extends RetractionColumns {
  readonly id: string;
  readonly content: string;
  readonly who: string;
  readonly captured_at: string;
}

/**
 * Inserts the given memory projections. Called during a rebuild after the table
 * has been recreated empty, so every memory is a fresh insert. The caller owns
 * the surrounding transaction.
 *
 * `replacing` is for the one caller that does NOT start from an empty table: an advance
 * writes the rows an arrival changed over the rows that were there, and a row that is already
 * there is then the thing being replaced. A rebuild passes nothing, and keeps the failure that
 * says its table was not emptied.
 */
export function materializeMemories(
  db: SqliteDatabase,
  memories: Iterable<MemoryProjection>,
  replacing = false,
): void {
  const insert = db.prepare(
    `${verb(replacing)} INTO memories (id, content, who, captured_at, retracted_at, retracted_who, retracted_which, retracted_reason)
     VALUES (@id, @content, @who, @capturedAt, @retractedAt, @retractedWho, @retractedWhich, @retractedReason)`,
  );
  for (const memory of memories) {
    insert.run({
      id: memory.id,
      content: memory.content,
      who: memory.who,
      capturedAt: memory.capturedAt,
      ...retractionParams(memory.retracted),
    });
  }
}

/** Reads one memory by id, or null if it is not projected. */
export function getMemory(db: SqliteDatabase, id: string): MemoryProjection | null {
  const row = db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as MemoryRow | undefined;
  return row === undefined ? null : toProjection(row);
}

/** Lists the projected memories still standing (not retracted), ordered by id for a stable result. */
export function listMemories(db: SqliteDatabase): MemoryProjection[] {
  const rows = db
    .prepare(`SELECT * FROM memories WHERE ${STANDING} ORDER BY id`)
    .all() as MemoryRow[];
  return rows.map(toProjection);
}

function toProjection(row: MemoryRow): MemoryProjection {
  return {
    id: row.id,
    content: row.content,
    who: row.who,
    capturedAt: row.captured_at,
    ...retractionOf(row),
  };
}

/** The `observations` row shape as stored. */
interface ObservationRow extends RetractionColumns {
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
  replacing = false,
): void {
  const insert = db.prepare(
    `${verb(replacing)} INTO observations (id, about, topic, text, who, recorded_at, retracted_at, retracted_who, retracted_which, retracted_reason)
     VALUES (@id, @about, @topic, @text, @who, @recordedAt, @retractedAt, @retractedWho, @retractedWhich, @retractedReason)`,
  );
  for (const observation of observations) {
    insert.run({
      id: observation.id,
      about: observation.about,
      topic: observation.topic,
      text: observation.text,
      who: observation.who,
      recordedAt: observation.recordedAt,
      ...retractionParams(observation.retracted),
    });
  }
}

/** Reads one observation by id, or null if it is not projected. */
export function getObservation(db: SqliteDatabase, id: string): ObservationProjection | null {
  const row = db.prepare('SELECT * FROM observations WHERE id = ?').get(id) as
    | ObservationRow
    | undefined;
  return row === undefined ? null : toObservation(row);
}

/** Lists the standing (not retracted) observations about the given entity, by time then id. */
export function listObservationsAbout(db: SqliteDatabase, about: string): ObservationProjection[] {
  const rows = db
    .prepare(`SELECT * FROM observations WHERE about = ? AND ${STANDING} ORDER BY recorded_at, id`)
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
    ...retractionOf(row),
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

/**
 * Lists the handoffs on the given task, oldest first — a TOTAL order, which
 * `ORDER BY recorded_at` alone was not.
 *
 * A handoff row is the one row in this schema with no id of its own: it is a list
 * entry rather than an entity (see the table's comment), so the tie between two
 * handoffs recorded in the same millisecond — one batch script, or a chat restarted
 * twice — cannot be broken the way every other read here breaks it. With no second
 * column to name, the order was whatever the query plan happened to produce, and a
 * plan is not a contract: the index scan this read gets today returns insertion
 * order, and a plan that sorted into a temp b-tree would not have to.
 *
 * So the tie-break is `rowid`, which IS insertion order, and insertion order is the
 * chain's own: a rebuild materializes the fold in replay order, and replay order is
 * total and deterministic for a tree. That makes the answer the record's order rather
 * than SQLite's, which is the same reason the other reads name `id`.
 *
 * Not `id DESC` like the newest-first reads, because this list is oldest first — a
 * handoff chain is read forwards — and an ascending tie-break is the one that agrees
 * with an ascending instant. See `newest-first.ts` for the sites where it does not.
 */
export function listHandoffs(db: SqliteDatabase, task: string): HandoffProjection[] {
  const rows = db
    .prepare('SELECT * FROM handoffs WHERE task = ? ORDER BY recorded_at, rowid')
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

/**
 * Inserts the standing assertions of edges, in the order they came to stand — the order
 * `rowid` keeps, and the one {@link advanceLinks} reads an edge's origin by. Called during a
 * rebuild after the table has been recreated empty. The caller owns the transaction.
 */
export function materializeLinkAssertions(
  db: SqliteDatabase,
  assertions: Iterable<LinkEdge>,
): void {
  const insert = db.prepare(
    `INSERT INTO link_assertions (subject, target, rel, who, linked_at)
     VALUES (@subject, @target, @rel, @who, @linkedAt)`,
  );
  for (const assertion of assertions) insert.run(assertion);
}

/**
 * Brings `links` and `link_assertions` forward over events appended to the order they were
 * built from, ONE EVENT AT A TIME and in that order, applying the rule the replay applies: an
 * assertion stands from where it is made ({@link linkOf}), a retraction withdraws the ones of
 * its edge it {@link withdraws}, and an edge's row is the lowest of its assertions standing —
 * or no row at all, when none does. The caller owns the transaction.
 */
export function advanceLinks(db: SqliteDatabase, arrived: readonly CatalogEvent[]): void {
  const assert = db.prepare(
    `INSERT OR IGNORE INTO link_assertions (subject, target, rel, who, linked_at)
     VALUES (@subject, @target, @rel, @who, @linkedAt)`,
  );
  const edge = db.prepare(
    `INSERT OR IGNORE INTO links (subject, target, rel, who, linked_at)
     VALUES (@subject, @target, @rel, @who, @linkedAt)`,
  );
  const ofEdge = db.prepare(
    'SELECT * FROM link_assertions WHERE subject = ? AND target = ? AND rel = ? ORDER BY rowid',
  );
  const withdraw = db.prepare(
    'DELETE FROM link_assertions WHERE subject = ? AND target = ? AND rel = ? AND who = ?',
  );
  const drop = db.prepare('DELETE FROM links WHERE subject = ? AND target = ? AND rel = ?');
  for (const event of arrived) {
    const asserted = linkOf(event);
    if (asserted !== undefined) {
      assert.run(asserted);
      edge.run(asserted);
      continue;
    }
    const retraction = linkRetractionOf(event);
    if (retraction === undefined) continue;
    const { subject, target, rel } = retraction;
    const standing = (ofEdge.all(subject, target, rel) as LinkRow[]).map(toLink);
    const left = standing.filter((assertion) => !withdraws(retraction, assertion));
    if (left.length === standing.length) continue;
    for (const gone of standing) {
      if (withdraws(retraction, gone)) withdraw.run(subject, target, rel, gone.who);
    }
    drop.run(subject, target, rel);
    const origin = left[0];
    if (origin !== undefined) edge.run(origin);
  }
}

/** Whether one identity's assertion of an edge still stands (a row of `link_assertions`). */
export function linkAssertionStands(
  db: SqliteDatabase,
  assertion: {
    readonly subject: string;
    readonly target: string;
    readonly rel: string;
    readonly who: string;
  },
): boolean {
  const row = db
    .prepare(
      'SELECT 1 FROM link_assertions WHERE subject = ? AND target = ? AND rel = ? AND who = ?',
    )
    .get(assertion.subject, assertion.target, assertion.rel, assertion.who);
  return row !== undefined;
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

/**
 * Lists every edge asserting the given relation, ordered by target then subject.
 *
 * The third way into the same table, and the one that reads the RELATION rather
 * than an end: "which rules address a path" cannot start from a subject (the
 * asker does not know which decisions there are) nor from a target (the asker has
 * a path, and the addresses that cover it are PREFIXES of it, not equal to it).
 * So the label is the key, and the caller filters the targets itself.
 *
 * `rel` is an open string the catalog never closes, so this takes any label and
 * knows none: it is a lookup, not a vocabulary. The order is a property of the
 * CONTENT, like the other two, so which rows come back cannot depend on the order
 * they were written in.
 */
export function listLinksByRelation(db: SqliteDatabase, rel: string): LinkEdge[] {
  const rows = db
    .prepare('SELECT * FROM links WHERE rel = ? ORDER BY target, subject')
    .all(rel) as LinkRow[];
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
