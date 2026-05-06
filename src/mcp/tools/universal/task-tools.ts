import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { Config } from '../../../config/config-schema.js';
import { TaskState } from '../../../domain/enums/task-state.js';
import type { IdentityService } from '../../../services/identity-service.js';
import type { TaskService } from '../../../services/task-service.js';
import type { McpSessionContext } from '../../mcp-session-context.js';
import { err, ok, requireActiveRun } from '../../mcp-tool-result.js';

const taskStateValues = Object.values(TaskState) as [TaskState, ...TaskState[]];

/**
 * Registers task-related MCP tools that **don't** depend on the active
 * workflow shape:
 *
 * - `task_create`  — creates a task in the workflow's initial state
 * - `tasks_list`   — read-only listing, optional state filter
 * - `task_show`    — read-only single-task lookup
 *
 * State transitions are exposed as separate tools generated from the
 * workflow definition; see {@link TransitionToolsRegistrar}.
 */
export class TaskTools {
  constructor(
    private readonly tasks: TaskService,
    private readonly identity: IdentityService,
    private readonly config: Config,
    private readonly session: McpSessionContext,
  ) {}

  /**
   * Attaches every task tool to the server.
   *
   * @param server - MCP server instance to register against
   */
  register(server: McpServer): void {
    server.registerTool(
      'task_create',
      {
        description:
          'Create a new task in the workflow initial state. Requires an active agent run.',
        inputSchema: {
          title: z.string().min(3).max(200),
          description: z.string().optional(),
          acceptance_criteria: z.array(z.string().min(1)).optional(),
          estimate: z.number().optional(),
          priority: z.number().int().min(1).max(5).optional(),
          assignee: z.string().optional(),
        },
      },
      (input) => {
        const runId = this.session.getCurrentRunId();
        const guard = requireActiveRun(runId);
        if (guard !== null) return guard;

        const handle = this.session.getClientMetadata().agent_handle;
        const result = this.tasks.create({
          projectKey: this.config.project.key,
          title: input.title,
          description: input.description,
          acceptanceCriteria: input.acceptance_criteria ?? [],
          estimate: input.estimate ?? null,
          priority: input.priority ?? 3,
          assigneeId: input.assignee ?? null,
          actor: this.identity.getDefaultActor(),
          via: handle !== undefined && handle.length > 0 ? `agent:${handle}` : undefined,
          runId: runId ?? undefined,
        });
        if (!result.ok) return err(result.error);
        return ok({ task: result.value });
      },
    );

    server.registerTool(
      'tasks_list',
      {
        description: 'List tasks, optionally filtered by state.',
        inputSchema: {
          state: z.enum(taskStateValues).optional(),
        },
      },
      ({ state }) => {
        const tasks = this.tasks.list(state !== undefined ? { state } : {});
        return ok({ tasks });
      },
    );

    server.registerTool(
      'task_show',
      {
        description: 'Return a single task by its human-readable key.',
        inputSchema: {
          task_key: z.string().describe('Task key, e.g. WEBAPP-42'),
        },
      },
      ({ task_key: taskKey }) => {
        const result = this.tasks.findByKey(taskKey);
        if (!result.ok) return err(result.error);
        return ok({ task: result.value });
      },
    );
  }
}
