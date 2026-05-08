import type { Transition } from '../../../domain/entities/transition.js';
import { generateUuid } from '../../../domain/id-generator.js';
import { isoNow } from '../../../utils/iso-now.js';
import type { SqliteAdapter } from '../sqlite-adapter.js';

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
   * Lists transitions caused by an agent run, in chronological order.
   *
   * @param runId - Agent run identifier
   * @returns Array of transitions emitted while the run was active
   */
  findByRun(runId: string): Transition[] {
    const rows = this.adapter
      .getDatabase()
      .prepare(`SELECT * FROM transitions WHERE agent_run_id = ? ORDER BY at`)
      .all(runId) as TransitionRow[];
    return rows.map(rowToTransition);
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
