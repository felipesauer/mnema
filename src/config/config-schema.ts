import { z } from 'zod';

/**
 * Zod schema for `mnema.config.json`.
 *
 * Mirrors the configuration contract documented in DESIGN.md §4.1.
 * All optional sections expose sensible defaults so a minimal config
 * (project + version) is enough to bootstrap a project.
 */
export const ConfigSchema = z.object({
  version: z.literal('1.0'),
  mnema_version: z.string(),
  project: z.object({
    key: z.string().regex(/^[A-Z][A-Z0-9]{1,9}$/),
    name: z.string().min(1),
    description: z.string().optional(),
  }),
  paths: z
    .object({
      // Every Mnema-managed artefact lives under `.mnema/` by default
      // so `mnema init` does not pollute the project root with eight
      // top-level entries. Users who want a different layout (e.g.
      // visible `backlog/` for GitHub) override individual entries.
      state: z.string().default('.mnema/state'),
      audit: z.string().default('.mnema/audit'),
      backlog: z.string().default('.mnema/backlog'),
      sprints: z.string().default('.mnema/sprints'),
      roadmap: z.string().default('.mnema/roadmap'),
      memory: z.string().default('.mnema/memory'),
      skills: z.string().default('.mnema/skills'),
      workflows: z.string().default('.mnema/workflows'),
    })
    .prefault({}),
  workflow: z.string().default('default'),
  // `multi` is reserved for a future multi-project layout that has
  // not been designed yet. The schema only accepts `single` so users
  // don't quietly configure a value that does nothing.
  mode: z.literal('single').default('single'),
  audit_strategy: z.enum(['full', 'recent', 'local']).default('recent'),
  audit_retention_months: z.number().int().positive().default(12),
  // `strict` holds agents to the workflow gate (a failed gate blocks an
  // agent mutation) while letting a human override — the default because
  // it preserves the protection that matters without locking humans out.
  // `blocking` blocks everyone; `advisory` only warns.
  enforcement_mode: z.enum(['advisory', 'strict', 'blocking']).default('strict'),
  sync: z
    .object({
      mode: z.enum(['hybrid', 'push', 'buffer']).default('hybrid'),
      agent_buffer_flush_seconds: z.number().int().positive().default(30),
      agent_buffer_flush_count: z.number().int().positive().default(50),
      agent_buffer_flush_on_plan_complete: z.boolean().default(true),
    })
    .prefault({}),
  features: z
    .object({
      fts_search: z.boolean().default(true),
      attachments: z.boolean().default(true),
    })
    .prefault({}),
});

/**
 * Validated configuration object derived from the Zod schema.
 */
export type Config = z.infer<typeof ConfigSchema>;
