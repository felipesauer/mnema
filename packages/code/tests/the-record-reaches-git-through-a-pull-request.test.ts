/**
 * THE RECORD REACHES GIT THROUGH A PULL REQUEST: `mnema record commit`, with real git, a bare
 * remote and the built binary, every program run with a home of the sandbox's own.
 *
 * What it asks: the branch's commit carries the tails cut at a signed checkpoint and nothing else
 * (no private tree, no file the cut does not need); the working tree, the index and HEAD are as
 * they were, byte for byte; the commit verifies; merged into the remote's default branch, `mnema
 * record pull` brings it back with the events above the cut still here; `--through` cuts where it
 * says; a base that is not the start of the record here is refused; nothing new makes no branch;
 * and the command printed to open the pull request is the forge's of the remote's address.
 */

import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nextCommands, remoteHost, runRecordCommit } from '../src/commands/record-commit.js';
import { GIT_WITHOUT_MAINTENANCE } from './support/git-without-maintenance.js';

const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

let sandbox: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-record-commit-'));
  mkdirSync(join(sandbox, 'home'), { recursive: true });
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function env(): Record<string, string> {
  return {
    PATH: process.env.PATH ?? '',
    HOME: join(sandbox, 'home'),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: GIT_WITHOUT_MAINTENANCE,
    GIT_AUTHOR_NAME: 'a',
    GIT_AUTHOR_EMAIL: 'a@example.invalid',
    GIT_COMMITTER_NAME: 'a',
    GIT_COMMITTER_EMAIL: 'a@example.invalid',
  };
}

function git(cwd: string, ...args: string[]): { status: number; out: string } {
  const ran = spawnSync('git', ['-c', 'init.defaultBranch=main', ...args], {
    cwd,
    encoding: 'utf-8',
    env: env(),
  });
  return { status: ran.status ?? -1, out: `${ran.stdout}${ran.stderr}` };
}

function mnema(cwd: string, ...args: string[]): { status: number; out: string; stdout: string } {
  const ran = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf-8', env: env() });
  return { status: ran.status ?? -1, out: `${ran.stdout}${ran.stderr}`, stdout: ran.stdout };
}

/** `mnema record commit` in process, in `checkout`. */
function commitIn(checkout: string, through?: string) {
  return runRecordCommit(
    { cwd: checkout, env: { home: join(sandbox, 'home') }, processEnv: env(), now: Date.now() },
    through !== undefined ? { through } : {},
  );
}

/** A decision recorded by the binary in `checkout`; its id. */
function decide(checkout: string, title: string): string {
  const ran = mnema(checkout, 'decision', 'record', title, 'a rationale');
  expect(ran.status, ran.out).toBe(0);
  const id = /\(([0-9a-f-]{36})\)/.exec(ran.out)?.[1];
  if (id === undefined) throw new Error(ran.out);
  return id;
}

/** A remote, and a clone of it with a record founded, committed and pushed. */
function world(): { local: string; remote: string } {
  const remote = join(sandbox, 'remote.git');
  const local = join(sandbox, 'local');
  expect(git(sandbox, 'init', '-q', '--bare', remote).status).toBe(0);
  expect(git(sandbox, 'clone', '-q', remote, local).status).toBe(0);
  expect(mnema(local, 'init', '--all-hosts').status).toBe(0);
  expect(git(local, 'add', '.').status).toBe(0);
  expect(git(local, 'commit', '-qm', 'the record').status).toBe(0);
  expect(git(local, 'push', '-q', 'origin', 'main').status).toBe(0);
  // A clone of an empty remote knows no default branch yet; this one names it, offline.
  expect(git(local, 'remote', 'set-head', 'origin', 'main').status).toBe(0);
  return { local, remote };
}

function theTail(checkout: string): string {
  const tails = readdirSync(join(checkout, '.mnema', 'tails'));
  expect(tails).toHaveLength(1);
  return `.mnema/tails/${tails[0] as string}`;
}

/** The checkpoints' last covered seq, line by line. */
function toSeqs(bytes: string): number[] {
  return bytes
    .split('\n')
    .filter(Boolean)
    .map((line) => (JSON.parse(line) as { toSeq: number }).toSeq);
}

/** What `git status`, the index, HEAD and the record's files are: the state a cut must not move. */
function stateOf(checkout: string): string {
  const files = git(checkout, 'ls-files', '--cached', '--others', '--exclude-standard', '.mnema')
    .out.split('\n')
    .filter(Boolean)
    .map((path) => `${path}\n${readFileSync(join(checkout, path), 'utf-8')}`);
  return [
    git(checkout, 'status', '--porcelain=v1', '--untracked-files=all').out,
    git(checkout, 'rev-parse', 'HEAD').out,
    git(checkout, 'symbolic-ref', 'HEAD').out,
    readFileSync(join(checkout, '.git', 'index')).toString('base64'),
    ...files,
  ].join('\n');
}

const SLOW = { timeout: 90_000 };

describe('mnema record commit', SLOW, () => {
  it('cuts each tail at its last checkpoint onto a branch, touching nothing here, and the branch verifies', () => {
    const { local } = world();
    decide(local, 'the first decision');
    decide(local, 'the second decision');
    // A private event: this machine's own tree, never a commit's.
    expect(
      mnema(local, 'decision', 'record', 'a private one', 'why', '--scope', 'private').status,
    ).toBe(0);
    expect(readdirSync(join(local, '.git', 'mnema'), { recursive: true }).length).toBeGreaterThan(
      0,
    );
    // And a line above the last checkpoint, which no checkpoint covers: it stays out.
    const tail = theTail(local);
    const segment = readFileSync(join(local, tail, '000001.jsonl'), 'utf-8');
    const checkpoints = readFileSync(join(local, tail, 'checkpoints.jsonl'), 'utf-8');
    const lastLine = segment.trimEnd().split('\n').pop() as string;
    const above = JSON.parse(lastLine) as { link: { seq: number } };
    const before = stateOf(local);

    const made = commitIn(local);
    if (!made.ok || made.kind !== 'made') throw new Error(JSON.stringify(made));
    expect(stateOf(local)).toBe(before);
    expect(made.decisions.map((one) => [one.adr, one.state])).toEqual([
      ['ADR-1', 'proposed'],
      ['ADR-2', 'proposed'],
    ]);
    expect(made.branch).toMatch(/^mnema-record\/adr-1-to-2-[0-9a-f]{12}$/);
    expect(made.title).toBe('Record ADR-1 and ADR-2');

    // The commit's tree is the base's with the tail grown to its last checkpoint, and nothing else.
    const changed = git(local, 'diff', '--name-only', 'origin/main', made.commit)
      .out.split('\n')
      .filter(Boolean)
      .sort();
    expect(changed).toEqual([`${tail}/000001.jsonl`, `${tail}/checkpoints.jsonl`]);
    const lastTo = toSeqs(checkpoints).pop() as number;
    const cutSegment = git(local, 'show', `${made.commit}:${tail}/000001.jsonl`).out;
    expect(cutSegment).toBe(
      `${segment
        .split('\n')
        .slice(0, lastTo + 1)
        .join('\n')}\n`,
    );
    expect(git(local, 'show', `${made.commit}:${tail}/checkpoints.jsonl`).out).toBe(checkpoints);
    expect(above.link.seq).toBe(lastTo);
    expect(git(local, 'ls-tree', '-r', '--name-only', made.commit).out).not.toMatch(/private/);
    expect(git(local, 'grep', '-c', 'a private one', made.commit).status).toBe(1);
    expect(made.left.events).toBe(0);

    // The branch, checked out apart, verifies, and verifies as the base grown.
    const apart = join(sandbox, 'apart');
    expect(git(sandbox, 'clone', '-q', '-b', made.branch, local, apart).status).toBe(0);
    expect(mnema(apart, 'verify', '--require', 'signed').status).toBe(0);
    expect(mnema(apart, 'verify', '--since', 'origin/main').status).toBe(0);
  });

  it('carries a tail the base lacks with its tail proof and the key that signs it', () => {
    const { local } = world();
    const held = git(local, 'ls-tree', '-r', '--name-only', 'origin/main', '.mnema').out;
    // A second key writing here opens a tail, and puts its key, that git does not track yet.
    const second = { ...env(), HOME: join(sandbox, 'second-home') };
    mkdirSync(second.HOME, { recursive: true });
    const wrote = spawnSync(
      process.execPath,
      [CLI, 'decision', 'record', 'from a second key', 'why'],
      {
        cwd: local,
        encoding: 'utf-8',
        env: second,
      },
    );
    expect(wrote.status, `${wrote.stdout}${wrote.stderr}`).toBe(0);
    const made = commitIn(local);
    if (!made.ok || made.kind !== 'made') throw new Error(JSON.stringify(made));
    const added = git(local, 'diff', '--name-only', '--diff-filter=A', 'origin/main', made.commit)
      .out.split('\n')
      .filter(Boolean);
    const opened = made.tails.find((cut) => !held.includes(cut.tail));
    if (opened === undefined) throw new Error(JSON.stringify(made.tails));
    const fp = opened.tail.slice(0, opened.tail.lastIndexOf('-'));
    expect(added.sort()).toEqual(
      [
        `.mnema/keys/${fp}.pub`,
        `.mnema/tails/${opened.tail}/000001.jsonl`,
        `.mnema/tails/${opened.tail}/checkpoints.jsonl`,
        `.mnema/tails/${opened.tail}/tailproof.json`,
      ].sort(),
    );
  });

  it('leaves out the events above the last checkpoint, and counts them', () => {
    const { local } = world();
    decide(local, 'one');
    const tail = theTail(local);
    // A line the writer appends after its checkpoint, as a crash between the two would leave it.
    const segmentPath = join(local, tail, '000001.jsonl');
    const lines = readFileSync(segmentPath, 'utf-8').trimEnd().split('\n');
    appendFileSync(segmentPath, `${lines[lines.length - 1] as string}\n`);
    const made = commitIn(local);
    if (!made.ok || made.kind !== 'made') throw new Error(JSON.stringify(made));
    expect(made.left.events).toBe(1);
    expect(git(local, 'show', `${made.commit}:${tail}/000001.jsonl`).out).toBe(
      `${lines.join('\n')}\n`,
    );
  });

  it('pushed and merged into the default branch, record pull brings it back with the events above the cut kept', () => {
    const { local, remote } = world();
    decide(local, 'committed now');
    const made = commitIn(local);
    if (!made.ok || made.kind !== 'made') throw new Error(JSON.stringify(made));
    const later = decide(local, 'recorded after the cut');
    expect(git(local, 'push', '-q', 'origin', made.branch).status).toBe(0);
    // The pull request merged, on the forge's side: a clone that merges the branch into main.
    const forge = join(sandbox, 'forge');
    expect(git(sandbox, 'clone', '-q', remote, forge).status).toBe(0);
    expect(
      git(forge, 'merge', '-q', '--no-ff', '-m', 'merge', `origin/${made.branch}`).status,
    ).toBe(0);
    expect(git(forge, 'push', '-q', 'origin', 'main').status).toBe(0);

    const pulled = mnema(local, 'record', 'pull');
    expect(pulled.status, pulled.out).toBe(0);
    expect(git(local, 'rev-parse', 'HEAD').out).toBe(git(local, 'rev-parse', 'origin/main').out);
    expect(mnema(local, 'show', later).status).toBe(0);
    expect(mnema(local, 'verify').status).toBe(0);
    // And now the base holds the first cut, the next one carries the later decision only.
    const next = commitIn(local);
    if (!next.ok || next.kind !== 'made') throw new Error(JSON.stringify(next));
    expect(next.decisions.map((one) => one.adr)).toEqual(['ADR-2']);
  });

  it('cuts through the checkpoint that covers the decision --through names', () => {
    const { local } = world();
    decide(local, 'first');
    const second = decide(local, 'second');
    decide(local, 'third');
    const made = commitIn(local, 'ADR-2');
    if (!made.ok || made.kind !== 'made') throw new Error(JSON.stringify(made));
    expect(made.decisions.map((one) => one.adr)).toEqual(['ADR-1', 'ADR-2']);
    expect(made.left.events).toBeGreaterThan(0);
    const tail = theTail(local);
    const carried = git(local, 'show', `${made.commit}:${tail}/000001.jsonl`).out;
    expect(carried).toContain(second);
    expect(carried).not.toContain('"third"');
    // The same by its id.
    const byId = commitIn(local, second);
    if (!byId.ok) throw new Error(JSON.stringify(byId));
    expect(byId.kind).toBe('exists');
    expect(byId.branch).toBe(made.branch);
  });

  it('says nothing to commit and makes no branch when the base holds the cut, and names a branch of the same cut', () => {
    const { local } = world();
    const nothing = commitIn(local);
    expect(nothing.ok && nothing.kind).toBe('nothing');
    expect(git(local, 'for-each-ref', 'refs/heads/mnema-record/').out).toBe('');
    decide(local, 'one');
    const made = mnema(local, 'record', 'commit');
    expect(made.status, made.out).toBe(0);
    const again = mnema(local, 'record', 'commit');
    expect(again.status).toBe(0);
    expect(again.out).toMatch(/A branch of this cut is there already/);
    expect(
      git(local, 'for-each-ref', 'refs/heads/mnema-record/').out.trim().split('\n'),
    ).toHaveLength(1);
  });

  it('refuses a base whose tail is not the start of the one here, pointing at record pull', () => {
    const { local, remote } = world();
    const forge = join(sandbox, 'forge');
    expect(git(sandbox, 'clone', '-q', remote, forge).status).toBe(0);
    const tail = theTail(forge);
    appendFileSync(join(forge, tail, '000001.jsonl'), '{"forged":1}\n');
    expect(git(forge, 'commit', '-qam', 'a fork').status).toBe(0);
    expect(git(forge, 'push', '-q', 'origin', 'main').status).toBe(0);
    expect(git(local, 'fetch', '-q').status).toBe(0);
    decide(local, 'one');
    const refused = mnema(local, 'record', 'commit');
    expect(refused.status).toBe(1);
    expect(refused.out).toContain(`${tail}/000001.jsonl`);
    expect(refused.out).toMatch(/mnema record pull/);
    expect(git(local, 'for-each-ref', 'refs/heads/mnema-record/').out).toBe('');
  });

  it('refuses a cut the readers do not verify, and makes no branch', () => {
    const { local } = world();
    decide(local, 'one');
    const tail = theTail(local);
    const path = join(local, tail, 'checkpoints.jsonl');
    const lines = readFileSync(path, 'utf-8').trimEnd().split('\n');
    const last = JSON.parse(lines.pop() as string) as Record<string, unknown>;
    last.sig = '0'.repeat(128);
    const keys = Object.keys(last).sort();
    lines.push(JSON.stringify(Object.fromEntries(keys.map((key) => [key, last[key]]))));
    writeFileSync(path, `${lines.join('\n')}\n`);
    const refused = commitIn(local);
    expect(refused.ok ? refused.kind : refused.reason).toBe('DOES_NOT_VERIFY');
    expect(git(local, 'for-each-ref', 'refs/heads/mnema-record/').out).toBe('');
  });

  it("signs the commit where the clone's configuration says git commit signs", () => {
    const { local } = world();
    decide(local, 'one');
    const signer = join(sandbox, 'signer.sh');
    writeFileSync(
      signer,
      '#!/bin/sh\ncat >/dev/null\necho "[GNUPG:] SIG_CREATED D 1 8 00 0 X" >&2\nprintf -- "-----BEGIN PGP SIGNATURE-----\\n\\nfake\\n-----END PGP SIGNATURE-----\\n"\n',
    );
    chmodSync(signer, 0o755);
    expect(git(local, 'config', 'commit.gpgSign', 'true').status).toBe(0);
    expect(git(local, 'config', 'gpg.program', signer).status).toBe(0);
    const made = commitIn(local);
    if (!made.ok || made.kind !== 'made') throw new Error(JSON.stringify(made));
    expect(git(local, 'cat-file', 'commit', made.commit).out).toMatch(/^gpgsig /m);

    // A signer that fails makes no branch.
    decide(local, 'two');
    expect(git(local, 'config', 'gpg.program', 'false').status).toBe(0);
    const refused = commitIn(local);
    expect(refused.ok ? refused.kind : refused.reason).toBe('GIT_FAILED');
  });

  it('refuses where this clone does not know the default branch, and says how to name it', () => {
    const { local } = world();
    expect(git(local, 'remote', 'set-head', 'origin', '-d').status).toBe(0);
    decide(local, 'one');
    const refused = mnema(local, 'record', 'commit');
    expect(refused.status).toBe(1);
    expect(refused.out).toMatch(/git remote set-head origin --auto/);
  });

  it('prints what it cut and the commands to run, and --json says the same', () => {
    const { local } = world();
    decide(local, 'one');
    const json = mnema(local, 'record', 'commit', '--json', '--through', 'ADR-1');
    expect(json.status, json.out).toBe(0);
    const said = JSON.parse(json.stdout) as {
      kind: string;
      branch: string;
      decisions: { adr: string }[];
      next: { push: string; forge: string };
    };
    expect(said.kind).toBe('made');
    expect(said.decisions.map((one) => one.adr)).toEqual(['ADR-1']);
    expect(said.next.push).toBe(`git push -u origin ${said.branch}`);
    expect(said.next.forge).toBe('other');
    const plain = mnema(local, 'record', 'commit');
    expect(plain.out).toContain(`git push -u origin ${said.branch}`);
    expect(plain.out).toMatch(/ADR-1 \(proposed\): one/);
  });
});

describe('the command that opens the pull request', () => {
  const ask = {
    remote: 'origin',
    base: 'main',
    branch: 'mnema-record/adr-1-0123456789ab',
    title: 'Record ADR-1',
    body: "it's the body",
  };

  it('is gh for a GitHub address, in each of its spellings', () => {
    for (const url of [
      'https://github.com/owner/repo.git',
      'git@github.com:owner/repo.git',
      'ssh://git@github.com/owner/repo',
      'https://user:secret@github.com/owner/repo',
    ]) {
      const next = nextCommands({ ...ask, url });
      expect(next.forge).toBe('github');
      expect(next.open).toBe(
        "gh pr create --base main --head mnema-record/adr-1-0123456789ab --title 'Record ADR-1' --body 'it'\\''s the body'",
      );
      expect(next.open).not.toContain('secret');
    }
  });

  it('is glab for a GitLab address', () => {
    const next = nextCommands({ ...ask, url: 'git@gitlab.com:group/repo.git' });
    expect(next.forge).toBe('gitlab');
    expect(next.open).toBe(
      "glab mr create --target-branch main --source-branch mnema-record/adr-1-0123456789ab --title 'Record ADR-1' --description 'it'\\''s the body'",
    );
    expect(nextCommands({ ...ask, url: 'https://gitlab.example.org/g/r' }).forge).toBe('gitlab');
  });

  it('is a sentence for any other forge, naming no address', () => {
    const next = nextCommands({ ...ask, url: 'https://code.example.org/user:pw/repo.git' });
    expect(next.forge).toBe('other');
    expect(next.open).toBe(
      'open a pull request from mnema-record/adr-1-0123456789ab into main on the forge that hosts origin, titled "Record ADR-1"',
    );
    expect(next.push).toBe('git push -u origin mnema-record/adr-1-0123456789ab');
  });

  it('reads the host out of an address', () => {
    expect(remoteHost('https://u:p@GitHub.com:443/o/r')).toBe('github.com');
    expect(remoteHost('git@gitlab.com:g/r.git')).toBe('gitlab.com');
    expect(remoteHost('/srv/repo.git')).toBeUndefined();
  });
});
