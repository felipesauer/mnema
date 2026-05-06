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
        '',
      ].join('\n'),
    ],
    [
      'creating-tasks.md',
      [
        '# Creating tasks',
        '',
        'Use this skill when the agent needs to decompose a request into',
        'one or more tasks before any code change.',
        '',
        '## Steps',
        '',
        '1. Call `agent_run_start` if you have not already.',
        '2. For each unit of work, call `task_create` with a precise',
        '   title and description.',
        '3. When the task is fully scoped, transition it to READY with',
        '   `task_submit` providing acceptance criteria and an estimate.',
        '4. Record the rationale of any non-obvious choice with',
        '   `decision_record` once that tool exists (Phase 7+).',
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
