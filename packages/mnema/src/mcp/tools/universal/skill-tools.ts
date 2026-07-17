import type { IdentityService } from '@mnema/core/services/integrity/identity-service.js';
import type { SkillQualityService } from '@mnema/core/services/knowledge/skill-quality-service.js';
import type { SkillService } from '@mnema/core/services/knowledge/skill-service.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
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
    private readonly skillQuality: SkillQualityService,
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
              '`mnema …` commands whose output is embedded when shown, e.g. ["mnema tasks ready"]',
            ),
          mode: z.enum(['update', 'new_version']).optional(),
          change_rationale: z
            .string()
            .min(1)
            .optional()
            .describe(
              'Why this version changed (shown in `skill_diff`); best with mode:"new_version"',
            ),
          scope: z
            .string()
            .min(1)
            .optional()
            .describe('Area path/package like "packages/notifier"; omit for project-global'),
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
          changeRationale: input.change_rationale,
          scope: input.scope,
          actor: this.identity.getDefaultActor(),
          via: handle !== undefined && handle.length > 0 ? `agent:${handle}` : undefined,
          runId: runId ?? undefined,
        });
        if (!result.ok) return err(result.error);
        return ok({ skill: result.value.skill, action: result.value.action });
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
      'skill_diff',
      {
        description:
          'Show the line-level diff between two versions of a skill, plus the newer ' +
          "version's change rationale (the why). Omit `from`/`to` to diff the two most " +
          'recent versions; a skill with a single version diffs against an empty base. Read-only.',
        inputSchema: {
          slug: z.string().min(1),
          from: z.number().int().positive().optional().describe('Older version number'),
          to: z.number().int().positive().optional().describe('Newer version number'),
        },
      },
      ({ slug, from, to }) => {
        const drift = requireFreshSchema(this.pendingMigrations);
        if (drift !== null) return drift;
        const result = this.skills.diff(slug, from, to);
        if (!result.ok) return err(result.error);
        const d = result.value;
        return ok({
          slug: d.slug,
          from_version: d.fromVersion,
          to_version: d.toVersion,
          change_rationale: d.changeRationale,
          hunks: d.hunks,
        });
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
          'List every recorded skill (latest version only). Ordered by usage_count desc, then recency. ' +
          'Each carries `review_flag`: true when the skill was applied in a run that touched a task ' +
          'which later reopened — a signal its guidance may need revisiting.',
        inputSchema: {},
      },
      () => {
        const drift = requireFreshSchema(this.pendingMigrations);
        if (drift !== null) return drift;
        const skills = this.skills.list();
        const flagged = this.skillQuality.flaggedForReview();
        return ok({
          skills: skills.map((s) => ({ ...s, review_flag: flagged.has(s.slug) })),
        });
      },
    );

    server.registerTool(
      'skill_review_proposals',
      {
        description:
          'Structured prompts to reconsider a skill: each proposal names a skill that was applied in a run touching a task which has since reopened, with the task key, run id, reopen count and the recorded reopen reason. A prompt for a human/agent to judge whether the skill needs revising — NOT a verdict, and it changes nothing. Authoring a revised version is a separate, explicit act (skill_record mode:new_version).',
        inputSchema: {},
      },
      () => {
        const drift = requireFreshSchema(this.pendingMigrations);
        if (drift !== null) return drift;
        return ok({ proposals: this.skillQuality.reviewProposals() });
      },
    );

    server.registerTool(
      'skill_supersede',
      {
        description:
          'Supersede a skill: point a version at a successor skill that replaces it. Targets the latest version of `slug` unless `version` is given; the successor resolves to the latest version of `superseded_by`. One-way — a superseded latest version drops out of the list and search. A skill cannot supersede itself. Requires an active agent run.',
        inputSchema: {
          slug: z.string().min(1).describe('Slug of the skill being superseded'),
          superseded_by: z.string().min(1).describe('Slug of the replacement skill'),
          version: z
            .number()
            .int()
            .positive()
            .optional()
            .describe('Specific version to supersede (default: latest)'),
        },
      },
      (input) => {
        const drift = requireFreshSchema(this.pendingMigrations);
        if (drift !== null) return drift;
        const runId = this.session.getCurrentRunId();
        const guard = requireActiveRun(runId);
        if (guard !== null) return guard;

        const handle = this.session.getClientMetadata().agent_handle;
        const result = this.skills.supersede(
          input.slug,
          input.superseded_by,
          this.identity.getDefaultActor(),
          input.version,
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
  }
}
