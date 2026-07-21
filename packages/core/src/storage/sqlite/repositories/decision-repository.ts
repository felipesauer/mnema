import type { Decision } from '../../../domain/entities/decision.js';
import { DecisionStatus } from '../../../domain/enums/decision-status.js';
import { generateUuid } from '../../../domain/id-generator.js';
import { stripInvocationMarkup } from '../../../domain/invocation-markup.js';
import { isoNow } from '../../../utils/iso-now.js';
import type { SqliteAdapter } from '../sqlite-adapter.js';

/** Strips leaked tool-invocation markup from a nullable text column on read. */
function cleanNullable(value: string | null): string | null {
  return value === null ? null : stripInvocationMarkup(value);
}

interface DecisionRow {
  readonly id: string;
  readonly key: string;
  readonly project_id: string;
  readonly title: string;
  readonly context: string | null;
  readonly decision: string;
  readonly rationale: string | null;
  readonly consequences: string | null;
  readonly status: string;
  readonly superseded_by: string | null;
  readonly authored_by: string;
  readonly impacts: string;
  readonly metadata: string;
  readonly at: string;
  readonly updated_at: string;
  readonly deleted_at: string | null;
}

/**
 * Result of {@link DecisionRepository.updateStatus} — mirrors the
 * `UpdateStateResult` shape used by `TaskRepository.updateState` so
 * services can branch on `kind` consistently.
 */
export type UpdateDecisionStatusResult =
  | { readonly ok: true; readonly decision: Decision }
  | { readonly ok: false; readonly reason: { readonly kind: 'NOT_FOUND' } }
  | {
      readonly ok: false;
      readonly reason: { readonly kind: 'CONFLICT'; readonly currentUpdatedAt: string };
    };

/**
 * Input for {@link DecisionRepository.insert}.
 */
export interface DecisionInsertInput {
  /** Committed identity, preserved on a clone rebuild; minted when omitted. */
  readonly id?: string;
  readonly key: string;
  readonly projectId: string;
  readonly title: string;
  readonly decision: string;
  readonly context?: string | null;
  readonly rationale?: string | null;
  readonly consequences?: string | null;
  readonly authoredBy: string;
  readonly impacts?: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
  /** Committed status to create in — defaults to proposed (clone rebuild). */
  readonly status?: string;
  /** Committed decision timestamp, preserved on a clone rebuild; default now. */
  readonly at?: string;
}

/** Content columns of a decision that sync rebuild can reconcile from markdown. */
export interface DecisionFieldUpdates {
  readonly title?: string;
  readonly decision?: string;
  readonly context?: string | null;
  readonly rationale?: string | null;
  readonly consequences?: string | null;
  readonly impacts?: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Persistence for {@link Decision} (Architecture Decision Records).
 *
 * Keys follow the `<PROJECT>-ADR-<seq>` shape; the sequence is scoped
 * to the project and produced by {@link nextSequence}.
 */
export class DecisionRepository {
  constructor(private readonly adapter: SqliteAdapter) {}

  /**
   * Returns the next sequential number to use for a decision key,
   * scoped to a project.
   *
   * @param projectId - Internal project id
   * @returns The next available sequence (starts at 1)
   */
  nextSequence(projectId: string): number {
    const row = this.adapter
      .getDatabase()
      .prepare('SELECT COUNT(*) AS n FROM decisions WHERE project_id = ?')
      .get(projectId) as { n: number };
    return row.n + 1;
  }

  /**
   * Runs `fn` inside a `BEGIN IMMEDIATE` transaction, taking the write lock
   * up front so a `nextSequence` COUNT followed by an insert cannot race a
   * second process into minting the same key.
   *
   * @param fn - Synchronous callback executed inside the transaction
   * @returns Whatever `fn` returns
   */
  runInTransactionImmediate<T>(fn: () => T): T {
    return this.adapter.getDatabase().transaction(fn).immediate();
  }

  /**
   * Looks up a decision by its human-readable key.
   *
   * @param key - Decision key, e.g. `WEBAPP-ADR-7`
   * @returns The decision or `null`
   */
  findByKey(key: string): Decision | null {
    const row = this.adapter
      .getDatabase()
      .prepare('SELECT * FROM decisions WHERE key = ? AND deleted_at IS NULL')
      .get(key) as DecisionRow | undefined;
    return row === undefined ? null : rowToDecision(row);
  }

  /**
   * Looks up a decision by its internal id.
   *
   * @param id - Internal UUID of the decision
   * @returns The decision or `null`
   */
  findById(id: string): Decision | null {
    const row = this.adapter
      .getDatabase()
      .prepare('SELECT * FROM decisions WHERE id = ? AND deleted_at IS NULL')
      .get(id) as DecisionRow | undefined;
    return row === undefined ? null : rowToDecision(row);
  }

  /**
   * True when any (non-deleted) decision points at `decisionId` as its
   * successor (`superseded_by`). Guards the reopen/reject of a decision that
   * a superseded predecessor still relies on being live — reopening or
   * rejecting it would strand that predecessor's `superseded_by` pointer at a
   * non-current target.
   *
   * @param decisionId - Internal UUID of the candidate successor
   * @returns Whether some predecessor was superseded by it
   */
  isReferencedAsSuccessor(decisionId: string): boolean {
    const row = this.adapter
      .getDatabase()
      .prepare('SELECT 1 FROM decisions WHERE superseded_by = ? AND deleted_at IS NULL LIMIT 1')
      .get(decisionId);
    return row !== undefined;
  }

  /**
   * Lists every decision of a project ordered by record time.
   *
   * @param projectId - Internal project id
   * @param status - Optional status filter
   * @returns Decisions ordered by `at`
   */
  findByProject(projectId: string, status?: DecisionStatus): Decision[] {
    const rows =
      status === undefined
        ? (this.adapter
            .getDatabase()
            .prepare(
              `SELECT * FROM decisions
                WHERE project_id = ? AND deleted_at IS NULL
                ORDER BY at`,
            )
            .all(projectId) as DecisionRow[])
        : (this.adapter
            .getDatabase()
            .prepare(
              `SELECT * FROM decisions
                WHERE project_id = ? AND status = ? AND deleted_at IS NULL
                ORDER BY at`,
            )
            .all(projectId, status) as DecisionRow[]);
    return rows.map(rowToDecision);
  }

  /**
   * Inserts a new decision in `proposed` state.
   *
   * @param input - Decision fields
   * @returns The newly created decision
   */
  insert(input: DecisionInsertInput): Decision {
    const id = input.id ?? generateUuid();
    const metadata = JSON.stringify(input.metadata ?? {});
    const impacts = JSON.stringify(input.impacts ?? []);
    const now = isoNow();

    this.adapter
      .getDatabase()
      .prepare(
        `INSERT INTO decisions (
           id, key, project_id, title, context, decision, rationale,
           consequences, status, authored_by, impacts, metadata, at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.key,
        input.projectId,
        input.title,
        input.context ?? null,
        input.decision,
        input.rationale ?? null,
        input.consequences ?? null,
        input.status ?? 'proposed',
        input.authoredBy,
        impacts,
        metadata,
        input.at ?? now,
        now,
      );

    const created = this.findById(id);
    if (created === null) {
      throw new Error('decision insert succeeded but row not found');
    }
    return created;
  }

  /**
   * Updates a decision's status, optionally pointing at a successor when
   * marking as `superseded`. Supports optimistic concurrency via
   * `expectedUpdatedAt` — when supplied, the update only proceeds if
   * the current `updated_at` matches.
   *
   * @param decisionId - Internal decision id
   * @param status - Target status
   * @param supersededBy - Successor decision id (only with `superseded`)
   * @param expectedUpdatedAt - Optional optimistic-concurrency token
   * @returns Result describing success or the reason it failed
   */
  updateStatus(
    decisionId: string,
    status: DecisionStatus,
    supersededBy: string | null = null,
    expectedUpdatedAt: string | null = null,
  ): UpdateDecisionStatusResult {
    const db = this.adapter.getDatabase();
    const current = db
      .prepare('SELECT updated_at FROM decisions WHERE id = ? AND deleted_at IS NULL')
      .get(decisionId) as { updated_at: string } | undefined;
    if (current === undefined) {
      return { ok: false, reason: { kind: 'NOT_FOUND' } };
    }
    if (expectedUpdatedAt !== null && current.updated_at !== expectedUpdatedAt) {
      return {
        ok: false,
        reason: { kind: 'CONFLICT', currentUpdatedAt: current.updated_at },
      };
    }

    db.prepare(
      `UPDATE decisions
          SET status = ?, superseded_by = ?, updated_at = ?
        WHERE id = ?`,
    ).run(status, supersededBy, isoNow(), decisionId);

    const reloaded = this.findById(decisionId);
    if (reloaded === null) {
      throw new Error('decision disappeared after updateStatus');
    }
    return { ok: true, decision: reloaded };
  }

  /**
   * Overwrites a decision's content columns from the given fields, skipping
   * any left `undefined`, and stamps `updated_at`. Used by sync rebuild to
   * fold content drift from the committed markdown back onto an existing
   * row. `status` and `superseded_by` are owned by {@link updateStatus} and
   * are never touched here.
   *
   * @param decisionId - Internal decision id
   * @param fields - Content columns to overwrite
   * @returns The reloaded decision
   */
  updateFields(decisionId: string, fields: DecisionFieldUpdates): Decision {
    const sets: string[] = [];
    const values: unknown[] = [];
    if (fields.title !== undefined) {
      sets.push('title = ?');
      values.push(fields.title);
    }
    if (fields.decision !== undefined) {
      sets.push('decision = ?');
      values.push(fields.decision);
    }
    if (fields.context !== undefined) {
      sets.push('context = ?');
      values.push(fields.context);
    }
    if (fields.rationale !== undefined) {
      sets.push('rationale = ?');
      values.push(fields.rationale);
    }
    if (fields.consequences !== undefined) {
      sets.push('consequences = ?');
      values.push(fields.consequences);
    }
    if (fields.impacts !== undefined) {
      sets.push('impacts = ?');
      values.push(JSON.stringify(fields.impacts));
    }
    if (fields.metadata !== undefined) {
      sets.push('metadata = ?');
      values.push(JSON.stringify(fields.metadata));
    }

    if (sets.length > 0) {
      sets.push('updated_at = ?');
      values.push(isoNow());
      values.push(decisionId);
      this.adapter
        .getDatabase()
        .prepare(`UPDATE decisions SET ${sets.join(', ')} WHERE id = ?`)
        .run(...values);
    }

    const reloaded = this.findById(decisionId);
    if (reloaded === null) {
      throw new Error(`updateFields: decision ${decisionId} not found`);
    }
    return reloaded;
  }

  /**
   * Returns the active decisions of a project whose `impacts` list
   * contains the given path/key — the reverse "which decision touched
   * this artefact?" query. Filtered in memory (ADR volume is small).
   *
   * @param projectId - Internal project id
   * @param ref - Artefact path or key to match
   * @returns Matching decisions ordered by recording time (desc)
   */
  findImpacting(projectId: string, ref: string): Decision[] {
    // "Which decision touched X?" should surface decisions that actually
    // govern the artefact. Rejected ADRs never governed anything; superseded
    // ADRs have been replaced — exclude both. Proposed/accepted are kept.
    // Order newest-first, per this method's documented contract (findByProject
    // returns ascending, so re-sort here without disturbing its other callers).
    return this.findByProject(projectId)
      .filter(
        (d) =>
          d.impacts.includes(ref) &&
          d.status !== DecisionStatus.Rejected &&
          d.status !== DecisionStatus.Superseded,
      )
      .sort((a, b) => b.at.localeCompare(a.at));
  }
}

function rowToDecision(row: DecisionRow): Decision {
  return {
    id: row.id,
    key: row.key,
    projectId: row.project_id,
    title: stripInvocationMarkup(row.title),
    context: cleanNullable(row.context),
    decision: stripInvocationMarkup(row.decision),
    rationale: cleanNullable(row.rationale),
    consequences: cleanNullable(row.consequences),
    status: row.status as DecisionStatus,
    supersededBy: row.superseded_by,
    authoredBy: row.authored_by,
    // Drift-tolerant: on a DB stopped before migration 015 the `impacts`
    // column does not exist, so SELECT * yields `undefined` here. A read that
    // worked before an additive migration must not throw — degrade to the
    // column's documented DEFAULT '[]' instead of JSON.parse(undefined).
    impacts: row.impacts == null ? [] : (JSON.parse(row.impacts) as string[]),
    metadata: JSON.parse(row.metadata) as Record<string, unknown>,
    at: row.at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}
