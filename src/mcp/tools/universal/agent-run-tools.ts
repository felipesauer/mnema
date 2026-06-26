import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { AgentRunStatus } from '../../../domain/enums/agent-run-status.js';
import { ErrorCode } from '../../../errors/error-codes.js';
import type { AgentRunService } from '../../../services/agent-run-service.js';
import type { AuditQuery } from '../../../services/audit-query.js';
import type { IdentityService } from '../../../services/identity-service.js';
import type { McpSessionContext } from '../../mcp-session-context.js';
import { err, ok } from '../../mcp-tool-result.js';

/** Audit kinds that count as the agent having recorded something it learned. */
const KNOWLEDGE_KINDS = ['skill_recorded', 'memory_recorded', 'observation_recorded'] as const;

/**
 * Registers the agent-run tool family on a {@link McpServer} instance:
 *
 * - `agent_run_start`  — opens a run, captures it in the session
 * - `agent_run_end`    — closes the active run, fires sync flush
 * - `agent_run_resume` — reattaches to an interrupted run
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
    private readonly auditQuery: AuditQuery,
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
            kind: ErrorCode.AgentHandleMissing,
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
          'Mark the currently-active agent run as ended. The run-end hook flushes the persistent sync buffer. If a completed run recorded no skill/memory/observation, the result carries a `reminder` to capture what was learned.',
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

        // Count what the agent recorded during this run, before closing it.
        // A completed run that captured nothing durable is usually a missed
        // chance to leave knowledge behind — nudge, but never block.
        const recorded = this.auditQuery
          .run({ run: runId })
          .filter((e) => (KNOWLEDGE_KINDS as readonly string[]).includes(e.kind));

        const ended = this.agentRun.end({
          runId,
          status,
          result: resultText ?? null,
          errorMessage: errorText ?? null,
        });
        if (!ended.ok) return err(ended.error);

        this.session.setCurrentRunId(null);
        const reminder =
          status === AgentRunStatus.Completed && recorded.length === 0
            ? 'This run recorded no skill, memory or observation. If you learned ' +
              'something durable — a repeatable procedure, a project fact, or a ' +
              'signal worth revisiting — capture it now with skill_record / ' +
              'memory_record / observation_record so the next session keeps it.'
            : undefined;

        return ok({
          run_id: ended.value.id,
          status: ended.value.status,
          ended_at: ended.value.endedAt,
          ...(reminder !== undefined ? { reminder } : {}),
        });
      },
    );

    server.registerTool(
      'agent_run_resume',
      {
        description:
          'Reattach to an interrupted run (aborted or failed) instead of opening a new one, and make it the session active run. Resuming a run that is still running is a safe no-op; a completed run is rejected. Returns a summary of what is still open.',
        inputSchema: {
          run_id: z.string().describe('Identifier of the interrupted run to resume'),
        },
      },
      ({ run_id: runId }) => {
        const result = this.agentRun.resume({
          runId,
          actor: this.identity.getDefaultActor(),
        });
        if (!result.ok) return err(result.error);

        this.session.setCurrentRunId(result.value.id);

        const summary = this.agentRun.summarize(result.value.id);
        return ok({
          run_id: result.value.id,
          status: result.value.status,
          depth: result.value.depth,
          ...(summary.ok
            ? {
                mutation_count: summary.value.mutationCount,
                plan_count: summary.value.planCount,
                open_items: summary.value.openItems.map((item) => ({
                  kind: item.kind,
                  id: item.id,
                  label: item.label,
                  status: item.status,
                })),
              }
            : {}),
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
