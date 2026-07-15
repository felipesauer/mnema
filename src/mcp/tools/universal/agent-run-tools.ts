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
          // Stamp the run guided when context_bootstrap ran earlier this
          // session — the observable proxy for a bootstrap-guided (solo) run
          // that leaves no skill_used trace.
          bootstrapped: this.session.wasBootstrapped(),
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
          ? buildSkillDraft(
              ended.value.goal,
              this.runSteps(runId, ended.value.startedAt, ended.value.endedAt),
            )
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
                // What to pick up first, in prose — the headline of a resume.
                resume_hint: summary.value.resumeHint,
                mutation_count: summary.value.mutationCount,
                plan_count: summary.value.planCount,
                // Tasks this run left mid-flight (non-terminal), newest first.
                active_tasks: summary.value.activeTasks.map((t) => ({
                  key: t.key,
                  state: t.state,
                  last_action: t.lastAction,
                  at: t.at,
                })),
                // Compact stand-in for run_diff: the last few moves, newest first.
                recent_changes: summary.value.recentChanges,
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

  /**
   * The run's substantive actions, in order, each rendered as one imperative
   * step. Bookkeeping events (run start/end, syncs) are skipped so the list
   * reads as a procedure, not a log. Feeds {@link buildSkillDraft} so the
   * draft's steps are what the agent actually did, not a placeholder.
   */
  private runSteps(runId: string, startedAt: string, endedAt: string | null): RunStep[] {
    const steps: RunStep[] = [];
    // Scope the read to the run's own window so the query skips segments the
    // run never touched instead of reading the whole chain to filter one run.
    for (const event of this.auditQuery.run({
      run: runId,
      since: startedAt,
      until: endedAt ?? undefined,
    })) {
      const step = stepForEvent(event.kind, event.data as Record<string, unknown>);
      if (step !== null) steps.push(step);
    }
    return steps;
  }
}

/** One derived procedure step: the action verb and the task it acted on (if any). */
interface RunStep {
  /** Imperative line, e.g. "submit_review MONITOR-4". */
  readonly text: string;
  /** The task key this step acted on, when applicable — used to detect a repeated cycle. */
  readonly taskKey: string | null;
  /** The bare action/verb, used to describe a repeated cycle compactly. */
  readonly verb: string;
}

/** A pre-filled skill_record draft an agent can accept or edit. */
export interface SkillDraft {
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly steps: string;
}

/**
 * Builds a skill_record draft from a run's goal and the steps it actually
 * performed (derived from the audit), turning the "record something" nudge
 * into a concrete starting point rather than a placeholder form.
 *
 * Three shapes, in order of usefulness:
 * 1. A repeated per-task cycle (the same verb sequence applied to ≥2 tasks)
 *    — captured as one generalised cycle, which is exactly the reusable
 *    procedure worth a skill.
 * 2. Otherwise, the run's steps verbatim as a numbered list.
 * 3. Nothing substantive happened — a short honest note, NOT fake
 *    placeholder steps that read as if a procedure existed.
 *
 * @param goal - The run's goal text
 * @param steps - The run's substantive steps, in order (see runSteps)
 * @returns A {@link SkillDraft}
 */
export function buildSkillDraft(goal: string, steps: readonly RunStep[]): SkillDraft {
  const name = goal.trim().length > 0 ? goal.trim() : 'Procedure from this run';
  const base = { slug: slugify(name), name };

  if (steps.length === 0) {
    return {
      ...base,
      description:
        'This run recorded no task/knowledge actions, so there is no procedure to distill. ' +
        'Write the steps yourself if you did something repeatable, then call skill_record.',
      steps: '(no steps captured — this run made no auditable changes)',
    };
  }

  const cycle = detectRepeatedCycle(steps);
  if (cycle !== null) {
    const numbered = cycle.verbs.map((v, i) => `${String(i + 1)}. ${describeVerb(v)}`).join('\n');
    return {
      ...base,
      description:
        `Repeatable cycle distilled from this run — applied to ${String(cycle.taskCount)} ` +
        `task(s) (${cycle.sampleTasks.join(', ')}). Edit before recording.`,
      steps: `${numbered}\n\n(derived from the run's audit; refine wording, then call skill_record)`,
    };
  }

  const numbered = steps.map((s, i) => `${String(i + 1)}. ${s.text}`).join('\n');
  return {
    ...base,
    description: 'Procedure distilled from this run’s actual actions. Edit before recording.',
    steps: `${numbered}\n\n(derived from the run's audit; refine wording, then call skill_record)`,
  };
}

/**
 * Maps one audit event to a procedure step, or `null` for bookkeeping
 * events that should not appear in a skill (run lifecycle, syncs). The
 * `verb` is the action name so a repeated cycle can be recognised; the
 * `text` is the human line for the numbered list.
 */
function stepForEvent(kind: string, data: Record<string, unknown>): RunStep | null {
  const s = (key: string): string | undefined =>
    typeof data[key] === 'string' ? (data[key] as string) : undefined;
  switch (kind) {
    case 'task_created':
      return {
        text: `create task ${s('key') ?? ''}`.trim(),
        taskKey: s('key') ?? null,
        verb: 'create',
      };
    case 'task_transitioned': {
      const action = s('action') ?? 'transition';
      return {
        text: `${action} ${s('key') ?? 'task'} (${s('from') ?? '?'} → ${s('to') ?? '?'})`,
        taskKey: s('key') ?? null,
        verb: action,
      };
    }
    case 'evidence_attached':
      return {
        text: `attach ${s('evidence_kind') ?? 'other'} evidence to ${s('task_key') ?? 'task'}`,
        taskKey: s('task_key') ?? null,
        verb: 'attach_evidence',
      };
    case 'decision_recorded':
      return { text: `record decision ${s('key') ?? ''}`.trim(), taskKey: null, verb: 'decision' };
    case 'memory_recorded':
      return { text: `record memory ${s('slug') ?? ''}`.trim(), taskKey: null, verb: 'memory' };
    case 'skill_recorded':
      return { text: `record skill ${s('slug') ?? ''}`.trim(), taskKey: null, verb: 'skill' };
    case 'observation_recorded':
      return { text: 'record an observation', taskKey: null, verb: 'observation' };
    case 'note_added':
      return {
        text: `add a note to ${s('task_key') ?? s('key') ?? 'task'}`,
        taskKey: null,
        verb: 'note',
      };
    default:
      return null; // run_started/ended, task_synced, claims, etc. — not procedure steps
  }
}

/** A repeated per-task cycle detected across a run's steps. */
interface RepeatedCycle {
  readonly verbs: readonly string[];
  readonly taskCount: number;
  readonly sampleTasks: readonly string[];
}

/**
 * Detects a procedure the run repeated across tasks: if ≥2 task keys each
 * went through the same ordered sequence of verbs, that sequence is the
 * reusable skill. Returns null when there is no such repetition (a one-off
 * run has nothing to generalise).
 */
function detectRepeatedCycle(steps: readonly RunStep[]): RepeatedCycle | null {
  const byTask = new Map<string, string[]>();
  for (const step of steps) {
    if (step.taskKey === null) continue;
    const list = byTask.get(step.taskKey);
    if (list === undefined) byTask.set(step.taskKey, [step.verb]);
    else list.push(step.verb);
  }
  if (byTask.size < 2) return null;

  // Group task keys by their verb-sequence signature; a signature shared by
  // ≥2 tasks (and with ≥2 steps, so it is a real cycle not a single move) wins.
  const bySignature = new Map<string, string[]>();
  for (const [taskKey, verbs] of byTask) {
    if (verbs.length < 2) continue;
    const sig = verbs.join('>');
    const tasks = bySignature.get(sig);
    if (tasks === undefined) bySignature.set(sig, [taskKey]);
    else tasks.push(taskKey);
  }
  for (const [sig, tasks] of bySignature) {
    if (tasks.length >= 2) {
      return { verbs: sig.split('>'), taskCount: tasks.length, sampleTasks: tasks.slice(0, 3) };
    }
  }
  return null;
}

/** A short imperative gloss for a verb in a generalised cycle. */
function describeVerb(verb: string): string {
  switch (verb) {
    case 'create':
      return 'create the task';
    case 'submit':
      return 'submit it (define title/description/criteria/estimate)';
    case 'start':
      return 'start it (assign yourself)';
    case 'submit_review':
      return 'submit for review with the PR url';
    case 'approve':
      return 'approve it';
    case 'attach_evidence':
      return 'attach evidence to a criterion';
    default:
      return `${verb} it`;
  }
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
