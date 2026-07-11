import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { Config } from '../../config/config-schema.js';
import { AgentRunStatus } from '../../domain/enums/agent-run-status.js';
import type { Workflow } from '../../domain/state-machine/state-machine.js';
import { ErrorCode } from '../../errors/error-codes.js';
import type { AgentRunService } from '../../services/agent-run-service.js';
import type { GitHubPrService, PrStatus } from '../../services/github-pr-service.js';
import type { IdentityService } from '../../services/identity-service.js';
import type { TaskService } from '../../services/task-service.js';
import { resolveGovernanceRun } from '../governance-run.js';
import type { McpSessionContext } from '../mcp-session-context.js';
import {
  err,
  ok,
  okTask,
  type PendingMigrationsSource,
  requireActiveRun,
  requireFreshSchema,
  toCompactTask,
  type Verbosity,
} from '../mcp-tool-result.js';
import { UNIVERSAL_TOOL_NAMES } from '../tool-registry.js';

/**
 * Action names that, when they also move a task into a terminal state,
 * are treated as acts of governance rather than units of work: they may
 * run without a pre-existing execution run (a short-lived system run is
 * opened to keep provenance). `approve` is the canonical case — signing
 * off a finished task should not require "starting work" first.
 *
 * The terminal-target check matters: a custom workflow could name a
 * mid-pipeline *work* transition `approve` (e.g. a lead approving a spec
 * that then continues), and that one must keep its run guard. Gating on
 * "named approve AND targets terminal" avoids silently relaxing it.
 */
const GOVERNANCE_ACTION_NAMES: ReadonlySet<string> = new Set(['approve']);

/**
 * Generates one MCP tool per workflow action.
 *
 * For a workflow declaring a transition `submit` requiring fields
 * `title`, `description`, `acceptance_criteria` and `estimate`, the
 * registrar attaches a `task_submit` tool with that exact input schema
 * plus `task_key` and `expected_updated_at` (optional, optimistic
 * concurrency).
 *
 * Tools regenerate on every server boot from the active workflow JSON,
 * so editing `workflows/*.json` and restarting is enough to expose new
 * actions to agents.
 */
export class TransitionToolsRegistrar {
  constructor(
    private readonly workflow: Workflow,
    private readonly tasks: TaskService,
    private readonly identity: IdentityService,
    private readonly session: McpSessionContext,
    private readonly agentRun: AgentRunService,
    private readonly config: Config,
    private readonly githubPr: GitHubPrService,
    private readonly pendingMigrations: PendingMigrationsSource,
  ) {}

  /**
   * Registers a `task_<action>` tool for every transition declared in
   * the active workflow.
   *
   * Identical action names appearing on multiple source states share a
   * single tool; the handler discovers the source state at call time
   * via `task_key` and lets {@link TaskService.transition} validate
   * whether the action is allowed.
   *
   * @param server - MCP server instance to register against
   * @returns Names of every tool that was registered (for diagnostics)
   */
  register(server: McpServer): readonly string[] {
    const seen = new Set<string>();
    const registered: string[] = [];
    // A workflow may name a transition action that collides with a universal
    // tool (e.g. an action literally named `create` → `task_create`).
    // Registering it would throw "Tool task_create is already registered" and
    // crash boot. Skip-and-warn instead so a malformed workflow degrades
    // gracefully rather than taking the server down.
    const reserved = new Set(UNIVERSAL_TOOL_NAMES);

    for (const actions of Object.values(this.workflow.transitions)) {
      for (const [action, transition] of Object.entries(actions)) {
        const toolName = `task_${action}`;
        if (seen.has(toolName)) continue;
        seen.add(toolName);
        if (reserved.has(toolName)) {
          process.stderr.write(
            `[mnema] skipping workflow action "${action}": the tool name "${toolName}" is reserved by a universal tool\n`,
          );
          continue;
        }

        // A transition into a terminal state (e.g. approve → DONE) can be
        // gated on PR/CI status when `github.done_pr_policy` is enabled.
        const targetsTerminal = this.workflow.terminal.includes(transition.to);
        // A transition may itself declare `pr_url` as a gate field (e.g.
        // `complete` carrying merged-code PR evidence). When it does, that
        // declaration is authoritative — we must not inject a synthetic
        // `pr_url` (it would collide) nor strip the caller's value from the
        // service payload, so the evidence reaches `transitions.payload`.
        const declaresPrUrl = 'pr_url' in transition.requires.shape;
        // Only inject the synthetic gate-only `pr_url` when the transition
        // targets a terminal state AND does not already declare it.
        const injectPrUrl = targetsTerminal && !declaresPrUrl;

        const inputSchema = {
          task_key: z.string().describe('Task key (e.g. WEBAPP-42)'),
          expected_updated_at: z
            .string()
            .optional()
            .describe('Optimistic concurrency token from a previous read'),
          verbosity: z
            .enum(['full', 'compact'])
            .optional()
            .describe(
              "Echo mode for the transitioned task. 'full' (default) returns the whole " +
                "entity; 'compact' returns only { key, state, updatedAt } to save context.",
            ),
          ...(injectPrUrl
            ? {
                pr_url: z
                  .string()
                  .optional()
                  .describe(
                    'Optional PR URL to check against `github.done_pr_policy`. When the policy ' +
                      'is warn/block and the PR is not merged or CI is red, the move is warned ' +
                      'or refused. Ignored when the policy is off (default).',
                  ),
              }
            : {}),
          ...transition.requires.shape,
        } as Record<string, z.ZodTypeAny>;

        const requiredFieldNames = Object.keys(transition.requires.shape);
        const fieldsHint =
          requiredFieldNames.length === 0
            ? '\n\nThis action has no required fields beyond `task_key`.'
            : `\n\nRequired fields: ${requiredFieldNames.join(', ')}.`;
        server.registerTool(
          toolName,
          {
            description: `${transition.description}\n\nUse when: ${transition.useWhen}${fieldsHint}\n\nPass verbosity: 'compact' to get back a lean { key, state, updatedAt } echo instead of the full task — ideal for batch or low-context transitions.`,
            inputSchema,
          },
          (input: Record<string, unknown>) => {
            // A transition is a mutation: refuse on schema drift with the
            // structured SCHEMA_OUT_OF_DATE (pointing at `mnema upgrade`)
            // instead of letting a write hit a behind-schema DB and leak a
            // raw SqliteError. The other mutation tools already do this;
            // the transition registrar was the gap.
            const drift = requireFreshSchema(this.pendingMigrations);
            if (drift !== null) return drift;

            // Governance only when the action is named so AND it moves the
            // task into a terminal state — a genuine sign-off, never a
            // same-named mid-pipeline work transition.
            const isGovernance =
              GOVERNANCE_ACTION_NAMES.has(action) && this.workflow.terminal.includes(transition.to);
            // Work actions require a live execution run. Governance acts
            // may run without one — a system run is opened to preserve
            // provenance — so signing off a finished task does not force
            // the agent to "start work" first.
            if (!isGovernance) {
              const guard = requireActiveRun(this.session.getCurrentRunId());
              if (guard !== null) return guard;
            }
            const gov = isGovernance
              ? resolveGovernanceRun(this.session, this.agentRun, this.identity, toolName)
              : { runId: this.session.getCurrentRunId() ?? undefined, finalize: () => {} };

            const {
              task_key: taskKey,
              expected_updated_at: expectedUpdatedAt,
              verbosity,
              ...payload
            } = input as {
              task_key: string;
              expected_updated_at?: string;
              verbosity?: Verbosity;
              [field: string]: unknown;
            };

            // `pr_url` is a workflow field for some transitions (e.g.
            // submit_review requires it, complete accepts it as merged-code
            // evidence) and ALSO the gate's input on a terminal transition.
            // Read it without removing it from `payload`; only strip it when
            // it was the synthetic gate-only field we injected, so a
            // transition that declares `pr_url` (required or optional) still
            // records it in `transitions.payload` as evidence.
            const prUrl = typeof input.pr_url === 'string' ? input.pr_url : undefined;
            if (injectPrUrl) delete (payload as { pr_url?: unknown }).pr_url;

            const handle = this.session.getClientMetadata().agent_handle;
            // A transient governance run must be recorded as completed only
            // when the act actually proceeds. A refusal (blocked gate, failed
            // transition) or a thrown handler closes it as aborted instead, so
            // a refused sign-off leaves no phantom completed run in the trail.
            let proceeded = false;
            // try/finally so any system run resolveGovernanceRun opened is
            // always closed — even on a gate refusal or a thrown transition.
            try {
              // DONE-gate: when this transition targets a terminal state, a
              // pr_url was given, and the policy is on, check PR/CI. `block`
              // refuses with GATE_FAILED before any state change; `warn`
              // lets it through and attaches a warning. Unresolvable status
              // (offline/unauth) never blocks.
              //
              // This is the merged-code completion path: a `complete`
              // transition that declares an optional `pr_url` lets an
              // IN_PROGRESS task with merged code reach DONE in one hop,
              // recording the PR in `transitions.payload` as evidence while
              // this same gate still enforces the DONE PR/CI policy — so the
              // one-hop path is never a way around the gate.
              let prWarning: string | undefined;
              const policy = this.config.github.done_pr_policy;
              if (targetsTerminal && policy !== 'off' && prUrl !== undefined && prUrl.length > 0) {
                const problem = prProblem(this.githubPr.status(prUrl));
                if (problem !== null) {
                  if (policy === 'block') {
                    return err({
                      kind: ErrorCode.GateFailed,
                      taskKey,
                      action,
                      issues: [{ path: ['pr_url'], message: problem }],
                    });
                  }
                  prWarning = problem; // policy === 'warn'
                }
              }

              // Detect an idempotent retry BEFORE the call, while the task is
              // still in its pre-state: the service will no-op it, and we
              // annotate the echo so the agent sees "already there" rather
              // than mistaking an unchanged response for a fresh transition.
              const noOp = this.tasks.wouldBeNoOp(
                taskKey,
                action,
                this.identity.getDefaultActor(),
                handle !== undefined && handle.length > 0 ? `agent:${handle}` : undefined,
              );

              const result = this.tasks.transition({
                taskKey,
                action,
                payload,
                actor: this.identity.getDefaultActor(),
                via: handle !== undefined && handle.length > 0 ? `agent:${handle}` : undefined,
                runId: gov.runId,
                expectedUpdatedAt,
              });
              if (!result.ok) return err(result.error);
              proceeded = true;
              if (prWarning !== undefined) {
                // Honour `verbosity` on the warn echo too — the pr_warning
                // branch must not silently return the full entity when the
                // caller asked for the compact shape.
                const task = verbosity === 'compact' ? toCompactTask(result.value) : result.value;
                return ok({ task, pr_warning: prWarning });
              }
              if (noOp) {
                const task = verbosity === 'compact' ? toCompactTask(result.value) : result.value;
                return ok({
                  task,
                  no_op: true,
                  note: `${taskKey} is already ${result.value.state} — no change (idempotent retry)`,
                });
              }
              return okTask(result.value, verbosity);
            } finally {
              gov.finalize(proceeded ? AgentRunStatus.Completed : AgentRunStatus.Aborted);
            }
          },
        );
        registered.push(toolName);
      }
    }

    return registered;
  }
}

/**
 * Returns a human reason the PR is not ready to close the task, or null
 * when it is ready (merged + CI passing/none) or its status can't be
 * resolved (offline / unauth / unknown — never block on absence of
 * evidence). Drives both the `block` refusal and the `warn` note.
 */
function prProblem(status: PrStatus): string | null {
  if (!status.available) return null; // can't prove a problem → don't gate
  const ref = status.ref ?? 'the PR';
  if (!status.merged) {
    return `${ref} is not merged (state: ${status.state}) — the task is moving to a terminal state before its PR landed.`;
  }
  if (status.ci === 'failing') {
    return `${ref} merged but its CI is failing.`;
  }
  if (status.ci === 'pending') {
    return `${ref} merged but its CI is still pending.`;
  }
  return null;
}
