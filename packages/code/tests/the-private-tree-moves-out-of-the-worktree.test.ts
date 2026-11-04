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
 *   - an old tree that already names another record than the shared one is relinked into the
 *     shared tree's record, each tail by its own key, then moved: both readers verify the shared
 *     tree, and private writes go on (ADR-155). It used to be refused, there being no way to join
 *     two records; the relink is that way;
 *   - where a tail of that old tree was signed by a key this machine does not hold, it is not
 *     relinked: the fix names the tail and the key, fails, and nothing is written or moved;
 *   - the doctor without --fix names both records and advises the fix only where it would
 *     relink: where it would refuse (no key here, or a key the record never took in), the finding
 *     says why and advises none, and the dry run says the same refusal the fix does;
 *   - where both trees enrolled the same agent key, the relinks would count and the record they
 *     made would fail `verify` (both readers refuse the second enrolment): the finding, the dry run
 *     and the fix refuse `RELINK_WOULD_NOT_VERIFY` naming that event, nothing is written, and
 *     `verify` stays green. The fix used to relink and move with exit 0, leaving `verify` failing.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
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
  verifyChain,
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
  return mnemaAs(undefined, cwd, ...argv);
}

/** The binary, signing with the agent key kept under `agent` where one is named. */
function mnemaAs(agent: string | undefined, cwd: string, ...argv: string[]) {
  const env = agent === undefined ? ENV() : { ...ENV(), MNEMA_AGENT_KEY: agent };
  const ran = spawnSync(process.execPath, [CLI, ...argv], { cwd, encoding: 'utf-8', env });
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

/** Every file under `dir` but git's objects, by path and bytes: what a refusal must leave as it was. */
function everythingUnder(dir: string): string {
  const files = readdirSync(dir, { recursive: true, encoding: 'utf-8' })
    .filter((path) => !path.includes(join('.git', 'objects')))
    .filter((path) => statSync(join(dir, path)).isFile())
    .sort();
  const hash = createHash('sha256');
  for (const path of files)
    hash
      .update(path)
      .update('\0')
      .update(readFileSync(join(dir, path)));
  return `${files.length} file(s), ${hash.digest('hex')}`;
}

/** What the second reader refused in the tree at `root`: each finding that failed, and where. */
function secondRefusals(root: string): readonly string[] {
  const ran = spawnSync('python3', ['-I', SECOND_READER, '--json', 'record', root], {
    encoding: 'utf-8',
  });
  if (ran.stdout === '') throw new Error(`the second reader produced no verdict: ${ran.stderr}`);
  const reading = JSON.parse(ran.stdout) as {
    findings: readonly { level: string; what: string; where: string }[];
  };
  return reading.findings.filter((f) => f.level === 'FAIL').map((f) => `${f.what} (${f.where})`);
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

  it('are relinked into the record of the shared tree where they name another, then moved, and verify', () => {
    // The shared tree founded first, by its own genesis; then a tree outside it, founded apart.
    expect(mnema(repo, 'memory', '--scope', 'private', 'in the repository').status).toBe(0);
    writtenOutsideTheRepository(repo, 'founded apart');
    const [old] = readdirSync(join(oldTree(repo), 'tails'));
    expect(mnema(repo, 'verify').status).toBe(0);

    // Without --fix, the doctor names both records and advises what the fix does: relink, then move.
    const doctor = mnema(repo, 'doctor').out;
    expect(doctor).toMatch(
      /since its tails name record [0-9a-f]{12}\.\.\. and those of .* name record /,
    );
    expect(doctor).toContain('`mnema doctor --fix private-tree` to relink 1 of them into record ');
    expect(doctor).toContain('each by its own key, and move them');

    const dry = mnema(repo, 'doctor', '--fix', 'private-tree', '--dry-run');
    expect(dry.out).toContain(`${oldTree(repo)}: would relink 1 tail(s) into record `);
    expect(readdirSync(join(oldTree(repo), 'tails'))).toEqual([old]);

    const fixed = mnema(repo, 'doctor', '--fix', 'private-tree');
    expect(fixed.status, fixed.out).toBe(0);
    expect(fixed.out).toContain(`${oldTree(repo)}: relinked 1 tail(s) into record `);
    expect(fixed.out).toContain('each by its own key');
    expect(fixed.out).toContain(`${oldTree(repo)}: moved 1 tail(s) to ${shared()}`);
    expect(readdirSync(join(shared(), 'tails'))).toContain(old);
    const verified = mnema(repo, 'verify');
    expect(verified.status, verified.out).toBe(0);
    expect(verified.out).toContain('1 tail(s) relinked into this record by their own key');
    expect(secondReading(shared())).toBe('VERIFIED');

    const later = mnema(repo, 'memory', '--scope', 'private', 'after the relink');
    expect(later.status, later.out).toBe(0);
    expect(mnema(repo, 'verify').status).toBe(0);
    expect(secondReading(shared())).toBe('VERIFIED');
    for (const note of ['in the repository', 'founded apart', 'after the relink']) {
      expect(mnema(repo, 'recall').out).toContain(note);
    }
  }, 180_000);

  it('are not relinked nor moved where a tail’s key is not on this machine, and the fix says which', () => {
    expect(mnema(repo, 'memory', '--scope', 'private', 'in the repository').status).toBe(0);
    // The old tree written by another machine: another HOME, so another key.
    const mine = home;
    home = join(sandbox, 'another-machine');
    mkdirSync(home);
    try {
      writtenOutsideTheRepository(repo, 'founded on another machine');
    } finally {
      home = mine;
    }
    const [old] = readdirSync(join(oldTree(repo), 'tails'));
    const tails = readdirSync(join(shared(), 'tails'));

    // The doctor, without --fix, names both records and advises no fix that refuses.
    const doctor = mnema(repo, 'doctor').out;
    expect(doctor).toMatch(
      /since its tails name record [0-9a-f]{12}\.\.\. and those of .* name record /,
    );
    expect(doctor).toContain(`this machine holds no key for ${old}`);
    expect(doctor).toContain('the fix would refuse them');
    expect(doctor).not.toContain('run `mnema doctor --fix private-tree`');

    // The dry run says the same refusal, and writes nothing either.
    const dry = mnema(repo, 'doctor', '--fix', 'private-tree', '--dry-run');
    expect(dry.status, dry.out).toBe(1);
    expect(dry.out).toContain(`${oldTree(repo)}: not moved, since its tails name record `);
    expect(dry.out).toContain(`this machine holds no key for ${old}`);
    expect(readdirSync(join(oldTree(repo), 'tails'))).toEqual([old]);
    expect(readdirSync(join(shared(), 'tails'))).toEqual(tails);

    const fixed = mnema(repo, 'doctor', '--fix', 'private-tree');
    expect(fixed.status, fixed.out).toBe(1);
    expect(fixed.out).toContain(`${oldTree(repo)}: not moved, since its tails name record `);
    expect(fixed.out).toContain(`this machine holds no key for ${old}`);
    expect(fixed.out).toContain('nothing was written');
    expect(readdirSync(join(oldTree(repo), 'tails'))).toEqual([old]);
    expect(readdirSync(join(shared(), 'tails'))).toEqual(tails);
    expect(mnema(repo, 'verify').status).toBe(0);
  }, 180_000);

  it('are refused, in the doctor and in the fix alike, where this machine holds the key but the record never took it in', () => {
    // The shared tree founded on another machine (another key); the old tree by this one's key,
    // which holds no membership in the record the shared tree names (ADR-157).
    const mine = home;
    home = join(sandbox, 'another-machine');
    mkdirSync(home);
    try {
      expect(mnema(repo, 'memory', '--scope', 'private', 'in the repository').status).toBe(0);
    } finally {
      home = mine;
    }
    writtenOutsideTheRepository(repo, 'founded apart');
    const [old] = readdirSync(join(oldTree(repo), 'tails'));
    const tails = readdirSync(join(shared(), 'tails'));

    const doctor = mnema(repo, 'doctor').out;
    expect(doctor).toMatch(
      /since its tails name record [0-9a-f]{12}\.\.\. and those of .* name record /,
    );
    expect(doctor).toContain('the fix would refuse them: RELINK_WOULD_NOT_COUNT');
    expect(doctor).toContain('relink-not-a-member');
    expect(doctor).not.toContain('run `mnema doctor --fix private-tree`');

    // The dry run no longer promises the relink the fix refuses.
    const dry = mnema(repo, 'doctor', '--fix', 'private-tree', '--dry-run');
    expect(dry.status, dry.out).toBe(1);
    expect(dry.out).not.toContain('would relink');
    expect(dry.out).toContain('RELINK_WOULD_NOT_COUNT');

    const fixed = mnema(repo, 'doctor', '--fix', 'private-tree');
    expect(fixed.status, fixed.out).toBe(1);
    expect(fixed.out).toContain('RELINK_WOULD_NOT_COUNT');
    expect(readdirSync(join(oldTree(repo), 'tails'))).toEqual([old]);
    expect(readdirSync(join(shared(), 'tails'))).toEqual(tails);
  }, 180_000);

  it('are refused, in the doctor and in the fix alike, where the record they would make together would not verify', () => {
    // The same agent key enrolled by both trees: by the repository's, then by the tree written
    // apart, where the agent writes too. Each tree verifies alone; read as one record, the second
    // enrolment names a key already in an identity, which both readers refuse.
    expect(mnema(repo, 'memory', '--scope', 'private', 'in the repository').status).toBe(0);
    const anchor = readdirSync(join(repo, '.mnema'), { recursive: true, encoding: 'utf-8' })
      .filter((path) => statSync(join(repo, '.mnema', path)).isFile())
      .map((path) => readFileSync(join(repo, '.mnema', path), 'utf-8').match(/mnid:[0-9a-f]+/)?.[0])
      .find((found) => found !== undefined) as string;
    const asked = mnema(repo, 'key', 'request', '--agent', 'bot', '--anchor', anchor);
    const request = asked.out.split('\n').find((line) => line.startsWith('mnema-agent-request'));
    expect(request, asked.out).toBeDefined();
    const here = mnema(repo, 'key', 'enroll', '--agent', request as string);
    expect(here.status, here.out).toBe(0);
    renameSync(join(repo, '.git'), join(repo, '.git.aside'));
    try {
      const apart = mnema(repo, 'key', 'enroll', '--agent', request as string);
      expect(apart.status, apart.out).toBe(0);
      const wrote = mnemaAs('bot', repo, 'memory', '--scope', 'private', 'the agent, apart');
      expect(wrote.status, wrote.out).toBe(0);
    } finally {
      renameSync(join(repo, '.git.aside'), join(repo, '.git'));
    }
    expect(mnema(repo, 'verify').status).toBe(0);
    const before = everythingUnder(sandbox);

    // The doctor names why, and advises no fix that would leave the record failing verify.
    const doctor = mnema(repo, 'doctor').out;
    expect(doctor).toContain('the fix would refuse them: RELINK_WOULD_NOT_VERIFY');
    expect(doctor).toContain('agent.enrolled names a key that is already in an identity');
    expect(doctor).not.toContain('run `mnema doctor --fix private-tree`');

    // The dry run refuses as the fix does, and neither writes a byte.
    const dry = mnema(repo, 'doctor', '--fix', 'private-tree', '--dry-run');
    expect(dry.status, dry.out).toBe(1);
    expect(dry.out).not.toContain('would relink');
    expect(dry.out).toContain('RELINK_WOULD_NOT_VERIFY');
    const fixed = mnema(repo, 'doctor', '--fix', 'private-tree');
    expect(fixed.status, fixed.out).toBe(1);
    expect(fixed.out).toContain('RELINK_WOULD_NOT_VERIFY');
    expect(fixed.out).toContain('nothing was written');
    expect(everythingUnder(sandbox)).toBe(before);
    expect(mnema(repo, 'verify').status).toBe(0);

    // The refusal's premise, by both readers: the two trees read as one directory (the move by
    // hand, without the relinks, which do not touch the fact refused) refuse the enrolment the
    // refusal names, at the tail and seq it names.
    const named = /tail ([0-9a-f]{64}-[0-9a-f]{32}) seq (\d+): agent\.enrolled/.exec(fixed.out);
    expect(named, fixed.out).not.toBeNull();
    const [, tail = '', seq = ''] = named as RegExpExecArray;
    const together = join(sandbox, 'together');
    cpSync(shared(), together, { recursive: true });
    cpSync(join(oldTree(repo), 'tails'), join(together, 'tails'), { recursive: true });
    for (const file of readdirSync(join(oldTree(repo), 'keys')).filter((f) => f.endsWith('.pub'))) {
      cpSync(join(oldTree(repo), 'keys', file), join(together, 'keys', file));
    }
    const product = verifyChain({ root: together }, catalogUpcasters()).issues;
    expect(
      product.filter((issue) => issue.detail.startsWith('agent.enrolled names a key')),
    ).toMatchObject([{ tail, seq: Number(seq) }]);
    const second = secondRefusals(together).filter((f) => f.startsWith('agent.enrolled'));
    // The second reader names a tail by its first 20 characters.
    expect(second).toEqual([expect.stringContaining(`(${tail.slice(0, 20)}... seq ${seq})`)]);
  }, 180_000);

  it('give the doctor nothing to say where there are none, and the fix nothing to move', () => {
    expect(mnema(repo, 'doctor').out).not.toContain('private-tree:');
    const fixed = mnema(repo, 'doctor', '--fix', 'private-tree');
    expect(fixed.status, fixed.out).toBe(0);
    expect(fixed.out).toContain('nothing to move');
  }, 60_000);
});
