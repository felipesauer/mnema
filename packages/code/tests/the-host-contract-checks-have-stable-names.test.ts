// @reads-the-tree
/**
 * THE HOST CONTRACT'S CHECKS HAVE NAMES THAT DO NOT MOVE.
 *
 * The seven jobs of `host-contract.yml` are required checks of `main`, and a required check is
 * matched by its name. A name that carried the pinned version of the host
 * (`host contract (codex 0.161.0)`) would stop every merge the day the pin is raised, because the
 * check the branch waits for would no longer be published. So on a pull request and on a push
 * the name is the host alone; the weekly and the manual run, whose checks nobody requires,
 * append the version they were given (`stable`, `latest`), which is the only way to tell two of
 * them apart.
 *
 * This reads the workflow and fails on a name that is not exactly the host plus that one suffix,
 * and on a job that appears or goes missing without the list below being changed with it.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const WORKFLOW = readFileSync(
  fileURLToPath(new URL('../../../.github/workflows/host-contract.yml', import.meta.url)),
  'utf-8',
);

/** The one thing a name may add, and only for the runs whose checks are not required. */
const ONLY_WHEN_NOT_A_PR_OR_A_PUSH =
  `\${{ contains(fromJSON('["schedule","workflow_dispatch"]'), github.event_name) ` +
  `&& format(' {0}', matrix.version) || '' }}`;

/** The checks of the host contract that `main` requires, by the name a pull request publishes. */
const REQUIRED = [
  'host contract (claude code)',
  'host contract (vs code)',
  'host contract (codex)',
  'host contract (copilot)',
  'host contract (opencode)',
  'host contract (gemini)',
  'host contract (qwen)',
];

const NAMES = [...WORKFLOW.matchAll(/^ {4}name: (host contract .*)$/gm)].map((m) => m[1] as string);

describe('the host contract checks have names that do not move', () => {
  it('names every job after its host, with the version only on a run that is not a PR or a push', () => {
    const plain = NAMES.map((name) => name.replace(ONLY_WHEN_NOT_A_PR_OR_A_PUSH, ''));
    expect(plain).toEqual(REQUIRED);
  });

  it('never lets a version into the name outside that one suffix', () => {
    for (const name of NAMES) {
      const rest = name.replace(ONLY_WHEN_NOT_A_PR_OR_A_PUSH, '');
      expect(rest, name).not.toMatch(/\$\{\{|\d+\.\d+/);
    }
  });

  it('still has the suffix, so the weekly runs of one host can be told apart', () => {
    expect(NAMES.every((name) => name.includes(ONLY_WHEN_NOT_A_PR_OR_A_PUSH))).toBe(true);
  });
});
