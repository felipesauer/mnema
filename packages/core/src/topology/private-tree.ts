/**
 * Whether git would STAGE the private tree — asked of git, and not of a file a third party
 * controls.
 *
 * THE PREMISE THIS REPLACES. A write into the private tree answered *"it is not committed and
 * does not travel"*, and the sentence was true because `.mnema/.gitignore` lists `/private/`.
 * That file is COMMITTED, so it is the one thing in the project a collaborator can change in
 * a commit that reads as housekeeping: with the line gone, the next `git add -A` stages every
 * private note and the commit publishes it, permanently, while the product kept saying it was
 * not committed. Measured on the binary: a private memory written over a `.gitignore` without
 * `/private/` answered exactly that, and was staged by the add that followed.
 *
 * So the write asks git. `git check-ignore` exits 0 when a path would be ignored and 1 when it
 * would not, and it answers for every source a project's ignore rules come from (this file, a
 * parent's, `.git/info/exclude`, the user's global file), which a read of one file never did.
 *
 * INSIDE A REPOSITORY THE TREE IS NO LONGER IN THE WORKING TREE: discovery puts it under the
 * repository's common git directory (`git-place.ts`), and no `git add` stages a path there — when
 * that directory is the top's own `.git`, or lies outside the working tree as the file system
 * resolves it. A tree found there is answered `outside-the-worktree` without asking git, and the
 * write goes on. A git directory a `.git` file or a link places INSIDE the working tree is not
 * out of reach of `git add`, and is asked of git like any other path.
 * Anywhere else — the old `.mnema/private/`, or any private tree inside a working tree — git is
 * asked as before, and a tree it would stage is still refused.
 *
 * WITHOUT GIT, NOTHING CHANGES. Outside a repository, with git absent, or when git cannot
 * answer (it exits 128, or runs out of time), the answer is `unknown` and the write goes on as
 * it did: there is no commit to leak into when there is no repository, and a refusal on a
 * guess would stop everyone whose git is merely unusual. `a-private-write-asks-git.test.ts`
 * holds all four.
 *
 * COST: one `git` process per private write; measured in the delivery's report.
 */

import { spawnSync } from 'node:child_process';
import { dirname, join, relative } from 'node:path';
import { CodedError } from '@mnema/chain';
import { commonDirIsOutsideTheWorktree, gitPlaceOf, isWithin } from './git-place.js';
import type { ResolvedTrees } from './resolve.js';

/** What git says of the private tree. */
export type PrivateTreeVisibility =
  | { readonly state: 'ignored' }
  | {
      readonly state: 'visible';
      /** The private tree, relative to the project's `.mnema/..`. */
      readonly path: string;
      /** The file that is meant to keep it out, relative to the same directory. */
      readonly gitignore: string;
    }
  /** In the repository's git directory, where no working tree reaches: nothing can stage it. */
  | { readonly state: 'outside-the-worktree' }
  | { readonly state: 'unknown' };

/** How long git is given to answer. It reads a few files; a hang is an answer of "unknown". */
const GIT_BUDGET_MS = 5_000;

/**
 * Whether git would stage a file in the project's private tree.
 *
 * Asked about a PATH INSIDE the tree, not the directory, because `/private/` is a directory
 * pattern: git matches it against a path under it, and against a directory only when it can
 * tell it is one — which it cannot for a tree that has not been written yet.
 */
export function privateTreeVisibility(trees: ResolvedTrees): PrivateTreeVisibility {
  if (trees.projectPublic === undefined || trees.projectPrivate === undefined) {
    return { state: 'unknown' };
  }
  const project = dirname(trees.projectPublic);
  const place = gitPlaceOf(project);
  if (
    place !== undefined &&
    isWithin(trees.projectPrivate, place.commonDir) &&
    commonDirIsOutsideTheWorktree(place)
  ) {
    return { state: 'outside-the-worktree' };
  }
  const inside = relative(project, join(trees.projectPrivate, 'a-private-record'));
  const asked = spawnSync('git', ['check-ignore', '-q', '--', inside], {
    cwd: project,
    stdio: 'ignore',
    timeout: GIT_BUDGET_MS,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
  });
  if (asked.error !== undefined || asked.status === null) return { state: 'unknown' };
  if (asked.status === 0) return { state: 'ignored' };
  if (asked.status !== 1) return { state: 'unknown' };
  return {
    state: 'visible',
    path: relative(project, trees.projectPrivate),
    gitignore: relative(project, join(trees.projectPublic, '.gitignore')),
  };
}

/** A write to the private tree was turned away because git would commit what it writes. */
export class PrivateTreeVisibleError extends CodedError {
  override readonly name = 'PrivateTreeVisibleError';
  readonly code = 'PRIVATE_TREE_VISIBLE';

  constructor(readonly seen: Extract<PrivateTreeVisibility, { state: 'visible' }>) {
    super(
      `git would stage ${seen.path}, the private tree: \`git check-ignore\` finds no rule that ` +
        `ignores it, so the next \`git add\` would take every private record into a commit and ` +
        `publish it. ${seen.gitignore} is the file that keeps it out and it is committed, so a ` +
        `change by somebody else may have removed its \`/private/\` line. Put that line back (or ` +
        'ignore the path another way) and write again. Nothing was written.',
    );
  }
}
