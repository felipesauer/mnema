import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { AgentPlanState } from '../../../domain/enums/agent-plan-state.js';
import type { AgentPlanService } from '../../../services/agent-plan-service.js';
import type { McpSessionContext } from '../../mcp-session-context.js';
import { err, ok, requireActiveRun } from '../../mcp-tool-result.js';

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
          'Create a plan step inside the active agent run. Plans are auto-archived when the run ends.',
        inputSchema: {
          content: z.string().min(1).describe('Description of the step'),
          parent_plan_id: z
            .string()
            .uuid()
            .optional()
            .describe('Parent plan id for nested steps (max depth 5)'),
          position: z.number().int().nonnegative().optional(),
        },
      },
      ({ content, parent_plan_id: parentPlanId, position }) => {
        const runId = this.session.getCurrentRunId();
        const guard = requireActiveRun(runId);
        if (guard !== null) return guard;

        const result = this.plans.create({
          runId: runId as string,
          content,
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
        description: 'Update the state of a plan step.',
        inputSchema: {
          plan_id: z.string().describe('Plan identifier'),
          state: z.enum(planStateValues),
          result: z.string().optional().describe('Free-form outcome text'),
        },
      },
      ({ plan_id: planId, state, result: resultText }) => {
        const guard = requireActiveRun(this.session.getCurrentRunId());
        if (guard !== null) return guard;

        const updated = this.plans.updateState({
          planId,
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
