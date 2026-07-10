import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { AgentRunStatus } from '../../../domain/enums/agent-run-status.js';
import { ErrorCode } from '../../../errors/error-codes.js';
import type { AgentRunService } from '../../../services/agent-run-service.js';
import type { AuditQuery } from '../../../services/audit-query.js';
import type { IdentityService } from '../../../services/identity-service.js';
import type { McpSessionContext } from '../../mcp-session-context.js';
import {
  err,
  ok,
  type PendingMigrationsSource,
  requireFreshSchema,
} from '../../mcp-tool-result.js';

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
    private readonly pendingMigrations: PendingMigrationsSource,
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
        const drift = requireFreshSchema(this.pendingMigrations);
        if (drift !== null) return drift;
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
        const drift = requireFreshSchema(this.pendingMigrations);
        if (drift !== null) return drift;
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
        const shouldNudge = status === AgentRunStatus.Completed && recorded.length === 0;
        const reminder = shouldNudge
          ? 'This run recorded no skill, memory or observation. If you learned ' +
            'something durable — a repeatable procedure, a project fact, or a ' +
            'signal worth revisiting — capture it now with skill_record / ' +
            'memory_record / observation_record so the next session keeps it.'
          : undefined;

        // Pre-fill a skill draft from what the run actually did, so
        // "capture it" is one edit away instead of a blank form. Skills
        // had near-zero adoption when the nudge was only a reminder; a
        // concrete starting point lowers the cost of recording one.
        const skillDraft = shouldNudge
          ? buildSkillDraft(ended.value.goal, this.touchedTaskKeys(runId))
          : undefined;

        return ok({
          run_id: ended.value.id,
          status: ended.value.status,
          ended_at: ended.value.endedAt,
          ...(reminder !== undefined ? { reminder } : {}),
          ...(skillDraft !== undefined ? { skill_draft: skillDraft } : {}),
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
        const drift = requireFreshSchema(this.pendingMigrations);
        if (drift !== null) return drift;
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

  /** Distinct task keys this run created or transitioned, in first-seen order. */
  private touchedTaskKeys(runId: string): string[] {
    const keys: string[] = [];
    const seen = new Set<string>();
    for (const event of this.auditQuery.run({ run: runId })) {
      if (event.kind !== 'task_created' && event.kind !== 'task_transitioned') continue;
      const key = (event.data as { key?: string }).key;
      if (typeof key === 'string' && !seen.has(key)) {
        seen.add(key);
        keys.push(key);
      }
    }
    return keys;
  }
}

/** A pre-filled skill_record draft an agent can accept or edit. */
export interface SkillDraft {
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly steps: string;
}

/**
 * Builds a skill_record draft from a run's goal and the tasks it touched,
 * turning the "record something" nudge into a concrete starting point.
 * The agent is expected to refine it before calling skill_record.
 *
 * @param goal - The run's goal text
 * @param taskKeys - Task keys the run created or transitioned
 * @returns A {@link SkillDraft}
 */
export function buildSkillDraft(goal: string, taskKeys: readonly string[]): SkillDraft {
  const name = goal.trim().length > 0 ? goal.trim() : 'Procedure from this run';
  const tasksNote = taskKeys.length > 0 ? ` (touched ${taskKeys.join(', ')})` : '';
  return {
    slug: slugify(name),
    name,
    description: `Repeatable procedure distilled from this run${tasksNote}. Edit before recording.`,
    steps:
      '1. <first step you took>\n2. <next step>\n3. <how you verified it>\n' +
      '— replace these with the actual procedure, then call skill_record.',
  };
}

/** Lowercase kebab-case slug, trimmed to a sane length. */
function slugify(text: string): string {
  const base = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return base.length > 0 ? base : 'run-procedure';
}
