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
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkpointHash, parseCheckpoint } from '@mnema/chain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  cutBranch,
  cutTitle,
  nextCommands,
  remoteHost,
  runRecordCommit,
  whatInitWritesInTheRecord,
} from '../src/commands/record-commit.js';
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
    env: { ...env(), GIT_CONFIG_GLOBAL: GIT_WITHOUT_MAINTENANCE },
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
  // Every file of the record's folder, the ones git ignores too.
  const record = join(checkout, '.mnema');
  const files = readdirSync(record, { recursive: true, encoding: 'utf-8' })
    .filter((path) => statSync(join(record, path)).isFile())
    .sort()
    .map((path) => `${path}\n${readFileSync(join(record, path)).toString('base64')}`);
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
    expect(made.branch).toMatch(/^mnema-record\/adr-1-2-[0-9a-f]{12}$/);
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

  it('carries the files init writes when the base holds no record, byte for byte', () => {
    const remote = join(sandbox, 'remote.git');
    const local = join(sandbox, 'local');
    expect(git(sandbox, 'init', '-q', '--bare', remote).status).toBe(0);
    expect(git(sandbox, 'clone', '-q', remote, local).status).toBe(0);
    writeFileSync(join(local, 'code.txt'), 'the work\n');
    expect(git(local, 'add', 'code.txt').status).toBe(0);
    expect(git(local, 'commit', '-qm', 'the work').status).toBe(0);
    expect(git(local, 'push', '-q', 'origin', 'main').status).toBe(0);
    expect(git(local, 'remote', 'set-head', 'origin', 'main').status).toBe(0);
    expect(mnema(local, 'init', '--all-hosts').status).toBe(0);
    decide(local, 'one');
    const made = commitIn(local);
    if (!made.ok || made.kind !== 'made') throw new Error(JSON.stringify(made));
    const names = whatInitWritesInTheRecord();
    expect(names).toEqual(['.editorconfig', '.gitattributes', '.gitignore', 'README.md']);
    for (const name of names) {
      expect(git(local, 'show', `${made.commit}:.mnema/${name}`).out, name).toBe(
        readFileSync(join(local, '.mnema', name), 'utf-8'),
      );
    }
    expect(git(local, 'show', `${made.commit}:.mnema/.gitattributes`).out).toMatch(
      /^\* -text$[\s\S]*merge=mnema-tail/m,
    );
  });

  it('keeps an older file init writes as the base holds it, and names it', () => {
    const remote = join(sandbox, 'remote.git');
    const local = join(sandbox, 'local');
    expect(git(sandbox, 'init', '-q', '--bare', remote).status).toBe(0);
    expect(git(sandbox, 'clone', '-q', remote, local).status).toBe(0);
    expect(mnema(local, 'init', '--all-hosts').status).toBe(0);
    // The base holds the .gitattributes of a record made before the tails' merge line existed.
    const older = "# Managed by mnema: this file governs only mnema's own tree.\n* -text\n";
    writeFileSync(join(local, '.mnema', '.gitattributes'), older);
    expect(git(local, 'add', '.').status).toBe(0);
    expect(git(local, 'commit', '-qm', 'the record').status).toBe(0);
    expect(git(local, 'push', '-q', 'origin', 'main').status).toBe(0);
    expect(git(local, 'remote', 'set-head', 'origin', 'main').status).toBe(0);
    // The next write gives this clone's copy the line it lacks.
    decide(local, 'one');
    expect(readFileSync(join(local, '.mnema', '.gitattributes'), 'utf-8')).toMatch(/merge=/);
    const made = commitIn(local);
    if (!made.ok || made.kind !== 'made') throw new Error(JSON.stringify(made));
    expect(git(local, 'show', `${made.commit}:.mnema/.gitattributes`).out).toBe(older);
    expect(made.left.files).toEqual(['.mnema/.gitattributes']);
    expect(mnema(local, 'record', 'commit').out).toContain('.mnema/.gitattributes');
  });

  it('leaves out the events above the last checkpoint, and counts them', () => {
    const { local } = world();
    decide(local, 'one');
    const tail = theTail(local);
    // A line the writer appends after its checkpoint, as a crash between the two would leave it.
    const segmentPath = join(local, tail, '000001.jsonl');
    const lines = readFileSync(segmentPath, 'utf-8').trimEnd().split('\n');
    appendFileSync(segmentPath, `${lines[lines.length - 1] as string}\n`);
    // And a file of the record that is not part of the proof, changed here.
    appendFileSync(join(local, '.mnema', 'README.md'), 'a line of mine\n');
    const made = commitIn(local);
    if (!made.ok || made.kind !== 'made') throw new Error(JSON.stringify(made));
    expect(made.left.events).toBe(1);
    expect(made.left.files).toEqual(['.mnema/README.md']);
    expect(git(local, 'show', `${made.commit}:.mnema/README.md`).out).not.toContain(
      'a line of mine',
    );
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
    if (!byId.ok || byId.kind !== 'exists') throw new Error(JSON.stringify(byId));
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

/** The hash of the last checkpoint of a tail, the name its witness files carry. */
function lastCheckpointHash(checkout: string, tail: string): string {
  const lines = readFileSync(join(checkout, tail, 'checkpoints.jsonl'), 'utf-8')
    .trimEnd()
    .split('\n');
  return checkpointHash(parseCheckpoint(lines[lines.length - 1] as string));
}

describe('mnema record commit, run from where git points elsewhere', SLOW, () => {
  it('writes no index a hook or a caller named, and still makes the branch', () => {
    const { local } = world();
    decide(local, 'one');
    const outside = join(sandbox, 'outside-index');
    const held = join(sandbox, 'held-index');
    writeFileSync(held, 'not an index\n');
    for (const index of [outside, held]) {
      const before = existsSync(index) ? readFileSync(index) : undefined;
      const ran = spawnSync(process.execPath, [CLI, 'record', 'commit', '--json'], {
        cwd: local,
        encoding: 'utf-8',
        env: { ...env(), GIT_INDEX_FILE: index },
      });
      expect(ran.status, `${ran.stdout}${ran.stderr}`).toBe(0);
      expect(existsSync(index) ? readFileSync(index) : undefined).toEqual(before);
      expect((JSON.parse(ran.stdout) as { kind: string }).kind).toMatch(/^(made|exists)$/);
    }
    expect(git(local, 'for-each-ref', 'refs/heads/mnema-record/').out).not.toBe('');
  });
});

describe('mnema record commit, and the files beside a tail', SLOW, () => {
  it('carries the witness of a checkpoint it carries, and passes over a folder there', () => {
    const { local } = world();
    decide(local, 'one');
    const tail = theTail(local);
    const hash = lastCheckpointHash(local, tail);
    mkdirSync(join(local, tail, 'witness'));
    writeFileSync(join(local, tail, 'witness', `${hash}.blocks`), '');
    mkdirSync(join(local, tail, 'witness', `${hash}.d`));
    const made = commitIn(local);
    if (!made.ok || made.kind !== 'made') throw new Error(JSON.stringify(made));
    const carried = git(local, 'ls-tree', '-r', '--name-only', made.commit, `${tail}/witness`).out;
    expect(carried.split('\n').filter(Boolean)).toEqual([`${tail}/witness/${hash}.blocks`]);
  });

  it('refuses a key, a tail file or a witness that is a symbolic link, naming it', () => {
    const cases: readonly ((local: string, tail: string) => string)[] = [
      (local) => {
        const key = readdirSync(join(local, '.mnema', 'keys')).find((name) =>
          name.endsWith('.pub'),
        ) as string;
        const path = join(local, '.mnema', 'keys', key);
        const copy = join(sandbox, 'elsewhere.pub');
        writeFileSync(copy, readFileSync(path));
        rmSync(path);
        symlinkSync(copy, path);
        return `.mnema/keys/${key}`;
      },
      (local, tail) => {
        const path = join(local, tail, 'checkpoints.jsonl');
        const copy = join(sandbox, 'elsewhere.jsonl');
        writeFileSync(copy, readFileSync(path));
        rmSync(path);
        symlinkSync(copy, path);
        return `${tail}/checkpoints.jsonl`;
      },
      (local, tail) => {
        const hash = lastCheckpointHash(local, tail);
        mkdirSync(join(local, tail, 'witness'));
        writeFileSync(join(sandbox, 'secret'), 'a file of the machine\n');
        symlinkSync(join(sandbox, 'secret'), join(local, tail, 'witness', `${hash}.ots`));
        return `${tail}/witness/${hash}.ots`;
      },
    ];
    for (const [n, link] of cases.entries()) {
      rmSync(join(sandbox, 'remote.git'), { recursive: true, force: true });
      rmSync(join(sandbox, 'local'), { recursive: true, force: true });
      rmSync(join(sandbox, 'secret'), { force: true });
      const { local } = world();
      decide(local, `one ${n}`);
      const named = link(local, theTail(local));
      expect(commitIn(local)).toEqual({ ok: false, reason: 'A_LINK', paths: [named] });
    }
    const said = mnema(join(sandbox, 'local'), 'record', 'commit');
    expect(said.status).toBe(1);
    expect(said.out).toMatch(/symbolic links/);
  });
});

describe('mnema record commit, where there is nothing to cut from', SLOW, () => {
  it('refuses outside a project, and outside a repository', () => {
    const empty = join(sandbox, 'empty');
    mkdirSync(empty);
    expect(commitIn(empty)).toEqual({ ok: false, reason: 'NO_PROJECT' });
    expect(mnema(empty, 'init', '--all-hosts').status).toBe(0);
    expect(commitIn(empty)).toEqual({ ok: false, reason: 'NOT_A_REPOSITORY' });
  });

  it('refuses a repository with no remote, and one with several the branch does not follow', () => {
    const alone = join(sandbox, 'alone');
    expect(git(sandbox, 'init', '-q', alone).status).toBe(0);
    expect(mnema(alone, 'init', '--all-hosts').status).toBe(0);
    expect(commitIn(alone)).toEqual({ ok: false, reason: 'NO_REMOTE', remotes: [] });
    expect(git(alone, 'remote', 'add', 'one', join(sandbox, 'one.git')).status).toBe(0);
    expect(git(alone, 'remote', 'add', 'two', join(sandbox, 'two.git')).status).toBe(0);
    expect(commitIn(alone)).toEqual({ ok: false, reason: 'NO_REMOTE', remotes: ['one', 'two'] });
    const said = mnema(alone, 'record', 'commit');
    expect(said.status).toBe(1);
    expect(said.out).toMatch(/several remotes \(one, two\)/);
  });

  it('refuses a --through that names no decision, or one no checkpoint covers', () => {
    const { local } = world();
    decide(local, 'one');
    expect(commitIn(local, 'ADR-9')).toEqual({
      ok: false,
      reason: 'NO_SUCH_DECISION',
      typed: 'ADR-9',
    });
    // The checkpoints back to the base's, the recording stands above every one of them.
    const tail = theTail(local);
    expect(git(local, 'checkout', 'HEAD', '--', `${tail}/checkpoints.jsonl`).status).toBe(0);
    expect(commitIn(local, 'ADR-1')).toEqual({ ok: false, reason: 'NOT_COVERED', typed: 'ADR-1' });
  });

  it('refuses where the base holds more of a tail than this clone does', () => {
    const { local } = world();
    decide(local, 'one');
    const made = commitIn(local);
    if (!made.ok || made.kind !== 'made') throw new Error(JSON.stringify(made));
    // The base moves to the cut, as a merged pull request would, and this clone loses its lines.
    expect(git(local, 'update-ref', 'refs/remotes/origin/main', made.commit).status).toBe(0);
    const tail = theTail(local);
    expect(git(local, 'checkout', 'HEAD', '--', `${tail}/000001.jsonl`).status).toBe(0);
    const refused = commitIn(local);
    if (refused.ok || refused.reason !== 'NOT_A_PREFIX') throw new Error(JSON.stringify(refused));
    expect(refused.found.map((one) => one.said)).toEqual([
      `${tail}/000001.jsonl: origin/main holds more of it than this clone does.`,
    ]);
  });

  it('says how old the base is', () => {
    const { local } = world();
    const later = runRecordCommit(
      {
        cwd: local,
        env: { home: join(sandbox, 'home') },
        processEnv: env(),
        now: Date.now() + 5 * 3600 * 1000 + 60_000,
      },
      {},
    );
    if (!later.ok) throw new Error(JSON.stringify(later));
    expect(later.base.hoursOld).toBe(5);
  });
});

describe('what a cut is named', () => {
  it('titles the cut by the labels it carries, or by its events', () => {
    expect(cutTitle([], 1)).toBe('Record 1 event');
    expect(cutTitle([], 3)).toBe('Record 3 events');
    expect(cutTitle(['ADR-4'], 2)).toBe('Record ADR-4');
    expect(cutTitle(['ADR-4', 'ADR-9'], 2)).toBe('Record ADR-4 and ADR-9');
    // A range only where the labels run without a gap: one the cut does not carry is never inside one.
    expect(cutTitle(['ADR-1', 'ADR-2', 'ADR-3', 'ADR-4'], 9)).toBe('Record ADR-1 to ADR-4');
    expect(cutTitle(['ADR-1', 'ADR-2', 'ADR-4'], 9)).toBe('Record ADR-1, ADR-2 and ADR-4');
    expect(cutTitle(['ADR-1', 'ADR-2', 'ADR-3', 'ADR-5', 'ADR-6', 'ADR-7', 'ADR-9'], 9)).toBe(
      'Record ADR-1 to ADR-3, ADR-5 to ADR-7 and ADR-9',
    );
  });

  it('names the branch by the labels and the digest, with no range over a gap', () => {
    expect(cutBranch([], '0123456789ab')).toBe('mnema-record/events-0123456789ab');
    expect(cutBranch(['ADR-4'], 'ab')).toBe('mnema-record/adr-4-ab');
    expect(cutBranch(['ADR-4', 'ADR-9'], 'ab')).toBe('mnema-record/adr-4-9-ab');
    expect(cutBranch(['ADR-1', 'ADR-2', 'ADR-3', 'ADR-4'], 'ab')).toBe(
      'mnema-record/adr-1-to-4-ab',
    );
    expect(cutBranch(['ADR-1', 'ADR-2', 'ADR-4'], 'ab')).toBe('mnema-record/adr-1-2-4-ab');
    expect(cutBranch(['ADR-1', 'ADR-3', 'ADR-5', 'ADR-7'], 'ab')).toBe(
      'mnema-record/4-decisions-ab',
    );
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

describe('a remote whose host is an ssh alias', () => {
  const ask = {
    remote: 'origin',
    base: 'main',
    branch: 'mnema-record/adr-1-0123456789ab',
    title: 'Record ADR-1',
    body: 'the body',
  };
  let bin: string | undefined;
  let asked = '';

  /** An `ssh` on a PATH of its own that answers `-G <alias>` the way OpenSSH does, and notes what it was asked. */
  function fakeSsh(script: string): NodeJS.ProcessEnv {
    bin = mkdtempSync(join(tmpdir(), 'mnema-fake-ssh-'));
    asked = join(bin, 'asked');
    writeFileSync(join(bin, 'ssh'), `#!/bin/sh\necho "$*" >> '${asked}'\n${script}\n`);
    chmodSync(join(bin, 'ssh'), 0o755);
    return { PATH: `${bin}:${process.env.PATH ?? ''}`, HOME: bin };
  }

  afterEach(() => {
    if (bin !== undefined) rmSync(bin, { recursive: true, force: true });
    bin = undefined;
  });

  it('is gh when the alias resolves to github.com, and asks ssh for the alias only', () => {
    const env = fakeSsh('printf "user git\\nhostname github.com\\nport 22\\n"');
    const next = nextCommands({ ...ask, url: 'git@work-github:owner/repo.git', env });
    expect(next.forge).toBe('github');
    expect(next.open).toContain('gh pr create --base main');
    expect(readFileSync(asked, 'utf-8').trim()).toBe('-G work-github');
  });

  it('is glab when the alias resolves to a GitLab host', () => {
    const env = fakeSsh('echo "hostname gitlab.example.org"');
    expect(nextCommands({ ...ask, url: 'ssh://git@alias/g/r', env }).forge).toBe('gitlab');
  });

  it('is the generic sentence when ssh fails, is absent or answers nothing useful', () => {
    const failing = fakeSsh('exit 255');
    expect(nextCommands({ ...ask, url: 'git@work-github:o/r.git', env: failing }).forge).toBe(
      'other',
    );
    const nothing = fakeSsh('echo "port 22"');
    expect(nextCommands({ ...ask, url: 'git@work-github:o/r.git', env: nothing }).forge).toBe(
      'other',
    );
    const absent = { PATH: '/nonexistent', HOME: bin ?? '/nonexistent' };
    expect(nextCommands({ ...ask, url: 'git@work-github:o/r.git', env: absent }).forge).toBe(
      'other',
    );
  });

  it('does not ask ssh for a host that is a known forge, or for an address that is not ssh', () => {
    const env = fakeSsh('echo "hostname github.com"');
    nextCommands({ ...ask, url: 'git@github.com:o/r.git', env });
    nextCommands({ ...ask, url: 'git@gitlab.com:o/r.git', env });
    nextCommands({ ...ask, url: 'https://code.example.org/o/r.git', env });
    expect(existsSync(asked)).toBe(false);
  });
});
