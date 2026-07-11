import path from 'node:path';

import { z } from 'zod';

import { isSafeAnchorRemote } from '../services/anchor/git-signed-anchor-provider.js';

/**
 * A path entry under `paths.*`. Every Mnema artefact directory is
 * resolved relative to the project root, so an entry with a `..` segment
 * or an absolute path could steer writes outside the project — a lever a
 * cloned repo's config should not have. Reject both; a leading `./` and
 * nested-but-contained relative paths stay valid.
 *
 * @param defaultValue - The default directory (already project-relative)
 */
function relativePathField(defaultValue: string) {
  return z
    .string()
    .default(defaultValue)
    .refine((p) => !path.isAbsolute(p) && !p.split(/[/\\]/).includes('..'), {
      message: 'must be a project-relative path without ".." segments',
    });
}

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
      state: relativePathField('.mnema/state'),
      audit: relativePathField('.mnema/audit'),
      backlog: relativePathField('.mnema/backlog'),
      sprints: relativePathField('.mnema/sprints'),
      roadmap: relativePathField('.mnema/roadmap'),
      memory: relativePathField('.mnema/memory'),
      observations: relativePathField('.mnema/observations'),
      skills: relativePathField('.mnema/skills'),
      commands: relativePathField('.mnema/commands'),
      templates: relativePathField('.mnema/templates'),
      workflows: relativePathField('.mnema/workflows'),
    })
    .prefault({}),
  workflow: z.string().default('default'),
  // `multi` is reserved for a future multi-project layout that has
  // not been designed yet. The schema only accepts `single` so users
  // don't quietly configure a value that does nothing.
  mode: z.literal('single').default('single'),
  audit_strategy: z.enum(['full', 'recent', 'local']).default('recent'),
  audit_retention_months: z.number().int().positive().default(12),
  // Machine attestation (ADR-37 layer 2): the chain head is signed with the
  // per-machine Ed25519 key at a checkpoint interval — NOT every event, to
  // spare the write hot path and cold-start. A checkpoint fires when EITHER
  // `events` new events have accrued since the last signature OR `seconds`
  // have elapsed, whichever comes first.
  audit: z
    .object({
      checkpoint: z
        .object({
          events: z.number().int().positive().default(100),
          seconds: z.number().int().positive().default(3600),
        })
        .prefault({}),
      // Temporal anchoring (ADR-37 layer 3): pluggable, OPT-IN, default
      // `none`. A real provider stamps the signed head into an external,
      // independently-verifiable timestamp OFF the write path, fail-open.
      // Per-provider options are validated below: rfc3161 requires a `tsa`
      // URL; git-signed may name a `remote`/`ref`.
      anchor: z
        .object({
          provider: z.enum(['none', 'git-signed', 'opentimestamps', 'rfc3161']).default('none'),
          // How often the scheduler anchors the head. Either bound may be
          // set; when neither is given the anchor cadence follows the
          // checkpoint interval (resolved by the scheduler, MNEMA-160).
          interval: z
            .object({
              events: z.number().int().positive().optional(),
              seconds: z.number().int().positive().optional(),
            })
            .prefault({}),
          // rfc3161: the Time-Stamp Authority endpoint (required for that
          // provider). git-signed: optional remote + ref to push the anchor
          // commit to (local-only when omitted).
          //
          // `tsa` is constrained to https:// — `z.url()` alone accepts
          // file://, http://localhost, and cloud-metadata IPs, which would be
          // an SSRF / local-file vector once a provider fetches it. The repo
          // config is agent-writable, so lock the scheme at the schema layer
          // BEFORE the rfc3161 provider ships and starts dereferencing it.
          tsa: z
            .url()
            .refine((u) => u.startsWith('https://'), {
              message: 'audit.anchor.tsa must be an https:// URL',
            })
            .optional(),
          // `remote` is fed to `git push`. Left unconstrained, a value like
          // `ext::sh -c '<payload>'` executes an arbitrary command via git's
          // remote-helper transports — command execution from a repo-writable
          // config. Lock it to a plain remote name or a safe transport URL at
          // the schema layer (fail closed at load), mirroring the git-signed
          // provider's own guard so a bad value can never reach `git push`.
          remote: z
            .string()
            .min(1)
            .refine(isSafeAnchorRemote, {
              message:
                'audit.anchor.remote must be a remote name or an https/ssh/git/file URL (a remote-helper transport like "ext::" is refused)',
            })
            .optional(),
          ref: z.string().min(1).optional(),
        })
        .prefault({})
        .check((ctx) => {
          if (ctx.value.provider === 'rfc3161' && ctx.value.tsa === undefined) {
            ctx.issues.push({
              code: 'custom',
              input: ctx.value,
              path: ['tsa'],
              message: 'audit.anchor.tsa (a TSA URL) is required when provider is "rfc3161"',
            });
          }
        }),
    })
    .prefault({}),
  // `strict` holds agents to the workflow gate (a failed gate blocks an
  // agent mutation) while letting a human override — the default because
  // it preserves the protection that matters without locking humans out.
  // `blocking` blocks everyone; `advisory` only warns.
  enforcement_mode: z.enum(['advisory', 'strict', 'blocking']).default('strict'),
  // Per-gate-field severity, layered on top of `enforcement_mode` (see
  // MNEMA-ADR-48). Maps a required gate FIELD name to how a *failure of that
  // field* is treated: `block` always refuses, `warn` lets the transition
  // proceed with an advisory, `off` ignores the field entirely. A transition
  // blocks iff at least one failing field resolves to `block`; absent fields
  // fall back to the global `enforcement_mode` for the acting actor. Lets a
  // ceremony gate (e.g. `estimate`) be warn-only while a safety gate
  // (`approval_note`, `pr_url`) stays blocking on the same transition. Empty
  // (the default) reproduces the pure global behaviour exactly.
  enforcement_field_severity: z.record(z.string(), z.enum(['off', 'warn', 'block'])).prefault({}),
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
      // Gates the knowledge surface (decisions/skills/memories/observations
      // and the provenance chain that links them) as MCP tools. Off in the
      // audit-only profile, where the point is a small core of audit + task
      // + run tools. The underlying stores still work if re-enabled — this
      // only controls what the agent sees.
      knowledge: z.boolean().default(true),
      // Opt-in npm update check (ADR-40). Default OFF: Mnema is offline /
      // zero-telemetry by default, and a registry check is an outbound
      // request. When true, `mnema doctor` compares the installed version
      // against the latest published one and surfaces a hint (fail-open,
      // cached). `mnema update check` works on demand regardless of this
      // flag. No usage data is ever transmitted.
      update_check: z.boolean().default(false),
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
  // A task_claim reserves a task for an actor BEFORE work starts, closing
  // the window optimistic concurrency (updated_at CAS on transition) only
  // catches after the fact: two sessions reading the same READY task can
  // each decide "I'll take this" before either writes. The lease expires on
  // its own — a session that dies without releasing (crash, killed
  // subagent, dropped MCP connection) does not leave the task claimed
  // forever, mirroring how aging.orphan_run_after_hours self-heals a run
  // left running with no agent_run_end.
  claims: z
    .object({
      lease_minutes: z.number().int().positive().default(30),
      // When true, the transition that picks a task up for work (the
      // workflow's `start` action, e.g. READY → IN_PROGRESS) requires the
      // acting actor to already hold a live, non-expired claim on the task
      // — refused with TASK_NOT_CLAIMED otherwise. Default OFF so a
      // single-agent flow keeps starting work without a prior claim; turn
      // it on for a team where two sessions might both pick up the same
      // ready task and you want the claim to be the gate, not a convention.
      require_to_start: z.boolean().default(false),
    })
    .prefault({}),
  // GitHub integration policy for the terminal (DONE) transition. When a
  // `pr_url` is supplied on a terminal transition (approve, or any other
  // transition into DONE), `done_pr_policy` decides what to do if that PR
  // is not merged or its CI is red:
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
        knowledge: z.boolean().optional(),
        update_check: z.boolean().optional(),
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
    claims: z
      .object({
        lease_minutes: z.number().int().positive().optional(),
        require_to_start: z.boolean().optional(),
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
