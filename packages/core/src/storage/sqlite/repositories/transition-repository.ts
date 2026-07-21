import type { Transition } from '../../../domain/entities/transition.js';
import { generateUuid } from '../../../domain/id-generator.js';
import { isoNow } from '../../../utils/iso-now.js';
import type { SqliteAdapter } from '../sqlite-adapter.js';

/**
 * A transition annotated with the human task key. Used when surfacing
 * transitions in human-facing views (e.g. `mnema agent inspect`) so
 * the reader does not have to map UUIDs back to keys themselves.
 */
export interface TransitionWithKey extends Transition {
  readonly taskKey: string;
}

interface TransitionRow {
  readonly id: string;
  readonly task_id: string;
  readonly from_state: string | null;
  readonly to_state: string;
  readonly action: string;
  readonly payload: string;
  readonly actor_id: string;
  readonly via_actor_id: string | null;
  readonly agent_run_id: string | null;
  readonly at: string;
}

/**
 * Input shape for {@link TransitionRepository.record}.
 */
export interface RecordTransitionInput {
  readonly taskId: string;
  readonly fromState: string | null;
  readonly toState: string;
  readonly action: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly actorId: string;
  readonly viaActorId?: string | null;
  readonly agentRunId?: string | null;
}

/**
 * Input shape for {@link TransitionRepository.insertProjected} — a transition
 * reconstructed from the audit chain rather than recorded live. Unlike
 * {@link RecordTransitionInput}, the caller supplies the committed `id` and
 * `at` from the source event so the projection is a faithful replay, not a
 * fresh stamp.
 */
export interface ProjectedTransitionInput extends RecordTransitionInput {
  /** The transition's committed id (minted by the projector from the event). */
  readonly id: string;
  /** The source event's timestamp — the true moment of the transition. */
  readonly at: string;
}

/**
 * Persistence for {@link Transition}. Append-only at the SQL level:
 * UPDATE/DELETE on `transitions` are blocked by triggers.
 */
export class TransitionRepository {
  constructor(private readonly adapter: SqliteAdapter) {}

  /**
   * Appends a transition record. Caller is expected to have already
   * verified the move against the workflow.
   *
   * @param input - Transition fields to persist
   * @returns The newly written transition
   */
  record(input: RecordTransitionInput): Transition {
    const id = generateUuid();
    const payload = JSON.stringify(input.payload);

    this.adapter
      .getDatabase()
      .prepare(
        `INSERT INTO transitions (
           id, task_id, from_state, to_state, action,
           payload, actor_id, via_actor_id, agent_run_id, at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.taskId,
        input.fromState,
        input.toState,
        input.action,
        payload,
        input.actorId,
        input.viaActorId ?? null,
        input.agentRunId ?? null,
        isoNow(),
      );

    const found = this.findById(id);
    if (found === null) {
      throw new Error('transition insert succeeded but row not found');
    }
    return found;
  }

  /**
   * Total number of transition rows. Used by the rebuild to decide whether the
   * table needs projecting: a fresh clone has none (the live hot-path is the
   * only writer, so a clone that never ran it starts empty), while a live
   * project already holds the authoritative rows and must not be re-projected.
   *
   * @returns The row count
   */
  count(): number {
    const row = this.adapter
      .getDatabase()
      .prepare('SELECT COUNT(*) AS n FROM transitions')
      .get() as { n: number };
    return row.n;
  }

  /**
   * Appends a transition reconstructed from the audit chain, preserving the
   * committed `id` and `at` from the source event. Same append-only INSERT as
   * {@link record} — it does not touch the UPDATE/DELETE-blocking triggers —
   * but replays a historical row faithfully instead of stamping a new one.
   * Only the rebuild uses this, and only against an empty table.
   *
   * @param input - Projected transition, carrying the committed id + timestamp
   */
  insertProjected(input: ProjectedTransitionInput): void {
    this.adapter
      .getDatabase()
      .prepare(
        `INSERT INTO transitions (
           id, task_id, from_state, to_state, action,
           payload, actor_id, via_actor_id, agent_run_id, at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.taskId,
        input.fromState,
        input.toState,
        input.action,
        JSON.stringify(input.payload),
        input.actorId,
        input.viaActorId ?? null,
        input.agentRunId ?? null,
        input.at,
      );
  }

  /**
   * Lists transitions of a task in chronological order.
   *
   * @param taskId - Internal task id
   * @returns Array of transitions ordered by `at`
   */
  findByTask(taskId: string): Transition[] {
    const rows = this.adapter
      .getDatabase()
      .prepare(`SELECT * FROM transitions WHERE task_id = ? ORDER BY at`)
      .all(taskId) as TransitionRow[];
    return rows.map(rowToTransition);
  }

  /**
   * Lists transitions caused by an agent run, in chronological order, each
   * annotated with the task's committed id (the display layer derives a short
   * alias from it). The `task_id` is already on the transition row, so no join
   * is needed.
   *
   * @param runId - Agent run identifier
   * @returns Array of transitions emitted while the run was active
   */
  findByRun(runId: string): TransitionWithKey[] {
    const rows = this.adapter
      .getDatabase()
      .prepare(
        `SELECT t.*
           FROM transitions t
          WHERE t.agent_run_id = ?
          ORDER BY t.at`,
      )
      .all(runId) as TransitionRow[];
    return rows.map((row) => ({ ...rowToTransition(row), taskKey: row.task_id }));
  }

  /**
   * Returns every transition with the given action name, annotated with the
   * task's committed id, oldest first. Used by the evolution report to mine
   * rework signals that do not depend on a reopen — e.g. `request_changes` on a
   * review, or `cancel` to a terminal state — across all tasks. The join to
   * `tasks` stays to exclude soft-deleted ones so a cancelled-then-deleted task
   * does not double-count.
   *
   * @param action - The workflow action to match (e.g. `request_changes`)
   * @returns Matching transitions with their task id, oldest first
   */
  findByAction(action: string): TransitionWithKey[] {
    const rows = this.adapter
      .getDatabase()
      .prepare(
        `SELECT t.*
           FROM transitions t
           JOIN tasks k ON k.id = t.task_id
          WHERE t.action = ?
            AND k.deleted_at IS NULL
          ORDER BY t.at`,
      )
      .all(action) as TransitionRow[];
    return rows.map((row) => ({ ...rowToTransition(row), taskKey: row.task_id }));
  }

  /**
   * Returns a transition by its internal id, or `null` if absent.
   *
   * @param id - Internal UUID of the transition
   * @returns The transition or `null`
   */
  findById(id: string): Transition | null {
    const row = this.adapter
      .getDatabase()
      .prepare('SELECT * FROM transitions WHERE id = ?')
      .get(id) as TransitionRow | undefined;
    return row === undefined ? null : rowToTransition(row);
  }
}

function rowToTransition(row: TransitionRow): Transition {
  return {
    id: row.id,
    taskId: row.task_id,
    fromState: row.from_state,
    toState: row.to_state,
    action: row.action,
    payload: JSON.parse(row.payload) as Record<string, unknown>,
    actorId: row.actor_id,
    viaActorId: row.via_actor_id,
    agentRunId: row.agent_run_id,
    at: row.at,
  };
}
