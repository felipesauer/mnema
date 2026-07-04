import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { IdentityService } from '../../../services/identity-service.js';
import type { SkillService } from '../../../services/skill-service.js';
import type { McpSessionContext } from '../../mcp-session-context.js';
import {
  err,
  ok,
  type PendingMigrationsSource,
  requireActiveRun,
  requireFreshSchema,
} from '../../mcp-tool-result.js';

/**
 * Registers the skill-related MCP tools — `skill_record`, `skill_show`,
 * `skill_use`, `skills_list`.
 *
 * Mutating tools (`skill_record`, `skill_use`) require an active agent
 * run. Read-only tools do not.
 */
export class SkillTools {
  constructor(
    private readonly skills: SkillService,
    private readonly identity: IdentityService,
    private readonly session: McpSessionContext,
    private readonly pendingMigrations: PendingMigrationsSource,
  ) {}

  /**
   * Attaches every skill tool to the server.
   *
   * @param server - MCP server instance to register against
   */
  register(server: McpServer): void {
    server.registerTool(
      'skill_record',
      {
        description:
          'Record a reusable procedure as a skill the agent (and others) can reuse later. ' +
          'Mode "update" (default) overwrites the latest version in place; mode "new_version" ' +
          'bumps. Returns the resulting skill and an `action` hint ' +
          '("created" | "updated" | "new_version" | "no_op"). Requires an active agent run.',
        inputSchema: {
          slug: z
            .string()
            .min(1)
            .regex(/^[a-z0-9][a-z0-9-]*$/, 'slug must be kebab-case ASCII')
            .describe('Kebab-case identifier, e.g. `safe-migration-rollout`'),
          name: z.string().min(1).max(120),
          description: z.string().min(1).max(500),
          content: z
            .string()
            .min(1)
            .describe('Markdown body of the skill — steps, examples, gotchas'),
          tools_used: z
            .array(z.string().min(1))
            .optional()
            .describe('MCP tools this skill relies on (used by `mnema skill lint`)'),
          invocable: z
            .boolean()
            .optional()
            .describe('Mark the skill as invocable (meant to be run), not just read'),
          dynamic_context: z
            .array(z.string().min(1))
            .optional()
            .describe(
              'Commands whose output is embedded when the skill is shown, e.g. ["mnema tasks ready"]. Only `mnema …` commands are run.',
            ),
          mode: z.enum(['update', 'new_version']).optional(),
        },
      },
      (input) => {
        const drift = requireFreshSchema(this.pendingMigrations);
        if (drift !== null) return drift;
        const runId = this.session.getCurrentRunId();
        const guard = requireActiveRun(runId);
        if (guard !== null) return guard;

        const handle = this.session.getClientMetadata().agent_handle;
        const result = this.skills.record({
          slug: input.slug,
          name: input.name,
          description: input.description,
          content: input.content,
          toolsUsed: input.tools_used,
          invocable: input.invocable,
          dynamicContext: input.dynamic_context,
          mode: input.mode,
          actor: this.identity.getDefaultActor(),
          via: handle !== undefined && handle.length > 0 ? `agent:${handle}` : undefined,
          runId: runId ?? undefined,
        });
        return ok({ skill: result.skill, action: result.action });
      },
    );

    server.registerTool(
      'skill_show',
      {
        description:
          'Return a single skill by slug. Omit `version` for the latest; pass a number to get a specific historical version.',
        inputSchema: {
          slug: z.string().min(1),
          version: z.number().int().positive().optional(),
        },
      },
      ({ slug, version }) => {
        const drift = requireFreshSchema(this.pendingMigrations);
        if (drift !== null) return drift;
        const result = this.skills.show(slug, version);
        if (!result.ok) return err(result.error);
        const skill = result.value;
        // For an invocable skill with declared commands, resolve their
        // live output so the caller sees current state, not a stale list.
        // Only ever runs on the latest version (a historical version's
        // context is meaningless); resolution is advisory and never throws.
        const dynamic_context =
          skill.invocable && skill.dynamicContext.length > 0 && version === undefined
            ? this.skills.resolveDynamicContext(skill)
            : undefined;
        return ok({ skill, dynamic_context });
      },
    );

    server.registerTool(
      'skill_use',
      {
        description:
          'Record that the agent used a skill — increments `usage_count` and stamps `last_used_at` on its latest version. ' +
          'Does not return the content; call `skill_show` for that. Requires an active agent run.',
        inputSchema: {
          slug: z.string().min(1),
        },
      },
      ({ slug }) => {
        const drift = requireFreshSchema(this.pendingMigrations);
        if (drift !== null) return drift;
        const runId = this.session.getCurrentRunId();
        const guard = requireActiveRun(runId);
        if (guard !== null) return guard;

        const handle = this.session.getClientMetadata().agent_handle;
        const result = this.skills.recordUse(
          slug,
          this.identity.getDefaultActor(),
          handle !== undefined && handle.length > 0 ? `agent:${handle}` : undefined,
          runId ?? undefined,
        );
        if (!result.ok) return err(result.error);
        const skill = result.value;
        return ok({
          skill: {
            slug: skill.slug,
            version: skill.version,
            usage_count: skill.usageCount,
            last_used_at: skill.lastUsedAt,
          },
        });
      },
    );

    server.registerTool(
      'skills_list',
      {
        description:
          'List every recorded skill (latest version only). Ordered by usage_count desc, then recency.',
        inputSchema: {},
      },
      () => {
        const drift = requireFreshSchema(this.pendingMigrations);
        if (drift !== null) return drift;
        const skills = this.skills.list();
        return ok({ skills });
      },
    );
  }
}
