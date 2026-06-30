import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { Workflow } from '../../domain/state-machine/state-machine.js';
import type { AgentRunService } from '../../services/agent-run-service.js';
import type { IdentityService } from '../../services/identity-service.js';
import type { TaskService } from '../../services/task-service.js';
import { resolveGovernanceRun } from '../governance-run.js';
import type { McpSessionContext } from '../mcp-session-context.js';
import { err, okTask, requireActiveRun, type Verbosity } from '../mcp-tool-result.js';
import { UNIVERSAL_TOOL_NAMES } from '../tool-registry.js';

/**
 * Workflow actions that are acts of governance rather than units of
 * work. They may be performed without a pre-existing execution run; when
 * none is active a short-lived system run is opened to keep provenance.
 * `approve` is the canonical case — signing off a finished task should
 * not require "starting work" first.
 */
const GOVERNANCE_ACTIONS: ReadonlySet<string> = new Set(['approve']);

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
            description: `${transition.description}\n\nUse when: ${transition.useWhen}${fieldsHint}`,
            inputSchema,
          },
          (input: Record<string, unknown>) => {
            const isGovernance = GOVERNANCE_ACTIONS.has(action);
            // Work actions require a live execution run. Governance acts
            // (e.g. approve) may run without one — a system run is opened
            // to preserve provenance — so signing off a finished task
            // does not force the agent to "start work" first.
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

            const handle = this.session.getClientMetadata().agent_handle;
            const result = this.tasks.transition({
              taskKey,
              action,
              payload,
              actor: this.identity.getDefaultActor(),
              via: handle !== undefined && handle.length > 0 ? `agent:${handle}` : undefined,
              runId: gov.runId,
              expectedUpdatedAt,
            });
            gov.finalize();
            if (!result.ok) return err(result.error);
            return okTask(result.value, verbosity);
          },
        );
        registered.push(toolName);
      }
    }

    return registered;
  }
}
