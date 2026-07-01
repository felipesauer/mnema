import { z } from 'zod';

/**
 * A single domain-event hook: an argv pair spawned WITHOUT a shell.
 * `command` is the executable; `args` are passed verbatim as separate
 * argv entries, so a value like `$(id -un)` is a literal string, never
 * expanded — this removes shell-metacharacter injection at the type level.
 *
 * A bare string (the pre-argv format, e.g. `"./notify.sh"`) is rejected
 * with an actionable message rather than an opaque "expected object": the
 * shell form is intentionally no longer accepted, and the message tells
 * the user the new shape.
 */
export const HookCommandSchema = z.preprocess(
  (value, ctx) => {
    if (typeof value === 'string') {
      ctx.addIssue({
        code: 'custom',
        message: `hooks are now { "command": "...", "args": [...] } and run without a shell; rewrite "${value}" as { "command": "${value}", "args": [] }`,
      });
      return z.NEVER;
    }
    return value;
  },
  z.object({
    command: z.string().min(1),
    args: z.array(z.string()).default([]),
  }),
);

/** A parsed, validated hook. */
export type HookCommand = z.infer<typeof HookCommandSchema>;

/**
 * The `hooks` block: one ordered list of {@link HookCommandSchema} per
 * curated domain event. Only the project {@link ConfigSchema} carries
 * hooks; the user-level config does not (a hooks block must be approved
 * in-project, so there is no global-origin hook path today).
 */
export const HooksSchema = z
  .object({
    on_task_done: z.array(HookCommandSchema).default([]),
    on_task_transitioned: z.array(HookCommandSchema).default([]),
    on_decision_accepted: z.array(HookCommandSchema).default([]),
    on_sprint_closed: z.array(HookCommandSchema).default([]),
    on_epic_closed: z.array(HookCommandSchema).default([]),
  })
  .prefault({});

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
      commands: z.string().default('.mnema/commands'),
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
  // Aging surfaces tasks that have sat in a non-terminal state for too
  // long — the IN_REVIEW limbo where a transition waits on a human that
  // never comes. `context_bootstrap` reports anything older than
  // `stale_after_days` so the backlog rot is visible on session start.
  aging: z
    .object({
      stale_after_days: z.number().int().positive().default(3),
      // A run that started and never ended past this many hours is treated
      // as orphaned (a dropped session that left it open). `mnema doctor`
      // surfaces these and `mnema agent close-orphans` can abort them.
      orphan_run_after_hours: z.number().int().positive().default(24),
      // Per-state review SLA in days. A non-terminal task sitting in one
      // of these states past its threshold is an SLA breach the inbox
      // and context_bootstrap surface actively. A state without an entry
      // falls back to `stale_after_days`. Keys are workflow state names
      // (e.g. IN_REVIEW, BLOCKED).
      sla_days: z.record(z.string(), z.number().int().positive()).default({}),
      // Per-state work-in-progress limit. A state holding more active
      // tasks than its limit is a WIP breach the inbox and
      // context_bootstrap surface. Keys are workflow state names; a state
      // without an entry is uncapped.
      wip_limits: z.record(z.string(), z.number().int().positive()).default({}),
    })
    .prefault({}),
  // GitHub integration policy for the terminal (DONE) transition. When a
  // `pr_url` is supplied on approve, `done_pr_policy` decides what to do
  // if that PR is not merged or its CI is red:
  //   - `off`   (default): never check — fully opt-in, zero network.
  //   - `warn`  : check and attach a `pr_warning`, but allow the move.
  //   - `block` : refuse the transition with PR_NOT_READY.
  // Unreachable GitHub (no gh / offline / unauth) never blocks — a status
  // that can't be resolved is treated as "can't prove a problem".
  github: z
    .object({
      done_pr_policy: z.enum(['off', 'warn', 'block']).default('off'),
    })
    .prefault({}),
  // Hooks run a command when a curated domain event fires (a task
  // reaching done, a decision accepted, …). Each key is a domain-event
  // name; the value is the list of hooks to run, in order. A hook is an
  // argv pair — `{ command, args }` — spawned WITHOUT a shell, so shell
  // metacharacters (`$(…)`, `|`, `;`, `&&`) are inert data, never
  // interpreted. The audit event is delivered as JSON on the command's
  // stdin and each firing writes its own `hook_ran` audit event — a hook
  // is part of the trail, never a phantom side effect.
  //
  // Because this config file lives inside the repo and is writable by the
  // very agents mnema keeps accountable, a configured hook block is inert
  // until a human approves it via `mnema hooks approve`; editing the block
  // afterwards revokes the approval. This closes the agent-writable-config
  // command-execution vector. Defaults to no hooks.
  hooks: HooksSchema,
});

/**
 * Validated configuration object derived from the Zod schema.
 */
export type Config = z.infer<typeof ConfigSchema>;

/**
 * Schema for the optional user-level config (`~/.config/mnema/config.json`).
 *
 * It carries only *behaviour preferences* — never project identity
 * (`project`, `version`, `mnema_version`), layout (`paths`) or the active
 * `workflow`, which are intrinsic to a project and must not leak across
 * them. Every field is optional: the file is a partial set of defaults
 * that a project config overrides key-by-key. `.strict()` rejects an
 * unknown or disallowed key (e.g. a stray `project`) so a mistake is a
 * loud error, not a silent global override.
 */
export const UserConfigSchema = z
  .object({
    audit_strategy: z.enum(['full', 'recent', 'local']).optional(),
    audit_retention_months: z.number().int().positive().optional(),
    enforcement_mode: z.enum(['advisory', 'strict', 'blocking']).optional(),
    sync: z
      .object({
        mode: z.enum(['hybrid', 'push', 'buffer']).optional(),
        agent_buffer_flush_seconds: z.number().int().positive().optional(),
        agent_buffer_flush_count: z.number().int().positive().optional(),
        agent_buffer_flush_on_plan_complete: z.boolean().optional(),
      })
      .strict()
      .optional(),
    features: z
      .object({
        fts_search: z.boolean().optional(),
        attachments: z.boolean().optional(),
      })
      .strict()
      .optional(),
    aging: z
      .object({
        stale_after_days: z.number().int().positive().optional(),
        orphan_run_after_hours: z.number().int().positive().optional(),
        sla_days: z.record(z.string(), z.number().int().positive()).optional(),
        wip_limits: z.record(z.string(), z.number().int().positive()).optional(),
      })
      .strict()
      .optional(),
    github: z
      .object({
        done_pr_policy: z.enum(['off', 'warn', 'block']).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

/**
 * Validated user-level config — a partial set of behaviour defaults.
 */
export type UserConfig = z.infer<typeof UserConfigSchema>;
