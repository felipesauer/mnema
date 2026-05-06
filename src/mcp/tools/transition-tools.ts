import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { Workflow } from '../../domain/state-machine/state-machine.js';
import type { IdentityService } from '../../services/identity-service.js';
import type { TaskService } from '../../services/task-service.js';
import type { McpSessionContext } from '../mcp-session-context.js';
import { err, ok, requireActiveRun } from '../mcp-tool-result.js';

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

    for (const actions of Object.values(this.workflow.transitions)) {
      for (const [action, transition] of Object.entries(actions)) {
        const toolName = `task_${action}`;
        if (seen.has(toolName)) continue;
        seen.add(toolName);

        const inputSchema = {
          task_key: z.string().describe('Task key (e.g. WEBAPP-42)'),
          expected_updated_at: z
            .string()
            .optional()
            .describe('Optimistic concurrency token from a previous read'),
          ...transition.requires.shape,
        } as Record<string, z.ZodTypeAny>;

        server.registerTool(
          toolName,
          {
            description: `${transition.description}\n\nUse when: ${transition.useWhen}`,
            inputSchema,
          },
          (input: Record<string, unknown>) => {
            const guard = requireActiveRun(this.session.getCurrentRunId());
            if (guard !== null) return guard;

            const {
              task_key: taskKey,
              expected_updated_at: expectedUpdatedAt,
              ...payload
            } = input as {
              task_key: string;
              expected_updated_at?: string;
              [field: string]: unknown;
            };

            const handle = this.session.getClientMetadata().agent_handle;
            const result = this.tasks.transition({
              taskKey,
              action,
              payload,
              actor: this.identity.getDefaultActor(),
              via: handle !== undefined && handle.length > 0 ? `agent:${handle}` : undefined,
              runId: this.session.getCurrentRunId() ?? undefined,
              expectedUpdatedAt,
            });
            if (!result.ok) return err(result.error);
            return ok({ task: result.value });
          },
        );
        registered.push(toolName);
      }
    }

    return registered;
  }
}
