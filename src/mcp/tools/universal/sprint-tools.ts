import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { Config } from '../../../config/config-schema.js';
import type { IdentityService } from '../../../services/identity-service.js';
import type { SprintService } from '../../../services/sprint-service.js';
import type { McpSessionContext } from '../../mcp-session-context.js';
import { err, ok, requireActiveRun, requireFreshSchema } from '../../mcp-tool-result.js';

/**
 * Registers the read-mostly sprint MCP tools — `sprint_show`,
 * `sprints_list`, `sprint_add_task`. Sprint creation, start and close
 * are intentionally CLI-only: choosing dates and capacity is human work,
 * not something an agent should do mid-run.
 */
export class SprintTools {
  constructor(
    private readonly sprints: SprintService,
    private readonly identity: IdentityService,
    private readonly config: Config,
    private readonly session: McpSessionContext,
    private readonly pendingMigrations: readonly string[],
  ) {}

  /**
   * Attaches the sprint tools to the server.
   *
   * @param server - MCP server instance to register against
   */
  register(server: McpServer): void {
    server.registerTool(
      'sprint_show',
      {
        description: 'Return a sprint together with its current task list.',
        inputSchema: {
          sprint_key: z.string().describe('Sprint key, e.g. WEBAPP-SPRINT-3'),
        },
      },
      ({ sprint_key: sprintKey }) => {
        // Read-only: drift-tolerant by policy (see requireFreshSchema docstring).
        const view = this.sprints.show(sprintKey);
        if (view === null) {
          return ok({ sprint: null, tasks: [], metrics: [] });
        }
        return ok({ sprint: view.sprint, tasks: view.tasks, metrics: view.metrics });
      },
    );

    server.registerTool(
      'sprints_list',
      {
        description: 'List every sprint of the current project, ordered by creation.',
        inputSchema: {},
      },
      () => {
        const sprints = this.sprints.list(this.config.project.key);
        return ok({ sprints });
      },
    );

    server.registerTool(
      'sprint_add_task',
      {
        description: 'Attach an existing task to a sprint. Requires an active agent run.',
        inputSchema: {
          sprint_key: z.string(),
          task_key: z.string(),
        },
      },
      ({ sprint_key: sprintKey, task_key: taskKey }) => {
        // Mutation: block on schema drift, consistent with every other write.
        const drift = requireFreshSchema(this.pendingMigrations);
        if (drift !== null) return drift;
        const runId = this.session.getCurrentRunId();
        const guard = requireActiveRun(runId);
        if (guard !== null) return guard;

        const handle = this.session.getClientMetadata().agent_handle;
        const result = this.sprints.addTask({
          sprintKey,
          taskKey,
          actor: this.identity.getDefaultActor(),
          via: handle !== undefined && handle.length > 0 ? `agent:${handle}` : undefined,
          runId: runId ?? undefined,
        });
        if (!result.ok) return err(result.error);
        return ok({ task: result.value });
      },
    );

    server.registerTool(
      'sprint_create',
      {
        description: 'Plan a new sprint in PLANNED state. Requires an active agent run.',
        inputSchema: {
          name: z.string().min(1),
          goal: z.string().optional(),
          starts_at: z.string().optional().describe('ISO-8601 start date'),
          ends_at: z.string().optional().describe('ISO-8601 end date'),
          capacity: z.number().int().positive().optional().describe('Capacity in story points'),
        },
      },
      (input) => {
        const drift = requireFreshSchema(this.pendingMigrations);
        if (drift !== null) return drift;
        const runId = this.session.getCurrentRunId();
        const guard = requireActiveRun(runId);
        if (guard !== null) return guard;

        const handle = this.session.getClientMetadata().agent_handle;
        const result = this.sprints.plan({
          projectKey: this.config.project.key,
          name: input.name,
          goal: input.goal,
          startsAt: input.starts_at,
          endsAt: input.ends_at,
          capacity: input.capacity,
          actor: this.identity.getDefaultActor(),
          via: handle !== undefined && handle.length > 0 ? `agent:${handle}` : undefined,
          runId: runId ?? undefined,
        });
        if (!result.ok) return err(result.error);
        return ok({ sprint: result.value });
      },
    );

    server.registerTool(
      'sprint_add_tasks',
      {
        description:
          'Attach several existing tasks to a sprint in one call (best-effort): ' +
          'each is attempted and the result lists what was added and what failed, ' +
          'with its input index. Requires an active agent run.',
        inputSchema: {
          sprint_key: z.string(),
          task_keys: z.array(z.string()).min(1).max(200).describe('Task keys to attach, in order'),
        },
      },
      (input) => {
        const drift = requireFreshSchema(this.pendingMigrations);
        if (drift !== null) return drift;
        const runId = this.session.getCurrentRunId();
        const guard = requireActiveRun(runId);
        if (guard !== null) return guard;

        const handle = this.session.getClientMetadata().agent_handle;
        const via = handle !== undefined && handle.length > 0 ? `agent:${handle}` : undefined;

        const added: unknown[] = [];
        const failed: { index: number; task_key: string; error: unknown }[] = [];
        input.task_keys.forEach((taskKey, index) => {
          const result = this.sprints.addTask({
            sprintKey: input.sprint_key,
            taskKey,
            actor: this.identity.getDefaultActor(),
            via,
            runId: runId ?? undefined,
          });
          if (result.ok) added.push(result.value);
          else failed.push({ index, task_key: taskKey, error: result.error });
        });

        return ok({ added, failed, added_count: added.length, failed_count: failed.length });
      },
    );
  }
}
