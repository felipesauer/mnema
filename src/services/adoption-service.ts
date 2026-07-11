import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { Config } from '../config/config-schema.js';
import { BUILT_IN_TASK_TEMPLATES, TASK_TEMPLATE_KINDS } from './task-template-service.js';

/**
 * Pieces of the project layout that adoption commands can install.
 *
 * Aligned with the `mnema adopt <component>` table in DESIGN.md §7.3.
 */
export type AdoptableComponent = 'skills' | 'memory' | 'roadmap' | 'commands' | 'templates';

/**
 * Per-component summary of what an adoption call did.
 */
export interface AdoptionResult {
  readonly component: AdoptableComponent;
  /** Absolute path of the directory installed or already present. */
  readonly path: string;
  /** Files actually written by this run (created, not pre-existing). */
  readonly created: readonly string[];
  /** Files left untouched because they already existed. */
  readonly skipped: readonly string[];
}

/**
 * Aggregate of a multi-component adoption run.
 */
export interface AdoptionSummary {
  readonly results: readonly AdoptionResult[];
}

/**
 * Installs optional pieces of the project layout (`skills/`, `memory/`,
 * `roadmap/`) on top of a `--minimal` init or any existing project.
 *
 * Idempotent by design: every adoption call walks the target tree and
 * only writes files that do not yet exist. Folders are created with
 * `recursive: true`; templates are dropped when no file with the same
 * name is already there. Re-running `adopt all` after files have been
 * customised never overwrites.
 */
export class AdoptionService {
  constructor(
    private readonly projectRoot: string,
    private readonly config: Config,
  ) {}

  /**
   * Installs a single component.
   *
   * @param component - Component to install
   * @returns Summary describing created vs skipped files
   */
  adopt(component: AdoptableComponent): AdoptionResult {
    switch (component) {
      case 'skills':
        return this.installSkills();
      case 'memory':
        return this.installMemory();
      case 'roadmap':
        return this.installRoadmap();
      case 'commands':
        return this.installCommands();
      case 'templates':
        return this.installTemplates();
    }
  }

  /**
   * Installs every component in turn. Each component is processed
   * independently; an idempotent run on a fully-adopted project
   * reports zero `created` files everywhere.
   *
   * @returns Per-component summaries
   */
  adoptAll(): AdoptionSummary {
    const components: AdoptableComponent[] = [
      'skills',
      'memory',
      'roadmap',
      'commands',
      'templates',
    ];
    return { results: components.map((c) => this.adopt(c)) };
  }

  private installSkills(): AdoptionResult {
    const dir = path.join(this.projectRoot, this.config.paths.skills);
    return this.writeTemplates(dir, 'skills', skillsTemplates());
  }

  private installMemory(): AdoptionResult {
    const dir = path.join(this.projectRoot, this.config.paths.memory);
    return this.writeTemplates(dir, 'memory', memoryTemplates());
  }

  private installRoadmap(): AdoptionResult {
    const dir = path.join(this.projectRoot, this.config.paths.roadmap);
    return this.writeTemplates(dir, 'roadmap', roadmapTemplates());
  }

  private installCommands(): AdoptionResult {
    const dir = path.join(this.projectRoot, this.config.paths.commands);
    return this.writeTemplates(dir, 'commands', commandsTemplates());
  }

  private installTemplates(): AdoptionResult {
    const dir = path.join(this.projectRoot, this.config.paths.templates);
    return this.writeTemplates(dir, 'templates', taskTemplateFiles());
  }

  private writeTemplates(
    dir: string,
    component: AdoptableComponent,
    templates: ReadonlyMap<string, string>,
  ): AdoptionResult {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const created: string[] = [];
    const skipped: string[] = [];
    for (const [relativePath, contents] of templates) {
      const target = path.join(dir, relativePath);
      const parent = path.dirname(target);
      if (!existsSync(parent)) {
        mkdirSync(parent, { recursive: true });
      }
      if (existsSync(target)) {
        skipped.push(target);
        continue;
      }
      writeFileSync(target, contents, 'utf-8');
      created.push(target);
    }
    // Mark sub-folders the user might want to leverage even if they
    // already exist with custom content. Only created when missing —
    // pre-existing folders are not touched.
    if (component === 'memory') {
      ensureDir(path.join(dir, 'decisions'));
      ensureDir(path.join(dir, 'notes'));
    }
    if (component === 'roadmap') {
      ensureDir(path.join(dir, 'epics'));
    }
    return { component, path: dir, created, skipped };
  }
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  // Drop a `.gitkeep` only if the folder is otherwise empty so the
  // directory survives a `git add .`.
  if (readdirSync(dir).length === 0) {
    writeFileSync(path.join(dir, '.gitkeep'), '', 'utf-8');
  }
}

function skillsTemplates(): Map<string, string> {
  return new Map([
    [
      'SKILL.md',
      [
        '# Skills',
        '',
        'Skills are reusable procedures the agent can follow when solving',
        'a recurring problem in this project. Add one Markdown file per',
        'skill, link them from this index when stable, and keep the',
        'individual skill bodies short — agents read everything that is',
        'referenced.',
        '',
        '## Available skills',
        '',
        '- [creating-tasks.md](creating-tasks.md)',
        '- [transitioning-tasks.md](transitioning-tasks.md)',
        '- [handling-blockers.md](handling-blockers.md)',
        '- [recording-decisions.md](recording-decisions.md)',
        '- [report-issue.md](report-issue.md)',
        '',
        '## Conventions',
        '',
        'Every skill ships with YAML frontmatter (`name`, `version`,',
        '`description`, `tools_used`) plus at least one `## Example`',
        'section. Run `mnema skill lint` before committing changes — it',
        'enforces those conventions and catches stale tool references.',
        '',
      ].join('\n'),
    ],
    [
      'creating-tasks.md',
      [
        '---',
        'name: creating-tasks',
        'version: 1.0.0',
        'description: Decompose a request into well-scoped tasks before writing code.',
        'tools_used:',
        '  - agent_run_start',
        '  - task_create',
        '  - task_submit',
        '---',
        '',
        '# Creating tasks',
        '',
        'Use this skill when the agent needs to decompose a user request into',
        'one or more tasks before any code change.',
        '',
        '## Steps',
        '',
        '1. Call `agent_run_start` if you have not already.',
        '2. For each unit of work, call `task_create` with a precise',
        '   title and description.',
        '3. When the task is fully scoped, transition it to the next state',
        '   with `task_submit` providing acceptance criteria and an estimate.',
        '',
        '## Example',
        '',
        'User: "Add Google sign-in to the web app."',
        '',
        '1. `agent_run_start({ goal: "scope Google sign-in" })`',
        '2. `task_create({ title: "Wire up OAuth callback" })`',
        '3. `task_submit({ task_key: "WEBAPP-1", title: "...", description: "...",',
        '   acceptance_criteria: ["redirect lands on /auth/callback"], estimate: 5 })`',
        '',
      ].join('\n'),
    ],
    [
      'transitioning-tasks.md',
      [
        '---',
        'name: transitioning-tasks',
        'version: 1.0.0',
        'description: Drive a task through the workflow with the appropriate transition tool.',
        'tools_used:',
        '  - task_show',
        '  - task_start',
        '  - task_submit_review',
        '  - task_approve',
        '---',
        '',
        '# Transitioning tasks',
        '',
        'Use this skill when an existing task needs to advance through the',
        'workflow. Pick the right transition tool by reading `task_show`',
        'first to confirm the current state.',
        '',
        '## Steps',
        '',
        '1. `task_show({ task_key })` — read the current state and `updated_at`.',
        '2. Pick the correct `task_<action>` tool for the move (`task_start`,',
        '   `task_submit_review`, `task_approve`, ...).',
        '3. Pass `expected_updated_at` to detect concurrent edits when',
        '   another agent or the human may have touched the task.',
        '',
        '## Example',
        '',
        '`task_submit_review({ task_key: "WEBAPP-1", pr_url: "https://github.com/x/y/pull/3" })`',
        '',
      ].join('\n'),
    ],
    [
      'handling-blockers.md',
      [
        '---',
        'name: handling-blockers',
        'version: 1.0.0',
        'description: Mark and resolve tasks that depend on someone else.',
        'tools_used:',
        '  - task_block',
        '  - task_unblock',
        '---',
        '',
        '# Handling blockers',
        '',
        'When work cannot proceed because of an external dependency, do',
        'not silently park the task — block it explicitly so the human',
        'sees it in `mnema inbox`.',
        '',
        '## Steps',
        '',
        '1. `task_block({ task_key, reason })` — provide a concrete reason',
        '   ("waiting for SSO credentials", not "blocked").',
        '2. When the blocker is resolved, `task_unblock({ task_key, note })`',
        '   so the audit log captures who unblocked and why.',
        '',
        '## Example',
        '',
        '`task_block({ task_key: "WEBAPP-7", reason: "missing AWS IAM access" })`',
        '',
      ].join('\n'),
    ],
    [
      'recording-decisions.md',
      [
        '---',
        'name: recording-decisions',
        'version: 1.0.0',
        'description: Capture architectural decisions as durable ADRs.',
        'tools_used:',
        '  - decision_record',
        '  - decision_show',
        '  - decisions_list',
        '---',
        '',
        '# Recording decisions',
        '',
        'When the agent makes a non-obvious architectural choice, capture',
        'it as an ADR so the next session does not relitigate it. Use the',
        '`decision_record` MCP tool — it stores the ADR in SQLite, indexes',
        'it for FTS, and routes the proposed status into the inbox so a',
        'human can accept or reject it.',
        '',
        '## Steps',
        '',
        '1. Call `decision_record({ title, decision, context?, rationale?, consequences? })`.',
        '2. The tool returns the new ADR with its key (e.g. `MYAPP-ADR-7`).',
        '3. Reference the key from related tasks or future decisions.',
        '',
        '## Example',
        '',
        '```',
        '# ADR-0007 — Use Zod for runtime validation',
        '',
        '## Context',
        'The project needs runtime validation for both config and user input.',
        '',
        '## Decision',
        'Adopt Zod 4. ',
        '',
        '## Consequences',
        'Positive: type-safe, single source of truth.',
        'Negative: bundle size grows by ~50KB.',
        '```',
        '',
      ].join('\n'),
    ],
    [
      'report-issue.md',
      [
        '---',
        'name: report-issue',
        'version: 1.0.0',
        'description: Assemble a sanitized bug report from the local error log and doctor; the human opens the issue.',
        'tools_used:',
        '  - audit_verify',
        '---',
        '',
        '# Report an issue',
        '',
        'Use this when the user hit a crash or unexpected behaviour and wants',
        'to report it. Turn what the machine already recorded into a clean,',
        'sanitized bug report instead of the user hand-copying stack traces.',
        '',
        'An unhandled crash is appended to a LOCAL, never-transmitted error log',
        'at `.mnema/state/errors.jsonl` (zero-telemetry — it stays on the',
        'machine). Each line is JSON: `{ at, message, stack, mnema_version,',
        'node_version, argv }`. Expected errors (gate failed, conflict) are NOT',
        'there — only genuine crashes.',
        '',
        '## Steps',
        '',
        '1. Read the most recent crash from `.mnema/state/errors.jsonl`. If the',
        '   file is absent, the crash predates this or happened outside a',
        '   project — ask the user to re-run with `MNEMA_DEBUG=1` and paste the',
        '   stack.',
        '2. SANITIZE before showing anything: home directory to `~`, any other',
        '   absolute path down to its basename, `KEY=value` where the key looks',
        '   secret-shaped to `KEY=<redacted>`, and long opaque tokens to',
        '   `<redacted>`.',
        '3. Gather environment: `mnema --version` and the log entry’s',
        '   `node_version`; a sanitized `mnema doctor` summary.',
        '4. Fill `.github/ISSUE_TEMPLATE/bug_report.md` — Version, Steps to',
        '   reproduce (ask the user; the log has `argv`, not intent), Expected',
        '   vs actual (the sanitized message/stack).',
        '5. Show the assembled report and open it with `gh issue create` ONLY',
        '   after explicit confirmation — never file automatically.',
        '',
        '## Example',
        '',
        'User: "Mnema crashed when I ran sync." Read the last `errors.jsonl`',
        'entry, redact its stack, and draft the bug report for the user to',
        'review before `gh issue create`.',
        '',
      ].join('\n'),
    ],
  ]);
}

function memoryTemplates(): Map<string, string> {
  return new Map([
    [
      'INDEX.md',
      [
        '# Memory index',
        '',
        'This file is loaded by every agent at session start. List the',
        'most important context the agent should know about — keep it',
        'short, link out for detail.',
        '',
        '## Project context',
        '',
        '- See `context.md` for a longer description of the project.',
        '- See `decisions/INDEX.md` for accepted ADRs.',
        '',
      ].join('\n'),
    ],
    [
      'context.md',
      [
        '# Project context',
        '',
        '_Free-form description of the project, its current goals and',
        'anything an agent should know before touching code._',
        '',
      ].join('\n'),
    ],
    [
      path.join('decisions', 'INDEX.md'),
      [
        '# Decisions (ADRs)',
        '',
        'Architecture decisions for this project. Record new ones with',
        '`mnema decision record` (Phase 7+); link them from this index',
        'after they are accepted.',
        '',
      ].join('\n'),
    ],
    [
      path.join('notes', 'INDEX.md'),
      [
        '# Notes',
        '',
        'Free-form notes attached to specific tasks live alongside their',
        'task; broader notes that span more than one task can be added',
        'as standalone files in this folder.',
        '',
      ].join('\n'),
    ],
  ]);
}

function roadmapTemplates(): Map<string, string> {
  return new Map([
    [
      'README.md',
      [
        '# Roadmap',
        '',
        'High-level objectives that span more than one sprint. Drop one',
        'file per quarter or theme, e.g. `2026-Q2.md`. Use the `epics/`',
        'subfolder for grouped task collections.',
        '',
      ].join('\n'),
    ],
  ]);
}

/**
 * The seed slash commands planted at init (and by `mnema adopt commands`).
 * Each is a `.md` whose frontmatter declares a `description` and an ordered
 * `steps` list of read-only `mnema` invocations (written without the leading
 * `mnema`), matching {@link CommandDefinitionService}. They exist so the
 * `.mnema/commands/` folder is not born empty — the shortcut that makes the
 * tool get used ships with the install. Commands are pure files (no SQLite
 * row), so unlike skills they need no import step.
 */
function commandsTemplates(): Map<string, string> {
  return new Map([
    [
      'INDEX.md',
      [
        '# Commands',
        '',
        'Slash commands bundle a repeatable read-only flow behind one name,',
        'committed with the project so the whole team shares it. Each command',
        'is a `<name>.md` with `description` + `steps` frontmatter; the body is',
        'notes for humans. List them with `mnema commands list`, inspect one',
        'with `mnema command show <name>`.',
        '',
        '- [standup.md](standup.md)',
        '- [close.md](close.md)',
        '- [audit.md](audit.md)',
        '',
      ].join('\n'),
    ],
    [
      'standup.md',
      [
        '---',
        'description: What is on your plate — active focus, your inbox, and what happened today.',
        'steps:',
        '  - context_bootstrap',
        '  - inbox',
        '  - history --since=today',
        '---',
        '',
        '# /standup',
        '',
        'Run at the start of a session to reorient: the bootstrap gives the',
        'active focus and next action, the inbox shows what waits on you, and',
        "today's history recaps recent movement. All read-only.",
        '',
      ].join('\n'),
    ],
    [
      'close.md',
      [
        '---',
        'description: Review a task before closing it — its evidence and current state.',
        'steps:',
        '  - task show',
        '  - task evidence',
        '---',
        '',
        '# /close',
        '',
        'Before moving a task to done, confirm it carries the evidence that',
        'proves each acceptance criterion. Pass the task key to each step,',
        'e.g. `mnema task show WEBAPP-4`. Then approve it with a note via',
        '`mnema task move <key> approve --field approval_note="..."`.',
        '',
      ].join('\n'),
    ],
    [
      'audit.md',
      [
        '---',
        'description: Audit the current change — commits with no task, and the audit-chain integrity.',
        'steps:',
        '  - drift',
        '  - audit verify',
        '---',
        '',
        '# /audit',
        '',
        'Check that the work is on the rails: `drift` lists commits on this',
        'branch not tied to any task, and `audit verify` confirms the',
        'hash-chained log is intact. Both read-only.',
        '',
      ].join('\n'),
    ],
  ]);
}

/**
 * Renders the built-in task templates (bug/feature/refactor/chore) to
 * overridable `.md` files, so `templates/` is populated and a project can
 * edit any kind in place. The SAME built-in skeletons drive both these
 * files and `task_create`'s pre-fill fallback — single source. Each file's
 * frontmatter carries `description` + `acceptance_criteria`, exactly what
 * TaskTemplateService.forKind reads back as an override.
 */
function taskTemplateFiles(): Map<string, string> {
  const entries: [string, string][] = TASK_TEMPLATE_KINDS.map((kind) => {
    const t = BUILT_IN_TASK_TEMPLATES[kind];
    const lines = [
      '---',
      'description: |',
      ...t.description.split('\n').map((l) => `  ${l}`),
      'acceptance_criteria:',
      ...t.acceptanceCriteria.map((c) => `  - ${c}`),
      '---',
      '',
      `# ${kind} template`,
      '',
      `Edit this file to change the ${kind} skeleton \`task_create --template ${kind}\` uses.`,
      '',
    ];
    return [`${kind}.md`, lines.join('\n')];
  });
  return new Map(entries);
}
