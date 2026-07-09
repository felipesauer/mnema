import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { ErrorCode } from '../../../errors/error-codes.js';
import type { IdentityService } from '../../../services/identity-service.js';
import {
  OBSERVATION_CONTENT_MAX,
  type ObservationService,
} from '../../../services/observation-service.js';
import type { McpSessionContext } from '../../mcp-session-context.js';
import {
  err,
  ok,
  type PendingMigrationsSource,
  requireActiveRun,
  requireFreshSchema,
} from '../../mcp-tool-result.js';

/**
 * Registers the observation-related MCP tools — `observation_record`,
 * `observations_list`, `observation_archive`.
 *
 * Observations are append-only contextual notes. They are SQLite-only
 * (no `.md` mirror) to keep ephemeral signals out of the working tree.
 */
export class ObservationTools {
  constructor(
    private readonly observations: ObservationService,
    private readonly identity: IdentityService,
    private readonly session: McpSessionContext,
    private readonly pendingMigrations: PendingMigrationsSource,
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
          content: z
            .string()
            .min(1)
            .describe(
              `The note. Keep it under ${OBSERVATION_CONTENT_MAX} characters — longer content is rejected with the exact overflow, so split it into two observations.`,
            ),
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

        // Enforce the length cap in the handler (not via `.max()` on the
        // schema) so the agent gets an actionable message with the exact
        // overflow, rather than the SDK's raw "too big" rejection.
        if (input.content.length > OBSERVATION_CONTENT_MAX) {
          const over = input.content.length - OBSERVATION_CONTENT_MAX;
          return err({
            kind: ErrorCode.ValidationFailed,
            issues: [
              {
                path: ['content'],
                message: `content is ${input.content.length} characters — ${over} over the ${OBSERVATION_CONTENT_MAX} limit. Split it into two observations.`,
              },
            ],
          });
        }

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
          include_archived: z
            .boolean()
            .optional()
            .describe('Include archived observations, which are hidden by default'),
        },
      },
      ({
        topic,
        related_task_key: relatedTaskKey,
        since,
        limit,
        include_archived: includeArchived,
      }) => {
        const drift = requireFreshSchema(this.pendingMigrations);
        if (drift !== null) return drift;
        const observations = this.observations.list({
          topic,
          relatedTaskKey,
          since,
          limit,
          includeArchived,
        });
        return ok({ observations });
      },
    );

    server.registerTool(
      'observation_archive',
      {
        description:
          'Archive an observation by id (soft, one-way retirement) — the row and its audit trail survive, but it drops out of observations_list and search. Use to retire a stale or superseded signal without losing the record. Unlike a memory, an observation has no slug to re-record, so this is not reversible. Requires an active agent run.',
        inputSchema: {
          observation_id: z
            .string()
            .min(1)
            .describe('Internal UUID of the observation (from `observation_record` response)'),
        },
      },
      ({ observation_id: observationId }) => {
        const drift = requireFreshSchema(this.pendingMigrations);
        if (drift !== null) return drift;
        const runId = this.session.getCurrentRunId();
        const guard = requireActiveRun(runId);
        if (guard !== null) return guard;

        const handle = this.session.getClientMetadata().agent_handle;
        const archived = this.observations.archive(
          observationId,
          this.identity.getDefaultActor(),
          handle !== undefined && handle.length > 0 ? `agent:${handle}` : undefined,
          runId ?? undefined,
        );
        if (!archived) {
          return err({ kind: ErrorCode.ObservationNotFound, observationId });
        }
        return ok({ observation_id: observationId, archived: true });
      },
    );
  }
}
