import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { IdentityService } from '../../../services/identity-service.js';
import type { ObservationService } from '../../../services/observation-service.js';
import type { McpSessionContext } from '../../mcp-session-context.js';
import { err, ok, requireActiveRun, requireFreshSchema } from '../../mcp-tool-result.js';

/**
 * Registers the observation-related MCP tools — `observation_record`,
 * `observations_list`.
 *
 * Observations are append-only contextual notes. They are SQLite-only
 * (no `.md` mirror) to keep ephemeral signals out of the working tree.
 */
export class ObservationTools {
  constructor(
    private readonly observations: ObservationService,
    private readonly identity: IdentityService,
    private readonly session: McpSessionContext,
    private readonly pendingMigrations: readonly string[],
  ) {}

  /**
   * Attaches every observation tool to the server.
   *
   * @param server - MCP server instance to register against
   */
  register(server: McpServer): void {
    server.registerTool(
      'observation_record',
      {
        description:
          'Record an append-only context note. Use this for short-lived signals that may inform a memory or skill later, but are not durable truths on their own. Requires an active agent run.',
        inputSchema: {
          content: z.string().min(1).max(2000),
          topics: z.array(z.string().min(1)).optional().describe('Free-form tags for filtering'),
          related_task_key: z
            .string()
            .min(1)
            .optional()
            .describe('Optional task key, e.g. WEBAPP-42, to scope the observation'),
        },
      },
      (input) => {
        const drift = requireFreshSchema(this.pendingMigrations);
        if (drift !== null) return drift;
        const runId = this.session.getCurrentRunId();
        const guard = requireActiveRun(runId);
        if (guard !== null) return guard;

        const handle = this.session.getClientMetadata().agent_handle;
        const result = this.observations.record({
          content: input.content,
          topics: input.topics,
          relatedTaskKey: input.related_task_key,
          actor: this.identity.getDefaultActor(),
          via: handle !== undefined && handle.length > 0 ? `agent:${handle}` : undefined,
          runId: runId ?? undefined,
        });
        if (!result.ok) return err(result.error);
        return ok({ observation: result.value });
      },
    );

    server.registerTool(
      'observations_list',
      {
        description:
          'List observations, newest first, with optional filters by topic, related task, or time.',
        inputSchema: {
          topic: z.string().min(1).optional(),
          related_task_key: z.string().min(1).optional(),
          since: z.string().optional().describe('ISO 8601 timestamp lower bound (inclusive)'),
          limit: z.number().int().positive().optional(),
        },
      },
      ({ topic, related_task_key: relatedTaskKey, since, limit }) => {
        const drift = requireFreshSchema(this.pendingMigrations);
        if (drift !== null) return drift;
        const observations = this.observations.list({
          topic,
          relatedTaskKey,
          since,
          limit,
        });
        return ok({ observations });
      },
    );
  }
}
