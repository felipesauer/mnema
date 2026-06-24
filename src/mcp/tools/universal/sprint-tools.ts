import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { Config } from '../../../config/config-schema.js';
import type { IdentityService } from '../../../services/identity-service.js';
import type { SprintService } from '../../../services/sprint-service.js';
import type { McpSessionContext } from '../../mcp-session-context.js';
import { err, ok, requireActiveRun } from '../../mcp-tool-result.js';

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
  }
}
