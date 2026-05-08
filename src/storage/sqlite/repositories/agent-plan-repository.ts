import type { AgentPlan } from '../../../domain/entities/agent-plan.js';
import { AgentPlanState } from '../../../domain/enums/agent-plan-state.js';
import { generateUuid } from '../../../domain/id-generator.js';
import { isoNow } from '../../../utils/iso-now.js';
import type { SqliteAdapter } from '../sqlite-adapter.js';

interface AgentPlanRow {
  readonly id: string;
  readonly agent_run_id: string;
  readonly parent_plan_id: string | null;
  readonly content: string;
  readonly state: string;
  readonly result: string | null;
  readonly position: number;
  readonly depth: number;
  readonly metadata: string;
  readonly started_at: string | null;
  readonly completed_at: string | null;
  readonly archived_at: string | null;
  readonly created_at: string;
}

/**
 * Input for {@link AgentPlanRepository.insert}.
 */
export interface AgentPlanInsertInput {
  readonly agentRunId: string;
  readonly content: string;
  readonly parentPlanId?: string | null;
  readonly position?: number;
  readonly depth?: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Persistence for {@link AgentPlan}. Read/write only.
 */
export class AgentPlanRepository {
  constructor(private readonly adapter: SqliteAdapter) {}

  /**
   * Returns a plan by its internal id, or `null` if missing.
   *
   * @param id - Internal UUID of the plan
   * @returns The plan or `null`
   */
  findById(id: string): AgentPlan | null {
    const row = this.adapter
      .getDatabase()
      .prepare('SELECT * FROM agent_plans WHERE id = ?')
      .get(id) as AgentPlanRow | undefined;
    return row === undefined ? null : rowToPlan(row);
  }

  /**
   * Lists plans belonging to a given run, optionally filtered to active
   * (non-archived) ones, ordered by `position` then `created_at`.
   *
   * @param runId - Run id to filter by
   * @param options - When `activeOnly` is true, archived plans are skipped
   * @returns Array of matching plans
   */
  findByRun(runId: string, options: { activeOnly?: boolean } = {}): AgentPlan[] {
    const sql =
      options.activeOnly === true
        ? `SELECT * FROM agent_plans
          WHERE agent_run_id = ? AND archived_at IS NULL
          ORDER BY position, created_at`
        : `SELECT * FROM agent_plans
          WHERE agent_run_id = ?
          ORDER BY position, created_at`;
    const rows = this.adapter.getDatabase().prepare(sql).all(runId) as AgentPlanRow[];
    return rows.map(rowToPlan);
  }

  /**
   * Inserts a new plan in `pending` state.
   *
   * @param input - Fields required to create the plan
   * @returns The newly created plan
   */
  insert(input: AgentPlanInsertInput): AgentPlan {
    const id = generateUuid();
    const metadata = JSON.stringify(input.metadata ?? {});

    this.adapter
      .getDatabase()
      .prepare(
        `INSERT INTO agent_plans (
           id, agent_run_id, parent_plan_id, content,
           state, position, depth, metadata, created_at
         ) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.agentRunId,
        input.parentPlanId ?? null,
        input.content,
        input.position ?? 0,
        input.depth ?? 0,
        metadata,
        isoNow(),
      );

    const created = this.findById(id);
    if (created === null) {
      throw new Error('agent_plan insert succeeded but row not found');
    }
    return created;
  }

  /**
   * Updates the state of a plan, stamping `started_at` / `completed_at`
   * timestamps as appropriate for the lifecycle.
   *
   * @param planId - Plan identifier
   * @param state - New state
   * @param result - Optional outcome text
   * @returns The updated plan, or `null` if the id is unknown
   */
  updateState(
    planId: string,
    state: AgentPlanState,
    result: string | null = null,
  ): AgentPlan | null {
    const db = this.adapter.getDatabase();

    if (state === AgentPlanState.InProgress) {
      db.prepare(
        `UPDATE agent_plans
            SET state = ?, started_at = COALESCE(started_at, ?)
          WHERE id = ?`,
      ).run(state, isoNow(), planId);
    } else if (
      state === AgentPlanState.Completed ||
      state === AgentPlanState.Failed ||
      state === AgentPlanState.Skipped
    ) {
      db.prepare(
        `UPDATE agent_plans
            SET state = ?, result = ?,
                completed_at = ?
          WHERE id = ?`,
      ).run(state, result, isoNow(), planId);
    } else {
      db.prepare(`UPDATE agent_plans SET state = ?, result = ? WHERE id = ?`).run(
        state,
        result,
        planId,
      );
    }

    return this.findById(planId);
  }
}

function rowToPlan(row: AgentPlanRow): AgentPlan {
  return {
    id: row.id,
    agentRunId: row.agent_run_id,
    parentPlanId: row.parent_plan_id,
    content: row.content,
    state: row.state as AgentPlanState,
    result: row.result,
    position: row.position,
    depth: row.depth,
    metadata: JSON.parse(row.metadata) as Record<string, unknown>,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
  };
}
