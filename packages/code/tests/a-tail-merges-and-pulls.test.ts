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
import { fixMergeDriver, mergeDriverLines } from '../src/commands/doctor-merge-driver.js';
import { driverCommand, runRecordPull } from '../src/commands/record-pull.js';
import { type CliIo, run } from '../src/program.js';
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

/** The command of the driver, as `record pull` hands it and `--fix merge-driver` writes it. */
const DRIVER_COMMAND = driverCommand(process.execPath, CLI);

/** The driver as `record pull` hands it, for the merges a test runs by hand. */
const DRIVER = `merge.mnema-tail.driver=${DRIVER_COMMAND}`;

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

/** `mnema record pull` in process, in `checkout`, with the driver the built binary is. */
function pull(checkout: string) {
  return runRecordPull({
    cwd: checkout,
    env: { home: join(sandbox, 'home') },
    processEnv: env(),
    driver: driverCommand(process.execPath, CLI),
    requirement: 'chained',
  });
}

/** What the doctor's merge driver reading and fix are handed, in `checkout`. */
function doctorIn(checkout: string) {
  return { cwd: checkout, env: { home: join(sandbox, 'home') }, processEnv: env() };
}

/** Many programs start in each case: a remote, two checkouts, the binary and git. */
const SLOW = { timeout: 60_000 };

/** The merge settings git holds in the checkout's own configuration. */
function mergeSettings(checkout: string): string {
  return git(checkout, 'config', '--local', '--get-regexp', '^merge\\.').out.trim();
}

describe('mnema record pull', SLOW, () => {
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

    const refused = pull(local);
    expect(refused.ok).toBe(false);
    if (refused.ok || refused.reason !== 'NOT_A_PREFIX') throw new Error(JSON.stringify(refused));
    expect(refused.found.map((one) => one.path)).toEqual([segment]);
    expect(refused.found[0]?.said).toContain(`${segment}: the two sides part at line ${lines}`);
    expect(refused.found[0]?.said).toMatch(/fork/);
    expect(readFileSync(join(local, segment)).equals(before)).toBe(true);
    expect(git(local, 'rev-parse', 'HEAD').out).toBe(head);
    expect(mergeSettings(local)).toBe('');
  });

  it('refuses where a file outside the record has changes, and names it', () => {
    const { local } = world();
    writeFileSync(join(local, 'AGENTS.md'), 'changed\n');
    expect(pull(local)).toEqual({
      ok: false,
      reason: 'CHANGES_OUTSIDE_THE_RECORD',
      paths: ['AGENTS.md'],
    });
    // And the binary says it, naming the file.
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

    const opened = grown
      .split('\n')
      .filter((line) => line.startsWith('?? .mnema/tails/') && line.endsWith('000001.jsonl'))
      .map((line) => line.slice(3));
    expect(opened).toHaveLength(1);
    const before = readFileSync(join(local, opened[0] as string));

    const pulled = pull(local);
    if (!pulled.ok) throw new Error(JSON.stringify(pulled));
    expect(pulled.pulled.status).toBe(0);
    expect(pulled.restored).toContain(opened[0]);
    expect(pulled.keptAside).toBeUndefined();
    expect(readFileSync(join(local, opened[0] as string)).equals(before)).toBe(true);
    expect(pulled.verdict?.record.ok).toBe(true);
  });
});

describe('mnema record pull, where git does not end clean', SLOW, () => {
  /** `local` and the branch it follows each with a commit the other lacks, and events uncommitted here. */
  function diverged(): { local: string; segment: string; before: Buffer } {
    const { local, other } = world();
    writeFileSync(join(other, 'theirs.txt'), 'theirs\n');
    expect(git(other, 'add', 'theirs.txt').status).toBe(0);
    expect(git(other, 'commit', '-qm', 'theirs').status).toBe(0);
    expect(git(other, 'push', '-q', 'origin', 'main').status).toBe(0);
    writeFileSync(join(local, 'ours.txt'), 'ours\n');
    expect(git(local, 'add', 'ours.txt').status).toBe(0);
    expect(git(local, 'commit', '-qm', 'ours').status).toBe(0);
    expect(mnema(local, 'task', 'create', 'two').status).toBe(0);
    const segment = join(theTail(local), '000001.jsonl');
    return { local, segment, before: readFileSync(join(local, segment)) };
  }

  it('fails, with what git said, and leaves the local events where they were, when git will not reconcile', () => {
    const { local, segment, before } = diverged();
    const pulled = pull(local);
    if (!pulled.ok) throw new Error(JSON.stringify(pulled));
    expect(pulled.pulled.status).not.toBe(0);
    expect(pulled.pulled.said).toMatch(/divergent branches/);
    expect(pulled.verdict).toBeUndefined();
    expect(readFileSync(join(local, segment)).equals(before)).toBe(true);
  });

  it('rebases where the person set pull.rebase, keeping the local events, and verifies', () => {
    const { local, segment, before } = diverged();
    expect(git(local, 'config', 'pull.rebase', 'true').status).toBe(0);
    const pulled = pull(local);
    if (!pulled.ok) throw new Error(JSON.stringify(pulled));
    expect(pulled.pulled.status).toBe(0);
    expect(pulled.unresolved).toBeUndefined();
    expect(readFileSync(join(local, segment)).equals(before)).toBe(true);
    expect(readFileSync(join(local, 'theirs.txt'), 'utf-8')).toBe('theirs\n');
    expect(pulled.verdict?.record.ok).toBe(true);
  });

  it('fails when the autostash comes back in conflict over a file of the record that is not a tail', () => {
    const { local, other } = world();
    const attributes = join('.mnema', '.gitattributes');
    writeFileSync(
      join(other, attributes),
      `${readFileSync(join(other, attributes), 'utf-8')}*.a -diff\n`,
    );
    expect(git(other, 'commit', '-qam', 'theirs').status).toBe(0);
    expect(git(other, 'push', '-q', 'origin', 'main').status).toBe(0);
    writeFileSync(
      join(local, attributes),
      `${readFileSync(join(local, attributes), 'utf-8')}*.b -diff\n`,
    );
    expect(mnema(local, 'task', 'create', 'two').status).toBe(0);

    const pulled = pull(local);
    if (!pulled.ok) throw new Error(JSON.stringify(pulled));
    // Git answered 0: what makes it a failure is what it left.
    expect(pulled.pulled.status).toBe(0);
    expect(pulled.unresolved).toEqual({ conflicted: ['.mnema/.gitattributes'], stashKept: true });
    expect(pulled.verdict).toBeUndefined();
  });

  it('refuses a file of the record that is not a tail and holds other bytes than upstream', () => {
    const { local, other } = world();
    const stray = join('.mnema', 'keys', 'stray.pub');
    writeFileSync(join(other, stray), 'theirs\n');
    expect(git(other, 'add', stray).status).toBe(0);
    expect(git(other, 'commit', '-qm', 'stray').status).toBe(0);
    expect(git(other, 'push', '-q', 'origin', 'main').status).toBe(0);
    writeFileSync(join(local, stray), 'ours\n');

    const refused = pull(local);
    if (refused.ok || refused.reason !== 'NOT_A_PREFIX') throw new Error(JSON.stringify(refused));
    expect(refused.found.map((one) => one.path)).toEqual([stray]);
    expect(refused.found[0]?.said).toMatch(/holds other bytes than on origin\/main/);
    expect(readFileSync(join(local, stray), 'utf-8')).toBe('ours\n');
  });

  it('refuses, changing nothing, where the remote cannot be read', () => {
    const { local } = world();
    expect(git(local, 'remote', 'set-url', 'origin', join(sandbox, 'gone.git')).status).toBe(0);
    const refused = pull(local);
    if (refused.ok || refused.reason !== 'FETCH_FAILED') throw new Error(JSON.stringify(refused));
    expect(refused.said).toMatch(/gone\.git/);
  });
});

describe('mnema record pull, as the command line words it', SLOW, () => {
  /**
   * The verb in process, standing in `cwd` with this sandbox's environment: what it said and
   * whether it failed. Only for the ends where git never runs the driver, since in process the
   * driver this command hands git would be the test runner's own script.
   */
  async function wired(cwd: string): Promise<{ text: string; failed: boolean }> {
    const saved = { cwd: process.cwd(), env: { ...process.env } };
    const lines: string[] = [];
    let failed = false;
    const io: CliIo = {
      out: (line) => lines.push(line),
      err: (line) => lines.push(line),
      fail: () => {
        failed = true;
      },
    };
    try {
      Object.assign(process.env, env());
      process.chdir(cwd);
      await run(['record', 'pull'], io);
    } finally {
      process.chdir(saved.cwd);
      for (const key of Object.keys(process.env)) {
        if (!(key in saved.env)) delete process.env[key];
      }
      Object.assign(process.env, saved.env);
    }
    return { text: lines.join('\n'), failed };
  }

  it('names the files a pull left in conflict and the stash git kept, and fails', async () => {
    const { local, other } = world();
    const attributes = join('.mnema', '.gitattributes');
    writeFileSync(
      join(other, attributes),
      `${readFileSync(join(other, attributes), 'utf-8')}*.a -diff\n`,
    );
    expect(git(other, 'commit', '-qam', 'theirs').status).toBe(0);
    expect(git(other, 'push', '-q', 'origin', 'main').status).toBe(0);
    writeFileSync(
      join(local, attributes),
      `${readFileSync(join(local, attributes), 'utf-8')}*.b -diff\n`,
    );
    const said = await wired(local);
    expect(said.failed).toBe(true);
    expect(said.text).toMatch(/left these files in conflict: \.mnema\/\.gitattributes/);
    expect(said.text).toMatch(/still in its stash/);
    expect(said.text).not.toMatch(/Pulled/);
  });

  it('says what git said when the pull fails, and fails', async () => {
    const { local, other } = world();
    writeFileSync(join(other, 'theirs.txt'), 'theirs\n');
    expect(git(other, 'add', 'theirs.txt').status).toBe(0);
    expect(git(other, 'commit', '-qm', 'theirs').status).toBe(0);
    expect(git(other, 'push', '-q', 'origin', 'main').status).toBe(0);
    writeFileSync(join(local, 'ours.txt'), 'ours\n');
    expect(git(local, 'add', 'ours.txt').status).toBe(0);
    expect(git(local, 'commit', '-qm', 'ours').status).toBe(0);
    const said = await wired(local);
    expect(said.failed).toBe(true);
    expect(said.text).toMatch(/divergent branches/);
    expect(said.text).toMatch(/git pull from origin\/main failed/);
  });

  it('words each refusal: a fork, and a remote it cannot read', async () => {
    const { local, other } = world();
    const segment = join(theTail(local), '000001.jsonl');
    writeFileSync(
      join(other, segment),
      `${readFileSync(join(other, segment), 'utf-8')}{"forged":1}\n`,
    );
    expect(git(other, 'commit', '-qam', 'a fork').status).toBe(0);
    expect(git(other, 'push', '-q', 'origin', 'main').status).toBe(0);
    expect(mnema(local, 'task', 'create', 'two').status).toBe(0);
    const forked = await wired(local);
    expect(forked.failed).toBe(true);
    expect(forked.text).toMatch(/Nothing was pulled or written: .*a fork/);
    expect(git(local, 'remote', 'set-url', 'origin', join(sandbox, 'gone.git')).status).toBe(0);
    const unread = await wired(local);
    expect(unread.failed).toBe(true);
    expect(unread.text).toMatch(
      /Reading the branch followed from its remote failed, and nothing was changed/,
    );
  });
});

describe('the driver record pull hands git', SLOW, () => {
  it("is this installation's node and script, quoted for the shell git runs it through", () => {
    expect(driverCommand('/opt/a b/node', "/x/it's/cli.js")).toBe(
      "'/opt/a b/node' '/x/it'\\''s/cli.js' record merge-tail %O %A %B %P",
    );
  });
});

describe('the merge driver, in a merge git runs', SLOW, () => {
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

describe('mnema init', SLOW, () => {
  it('names the driver in the record and writes no line of git configuration', () => {
    const { local } = world();
    expect(readFileSync(join(local, '.mnema', '.gitattributes'), 'utf-8')).toContain(
      'tails/*/*.jsonl merge=mnema-tail\n',
    );
    expect(mergeSettings(local)).toBe('');
  });
});

describe('the doctor', SLOW, () => {
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
      /`mnema doctor --fix merge-driver` writes the driver and its name, merge\.autoStash and rebase\.autoStash into this repository's git configuration/,
    );
    expect(mergeSettings(local)).toBe('');

    const dry = fixMergeDriver(doctorIn(local), { dryRun: true, driver: DRIVER_COMMAND });
    expect(dry.refused).toBe(false);
    expect(dry.lines.join('\n')).toContain(
      `would set merge.mnema-tail.driver = ${DRIVER_COMMAND} in this repository's git configuration.`,
    );
    expect(mergeSettings(local)).toBe('');

    const fixed = mnema(local, 'doctor', '--fix', 'merge-driver');
    expect(fixed.status).toBe(0);
    expect(mergeSettings(local)).toBe(
      [
        'merge.mnema-tail.name mnema: keep the longer side of a tail that only grows',
        `merge.mnema-tail.driver ${DRIVER_COMMAND}`,
        'merge.autostash true',
      ].join('\n'),
    );
    expect(mnema(local, 'doctor').out).not.toMatch(/merge-driver/);
    expect(
      fixMergeDriver(doctorIn(local), { dryRun: false, driver: DRIVER_COMMAND }).lines,
    ).toEqual([
      'nothing to change: git already holds a driver that runs, merge.autoStash and rebase.autoStash here.',
    ]);
  });

  it('leaves a driver of the same name it did not write, and says so', () => {
    const { local } = world();
    expect(git(local, 'config', 'merge.mnema-tail.driver', 'cat').status).toBe(0);
    const refused = fixMergeDriver(doctorIn(local), { dryRun: false, driver: DRIVER_COMMAND });
    expect(refused.refused).toBe(true);
    expect(refused.lines.join('\n')).toMatch(
      /merge\.mnema-tail\.driver is already set to cat, which mnema did not write/,
    );
    expect(git(local, 'config', '--get', 'merge.mnema-tail.driver').out.trim()).toBe('cat');
  });
});

describe('the doctor outside a repository', () => {
  it('says nothing, and its fix refuses, naming what it looked for', () => {
    const bare = join(sandbox, 'no-git');
    mkdirSync(bare, { recursive: true });
    expect(mergeDriverLines(doctorIn(bare))).toEqual([]);
    const refused = fixMergeDriver(doctorIn(bare), { dryRun: false, driver: DRIVER_COMMAND });
    expect(refused.refused).toBe(true);
    expect(refused.lines[0]).toMatch(
      /^nothing changed: there is no record here inside a git repository/,
    );
  });
});

describe('mnema record pull outside what it pulls', () => {
  it('refuses with no project, and with no branch followed', () => {
    const bare = join(sandbox, 'no-project');
    mkdirSync(bare, { recursive: true });
    expect(pull(bare)).toEqual({ ok: false, reason: 'NO_PROJECT' });
    const lone = join(sandbox, 'lone');
    mkdirSync(join(sandbox, 'home'), { recursive: true });
    expect(git(sandbox, 'init', '-q', lone).status).toBe(0);
    expect(mnema(lone, 'init', '--all-hosts').status).toBe(0);
    expect(pull(lone)).toEqual({ ok: false, reason: 'NO_UPSTREAM' });
    const plain = join(sandbox, 'plain');
    mkdirSync(plain, { recursive: true });
    expect(mnema(plain, 'init', '--all-hosts').status).toBe(0);
    expect(pull(plain)).toEqual({ ok: false, reason: 'NOT_A_REPOSITORY' });
  }, 60_000);
});
