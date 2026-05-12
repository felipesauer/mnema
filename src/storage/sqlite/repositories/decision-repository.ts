import type { Decision } from '../../../domain/entities/decision.js';
import type { DecisionStatus } from '../../../domain/enums/decision-status.js';
import { generateUuid } from '../../../domain/id-generator.js';
import { isoNow } from '../../../utils/iso-now.js';
import type { SqliteAdapter } from '../sqlite-adapter.js';

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
  readonly key: string;
  readonly projectId: string;
  readonly title: string;
  readonly decision: string;
  readonly context?: string | null;
  readonly rationale?: string | null;
  readonly consequences?: string | null;
  readonly authoredBy: string;
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
    const id = generateUuid();
    const metadata = JSON.stringify(input.metadata ?? {});
    const now = isoNow();

    this.adapter
      .getDatabase()
      .prepare(
        `INSERT INTO decisions (
           id, key, project_id, title, context, decision, rationale,
           consequences, status, authored_by, metadata, at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'proposed', ?, ?, ?, ?)`,
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
        input.authoredBy,
        metadata,
        now,
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
}

function rowToDecision(row: DecisionRow): Decision {
  return {
    id: row.id,
    key: row.key,
    projectId: row.project_id,
    title: row.title,
    context: row.context,
    decision: row.decision,
    rationale: row.rationale,
    consequences: row.consequences,
    status: row.status as DecisionStatus,
    supersededBy: row.superseded_by,
    authoredBy: row.authored_by,
    metadata: JSON.parse(row.metadata) as Record<string, unknown>,
    at: row.at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}
