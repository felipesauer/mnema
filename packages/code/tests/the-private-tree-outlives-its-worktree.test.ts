/**
 * A private note written in a linked worktree survives `git worktree remove`.
 *
 * THE DEFECT, MEASURED ON THE SHIPPED BINARY. The private tree lived at
 * `<worktree>/.mnema/private/`, ignored by git — and `git worktree remove` deletes ignored files
 * without `--force` and without a word. Agents' hosts make and remove worktrees on their own, so
 * every private note an agent took in one went with it.
 *
 * Inside a repository the tree now lives under the common git directory, which every worktree of
 * the repository shares and none of them removes. Each worktree keeps its own installation id in
 * its own git directory, so each writes a tail of its own: two worktrees writing at once never
 * wait on each other's lock.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GIT_WITHOUT_MAINTENANCE } from './support/git-without-maintenance.js';

const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

let sandbox: string;
let home: string;
let repo: string;
let worktree: string;

const ENV = () => ({
  PATH: process.env.PATH ?? '',
  HOME: home,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: GIT_WITHOUT_MAINTENANCE,
  GIT_AUTHOR_NAME: 'a',
  GIT_AUTHOR_EMAIL: 'a@example.invalid',
  GIT_COMMITTER_NAME: 'a',
  GIT_COMMITTER_EMAIL: 'a@example.invalid',
});

function mnema(cwd: string, ...argv: string[]) {
  const ran = spawnSync(process.execPath, [CLI, ...argv], {
    cwd,
    encoding: 'utf-8',
    env: ENV(),
  });
  return { status: ran.status, out: `${ran.stdout}${ran.stderr}` };
}

function git(cwd: string, ...args: string[]) {
  const ran = spawnSync('git', args, {
    cwd,
    encoding: 'utf-8',
    env: { ...ENV(), GIT_CONFIG_GLOBAL: GIT_WITHOUT_MAINTENANCE },
  });
  return { status: ran.status, out: `${ran.stdout}${ran.stderr}` };
}

/** The private tree every worktree of the repository shares. */
function sharedTree(): string {
  return join(repo, '.git', 'mnema', '%2E', 'private');
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-private-outlives-'));
  home = join(sandbox, 'home');
  repo = join(sandbox, 'repo');
  worktree = join(sandbox, 'wt');
  mkdirSync(home);
  mkdirSync(repo);
  expect(git(repo, 'init', '-q', '-b', 'main').status).toBe(0);
  expect(mnema(repo, 'init').status).toBe(0);
  // The project's tree is committed, as a project's is: an untracked file in a worktree is what
  // makes `git worktree remove` refuse, and this is about what it removes when it does not.
  expect(git(repo, 'add', '.mnema').status).toBe(0);
  expect(git(repo, 'commit', '-qm', 'found the record').status).toBe(0);
  const added = git(repo, 'worktree', 'add', '-q', worktree);
  expect(added.status, added.out).toBe(0);
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe('a private note taken in a linked worktree', () => {
  it('is still there after `git worktree remove`, without --force, and reads from the checkout', () => {
    const mark = 'kept-past-the-worktree';
    const wrote = mnema(worktree, 'memory', '--scope', 'private', `a note ${mark}`);
    expect(wrote.status, wrote.out).toBe(0);

    const removed = git(repo, 'worktree', 'remove', worktree);
    expect(removed.status, removed.out).toBe(0);

    expect(mnema(repo, 'recall').out).toContain(mark);
    const verified = mnema(repo, 'verify');
    expect(verified.status, verified.out).toBe(0);
  }, 120_000);

  it('is read by every worktree of the repository, and a separate clone has a tree of its own', () => {
    const mark = 'seen-from-the-checkout';
    expect(mnema(worktree, 'memory', '--scope', 'private', `a note ${mark}`).status).toBe(0);
    expect(mnema(repo, 'recall').out).toContain(mark);

    const clone = join(sandbox, 'clone');
    expect(git(sandbox, 'clone', '-q', repo, clone).status).toBe(0);
    expect(mnema(clone, 'recall').out).not.toContain(mark);
  }, 120_000);
});

describe('a project nested where the top project’s tree keeps its tails', () => {
  it('keeps its private tree beside the top’s, and the top still verifies', () => {
    // Keyed by the relative path WITH its slashes, the tree of a project at `private/tails`
    // was `<git dir>/mnema/private/tails/private` — inside the top's `tails/`.
    const nested = join(repo, 'private', 'tails');
    mkdirSync(nested, { recursive: true });
    expect(mnema(nested, 'init').status).toBe(0);
    expect(mnema(nested, 'memory', '--scope', 'private', 'from the nested one').status).toBe(0);
    expect(mnema(repo, 'memory', '--scope', 'private', 'from the top').status).toBe(0);

    const verified = mnema(repo, 'verify');
    expect(verified.status, verified.out).toBe(0);
    expect(readdirSync(join(repo, '.git', 'mnema')).sort()).toEqual(['%2E', 'private%2Ftails']);
  }, 120_000);
});

describe('two worktrees writing privately at the same time', () => {
  it('write two tails, and one holding its lock does not stop the other', () => {
    expect(mnema(repo, 'memory', '--scope', 'private', 'from the checkout').status).toBe(0);
    const tails = readdirSync(join(sharedTree(), 'tails'));
    expect(tails).toHaveLength(1);

    // The checkout's tail held by a live process, as a writer in the middle of an append holds it.
    const lock = join(sharedTree(), 'locks', `${tails[0]}.lock`);
    mkdirSync(join(sharedTree(), 'locks'), { recursive: true });
    writeFileSync(lock, `${process.pid} ${Date.now()}\n`, 'utf-8');
    const wrote = mnema(worktree, 'memory', '--scope', 'private', 'from the worktree');
    rmSync(lock);

    expect(wrote.status, wrote.out).toBe(0);
    expect(readdirSync(join(sharedTree(), 'tails')).sort()).toHaveLength(2);
    // The worktree's installation id lives in its own git directory, beside nothing it shares.
    expect(
      readdirSync(join(repo, '.git', 'worktrees', 'wt', 'mnema', '%2E', 'private', 'keys')),
    ).toEqual(expect.arrayContaining([expect.stringMatching(/\.inst$/)]));
  }, 120_000);
});
