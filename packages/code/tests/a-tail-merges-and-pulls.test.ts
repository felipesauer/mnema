/**
 * A TAIL ONLY GROWS, AND GIT IS TOLD SO: with real git, a real record and the built binary.
 *
 * The case that asked for this: the record's tail is appended to here and left uncommitted, a pull
 * request carries those events to the branch this checkout follows, and `git pull` then refuses
 * ("Your local changes ... would be overwritten by merge") although the branch holds only the start
 * of the local file. `mnema record pull` pulls over it; a merge of a branch that grew the same tail
 * is clean through the driver, and stops on a conflict without it, as it always did; a fork is named
 * and never joined. Neither `record pull` nor `init` writes a line of git's configuration.
 */

import { spawnSync } from 'node:child_process';
import {
  cpSync,
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
import { mergeDriverLines } from '../src/commands/doctor-merge-driver.js';
import { driverCommand } from '../src/commands/record-pull.js';
import { GIT_WITHOUT_MAINTENANCE } from './support/git-without-maintenance.js';

const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

let sandbox: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-tail-merges-'));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** The environment every program here runs with: the sandbox's home, git without maintenance. */
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

/** `git <args>` in `cwd`. */
function git(cwd: string, ...args: string[]): { status: number; out: string } {
  const ran = spawnSync('git', ['-c', 'init.defaultBranch=main', ...args], {
    cwd,
    encoding: 'utf-8',
    env: { ...env(), GIT_CONFIG_GLOBAL: GIT_WITHOUT_MAINTENANCE },
  });
  return { status: ran.status ?? -1, out: `${ran.stdout}${ran.stderr}` };
}

/** The built binary, in `cwd`. */
function mnema(cwd: string, ...args: string[]): { status: number; out: string } {
  const ran = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf-8', env: env() });
  return { status: ran.status ?? -1, out: `${ran.stdout}${ran.stderr}` };
}

/** The driver as `record pull` hands it, for the merges a test runs by hand. */
const DRIVER = `merge.mnema-tail.driver=${driverCommand(process.execPath, CLI)}`;

/**
 * A remote, the checkout that writes (`local`) with a record founded and pushed, and a second
 * checkout (`other`) where what a pull request carries is committed.
 */
function world(): { local: string; other: string } {
  const remote = join(sandbox, 'remote.git');
  const local = join(sandbox, 'local');
  const other = join(sandbox, 'other');
  mkdirSync(join(sandbox, 'home'), { recursive: true });
  expect(git(sandbox, 'init', '-q', '--bare', remote).status).toBe(0);
  expect(git(sandbox, 'clone', '-q', remote, local).status).toBe(0);
  expect(mnema(local, 'init', '--all-hosts').status).toBe(0);
  expect(mnema(local, 'task', 'create', 'one').status).toBe(0);
  expect(git(local, 'add', '.').status).toBe(0);
  expect(git(local, 'commit', '-qm', 'the record').status).toBe(0);
  expect(git(local, 'push', '-q', 'origin', 'main').status).toBe(0);
  expect(git(sandbox, 'clone', '-q', remote, other).status).toBe(0);
  return { local, other };
}

/** The one tail of the public tree, as its directory from the checkout's top. */
function theTail(checkout: string): string {
  const tails = readdirSync(join(checkout, '.mnema', 'tails'));
  expect(tails).toHaveLength(1);
  return join('.mnema', 'tails', tails[0] as string);
}

/** What a pull request carries: the record's tails and keys as `local` holds them, committed in `other`. */
function carry(local: string, other: string): void {
  for (const part of ['tails', 'keys']) {
    cpSync(join(local, '.mnema', part), join(other, '.mnema', part), { recursive: true });
  }
  expect(git(other, 'add', '.mnema').status).toBe(0);
  expect(git(other, 'commit', '-qm', 'carry the record').status).toBe(0);
  expect(git(other, 'push', '-q', 'origin', 'main').status).toBe(0);
}

/** The merge settings git holds in the checkout's own configuration. */
function mergeSettings(checkout: string): string {
  return git(checkout, 'config', '--local', '--get-regexp', '^merge\\.').out.trim();
}

describe('mnema record pull', () => {
  it('pulls over events not yet committed when the branch holds their start, and writes no configuration', () => {
    const { local, other } = world();
    expect(mnema(local, 'task', 'create', 'two').status).toBe(0);
    carry(local, other);
    expect(mnema(local, 'task', 'create', 'three').status).toBe(0);
    const segment = join(local, theTail(local), '000001.jsonl');
    const before = readFileSync(segment);

    // The case that asked for it: git alone refuses.
    const plain = git(local, 'pull');
    expect(plain.status).not.toBe(0);
    expect(plain.out).toMatch(/would be overwritten by merge/);

    const pulled = mnema(local, 'record', 'pull');
    expect(pulled.out).toMatch(/Pulled origin\/main\./);
    expect(pulled.status).toBe(0);
    expect(readFileSync(segment).equals(before)).toBe(true);
    expect(git(local, 'rev-parse', 'HEAD').out).toBe(git(local, 'rev-parse', 'origin/main').out);
    expect(mnema(local, 'verify').status).toBe(0);
    expect(mergeSettings(local)).toBe('');
  });

  it('refuses a tail that forked, naming the file and the line, and writes nothing', () => {
    const { local, other } = world();
    const tail = theTail(local);
    const segment = join(tail, '000001.jsonl');
    const lines = readFileSync(join(other, segment), 'utf-8').split('\n').length;
    writeFileSync(
      join(other, segment),
      `${readFileSync(join(other, segment), 'utf-8')}{"forged":1}\n`,
    );
    expect(git(other, 'commit', '-qam', 'a fork').status).toBe(0);
    expect(git(other, 'push', '-q', 'origin', 'main').status).toBe(0);
    expect(mnema(local, 'task', 'create', 'two').status).toBe(0);
    const head = git(local, 'rev-parse', 'HEAD').out;
    const before = readFileSync(join(local, segment));

    const refused = mnema(local, 'record', 'pull');
    expect(refused.status).toBe(1);
    expect(refused.out).toContain(`${segment}: the two sides part at line ${lines}`);
    expect(refused.out).toMatch(/fork/);
    expect(readFileSync(join(local, segment)).equals(before)).toBe(true);
    expect(git(local, 'rev-parse', 'HEAD').out).toBe(head);
    expect(mergeSettings(local)).toBe('');
  });

  it('refuses where a file outside the record has changes, and names it', () => {
    const { local } = world();
    writeFileSync(join(local, 'AGENTS.md'), 'changed\n');
    const refused = mnema(local, 'record', 'pull');
    expect(refused.status).toBe(1);
    expect(refused.out).toMatch(/Files outside the record have changes \(AGENTS\.md\)/);
  });

  it('puts back a tail this checkout opened and the branch already holds, with what it added since', () => {
    const { local, other } = world();
    // A second key writing here opens a tail of its own, which git does not track yet.
    const second = { ...env(), HOME: join(sandbox, 'second-home') };
    mkdirSync(second.HOME, { recursive: true });
    const write = (title: string) =>
      spawnSync(process.execPath, [CLI, 'task', 'create', title], {
        cwd: local,
        encoding: 'utf-8',
        env: second,
      });
    expect(write('from a second key').status).toBe(0);
    carry(local, other);
    expect(write('and one more').status).toBe(0);
    const grown = git(local, 'status', '--porcelain', '--untracked-files=all', '.mnema').out;
    expect(grown).toMatch(/\?\? \.mnema\/tails\//);
    expect(git(local, 'pull').out).toMatch(/untracked working tree files would be overwritten/);

    const pulled = mnema(local, 'record', 'pull');
    expect(pulled.out).toMatch(/put back, with the events this checkout adds/);
    expect(pulled.status).toBe(0);
    expect(mnema(local, 'verify').status).toBe(0);
  });
});

describe('the driver record pull hands git', () => {
  it("is this installation's node and script, quoted for the shell git runs it through", () => {
    expect(driverCommand('/opt/a b/node', "/x/it's/cli.js")).toBe(
      "'/opt/a b/node' '/x/it'\\''s/cli.js' record merge-tail %O %A %B %P",
    );
  });
});

describe('the merge driver, in a merge git runs', () => {
  /** Both sides grow the record and commit: `other` holds what a pull request carried, `local` more. */
  function grownOnBothSides(): { local: string; segment: string; longer: Buffer } {
    const { local, other } = world();
    expect(mnema(local, 'task', 'create', 'two').status).toBe(0);
    carry(local, other);
    expect(mnema(local, 'task', 'create', 'three').status).toBe(0);
    expect(git(local, 'add', '.mnema').status).toBe(0);
    expect(git(local, 'commit', '-qm', 'more').status).toBe(0);
    const segment = join(theTail(local), '000001.jsonl');
    return { local, segment, longer: readFileSync(join(local, segment)) };
  }

  it('without the driver, a merge of a grown tail stops on a conflict, as git always did', () => {
    const { local } = grownOnBothSides();
    const merged = git(local, 'pull', '--no-rebase');
    expect(merged.status).not.toBe(0);
    expect(merged.out).toMatch(/CONFLICT \(content\): Merge conflict in \.mnema\/tails\//);
  });

  it('with the driver, the same merge is clean and keeps the longer side byte for byte', () => {
    const { local, segment, longer } = grownOnBothSides();
    const merged = git(local, '-c', DRIVER, 'pull', '--no-rebase');
    expect(merged.out).not.toMatch(/CONFLICT/);
    expect(merged.status).toBe(0);
    expect(readFileSync(join(local, segment)).equals(longer)).toBe(true);
    expect(mnema(local, 'verify').status).toBe(0);
  });

  it('a fork stops the merge, is named with its line, and our side stays as it was', () => {
    const { local, other } = world();
    const segment = join(theTail(local), '000001.jsonl');
    const lines = readFileSync(join(other, segment), 'utf-8').split('\n').length;
    writeFileSync(
      join(other, segment),
      `${readFileSync(join(other, segment), 'utf-8')}{"forged":1}\n`,
    );
    expect(git(other, 'commit', '-qam', 'a fork').status).toBe(0);
    expect(git(other, 'push', '-q', 'origin', 'main').status).toBe(0);
    expect(mnema(local, 'task', 'create', 'two').status).toBe(0);
    expect(git(local, 'add', '.mnema').status).toBe(0);
    expect(git(local, 'commit', '-qm', 'two').status).toBe(0);
    const ours = readFileSync(join(local, segment));

    const merged = git(local, '-c', DRIVER, 'pull', '--no-rebase');
    expect(merged.status).not.toBe(0);
    expect(merged.out).toContain(`the two sides part at line ${lines}`);
    expect(merged.out).toMatch(/fork/);
    expect(readFileSync(join(local, segment)).equals(ours)).toBe(true);
  });
});

describe('mnema init', () => {
  it('names the driver in the record and writes no line of git configuration', () => {
    const { local } = world();
    expect(readFileSync(join(local, '.mnema', '.gitattributes'), 'utf-8')).toContain(
      'tails/*/*.jsonl merge=mnema-tail\n',
    );
    expect(mergeSettings(local)).toBe('');
  });
});

describe('the doctor', () => {
  it('names a driver git does not know, and only --fix merge-driver writes it, --dry-run first', () => {
    const { local } = world();
    const asked = mnema(local, 'doctor');
    expect(asked.out).toMatch(/to do · merge-driver: git merges this record's tails as text/);
    const read = mergeDriverLines({
      cwd: local,
      env: { home: join(sandbox, 'home') },
      processEnv: env(),
    });
    expect(read).toHaveLength(1);
    expect(read[0]).toMatch(
      /`mnema doctor --fix merge-driver` writes it into this repository's git configuration/,
    );
    expect(mergeSettings(local)).toBe('');

    const dry = mnema(local, 'doctor', '--fix', 'merge-driver', '--dry-run');
    expect(dry.status).toBe(0);
    expect(dry.out).toMatch(
      /would set merge\.mnema-tail\.driver = mnema record merge-tail %O %A %B %P/,
    );
    expect(mergeSettings(local)).toBe('');

    const fixed = mnema(local, 'doctor', '--fix', 'merge-driver');
    expect(fixed.status).toBe(0);
    expect(mergeSettings(local)).toBe(
      [
        'merge.mnema-tail.name mnema: keep the longer side of a tail that only grows',
        'merge.mnema-tail.driver mnema record merge-tail %O %A %B %P',
      ].join('\n'),
    );
    expect(mnema(local, 'doctor').out).not.toMatch(/merge-driver/);
    expect(mnema(local, 'doctor', '--fix', 'merge-driver').out).toMatch(/nothing to change/);
  });

  it('leaves a driver of the same name it did not write, and says so', () => {
    const { local } = world();
    expect(git(local, 'config', 'merge.mnema-tail.driver', 'cat').status).toBe(0);
    const refused = mnema(local, 'doctor', '--fix', 'merge-driver');
    expect(refused.status).toBe(1);
    expect(refused.out).toMatch(
      /merge\.mnema-tail\.driver is already set to cat, which mnema did not write/,
    );
    expect(git(local, 'config', '--get', 'merge.mnema-tail.driver').out.trim()).toBe('cat');
  });
});
