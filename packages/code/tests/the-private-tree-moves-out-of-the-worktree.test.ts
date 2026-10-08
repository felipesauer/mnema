/**
 * Private trees written before the private tree moved into the repository's git directory are
 * found by `mnema doctor`, and moved by `mnema doctor --fix private-tree`.
 *
 * The old trees are made the way they were made: by the binary, writing privately in a project
 * whose repository it could not see (its `.git` set aside for the write), so each holds what an
 * old private tree held — a tail, the key's public half and anchor, an installation id, and the
 * writers' `locks/`.
 *
 * WHAT THIS HOLDS:
 *   - the doctor names every worktree's old tree, and how many tails it holds;
 *   - `--dry-run` moves nothing;
 *   - the move puts every tail in the shared tree, discards `locks/`, and the record verifies;
 *   - a worktree that had not written since goes on writing its old tail (its installation id
 *     moved to its own git directory); the checkout, which had, keeps its new one, and its old
 *     tail is moved as a closed tail;
 *   - after the move, `git worktree remove` without `--force` takes nothing private with it,
 *     and the doctor has nothing more to say.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync } from 'node:fs';
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
  const ran = spawnSync(process.execPath, [CLI, ...argv], { cwd, encoding: 'utf-8', env: ENV() });
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

/** A private note written where the private tree used to live: the repository set aside. */
function writtenTheOldWay(top: string, text: string): void {
  renameSync(join(top, '.git'), join(top, '.git.aside'));
  try {
    const wrote = mnema(top, 'memory', '--scope', 'private', text);
    expect(wrote.status, wrote.out).toBe(0);
  } finally {
    renameSync(join(top, '.git.aside'), join(top, '.git'));
  }
}

const shared = () => join(repo, '.git', 'mnema', 'private');
const oldTree = (top: string) => join(top, '.mnema', 'private');

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-private-moves-'));
  home = join(sandbox, 'home');
  repo = join(sandbox, 'repo');
  worktree = join(sandbox, 'wt');
  mkdirSync(home);
  mkdirSync(repo);
  expect(git(repo, 'init', '-q', '-b', 'main').status).toBe(0);
  expect(mnema(repo, 'init').status).toBe(0);
  expect(git(repo, 'add', '.mnema').status).toBe(0);
  expect(git(repo, 'commit', '-qm', 'found the record').status).toBe(0);
  expect(git(repo, 'worktree', 'add', '-q', worktree).status).toBe(0);
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe('private trees from before the move', () => {
  it('are named by the doctor, moved by --fix private-tree, and verify', () => {
    writtenTheOldWay(repo, 'old note from the checkout');
    writtenTheOldWay(worktree, 'old note from the worktree');
    // The checkout writes once after the move: its installation id in the shared tree is new.
    expect(mnema(repo, 'memory', '--scope', 'private', 'new note from the checkout').status).toBe(
      0,
    );
    expect(existsSync(join(oldTree(repo), 'locks'))).toBe(true);
    expect(mnema(repo, 'recall').out).not.toContain('old note from the worktree');

    const doctor = mnema(repo, 'doctor');
    const lines = doctor.out.split('\n').filter((line) => line.includes('private-tree:'));
    expect(lines).toHaveLength(2);
    expect(doctor.out).toContain(`${oldTree(repo)} holds 1 tail(s)`);
    expect(doctor.out).toContain(`${oldTree(worktree)} holds 1 tail(s)`);
    expect(doctor.out).toContain('`mnema doctor --fix private-tree`');

    const dry = mnema(repo, 'doctor', '--fix', 'private-tree', '--dry-run');
    expect(dry.status, dry.out).toBe(0);
    expect(dry.out).toContain('nothing was written');
    expect(existsSync(oldTree(repo))).toBe(true);
    expect(existsSync(oldTree(worktree))).toBe(true);

    const fixed = mnema(repo, 'doctor', '--fix', 'private-tree');
    expect(fixed.status, fixed.out).toBe(0);
    expect(fixed.out).toContain('1 of them closed');
    expect(existsSync(oldTree(repo))).toBe(false);
    expect(existsSync(oldTree(worktree))).toBe(false);
    expect(readdirSync(join(shared(), 'tails'))).toHaveLength(3);

    const recalled = mnema(repo, 'recall').out;
    for (const note of ['old note from the checkout', 'old note from the worktree', 'new note']) {
      expect(recalled).toContain(note);
    }
    const verified = mnema(repo, 'verify');
    expect(verified.status, verified.out).toBe(0);

    // The worktree had not written since: it goes on writing the tail it had.
    expect(mnema(worktree, 'memory', '--scope', 'private', 'after the move').status).toBe(0);
    expect(readdirSync(join(shared(), 'tails'))).toHaveLength(3);

    expect(mnema(repo, 'doctor').out).not.toContain('private-tree:');
    const removed = git(repo, 'worktree', 'remove', worktree);
    expect(removed.status, removed.out).toBe(0);
    expect(mnema(repo, 'recall').out).toContain('after the move');
  }, 180_000);

  it('give the doctor nothing to say where there are none, and the fix nothing to move', () => {
    expect(mnema(repo, 'doctor').out).not.toContain('private-tree:');
    const fixed = mnema(repo, 'doctor', '--fix', 'private-tree');
    expect(fixed.status, fixed.out).toBe(0);
    expect(fixed.out).toContain('nothing to move');
  }, 60_000);
});
