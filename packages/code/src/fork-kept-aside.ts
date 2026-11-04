/**
 * What a pull left aside of the record's tails, and the one sentence that says it (ADR-181).
 *
 * WHY IT EXISTS. With the driver and the autoStash settings written, a plain `git pull` carries the
 * record's events that are not committed (`a-plain-git-pull-carries-the-record.test.ts`). When both
 * sides appended to the SAME tail, which is a fork, it is the one case git does not stop on: the pull
 * says "Fast-forward" and exits 0, the tail files are left in conflict (unmerged, with no markers),
 * the working tree holds the branch's side, and the local side lives only in git's stash, where git
 * itself suggests a `git stash drop`. Measured on git 2.55 (cases 17 and 18 of the probe of
 * 4 November 2026). `mnema verify` reads the branch's side and says nothing. This reads the two
 * traces git leaves, and `mnema status` and `mnema doctor` say the sentence from
 * {@link saysForkKeptAside}, so they cannot word it differently (`a-plain-git-pull-carries-the-record.test.ts`
 * holds both to this module).
 *
 * WHAT IT READS. In the repository the record lives in, only: an entry of `git stash list` named
 * autostash whose changes include a file under the record's `tails/`, and the tail files the index
 * holds unmerged. It reads, never writes, takes no optional lock and asks no network: three or four
 * local `git` calls, the stash capped at {@link STASHES_READ} entries.
 *
 * SILENT BY CONSTRUCTION. Outside a git repository, with no public tree, or with neither trace, the
 * answer is `undefined` and nothing is said.
 *
 * WHAT IT DOES NOT CLAIM. An entry that holds tail files may be a fork, or a stash a failed
 * restore left for another reason; the sentence says "may" and says what git did and what to keep.
 */

import { spawnSync } from 'node:child_process';
import { type DiscoveryEnv, resolveTrees } from '@mnema/core';

/** The most stash entries read: the ones a pull leaves are the newest. */
const STASHES_READ = 20;

/** What the reading needs: injected so it is testable against a sandbox. */
export interface ForkKeptAsideContext {
  readonly cwd: string;
  readonly env: DiscoveryEnv;
  /** The environment git runs with; this process's by default. */
  readonly processEnv?: NodeJS.ProcessEnv;
}

/** What a pull left aside of the tails. */
export interface ForkKeptAside {
  /** The autostash entries of git's stash that hold files of a tail. */
  readonly stashes: number;
  /** The tail files the index holds unmerged. */
  readonly conflicted: number;
}

/** One git in `cwd`, or undefined where git is absent, does not answer 0, or takes too long. */
function ask(ctx: ForkKeptAsideContext, cwd: string, args: readonly string[]): string | undefined {
  const ran = spawnSync(
    'git',
    ['-c', 'gc.auto=0', '-c', 'maintenance.auto=false', '-c', 'core.quotepath=off', ...args],
    {
      cwd,
      encoding: 'utf-8',
      timeout: 5_000,
      env: { ...(ctx.processEnv ?? process.env), GIT_OPTIONAL_LOCKS: '0', GIT_NO_LAZY_FETCH: '1' },
    },
  );
  if (ran.error !== undefined || ran.status !== 0) return undefined;
  return ran.stdout;
}

/** What a pull left aside of the record's tails, or undefined where it left nothing, or git cannot say. */
export function readForkKeptAside(ctx: ForkKeptAsideContext): ForkKeptAside | undefined {
  const record = resolveTrees(ctx.cwd, ctx.env).projectPublic;
  if (record === undefined) return undefined;
  if (ask(ctx, record, ['rev-parse', '--git-dir']) === undefined) return undefined;

  const unmerged = new Set(
    (ask(ctx, record, ['ls-files', '-u', '-z', '--', 'tails']) ?? '')
      .split('\0')
      .filter((entry) => entry !== '')
      .map((entry) => entry.slice(entry.indexOf('\t') + 1)),
  );

  const listed = (ask(ctx, record, ['stash', 'list', '--format=%gd%x09%gs']) ?? '')
    .split('\n')
    .filter((row) => /\tautostash$|\t.*: autostash$/i.test(row))
    .slice(0, STASHES_READ);
  let stashes = 0;
  for (const row of listed) {
    const ref = row.slice(0, row.indexOf('\t'));
    const changed = ask(ctx, record, ['diff', '--name-only', `${ref}^1`, ref, '--', 'tails']);
    if (changed !== undefined && changed.trim() !== '') stashes += 1;
  }

  if (stashes === 0 && unmerged.size === 0) return undefined;
  return { stashes, conflicted: unmerged.size };
}

/**
 * The sentence `mnema status` and `mnema doctor` say: what git holds aside, what that may be, and
 * what to keep. One line, a statement of fact with the commands named.
 */
export function saysForkKeptAside(found: ForkKeptAside): string {
  const where = [
    found.stashes > 0
      ? `${found.stashes === 1 ? 'an autostash entry' : `${found.stashes} autostash entries`} of git's stash holds files of the record's tails`
      : undefined,
    found.conflicted > 0
      ? `${found.conflicted === 1 ? 'a tail file is' : `${found.conflicted} tail files are`} in conflict in the index`
      : undefined,
  ]
    .filter((part) => part !== undefined)
    .join(', and ');
  return (
    `A pull left events of this record aside: ${where}. ` +
    "If both sides appended to one tail that is a fork, which git does not name: its pull said Fast-forward and exited 0, the working tree holds the branch's side, and the other side is only in the stash. " +
    'Do not drop the stash: it may hold the only copy of those events (`git stash show -p` shows them). ' +
    '`mnema record pull`, run before a pull, names a fork of one tail and writes nothing.'
  );
}
