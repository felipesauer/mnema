import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { Config } from '../../../config/config-schema.js';
import type { StateMachine } from '../../../domain/state-machine/state-machine.js';
import type { IdentityService } from '../../../services/identity-service.js';
import type { TaskService } from '../../../services/task-service.js';
import type { McpSessionContext } from '../../mcp-session-context.js';
import { err, ok, requireActiveRun } from '../../mcp-tool-result.js';

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
    private readonly stateMachine: StateMachine,
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
          context_budget: z
            .number()
            .int()
            .min(0)
            .optional()
            .describe('Estimated context cost in tokens (distinct from estimate / story points)'),
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
          contextBudget: input.context_budget ?? null,
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

    // Derive the state enum from the *active* workflow so projects on
    // lean/kanban/jira-classic get the correct autocomplete values
    // (and tight validation) instead of the default workflow's literals.
    const workflowStates = this.stateMachine.getWorkflow().states;
    const stateSchema =
      workflowStates.length > 0
        ? z
            .enum(workflowStates as [string, ...string[]])
            .optional()
            .describe(
              `Filter by task state. Valid values for this workflow: ${workflowStates.join(', ')}`,
            )
        : z.string().min(1).optional();

    server.registerTool(
      'tasks_list',
      {
        description: 'List tasks with optional filters (state, assignee handle/UUID) and ordering.',
        inputSchema: {
          state: stateSchema,
          assignee_id: z
            .string()
            .min(1)
            .optional()
            .describe('Filter by assignee — accepts a handle (e.g. `maria`) or a UUID'),
          sort: z
            .enum(['key', 'updated_at', 'created_at', 'priority'])
            .optional()
            .describe('Order results by the given field. Default: key (alphanumeric)'),
          limit: z
            .number()
            .int()
            .positive()
            .optional()
            .describe('Maximum number of tasks to return'),
        },
      },
      ({ state, assignee_id: assigneeId, sort, limit }) => {
        let tasks = this.tasks.list(state !== undefined ? { state } : {});

        if (assigneeId !== undefined) {
          // Resolve handle → actor id when needed; the handle path covers
          // the common case (`maria`) without forcing the agent to know
          // the UUID. Unknown handles produce zero matches (intentional —
          // typos shouldn't return everything).
          const resolvedId = isUuid(assigneeId)
            ? assigneeId
            : this.identity.findActorIdByHandle(assigneeId);
          tasks = tasks.filter((t) => t.assigneeId === resolvedId);
        }

        if (sort !== undefined) {
          tasks = [...tasks].sort((a, b) => compareBy(a, b, sort));
        }

        if (limit !== undefined) {
          tasks = tasks.slice(0, limit);
        }

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

    server.registerTool(
      'task_actions',
      {
        description:
          'List the workflow actions currently available on a task. ' +
          'Returns one entry per action with its destination state and the ' +
          'fields the gate requires. Use this before mutating to confirm an ' +
          'action exists from the task’s current state — saves a round-trip ' +
          'when the agent is uncertain.',
        inputSchema: {
          task_key: z.string().describe('Task key, e.g. WEBAPP-42'),
        },
      },
      ({ task_key: taskKey }) => {
        const result = this.tasks.findByKey(taskKey);
        if (!result.ok) return err(result.error);
        const task = result.value;
        const workflow = this.stateMachine.getWorkflow();
        const fromState = task.state;
        const transitions = workflow.transitions[fromState] ?? {};
        const actions = Object.entries(transitions).map(([action, transition]) => ({
          action,
          to: transition.to,
          description: transition.description,
          use_when: transition.useWhen,
          required_fields: Object.keys(transition.requires.shape),
        }));
        return ok({
          task_key: task.key,
          state: fromState,
          actions,
        });
      },
    );
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

type SortKey = 'key' | 'updated_at' | 'created_at' | 'priority';

interface SortableTask {
  readonly key: string;
  readonly updatedAt: string;
  readonly createdAt: string;
  readonly priority: number;
}

function compareBy(a: SortableTask, b: SortableTask, key: SortKey): number {
  switch (key) {
    case 'key':
      return naturalCompareKey(a.key, b.key);
    case 'updated_at':
      return b.updatedAt.localeCompare(a.updatedAt); // newest first
    case 'created_at':
      return b.createdAt.localeCompare(a.createdAt); // newest first
    case 'priority':
      return a.priority - b.priority; // 1 (highest) first
  }
}

/**
 * Sorts task keys numerically when they share a prefix
 * (e.g. `MNEMA-2` before `MNEMA-10`). Falls back to lexical compare
 * for keys with different prefixes.
 */
function naturalCompareKey(a: string, b: string): number {
  const matchA = a.match(/^([A-Z]+)-(\d+)$/);
  const matchB = b.match(/^([A-Z]+)-(\d+)$/);
  if (matchA !== null && matchB !== null && matchA[1] === matchB[1]) {
    return Number(matchA[2]) - Number(matchB[2]);
  }
  return a.localeCompare(b);
}
