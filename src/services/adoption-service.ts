import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { Config } from '../config/config-schema.js';

/**
 * Pieces of the project layout that adoption commands can install.
 *
 * Aligned with the `mnema adopt <component>` table in DESIGN.md §7.3.
 */
export type AdoptableComponent = 'skills' | 'memory' | 'roadmap';

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
    const components: AdoptableComponent[] = ['skills', 'memory', 'roadmap'];
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
