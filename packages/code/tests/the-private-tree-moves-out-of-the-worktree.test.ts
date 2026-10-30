/**
 * Private trees written before the private tree moved into the repository's git directory are
 * found by `mnema doctor`, and moved by `mnema doctor --fix private-tree`.
 *
 * The old trees are made the way they were made: by the binary, writing privately in a project
 * whose repository it could not see (its `.git` set aside for the write), so each holds what an
 * old private tree held (a tail, the key's public half and anchor, an installation id, and the
 * writers' `locks/`).
 *
 * WHAT THIS HOLDS:
 *   - the doctor names every worktree's old tree, and how many tails it holds;
 *   - `--dry-run` moves nothing;
 *   - the move puts every tail in the shared tree, discards `locks/`, and the record verifies;
 *   - a worktree that had not written since goes on writing its old tail (its installation id
 *     moved to its own git directory); the checkout, which had, keeps its new one, and its old
 *     tail is moved as a closed tail;
 *   - after the move, `git worktree remove` without `--force` takes nothing private with it,
 *     and the doctor has nothing more to say;
 *   - a project written outside a repository, then given one: the tree founded in the git
 *     directory takes the record the old tree names, so the move joins one record, both readers
 *     verify it, and private writes go on (FORMAT.md section 6.10);
 *   - an old tree that already names another record than the shared one is not moved: the fix
 *     says why and fails, and nothing is written.
 */

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  canonicalBytes,
  canonicalStringify,
  catalogUpcasters,
  checkpointHash,
  listTails,
  loadOrCreateKeyPair,
  readTailCheckpoints,
  readTailEntries,
  serializeCheckpoint,
  sign,
  signCheckpoint,
} from '@mnema/chain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GIT_WITHOUT_MAINTENANCE } from './support/git-without-maintenance.js';

const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const SECOND_READER = fileURLToPath(
  new URL('../../chain/verifier/mnema_verify.py', import.meta.url),
);

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

/**
 * A private note written where the private tree used to live, by this binary: the repository set
 * aside, so the tree is founded in `.mnema/private/` and names a record of its own (FORMAT.md
 * section 6.10), as a project's private tree outside a repository does.
 */
function writtenOutsideTheRepository(top: string, text: string): void {
  renameSync(join(top, '.git'), join(top, '.git.aside'));
  try {
    const wrote = mnema(top, 'memory', '--scope', 'private', text);
    expect(wrote.status, wrote.out).toBe(0);
  } finally {
    renameSync(join(top, '.git.aside'), join(top, '.git'));
  }
}

/**
 * The same, signed again as a writer before 0.1.5 signed it, under the first schemes, naming no
 * record: a tree left in a worktree from before the move, which every binary since writes into
 * the repository's git directory, was written before records were named.
 */
function writtenTheOldWay(top: string, text: string): void {
  writtenOutsideTheRepository(top, text);
  signedAsBeforeRecordsWereNamed(oldTree(top));
}

/** The second reader's verdict on the tree at `root`. */
function secondReading(root: string): string {
  const ran = spawnSync('python3', ['-I', SECOND_READER, '--json', 'record', root], {
    encoding: 'utf-8',
  });
  if (ran.stdout === '') throw new Error(`the second reader produced no verdict: ${ran.stderr}`);
  return (JSON.parse(ran.stdout) as { verdict: string }).verdict;
}

/** Every tail proof and checkpoint of the tree at `root` signed again under the first schemes. */
function signedAsBeforeRecordsWereNamed(root: string): void {
  const keyPair = loadOrCreateKeyPair({ root: join(home, '.mnema', 'identity') });
  for (const tail of listTails({ root })) {
    const dir = join(root, 'tails', tail);
    const proof = { scheme: 'mnema-tail/1', signerFp: keyPair.fingerprint, tail };
    const sig = Buffer.from(sign(canonicalBytes(proof), keyPair.privateKey)).toString('hex');
    writeFileSync(join(dir, 'tailproof.json'), `${canonicalStringify({ ...proof, sig })}\n`);
    const entries = readTailEntries({ root }, tail, catalogUpcasters());
    let prev: string | null = null;
    const lines: string[] = [];
    for (const { fromSeq, toSeq } of readTailCheckpoints({ root }, tail)) {
      const events = entries
        .filter((entry) => entry.link.seq >= fromSeq && entry.link.seq <= toSeq)
        .map((entry) => entry.written);
      const signed = signCheckpoint({ tail, fromSeq, events, prev, keyPair });
      lines.push(serializeCheckpoint(signed));
      prev = checkpointHash(signed);
    }
    writeFileSync(join(dir, 'checkpoints.jsonl'), `${lines.join('\n')}\n`);
  }
}

const shared = () => join(repo, '.git', 'mnema', '%2E', 'private');
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
    // The checkout's tree by this binary, naming a record; the worktree's from before 0.1.5.
    writtenOutsideTheRepository(repo, 'old note from the checkout');
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
    expect(secondReading(shared())).toBe('VERIFIED');

    // The worktree had not written since: it goes on writing the tail it had.
    expect(mnema(worktree, 'memory', '--scope', 'private', 'after the move').status).toBe(0);
    expect(readdirSync(join(shared(), 'tails'))).toHaveLength(3);

    expect(mnema(repo, 'doctor').out).not.toContain('private-tree:');
    const removed = git(repo, 'worktree', 'remove', worktree);
    expect(removed.status, removed.out).toBe(0);
    expect(mnema(repo, 'recall').out).toContain('after the move');
  }, 180_000);

  it('join the tree a project kept before its repository, both written by this binary', () => {
    const project = join(sandbox, 'no-repository-yet');
    mkdirSync(project);
    expect(mnema(project, 'init').status).toBe(0);
    const before = mnema(project, 'memory', '--scope', 'private', 'before the repository');
    expect(before.status, before.out).toBe(0);
    expect(git(project, 'init', '-q', '-b', 'main').status).toBe(0);
    const after = mnema(project, 'memory', '--scope', 'private', 'after the repository');
    expect(after.status, after.out).toBe(0);
    expect(mnema(project, 'doctor').out).toContain(`${oldTree(project)} holds 1 tail(s)`);

    const fixed = mnema(project, 'doctor', '--fix', 'private-tree');
    expect(fixed.status, fixed.out).toBe(0);
    expect(fixed.out).toContain('moved 1 tail(s)');
    expect(existsSync(oldTree(project))).toBe(false);
    const tree = join(project, '.git', 'mnema', '%2E', 'private');
    expect(readdirSync(join(tree, 'tails'))).toHaveLength(2);

    const verified = mnema(project, 'verify');
    expect(verified.status, verified.out).toBe(0);
    expect(secondReading(tree)).toBe('VERIFIED');
    const later = mnema(project, 'memory', '--scope', 'private', 'later still');
    expect(later.status, later.out).toBe(0);
    for (const note of ['before the repository', 'after the repository', 'later still']) {
      expect(mnema(project, 'recall').out).toContain(note);
    }
  }, 180_000);

  it('are not moved where they already name another record, and the fix says why', () => {
    // The shared tree founded first, by its own genesis; then a tree outside it, founded apart.
    expect(mnema(repo, 'memory', '--scope', 'private', 'in the repository').status).toBe(0);
    writtenOutsideTheRepository(repo, 'founded apart');
    const tails = readdirSync(join(shared(), 'tails'));

    const fixed = mnema(repo, 'doctor', '--fix', 'private-tree');
    expect(fixed.status, fixed.out).toBe(1);
    expect(fixed.out).toContain(`${oldTree(repo)}: not moved, since its tails name record `);
    expect(fixed.out).toContain('(another-record)');
    expect(fixed.out).toContain('nothing was written');
    expect(readdirSync(join(oldTree(repo), 'tails'))).toHaveLength(1);
    expect(readdirSync(join(shared(), 'tails'))).toEqual(tails);
    const verified = mnema(repo, 'verify');
    expect(verified.status, verified.out).toBe(0);
    expect(mnema(repo, 'doctor', '--fix', 'private-tree', '--dry-run').out).toContain('not moved');
  }, 180_000);

  it('give the doctor nothing to say where there are none, and the fix nothing to move', () => {
    expect(mnema(repo, 'doctor').out).not.toContain('private-tree:');
    const fixed = mnema(repo, 'doctor', '--fix', 'private-tree');
    expect(fixed.status, fixed.out).toBe(0);
    expect(fixed.out).toContain('nothing to move');
  }, 60_000);
});
