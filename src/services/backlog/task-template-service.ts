import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { parseFrontmatter } from '../../storage/markdown/frontmatter.js';

/** The kinds of task a template exists for. */
export type TaskTemplateKind = 'bug' | 'feature' | 'refactor' | 'chore';

/** The pre-fill a template offers: a description skeleton + criteria skeleton. */
export interface TaskTemplate {
  readonly description: string;
  readonly acceptanceCriteria: readonly string[];
}

/** Every kind a template is available for — the valid `template` values. */
export const TASK_TEMPLATE_KINDS: readonly TaskTemplateKind[] = [
  'bug',
  'feature',
  'refactor',
  'chore',
];

/**
 * Built-in skeletons per kind. Deliberately terse prompts, not prose — a
 * mould the agent fills, so the backlog reads consistently without forcing
 * anyone to invent structure. Overridable per project (see below).
 */
export const BUILT_IN_TASK_TEMPLATES: Readonly<Record<TaskTemplateKind, TaskTemplate>> = {
  bug: {
    description:
      '## What is wrong\n<observed behaviour>\n\n## Expected\n<what should happen>\n\n## Repro\n1. <step>\n\n## Cause / fix\n<root cause once known>',
    acceptanceCriteria: [
      'the reported behaviour no longer reproduces',
      'a regression test fails before the fix and passes after',
    ],
  },
  feature: {
    description:
      '## Goal\n<what this enables and for whom>\n\n## Approach\n<how, at a high level>\n\n## Out of scope\n<what this deliberately does not do>',
    acceptanceCriteria: [
      'the feature works end-to-end for the primary case',
      'covered by a test',
      'documented where a user would look',
    ],
  },
  refactor: {
    description:
      '## Motivation\n<why the current shape hurts>\n\n## Change\n<what moves/changes>\n\n## Invariants\n<behaviour that must stay identical>',
    acceptanceCriteria: [
      'external behaviour is unchanged',
      'the existing test suite still passes with no new gaps',
    ],
  },
  chore: {
    description: '## Task\n<the housekeeping to do>\n\n## Why now\n<what prompted it>',
    acceptanceCriteria: ['the chore is done and verified'],
  },
};

/**
 * Supplies task templates by kind (bug/feature/refactor/chore), so
 * `task_create` can pre-fill a consistent description + acceptance-criteria
 * skeleton instead of every agent inventing its own shape.
 *
 * Templates are **content, not hard-coded**: the built-in skeletons are the
 * default, but a project can override any kind by dropping a
 * `<kind>.md` in `templates/` whose frontmatter carries `description`
 * and/or `acceptance_criteria`. A missing file falls back to the built-in;
 * a malformed one is ignored (fall back), never fatal. Read-only.
 */
export class TaskTemplateService {
  constructor(private readonly templatesDir: string) {}

  /**
   * The template for `kind` — the project's `templates/<kind>.md` override
   * merged over the built-in default (each field overridden only when the
   * file supplies it).
   *
   * @param kind - The task kind
   * @returns The resolved {@link TaskTemplate}
   */
  forKind(kind: TaskTemplateKind): TaskTemplate {
    const builtIn = BUILT_IN_TASK_TEMPLATES[kind];
    const file = path.join(this.templatesDir, `${kind}.md`);
    if (!existsSync(file)) return builtIn;
    try {
      const parsed = parseFrontmatter(readFileSync(file, 'utf-8'));
      const data = parsed.data as Record<string, unknown>;
      const description =
        typeof data.description === 'string' && data.description.length > 0
          ? data.description
          : builtIn.description;
      const acceptanceCriteria =
        Array.isArray(data.acceptance_criteria) &&
        data.acceptance_criteria.every((c): c is string => typeof c === 'string')
          ? (data.acceptance_criteria as string[])
          : builtIn.acceptanceCriteria;
      return { description, acceptanceCriteria };
    } catch {
      return builtIn; // malformed override — fall back to the built-in
    }
  }
}
