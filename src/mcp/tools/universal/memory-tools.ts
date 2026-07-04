import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { ErrorCode } from '../../../errors/error-codes.js';
import type { IdentityService } from '../../../services/identity-service.js';
import type { MemoryService } from '../../../services/memory-service.js';
import type { McpSessionContext } from '../../mcp-session-context.js';
import {
  err,
  ok,
  type PendingMigrationsSource,
  requireActiveRun,
  requireFreshSchema,
} from '../../mcp-tool-result.js';

/**
 * Registers the memory-related MCP tools — `memory_record`,
 * `memory_show`, `memories_list`.
 *
 * Memories are durable project facts the agent asserts as truth.
 * Distinct from decisions (formal ADRs with a lifecycle) and
 * observations (append-only ephemera).
 */
export class MemoryTools {
  constructor(
    private readonly memories: MemoryService,
    private readonly identity: IdentityService,
    private readonly session: McpSessionContext,
    private readonly pendingMigrations: PendingMigrationsSource,
  ) {}

  /**
   * Attaches every memory tool to the server.
   *
   * @param server - MCP server instance to register against
   */
  register(server: McpServer): void {
    server.registerTool(
      'memory_record',
      {
        description:
          'Record a durable project fact as a memory. Upsert by slug — calling twice with the same slug overwrites the prior content. ' +
          'Returns the resulting memory and an `action` hint ("created" | "updated" | "no_op"). Requires an active agent run.',
        inputSchema: {
          slug: z
            .string()
            .min(1)
            .regex(/^[a-z0-9][a-z0-9-]*$/, 'slug must be kebab-case ASCII'),
          title: z.string().min(1).max(200),
          content: z.string().min(1),
          topics: z
            .array(z.string().min(1))
            .optional()
            .describe('Free-form tags for filtering, e.g. ["compliance", "estimation"]'),
          derived_from_decision: z
            .string()
            .optional()
            .describe('Decision key this memory was derived from — records a provenance edge'),
        },
      },
      (input) => {
        const drift = requireFreshSchema(this.pendingMigrations);
        if (drift !== null) return drift;
        const runId = this.session.getCurrentRunId();
        const guard = requireActiveRun(runId);
        if (guard !== null) return guard;

        const handle = this.session.getClientMetadata().agent_handle;
        const result = this.memories.record({
          slug: input.slug,
          title: input.title,
          content: input.content,
          topics: input.topics,
          derivedFromDecision: input.derived_from_decision,
          actor: this.identity.getDefaultActor(),
          via: handle !== undefined && handle.length > 0 ? `agent:${handle}` : undefined,
          runId: runId ?? undefined,
        });
        return ok({ memory: result.memory, action: result.action });
      },
    );

    server.registerTool(
      'memory_show',
      {
        description: 'Return a single memory by slug.',
        inputSchema: {
          slug: z.string().min(1),
        },
      },
      ({ slug }) => {
        const drift = requireFreshSchema(this.pendingMigrations);
        if (drift !== null) return drift;
        const result = this.memories.show(slug);
        if (!result.ok) return err(result.error);
        return ok({ memory: result.value });
      },
    );

    server.registerTool(
      'memories_list',
      {
        description: 'List memories, optionally filtered by topic.',
        inputSchema: {
          topic: z.string().min(1).optional(),
        },
      },
      ({ topic }) => {
        const drift = requireFreshSchema(this.pendingMigrations);
        if (drift !== null) return drift;
        const memories = this.memories.list(topic);
        return ok({ memories });
      },
    );

    server.registerTool(
      'memory_archive',
      {
        description:
          'Archive a memory (soft, reversible retirement) — the row and its audit trail survive, and re-recording the slug reactivates it. Use to retire a memory flagged stale/obsolete without losing the record. Requires an active agent run.',
        inputSchema: {
          slug: z.string().min(1).describe('Memory slug to archive'),
        },
      },
      ({ slug }) => {
        const drift = requireFreshSchema(this.pendingMigrations);
        if (drift !== null) return drift;
        const runId = this.session.getCurrentRunId();
        const guard = requireActiveRun(runId);
        if (guard !== null) return guard;

        const handle = this.session.getClientMetadata().agent_handle;
        const archived = this.memories.archive(
          slug,
          this.identity.getDefaultActor(),
          handle !== undefined && handle.length > 0 ? `agent:${handle}` : undefined,
          runId ?? undefined,
        );
        if (!archived) {
          return err({ kind: ErrorCode.MemoryNotFound, slug });
        }
        return ok({ slug, archived: true });
      },
    );
  }
}
