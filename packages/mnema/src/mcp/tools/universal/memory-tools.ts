import { AgentRunStatus } from '@mnema/core/domain/enums/agent-run-status.js';
import { ErrorCode } from '@mnema/core/errors/error-codes.js';
import type { AgentRunService } from '@mnema/core/services/agent/agent-run-service.js';
import type { IdentityService } from '@mnema/core/services/integrity/identity-service.js';
import type { MemoryService } from '@mnema/core/services/knowledge/memory-service.js';
import type { WikilinkLintService } from '@mnema/core/services/lint/wikilink-lint-service.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { resolveGovernanceRun } from '../../governance-run.js';
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
    private readonly agentRun: AgentRunService,
    private readonly wikilinks: WikilinkLintService,
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
          'Returns the resulting memory and an `action` hint ("created" | "updated" | "no_op"). If no agent run is active, a short-lived system run is opened to attribute it.',
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
          scope: z
            .string()
            .min(1)
            .optional()
            .describe('Area path/package like "packages/notifier"; omit for project-global'),
          derived_from_decision: z
            .string()
            .optional()
            .describe('Decision key this was derived from (records a provenance edge)'),
          derived_from_observation: z
            .string()
            .optional()
            .describe('Observation id this was promoted from (records a provenance edge)'),
        },
      },
      (input) => {
        const drift = requireFreshSchema(this.pendingMigrations);
        if (drift !== null) return drift;

        // Recording a memory should not require an execution run. If none is
        // active, open a short-lived system run so provenance (actor / via /
        // run) is still captured, then close it in the finally below.
        const gov = resolveGovernanceRun(
          this.session,
          this.agentRun,
          this.identity,
          'memory_record',
        );
        // A transient system run must be recorded as completed only when the
        // record actually lands. A failed record or a thrown handler closes it
        // as aborted, so a refused record leaves no phantom completed run.
        let proceeded = false;
        try {
          const handle = this.session.getClientMetadata().agent_handle;
          const result = this.memories.record({
            slug: input.slug,
            title: input.title,
            content: input.content,
            topics: input.topics,
            scope: input.scope,
            derivedFromDecision: input.derived_from_decision,
            derivedFromObservation: input.derived_from_observation,
            actor: this.identity.getDefaultActor(),
            via: handle !== undefined && handle.length > 0 ? `agent:${handle}` : undefined,
            runId: gov.runId,
          });
          if (!result.ok) return err(result.error);
          proceeded = true;
          return ok({ memory: result.value.memory, action: result.value.action });
        } finally {
          gov.finalize(proceeded ? AgentRunStatus.Completed : AgentRunStatus.Aborted);
        }
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
          'Archive a memory (soft, reversible retirement) — the row and its audit trail survive, and re-recording the slug reactivates it. Use to retire a memory flagged stale/obsolete without losing the record. Pass preview:true for a non-destructive intent diff (which knowledge files still link to this slug and would be left dangling) without archiving. Requires an active agent run.',
        inputSchema: {
          slug: z.string().min(1).describe('Memory slug to archive'),
          preview: z.boolean().optional().describe('Return the projected impact without archiving'),
        },
      },
      ({ slug, preview }) => {
        const drift = requireFreshSchema(this.pendingMigrations);
        if (drift !== null) return drift;

        if (preview === true) {
          const danglingFiles = this.wikilinks.referencesTo(slug);
          return ok({
            preview: true,
            op: 'archive',
            impact: { slug, dangling_reference_files: danglingFiles },
            summary:
              danglingFiles.length > 0
                ? `${String(danglingFiles.length)} knowledge file(s) link to [[${slug}]] and would dangle after archive`
                : `no wikilink references — safe to archive`,
          });
        }

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

    server.registerTool(
      'memory_supersede',
      {
        description:
          'Supersede a memory: point it at a successor memory that replaces it. One-way (unlike archive) — the superseded memory drops out of the default list and search, and a navigable memory→memory provenance edge is recorded. Both memories must exist; a memory cannot supersede itself. Requires an active agent run.',
        inputSchema: {
          slug: z.string().min(1).describe('Slug of the memory being superseded'),
          superseded_by: z.string().min(1).describe('Slug of the replacement memory'),
        },
      },
      (input) => {
        const drift = requireFreshSchema(this.pendingMigrations);
        if (drift !== null) return drift;
        const runId = this.session.getCurrentRunId();
        const guard = requireActiveRun(runId);
        if (guard !== null) return guard;

        const handle = this.session.getClientMetadata().agent_handle;
        const result = this.memories.supersede(
          input.slug,
          input.superseded_by,
          this.identity.getDefaultActor(),
          handle !== undefined && handle.length > 0 ? `agent:${handle}` : undefined,
          runId ?? undefined,
        );
        if (!result.ok) return err(result.error);
        return ok({
          slug: input.slug,
          superseded_by: input.superseded_by,
          successor: result.value,
        });
      },
    );

    server.registerTool(
      'memory_contradict',
      {
        description:
          'Record that THIS memory contradicts (obsoletes) another. Softer than supersede: the contradicted memory stays listed and searchable — the contradiction is informative — but is annotated obsolete and de-ranked so the current truth is unambiguous. Records a navigable memory→memory provenance edge. Both memories must exist; a memory cannot contradict itself. Requires an active agent run.',
        inputSchema: {
          slug: z.string().min(1).describe('Slug of the newer memory doing the contradicting'),
          obsoletes: z.string().min(1).describe('Slug of the memory being marked obsolete'),
        },
      },
      (input) => {
        const drift = requireFreshSchema(this.pendingMigrations);
        if (drift !== null) return drift;
        const runId = this.session.getCurrentRunId();
        const guard = requireActiveRun(runId);
        if (guard !== null) return guard;

        const handle = this.session.getClientMetadata().agent_handle;
        const result = this.memories.contradict(
          input.slug,
          input.obsoletes,
          this.identity.getDefaultActor(),
          handle !== undefined && handle.length > 0 ? `agent:${handle}` : undefined,
          runId ?? undefined,
        );
        if (!result.ok) return err(result.error);
        return ok({
          slug: input.slug,
          obsoletes: input.obsoletes,
          obsoleted: result.value,
        });
      },
    );
  }
}
