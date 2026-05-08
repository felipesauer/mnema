import type { AgentRun } from '../../../domain/entities/agent-run.js';
import { AgentRunStatus } from '../../../domain/enums/agent-run-status.js';
import { generateUuid } from '../../../domain/id-generator.js';
import { isoNow } from '../../../utils/iso-now.js';
import type { SqliteAdapter } from '../sqlite-adapter.js';

interface AgentRunRow {
  readonly id: string;
  readonly agent_actor_id: string;
  readonly parent_run_id: string | null;
  readonly invoked_by: string;
  readonly goal: string;
  readonly skills_loaded: string;
  readonly status: string;
  readonly result: string | null;
  readonly error: string | null;
  readonly metadata: string;
  readonly client_metadata: string;
  readonly started_at: string;
  readonly ended_at: string | null;
  readonly depth: number;
}

/**
 * Input for {@link AgentRunRepository.insert}.
 */
export interface AgentRunInsertInput {
  readonly agentActorId: string;
  readonly invokedBy: string;
  readonly goal: string;
  readonly parentRunId?: string | null;
  readonly skillsLoaded?: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly clientMetadata?: Readonly<Record<string, unknown>>;
  readonly depth?: number;
}

/**
 * Persistence for {@link AgentRun}. Read/write only — no business rules.
 */
export class AgentRunRepository {
  constructor(private readonly adapter: SqliteAdapter) {}

  /**
   * Returns the agent run with the given id, or `null` if missing.
   *
   * @param id - Internal UUID of the run
   * @returns The run or `null`
   */
  findById(id: string): AgentRun | null {
    const row = this.adapter
      .getDatabase()
      .prepare('SELECT * FROM agent_runs WHERE id = ?')
      .get(id) as AgentRunRow | undefined;
    return row === undefined ? null : rowToAgentRun(row);
  }

  /**
   * Inserts a new agent run in `running` status.
   *
   * @param input - Fields required to start the run
   * @returns The newly created run
   */
  insert(input: AgentRunInsertInput): AgentRun {
    const id = generateUuid();
    const skills = JSON.stringify(input.skillsLoaded ?? []);
    const metadata = JSON.stringify(input.metadata ?? {});
    const clientMetadata = JSON.stringify(input.clientMetadata ?? {});

    this.adapter
      .getDatabase()
      .prepare(
        `INSERT INTO agent_runs (
           id, agent_actor_id, parent_run_id, invoked_by,
           goal, skills_loaded, status, metadata, client_metadata, depth, started_at
         ) VALUES (?, ?, ?, ?, ?, ?, 'running', ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.agentActorId,
        input.parentRunId ?? null,
        input.invokedBy,
        input.goal,
        skills,
        metadata,
        clientMetadata,
        input.depth ?? 0,
        isoNow(),
      );

    const created = this.findById(id);
    if (created === null) {
      throw new Error('agent_run insert succeeded but row not found');
    }
    return created;
  }

  /**
   * Marks the run as ended with a terminal status and optional result.
   * The `trg_archive_plans_on_run_end` trigger will archive any plans
   * still attached to the run.
   *
   * @param runId - Run identifier
   * @param status - Terminal status
   * @param result - Optional textual outcome
   * @returns The updated run, or `null` if the id is unknown
   */
  end(
    runId: string,
    status: AgentRunStatus,
    result: string | null = null,
    errorMessage: string | null = null,
  ): AgentRun | null {
    if (
      status !== AgentRunStatus.Completed &&
      status !== AgentRunStatus.Failed &&
      status !== AgentRunStatus.Aborted
    ) {
      throw new Error(`agent_run end called with non-terminal status: ${status}`);
    }
    this.adapter
      .getDatabase()
      .prepare(
        `UPDATE agent_runs
            SET status = ?, result = ?, error = ?,
                ended_at = ?
          WHERE id = ?`,
      )
      .run(status, result, errorMessage, isoNow(), runId);
    return this.findById(runId);
  }
}

function rowToAgentRun(row: AgentRunRow): AgentRun {
  return {
    id: row.id,
    agentActorId: row.agent_actor_id,
    parentRunId: row.parent_run_id,
    invokedBy: row.invoked_by,
    goal: row.goal,
    skillsLoaded: JSON.parse(row.skills_loaded) as string[],
    status: row.status as AgentRunStatus,
    result: row.result,
    error: row.error,
    metadata: JSON.parse(row.metadata) as Record<string, unknown>,
    clientMetadata: JSON.parse(row.client_metadata) as Record<string, unknown>,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    depth: row.depth,
  };
}
