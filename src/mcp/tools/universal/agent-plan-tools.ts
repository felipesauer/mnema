import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { AgentPlanState } from '../../../domain/enums/agent-plan-state.js';
import type { AgentPlanService } from '../../../services/agent-plan-service.js';
import type { McpSessionContext } from '../../mcp-session-context.js';
import {
  err,
  ok,
  type PendingMigrationsSource,
  requireActiveRun,
  requireFreshSchema,
} from '../../mcp-tool-result.js';

const planStateValues = Object.values(AgentPlanState) as [AgentPlanState, ...AgentPlanState[]];

/**
 * Registers the agent-plan tool family on the MCP server.
 *
 * - `agent_plan_create`        — creates a plan attached to the active run
 * - `agent_plan_update_state`  — updates a plan's state (with optional result)
 * - `agent_plans_list`         — lists plans of the active run
 *
 * Plans are intra-run scratch state — they auto-archive when the run
 * ends. Mutations require an active run, the read tool does not.
 */
export class AgentPlanTools {
  constructor(
    private readonly plans: AgentPlanService,
    private readonly session: McpSessionContext,
    private readonly pendingMigrations: PendingMigrationsSource,
  ) {}

  /**
   * Attaches every plan tool to the server.
   *
   * @param server - MCP server instance to register against
   */
  register(server: McpServer): void {
    server.registerTool(
      'agent_plan_create',
      {
        description:
          'Create a plan step inside the active agent run. Plans are auto-archived when the run ends. ' +
          'Pass `task_key` when the plan implements a specific task — the linkage shows up in `agent inspect` ' +
          'so audit reconstruction can pair plans with their task transitions.',
        inputSchema: {
          content: z.string().min(1).describe('Description of the step'),
          task_key: z
            .string()
            .optional()
            .describe(
              'Optional task key (e.g. WEBAPP-42) this plan implements. ' +
                'Server resolves to a task FK; unknown keys return TASK_NOT_FOUND.',
            ),
          parent_plan_id: z
            .string()
            .uuid()
            .optional()
            .describe('Parent plan id for nested steps (max depth 5)'),
          position: z.number().int().nonnegative().optional(),
        },
      },
      ({ content, task_key: taskKey, parent_plan_id: parentPlanId, position }) => {
        const drift = requireFreshSchema(this.pendingMigrations);
        if (drift !== null) return drift;
        const runId = this.session.getCurrentRunId();
        const guard = requireActiveRun(runId);
        if (guard !== null) return guard;

        const result = this.plans.create({
          runId: runId as string,
          content,
          taskKey,
          parentPlanId,
          position,
        });
        if (!result.ok) return err(result.error);
        return ok({ plan: result.value });
      },
    );

    server.registerTool(
      'agent_plan_update_state',
      {
        description:
          'Update the state of a plan step. Identify the plan either by `plan_id` (UUID) or by ' +
          'the pair `(run_id, position)` — handy when the agent declared a linear plan upfront ' +
          'and addresses steps by position rather than tracking UUIDs.',
        inputSchema: {
          plan_id: z
            .string()
            .optional()
            .describe('Plan UUID. Mutually exclusive with run_id+position.'),
          run_id: z
            .string()
            .optional()
            .describe('Run id (defaults to active run when omitted alongside position).'),
          position: z
            .number()
            .int()
            .nonnegative()
            .optional()
            .describe('Plan position within the run. Use with run_id (or active run).'),
          state: z.enum(planStateValues),
          result: z.string().optional().describe('Free-form outcome text'),
        },
      },
      ({ plan_id: planId, run_id: runId, position, state, result: resultText }) => {
        const drift = requireFreshSchema(this.pendingMigrations);
        if (drift !== null) return drift;
        const guard = requireActiveRun(this.session.getCurrentRunId());
        if (guard !== null) return guard;

        if (planId === undefined && position === undefined) {
          return err({
            kind: 'AGENT_PLAN_NOT_FOUND' as never,
            planId: '(none provided — pass plan_id or position)',
          });
        }

        const effectiveRunId = runId ?? this.session.getCurrentRunId() ?? undefined;

        const updated = this.plans.updateState({
          planId,
          runId: effectiveRunId,
          position,
          state,
          result: resultText ?? null,
        });
        if (!updated.ok) return err(updated.error);
        return ok({ plan: updated.value });
      },
    );

    server.registerTool(
      'agent_plans_list',
      {
        description: 'List plans for a run, optionally restricted to active (non-archived) ones.',
        inputSchema: {
          run_id: z.string().describe('Run identifier').optional(),
          active_only: z.boolean().optional(),
        },
      },
      ({ run_id: runId, active_only: activeOnly }) => {
        const target = runId ?? this.session.getCurrentRunId();
        if (target === null) {
          return ok({ plans: [] });
        }
        const plans = this.plans.list(target, { activeOnly: activeOnly === true });
        return ok({ plans });
      },
    );
  }
}
