import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { IdentityService } from '../../../services/identity-service.js';
import type { LabelService } from '../../../services/label-service.js';
import type { McpSessionContext } from '../../mcp-session-context.js';
import { err, ok, requireActiveRun, requireFreshSchema } from '../../mcp-tool-result.js';

/**
 * Registers the transversal-label MCP tools — `task_set_labels`,
 * `task_labels`, `labels_list`.
 *
 * `task_set_labels` is a mutation (active run + fresh schema required)
 * with set-semantics: it replaces a task's whole label set, so passing
 * `[]` clears every label. `task_labels` and `labels_list` are
 * read-only; `labels_list` returns the catalogue with per-label
 * active-task counts — the payoff of the normalized model.
 */
export class LabelTools {
  constructor(
    private readonly labels: LabelService,
    private readonly identity: IdentityService,
    private readonly session: McpSessionContext,
    private readonly pendingMigrations: readonly string[],
  ) {}

  /**
   * Attaches every label tool to the server.
   *
   * @param server - MCP server instance to register against
   */
  register(server: McpServer): void {
    server.registerTool(
      'task_set_labels',
      {
        description:
          'Set the transversal labels on a task (replaces the whole set — pass an empty array to clear all). Labels are the cross-cutting axis epics and sprints do not capture, e.g. "area:api", "tipo:bug". Requires an active agent run.',
        inputSchema: {
          task_key: z.string().describe('Task key, e.g. WEBAPP-42'),
          labels: z
            .array(z.string().min(1))
            .describe('The complete desired label set; an empty array clears every label'),
        },
      },
      (input) => {
        const drift = requireFreshSchema(this.pendingMigrations);
        if (drift !== null) return drift;
        const runId = this.session.getCurrentRunId();
        const guard = requireActiveRun(runId);
        if (guard !== null) return guard;

        const handle = this.session.getClientMetadata().agent_handle;
        const result = this.labels.setLabels({
          taskKey: input.task_key,
          labels: input.labels,
          actor: this.identity.getDefaultActor(),
          via: handle !== undefined && handle.length > 0 ? `agent:${handle}` : undefined,
          runId: runId ?? undefined,
        });
        if (!result.ok) return err(result.error);
        return ok({ task_key: input.task_key, labels: result.value });
      },
    );

    server.registerTool(
      'task_labels',
      {
        description: 'List the transversal labels on a task. Read-only.',
        inputSchema: {
          task_key: z.string().describe('Task key, e.g. WEBAPP-42'),
        },
      },
      ({ task_key: taskKey }) => {
        const result = this.labels.listForTask(taskKey);
        if (!result.ok) return err(result.error);
        return ok({ task_key: taskKey, labels: result.value });
      },
    );

    server.registerTool(
      'labels_list',
      {
        description:
          'List the label catalogue with the number of active tasks carrying each, most-used first. Read-only.',
        inputSchema: {},
      },
      () => ok({ labels: this.labels.counts() }),
    );
  }
}
