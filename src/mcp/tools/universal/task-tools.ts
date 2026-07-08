import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { Config } from '../../../config/config-schema.js';
import type { StateMachine } from '../../../domain/state-machine/state-machine.js';
import type { IdentityService } from '../../../services/identity-service.js';
import type { LabelService } from '../../../services/label-service.js';
import type { TaskService } from '../../../services/task-service.js';
import type { McpSessionContext } from '../../mcp-session-context.js';
import {
  err,
  ok,
  okTask,
  type PendingMigrationsSource,
  requireActiveRun,
  requireFreshSchema,
  toCompactTask,
} from '../../mcp-tool-result.js';

/**
 * One task's fields for `task_create_many`. Mirrors the `task_create`
 * single-item schema so a batch validates each entry the same way.
 */
const taskItemSchema = z.object({
  title: z.string().min(3).max(200),
  description: z.string().optional(),
  acceptance_criteria: z.array(z.string().min(1)).optional(),
  estimate: z.number().int().min(0).optional(),
  context_budget: z.number().int().min(0).optional(),
  priority: z.number().int().min(1).max(5).optional(),
  assignee: z.string().optional(),
  labels: z.array(z.string().min(1)).optional(),
});

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
    private readonly pendingMigrations: PendingMigrationsSource,
    private readonly labels: LabelService,
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
          description: z
            .string()
            .optional()
            .describe(
              'Free-form at creation (a draft may be terse); the workflow gate ' +
                'enforces any minimum length when the task is submitted for readiness',
            ),
          acceptance_criteria: z.array(z.string().min(1)).optional(),
          estimate: z
            .number()
            .int()
            .min(0)
            .optional()
            .describe('Estimate in story points (non-negative integer)'),
          context_budget: z
            .number()
            .int()
            .min(0)
            .optional()
            .describe('Estimated context cost in tokens (distinct from estimate / story points)'),
          priority: z.number().int().min(1).max(5).optional(),
          assignee: z
            .string()
            .optional()
            .describe('Assignee — a known actor handle (e.g. `maria`) or a UUID'),
          labels: z
            .array(z.string().min(1))
            .optional()
            .describe('Transversal labels, e.g. ["area:api", "tipo:bug"]'),
          verbosity: z
            .enum(['full', 'compact'])
            .optional()
            .describe(
              "Echo mode for the created task. 'full' (default) returns the whole entity; " +
                "'compact' returns only { key, state, updatedAt } to save context in batches.",
            ),
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
          via,
          runId: runId ?? undefined,
        });
        if (!result.ok) return err(result.error);

        if (input.labels !== undefined && input.labels.length > 0) {
          const labelled = this.labels.setLabels({
            taskKey: result.value.key,
            labels: input.labels,
            actor: this.identity.getDefaultActor(),
            via,
            runId: runId ?? undefined,
          });
          if (!labelled.ok) return err(labelled.error);
        }
        return okTask(result.value, input.verbosity);
      },
    );

    server.registerTool(
      'task_assign',
      {
        description:
          'Assign a task to an actor (or clear its assignee). Resolves a ' +
          'handle to the actor; an unknown handle returns UNKNOWN_ASSIGNEE. ' +
          'Requires an active agent run.',
        inputSchema: {
          task_key: z.string().describe('Task key, e.g. WEBAPP-42'),
          assignee: z
            .string()
            .nullable()
            .describe('Actor handle (e.g. `maria`) or UUID; pass null to clear the assignee'),
        },
      },
      (input) => {
        const drift = requireFreshSchema(this.pendingMigrations);
        if (drift !== null) return drift;
        const runId = this.session.getCurrentRunId();
        const guard = requireActiveRun(runId);
        if (guard !== null) return guard;

        const handle = this.session.getClientMetadata().agent_handle;
        const result = this.tasks.assign({
          taskKey: input.task_key,
          assignee: input.assignee,
          actor: this.identity.getDefaultActor(),
          via: handle !== undefined && handle.length > 0 ? `agent:${handle}` : undefined,
          runId: runId ?? undefined,
        });
        if (!result.ok) return err(result.error);
        return ok({ task: result.value });
      },
    );

    server.registerTool(
      'task_claim',
      {
        description:
          'Reserve a task for the calling actor with a lease that expires ' +
          'on its own — use before starting work on a task two sessions ' +
          'might both pick up, so the second one sees TASK_ALREADY_CLAIMED ' +
          'instead of racing to task_start. Fails if another actor already ' +
          'holds a live claim; re-claiming your own live claim extends it. ' +
          'Requires an active agent run.',
        inputSchema: {
          task_key: z.string().describe('Task key, e.g. WEBAPP-42'),
          lease_minutes: z
            .number()
            .int()
            .positive()
            .optional()
            .describe(
              `How long the claim lasts before it self-expires. Default: config claims.lease_minutes (${this.config.claims.lease_minutes}).`,
            ),
        },
      },
      (input) => {
        const drift = requireFreshSchema(this.pendingMigrations);
        if (drift !== null) return drift;
        const runId = this.session.getCurrentRunId();
        const guard = requireActiveRun(runId);
        if (guard !== null) return guard;

        const handle = this.session.getClientMetadata().agent_handle;
        const result = this.tasks.claim({
          taskKey: input.task_key,
          actor: this.identity.getDefaultActor(),
          via: handle !== undefined && handle.length > 0 ? `agent:${handle}` : undefined,
          runId: runId ?? undefined,
          leaseMinutes: input.lease_minutes ?? this.config.claims.lease_minutes,
        });
        if (!result.ok) return err(result.error);
        return ok({ task: result.value });
      },
    );

    server.registerTool(
      'task_release_claim',
      {
        description:
          'Release the calling actor’s claim on a task. A no-op (not an ' +
          'error) if the task is unclaimed or held by someone else — safe ' +
          'to call defensively when finishing or aborting work. Requires ' +
          'an active agent run.',
        inputSchema: {
          task_key: z.string().describe('Task key, e.g. WEBAPP-42'),
        },
      },
      (input) => {
        const drift = requireFreshSchema(this.pendingMigrations);
        if (drift !== null) return drift;
        const runId = this.session.getCurrentRunId();
        const guard = requireActiveRun(runId);
        if (guard !== null) return guard;

        const handle = this.session.getClientMetadata().agent_handle;
        const result = this.tasks.releaseClaim({
          taskKey: input.task_key,
          actor: this.identity.getDefaultActor(),
          via: handle !== undefined && handle.length > 0 ? `agent:${handle}` : undefined,
          runId: runId ?? undefined,
        });
        if (!result.ok) return err(result.error);
        return ok({ task: result.value });
      },
    );

    server.registerTool(
      'task_create_many',
      {
        description:
          'Create several tasks in one call (best-effort): every task is ' +
          'attempted, and the result lists what was created and what failed, ' +
          'each with its input index. Cuts the round-trips when an agent ' +
          'bootstraps a backlog. Requires an active agent run.',
        inputSchema: {
          tasks: z.array(taskItemSchema).min(1).max(200).describe('Tasks to create, in order'),
          verbosity: z
            .enum(['full', 'compact'])
            .optional()
            .describe(
              "Echo mode for each created task. 'full' (default) returns whole entities; " +
                "'compact' returns only { key, state, updatedAt } each — recommended for large " +
                'batches to avoid inflating context with repeated descriptions.',
            ),
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

        const created: unknown[] = [];
        const failed: { index: number; error: unknown }[] = [];
        input.tasks.forEach((item, index) => {
          const result = this.tasks.create({
            projectKey: this.config.project.key,
            title: item.title,
            description: item.description,
            acceptanceCriteria: item.acceptance_criteria ?? [],
            estimate: item.estimate ?? null,
            contextBudget: item.context_budget ?? null,
            priority: item.priority ?? 3,
            assigneeId: item.assignee ?? null,
            actor: this.identity.getDefaultActor(),
            via,
            runId: runId ?? undefined,
          });
          if (!result.ok) {
            failed.push({ index, error: result.error });
            return;
          }
          if (item.labels !== undefined && item.labels.length > 0) {
            const labelled = this.labels.setLabels({
              taskKey: result.value.key,
              labels: item.labels,
              actor: this.identity.getDefaultActor(),
              via,
              runId: runId ?? undefined,
            });
            // The task itself was created; a bad label name is surfaced as
            // this item's failure so the agent can fix and retry, rather
            // than silently dropping the labels it asked for.
            if (!labelled.ok) {
              failed.push({ index, error: labelled.error });
              return;
            }
          }
          created.push(input.verbosity === 'compact' ? toCompactTask(result.value) : result.value);
        });

        return ok({ created, failed, created_count: created.length, failed_count: failed.length });
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
