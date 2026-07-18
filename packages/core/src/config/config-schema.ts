import { z } from 'zod';

import { isSafeAnchorRemote } from '../utils/anchor-remote.js';

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
    on_sprint_canceled: z.array(HookCommandSchema).default([]),
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
/**
 * The config-shape version: the single point of truth for the `version` field.
 * It is one input to the store-format hash and the hook for config
 * upgrade-scripts. Bumping it is a deliberate config-shape change.
 */
export const CONFIG_VERSION = '2.0';

export const ConfigSchema = z.object({
  version: z.literal(CONFIG_VERSION),
  mnema_version: z.string(),
  project: z.object({
    key: z.string().regex(/^[A-Z][A-Z0-9]{1,9}$/),
    name: z.string().min(1),
    description: z.string().optional(),
  }),
  // Which observable signal marks an agent run as "guided" in `eval_report`.
  // `skill_used`: the run emitted a skill_used event. `bootstrap`: the run was
  // opened after context_bootstrap ran (a bootstrap-guided solo run that
  // leaves no skill trace). `either` (default): guided when EITHER holds.
  eval: z
    .object({
      guided_proxy: z.enum(['skill_used', 'bootstrap', 'either']).default('either'),
    })
    .prefault({}),
  // Machine attestation: the chain head is signed with the
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
      // Retention policy for the audit chain — the knobs `mnema audit
      // prune` and doctor's retention check read. `full` keeps everything
      // hot; `recent` keeps the last `months` hot and archives the rest;
      // `local` prunes the local copy behind a signed re-baseline (the
      // committed chain in git remains the durable history).
      retention: z
        .object({
          strategy: z.enum(['full', 'recent', 'local']).default('recent'),
          months: z.number().int().positive().default(12),
        })
        .prefault({}),
      // Temporal anchoring: pluggable, OPT-IN, default `none`. A real provider
      // stamps the signed head into an external, independently-verifiable
      // timestamp OFF the write path, fail-open. Per-provider options are
      // validated below: git-signed may name a `remote`/`ref`.
      anchor: z
        .object({
          provider: z.enum(['none', 'git-signed']).default('none'),
          // How often the scheduler anchors the head. Either bound may be
          // set; when neither is given the anchor cadence follows the
          // checkpoint interval (resolved by the scheduler).
          interval: z
            .object({
              events: z.number().int().positive().optional(),
              seconds: z.number().int().positive().optional(),
            })
            .prefault({}),
          // git-signed: optional remote + ref to push the anchor commit to
          // (local-only when omitted).
          //
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
        .prefault({}),
    })
    .prefault({}),
  // `strict` holds agents to the workflow gate (a failed gate blocks an
  // agent mutation) while letting a human override — the default because
  // it preserves the protection that matters without locking humans out.
  // `blocking` blocks everyone; `advisory` only warns.
  enforcement_mode: z.enum(['advisory', 'strict', 'blocking']).default('strict'),
  // Per-gate-field severity, layered on top of `enforcement_mode`.
  // Maps a required gate FIELD name to how a *failure of that
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
      agent_buffer_flush_seconds: z.number().int().positive().default(30),
      agent_buffer_flush_count: z.number().int().positive().default(50),
    })
    .prefault({}),
  features: z
    .object({
      // Gates the knowledge surface (decisions/skills/memories/observations
      // and the provenance chain that links them) as MCP tools. Off in the
      // audit-only profile, where the point is a small core of audit + task
      // + run tools. The underlying stores still work if re-enabled — this
      // only controls what the agent sees.
      knowledge: z.boolean().default(true),
      // Opt-in npm update check. Default OFF: Mnema is offline /
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
  // Terminal-mirror archival. DONE/CANCELED tasks keep a live SQLite row (the
  // source of truth) and their `.md` mirror is never deleted, so a committed
  // backlog accumulates every finished task forever. `mnema archive` (and
  // `mnema doctor --archive-terminal`) is an OPT-IN step that MOVES — never
  // deletes — the mirrors of terminal tasks older than the cutoff into
  // `backlog/.archive/<STATE>/`, out of the active state folders. The dot-prefix
  // is deliberate: every backlog scanner skips it, so an archived mirror is
  // inert across `sync` and `doctor --prune-orphans` and the row stays intact.
  archive: z
    .object({
      terminal_after_months: z.number().int().positive().default(6),
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
  // Git-observer settings. `watch` turns on the opt-in
  // git-observing mode of `mnema watch` persistently (same as passing
  // `--git`): while watching, the unambiguous in-progress task is linked to
  // the current branch + commits, read-only, never touching `.git`. Off by
  // default — a passive-ledger user is never surprised by git ingestion.
  git: z
    .object({
      watch: z.boolean().default(false),
      // Root-level files mnema regenerates that should ride along in the
      // trail commit (which otherwise touches only `.mnema`) WHEN already
      // staged — the trail commit never `git add`s them, so a user's working
      // tree is left untouched. AGENTS.md is the one file with recurring,
      // mnema-authored churn; .gitignore/.gitattributes are deliberately left
      // out so a human's edits there are never folded in. Entries must be
      // exact individual repo-root file paths (matched verbatim), not globs or
      // directories — a directory would not be recognised and would fall to
      // the code bucket.
      trail_extra_paths: z.array(z.string()).default(['AGENTS.md']),
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
 * Keys the per-repo local override (`.mnema/config.local.json`) may NOT
 * set: project identity/version are intrinsic to a project, and a hooks
 * block must live in the committed, human-approved project config.
 */
export const PROJECT_ONLY_KEYS = ['version', 'mnema_version', 'project', 'hooks'] as const;

/** Defaults materialised from the schema itself — the shape's ground truth. */
const SCHEMA_DEFAULTS: Record<string, unknown> = ConfigSchema.parse({
  version: CONFIG_VERSION,
  mnema_version: '0.0.0',
  project: { key: 'XX', name: 'shape-probe' },
});

/**
 * The behaviour keys a local override may set — DERIVED from the schema
 * shape (every top-level key minus {@link PROJECT_ONLY_KEYS}), so the
 * override surface can never drift from the config it overrides.
 */
export const BEHAVIOUR_KEYS: readonly string[] = Object.keys(ConfigSchema.shape).filter(
  (key) => !(PROJECT_ONLY_KEYS as readonly string[]).includes(key),
);

/**
 * Top-level keys whose values deep-merge instead of replacing wholesale —
 * DERIVED from the shape by the rule "every top-level object block
 * deep-merges": a key is mergeable exactly when its schema default is a
 * plain object. No hand-maintained list to forget a new block in.
 */
export const DEEP_MERGE_KEYS: readonly string[] = BEHAVIOUR_KEYS.filter((key) => {
  const value = SCHEMA_DEFAULTS[key];
  return typeof value === 'object' && value !== null && !Array.isArray(value);
});
