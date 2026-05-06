import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { AgentRunStatus } from '../../../domain/enums/agent-run-status.js';
import { ErrorCode } from '../../../errors/error-codes.js';
import type { AgentRunService } from '../../../services/agent-run-service.js';
import type { IdentityService } from '../../../services/identity-service.js';
import type { McpSessionContext } from '../../mcp-session-context.js';
import { err, ok } from '../../mcp-tool-result.js';

/**
 * Registers the agent-run tool family on a {@link McpServer} instance:
 *
 * - `agent_run_start`  — opens a run, captures it in the session
 * - `agent_run_end`    — closes the active run, fires sync flush
 * - `agent_run_show`   — read-only inspection
 *
 * Every mutating MCP tool requires a run: the rule is enforced inside
 * the individual tool handlers (Task, AgentPlan, …) by checking
 * `session.getCurrentRunId()`.
 */
export class AgentRunTools {
  constructor(
    private readonly agentRun: AgentRunService,
    private readonly identity: IdentityService,
    private readonly session: McpSessionContext,
  ) {}

  /**
   * Attaches every agent-run tool to the server.
   *
   * @param server - MCP server instance to register against
   */
  register(server: McpServer): void {
    server.registerTool(
      'agent_run_start',
      {
        description:
          'Start a new agent run. REQUIRED before any mutation. The agent_handle is taken from the MCP client metadata; the LLM must not declare it.',
        inputSchema: {
          goal: z.string().min(3).describe('Short description of the work the agent will perform'),
          parent_run_id: z
            .string()
            .uuid()
            .optional()
            .describe('Optional parent run id for nested runs'),
        },
      },
      ({ goal, parent_run_id: parentRunId }) => {
        const handle = this.session.getClientMetadata().agent_handle;
        if (handle === undefined || handle.length === 0) {
          return err({
            kind: ErrorCode.IdentityNotConfigured,
          });
        }

        const result = this.agentRun.start({
          goal,
          actor: this.identity.getDefaultActor(),
          agentHandle: handle,
          parentRunId,
          clientMetadata: this.session.getClientMetadata() as Record<string, unknown>,
        });
        if (!result.ok) return err(result.error);

        this.session.setCurrentRunId(result.value.id);
        return ok({
          run_id: result.value.id,
          status: result.value.status,
          depth: result.value.depth,
          started_at: result.value.startedAt,
        });
      },
    );

    server.registerTool(
      'agent_run_end',
      {
        description:
          'Mark the currently-active agent run as ended. The run-end hook flushes the persistent sync buffer.',
        inputSchema: {
          status: z
            .enum([AgentRunStatus.Completed, AgentRunStatus.Failed, AgentRunStatus.Aborted])
            .describe('Terminal status — usually `completed`'),
          result: z.string().optional().describe('Free-form summary'),
          error: z.string().optional().describe('Error message when status=failed'),
        },
      },
      ({ status, result: resultText, error: errorText }) => {
        const runId = this.session.getCurrentRunId();
        if (runId === null) return err({ kind: ErrorCode.NoActiveRun });

        const ended = this.agentRun.end({
          runId,
          status,
          result: resultText ?? null,
          errorMessage: errorText ?? null,
        });
        if (!ended.ok) return err(ended.error);

        this.session.setCurrentRunId(null);
        return ok({
          run_id: ended.value.id,
          status: ended.value.status,
          ended_at: ended.value.endedAt,
        });
      },
    );

    server.registerTool(
      'agent_run_show',
      {
        description: 'Return a single agent run by id.',
        inputSchema: {
          run_id: z.string().describe('Identifier of the run to fetch'),
        },
      },
      ({ run_id: runId }) => {
        const result = this.agentRun.findById(runId);
        if (!result.ok) return err(result.error);
        return ok({ run: result.value });
      },
    );
  }
}
