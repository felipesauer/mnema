/**
 * A PLAIN `git pull` CARRIES THE RECORD (ADR-181): with real git, a real record and the built binary.
 *
 * The case: events of a tail are appended here and left uncommitted, a pull request carries them to the
 * branch this clone follows, and `git pull` refuses before any merge driver runs. The clone's own git
 * configuration makes it automatic, four settings, the driver first: the tails' merge driver and its name, `merge.autoStash`
 * and `rebase.autoStash` (`commands/doctor-merge-driver.ts`, written by `mnema doctor --fix merge-driver` and by
 * the answer to `mnema init`'s question). An autoStash without the driver is worse than none (git exits 0 and
 * leaves conflict markers in signed tails), so it is never written without it.
 *
 * WHAT IS HELD, by the files and by git's own answers:
 *   - a plain `git pull`, `--no-rebase`, `--rebase` and a merge with an unrelated local commit succeed over local
 *     events, a prefix of the branch's and a longer one, with the record verifying afterwards, in a clone whose PATH
 *     holds no `mnema` (the driver is named by absolute paths);
 *   - a fork is the one case git does not stop on: the pull exits 0, the local side lives in the stash, and
 *     `mnema status` and `mnema doctor` say so, in one sentence (`fork-kept-aside.ts`);
 *   - the fix writes all of the settings or none, and never overrides a setting of the person's;
 *   - `mnema init` offers the settings, shows them in the plan, and writes them when the answer is yes.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  fixMergeDriver,
  mergeDriverLines,
  mergeSettings,
  whyTheDriverCannotRun,
} from '../src/commands/doctor-merge-driver.js';
import { driverCommand } from '../src/commands/record-pull.js';
import { readForkKeptAside, saysForkKeptAside } from '../src/fork-kept-aside.js';
import { withoutSequences } from '../src/presentation/width.js';
import { type CliIo, run } from '../src/program.js';
import { fakeTerminal, hooksNothing, until } from './support/console.js';
import { GIT_WITHOUT_MAINTENANCE } from './support/git-without-maintenance.js';

const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

/** The command the fix writes for the built binary: its node and its script, by absolute path. */
const DRIVER = driverCommand(process.execPath, CLI);

let sandbox: string;
const kept = { cwd: process.cwd(), home: process.env.HOME };

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-plain-pull-'));
  mkdirSync(join(sandbox, 'home'), { recursive: true });
  // A PATH that holds git and nothing else: no `mnema` for a driver to be found by.
  mkdirSync(join(sandbox, 'bin'));
  symlinkSync(
    execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf-8' }).trim(),
    join(sandbox, 'bin', 'git'),
  );
});

afterEach(() => {
  process.chdir(kept.cwd);
  if (kept.home === undefined) delete process.env.HOME;
  else process.env.HOME = kept.home;
  rmSync(sandbox, { recursive: true, force: true });
});

/** The environment every program here runs with: the sandbox's home, a PATH with git alone. */
function env(): Record<string, string> {
  return {
    PATH: join(sandbox, 'bin'),
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

/** A remote, the clone that writes (`local`) with a record founded and pushed, and the clone that commits (`other`). */
function world(): { local: string; other: string } {
  const remote = join(sandbox, 'remote.git');
  const local = join(sandbox, 'local');
  const other = join(sandbox, 'other');
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

/** The one tail of the public tree, as its folder from the checkout's top. */
function theTail(checkout: string): string {
  const tails = readdirSync(join(checkout, '.mnema', 'tails'));
  expect(tails).toHaveLength(1);
  return join('.mnema', 'tails', tails[0] as string);
}

/** The bytes of the tail's first segment. */
function segment(checkout: string): Buffer {
  return readFileSync(join(checkout, theTail(checkout), '000001.jsonl'));
}

/** What a pull request carries: the record's tails and keys as `local` holds them, committed and pushed from `other`. */
function carry(local: string, other: string): void {
  for (const part of ['tails', 'keys']) {
    cpSync(join(local, '.mnema', part), join(other, '.mnema', part), { recursive: true });
  }
  expect(git(other, 'add', '.mnema').status).toBe(0);
  expect(git(other, 'commit', '-qm', 'carry the record').status).toBe(0);
  expect(git(other, 'push', '-q', 'origin', 'main').status).toBe(0);
}

/** The settings the fix writes, as git lists them. */
const THE_THREE = [
  'merge.mnema-tail.name=mnema: keep the longer side of a tail that only grows',
  `merge.mnema-tail.driver=${DRIVER}`,
  'merge.autostash=true',
  'rebase.autostash=true',
];

/** What git's own configuration of this clone holds under the three names (keys as git lists them). */
function configured(checkout: string): string[] {
  return git(checkout, 'config', '--local', '--list')
    .out.split('\n')
    .filter((line) => /^(merge|rebase)\./.test(line));
}

/** Local events a prefix of the branch's, and longer than the branch's; each with the bytes the pull must end on. */
const SHAPES = {
  prefix: (local: string, other: string) => {
    expect(mnema(local, 'task', 'create', 'two').status).toBe(0);
    const kept = join(sandbox, 'kept');
    cpSync(join(local, '.mnema', 'tails'), kept, { recursive: true });
    expect(mnema(local, 'task', 'create', 'three').status).toBe(0);
    carry(local, other);
    const remote = segment(other);
    rmSync(join(local, '.mnema', 'tails'), { recursive: true });
    cpSync(kept, join(local, '.mnema', 'tails'), { recursive: true });
    expect(segment(local).length).toBeLessThan(remote.length);
    return remote;
  },
  longer: (local: string, other: string) => {
    expect(mnema(local, 'task', 'create', 'two').status).toBe(0);
    carry(local, other);
    expect(mnema(local, 'task', 'create', 'three').status).toBe(0);
    const ours = segment(local);
    expect(ours.length).toBeGreaterThan(segment(other).length);
    return ours;
  },
};

/** Many programs start in each case: a remote, two clones, the binary and git. */
const SLOW = { timeout: 90_000 };

describe('a plain git pull over events not yet committed', SLOW, () => {
  const PULLS: readonly (readonly string[])[] = [
    ['pull'],
    ['pull', '--no-rebase'],
    ['pull', '--rebase'],
  ];

  for (const [shape, build] of Object.entries(SHAPES)) {
    for (const args of PULLS) {
      it(`succeeds with local events that are ${shape === 'prefix' ? 'a prefix of the branch' : 'longer than the branch'}: git ${args.join(' ')}`, () => {
        const { local, other } = world();
        const ends = build(local, other);
        // Without the settings git refuses and touches nothing.
        const refused = git(local, ...args);
        expect(refused.status).not.toBe(0);
        expect(mnema(local, 'doctor', '--fix', 'merge-driver').status).toBe(0);

        const pulled = git(local, ...args);
        expect(pulled.out).not.toMatch(/conflict/i);
        expect(pulled.status).toBe(0);
        expect(segment(local).equals(ends)).toBe(true);
        expect(mnema(local, 'verify').status).toBe(0);
        expect(git(local, 'stash', 'list').out.trim()).toBe('');
        expect(git(local, 'diff', '--name-only', '--diff-filter=U').out.trim()).toBe('');
        expect(mnema(local, 'status').out).not.toMatch(/Kept aside by a pull/);
      });
    }
  }

  for (const [how, args] of [
    ['a merge', ['pull', '--no-rebase']],
    ['a rebase', ['pull', '--rebase']],
  ] as const) {
    it(`succeeds beside an unrelated local commit, as ${how}`, () => {
      const { local, other } = world();
      const ends = SHAPES.prefix(local, other);
      writeFileSync(join(local, 'notes.txt'), 'mine\n');
      expect(git(local, 'add', 'notes.txt').status).toBe(0);
      expect(git(local, 'commit', '-qm', 'an unrelated change').status).toBe(0);
      expect(mnema(local, 'doctor', '--fix', 'merge-driver').status).toBe(0);

      const pulled = git(local, ...args);
      expect(pulled.status).toBe(0);
      expect(segment(local).equals(ends)).toBe(true);
      expect(readFileSync(join(local, 'notes.txt'), 'utf-8')).toBe('mine\n');
      expect(git(local, 'log', '--format=%s').out).toContain('an unrelated change');
      expect(mnema(local, 'verify').status).toBe(0);
    });
  }
});

describe('a fork, the one case git does not stop on', SLOW, () => {
  /** Both clones appended to the one tail: the branch holds `remote-side`, the local file holds `local-side`. */
  function fork(): { local: string; other: string } {
    const { local, other } = world();
    // A copy of the whole clone, writer state included: two writers that hold the same tail and part from it.
    const twin = join(sandbox, 'twin');
    cpSync(local, twin, { recursive: true });
    expect(mnema(local, 'task', 'create', 'remote-side').status).toBe(0);
    carry(local, other);
    expect(mnema(twin, 'task', 'create', 'local-side').status).toBe(0);
    expect(segment(twin).equals(segment(other))).toBe(false);
    return { local: twin, other };
  }

  it('leaves the local side in the stash, and status and doctor say it in the same sentence', () => {
    const { local } = fork();
    const ours = segment(local).toString();
    expect(mnema(local, 'doctor', '--fix', 'merge-driver').status).toBe(0);
    expect(mnema(local, 'status').out).not.toMatch(/Kept aside by a pull/);

    const pulled = git(local, 'pull');
    expect(pulled.status).toBe(0);
    expect(git(local, 'stash', 'list').out).toMatch(/autostash/);
    // The local event is not lost: it is in the stash, as git's own `show` prints it.
    const lastLocal = ours.trim().split('\n').at(-1) as string;
    expect(git(local, 'stash', 'show', '-p', 'stash@{0}').out).toContain(lastLocal);

    const found = readForkKeptAside({
      cwd: local,
      env: { home: join(sandbox, 'home') },
      processEnv: env(),
    });
    expect(found?.stashes).toBe(1);
    expect(found?.conflicted).toBeGreaterThan(0);
    const sentence = saysForkKeptAside(found as NonNullable<typeof found>);
    expect(sentence).toMatch(/Do not drop the stash/);
    expect(sentence).toMatch(/`mnema record pull`/);

    // Once a plain pull has left it aside, `record pull` does not look in the stash: it stops on the open conflict.
    expect(mnema(local, 'record', 'pull').status).not.toBe(0);
    expect(mnema(local, 'record', 'pull').out).not.toMatch(/fork/);

    const status = mnema(local, 'status').out;
    expect(status).toMatch(/Kept aside by a pull:/);
    expect(status.replace(/\s+/g, ' ')).toContain(sentence);
    const doctor = mnema(local, 'doctor').out;
    expect(doctor).toMatch(/to do · fork-kept-aside: A pull left events of this record aside/);
    expect(doctor.replace(/\s+/g, ' ')).toContain(sentence);
  });

  it('says nothing while nothing is kept aside', () => {
    const { local } = fork();
    expect(
      readForkKeptAside({ cwd: local, env: { home: join(sandbox, 'home') }, processEnv: env() }),
    ).toBeUndefined();
    expect(mnema(local, 'doctor').out).not.toMatch(/fork-kept-aside/);
  });

  it('has `mnema record pull`, run before a pull, name it and write nothing', () => {
    const { local } = fork();
    const before = segment(local);
    const named = mnema(local, 'record', 'pull');
    expect(named.status).not.toBe(0);
    expect(named.out).toMatch(/fork/);
    expect(segment(local).equals(before)).toBe(true);
  });
});

describe('the fix writes all of the settings or none', SLOW, () => {
  const here = (checkout: string) => ({
    cwd: checkout,
    env: { home: join(sandbox, 'home') },
    processEnv: env(),
  });

  it('writes the driver and its name, then merge.autoStash and rebase.autoStash, by absolute path, after --dry-run says them', () => {
    const { local } = world();
    const asked = mnema(local, 'doctor');
    expect(asked.out).toMatch(/to do · merge-driver: /);
    expect(asked.out.replace(/\s+/g, ' ')).toMatch(/merge\.autoStash and rebase\.autoStash/);
    expect(asked.out.replace(/\s+/g, ' ')).toMatch(/apply to every file of this clone/);

    const dry = fixMergeDriver(here(local), { dryRun: true, driver: DRIVER });
    expect(dry.lines.join('\n')).toMatch(/would set merge\.autoStash = true/);
    expect(dry.lines.join('\n')).toMatch(/would set rebase\.autoStash = true/);
    expect(dry.lines.join('\n')).toMatch(/would set merge\.mnema-tail\.driver = /);
    expect(dry.lines.join('\n')).toMatch(/apply to every file of this clone/);
    expect(configured(local)).toEqual([]);

    const fixed = mnema(local, 'doctor', '--fix', 'merge-driver');
    expect(fixed.status).toBe(0);
    expect(fixed.out.replace(/\s+/g, ' ')).toMatch(/apply to every file of this clone/);
    expect(configured(local)).toEqual(THE_THREE);
    // The program is named by the paths of this installation: no `mnema` is looked up on the PATH.
    expect(configured(local).join('\n')).not.toMatch(/driver=mnema /);
    expect(mnema(local, 'doctor').out).not.toMatch(/merge-driver/);
    expect(fixMergeDriver(here(local), { dryRun: false, driver: DRIVER }).lines).toEqual([
      'nothing to change: git already holds a driver that runs, merge.autoStash and rebase.autoStash here.',
    ]);
  });

  it('writes the driver before either autoStash, so a write that stops never leaves an autoStash without it', () => {
    const keys = mergeSettings(DRIVER).map(([key]) => key);
    expect(keys.indexOf('merge.mnema-tail.driver')).toBeGreaterThanOrEqual(0);
    expect(keys.indexOf('merge.mnema-tail.driver')).toBeLessThan(keys.indexOf('merge.autoStash'));
    expect(keys.indexOf('merge.mnema-tail.driver')).toBeLessThan(keys.indexOf('rebase.autoStash'));
  });

  it('leaves an autoStash the person turned off, writes nothing, and says it', () => {
    const { local } = world();
    expect(git(local, 'config', 'rebase.autoStash', 'false').status).toBe(0);
    const refused = fixMergeDriver(here(local), { dryRun: false, driver: DRIVER });
    expect(refused.refused).toBe(true);
    expect(refused.lines.join('\n')).toMatch(
      /rebase\.autoStash is already set to false, which mnema did not write; it is left as it is\./,
    );
    expect(refused.lines.at(-1)).toBe('nothing was written.');
    expect(configured(local)).toEqual(['rebase.autostash=false']);
  });

  it('treats a boolean the person wrote their own way as theirs, and a `true` as already there', () => {
    const { local } = world();
    expect(git(local, 'config', 'merge.autoStash', 'yes').status).toBe(0);
    const fixed = fixMergeDriver(here(local), { dryRun: false, driver: DRIVER });
    expect(fixed.refused).toBe(false);
    expect(fixed.lines.join('\n')).not.toMatch(/set merge\.autoStash/);
    expect(configured(local)).toContain('merge.autostash=yes');
    expect(git(local, 'config', '--type=bool', 'merge.autoStash').out.trim()).toBe('true');
    expect(git(local, 'config', '--get', 'rebase.autoStash').out.trim()).toBe('true');
    expect(git(local, 'config', '--get', 'merge.mnema-tail.driver').out.trim()).toBe(DRIVER);
  });

  const EARLIER = 'mnema record merge-tail %O %A %B %P';

  it('replaces an earlier driver that finds mnema by the PATH when there is none on it, and only then writes the autoStash settings', () => {
    const { local } = world();
    expect(git(local, 'config', 'merge.mnema-tail.driver', EARLIER).status).toBe(0);
    // The test's PATH holds git alone: the earlier form cannot run, and the doctor says so before any pull.
    const says = mergeDriverLines(here(local));
    expect(says).toHaveLength(1);
    expect(says[0]).toMatch(/cannot run here \(there is no mnema on the PATH git runs with\)/);
    const fixed = fixMergeDriver(here(local), { dryRun: false, driver: DRIVER });
    expect(fixed.refused).toBe(false);
    expect(fixed.lines.join('\n')).toMatch(/it is replaced/);
    expect(git(local, 'config', '--get', 'merge.mnema-tail.driver').out.trim()).toBe(DRIVER);
    expect(git(local, 'config', '--get', 'merge.autoStash').out.trim()).toBe('true');
    expect(git(local, 'config', '--get', 'rebase.autoStash').out.trim()).toBe('true');
    expect(mergeDriverLines(here(local))).toEqual([]);
  });

  it('keeps an earlier driver that finds mnema by the PATH when mnema is on it', () => {
    const { local } = world();
    mkdirSync(join(sandbox, 'bin-with-mnema'));
    writeFileSync(join(sandbox, 'bin-with-mnema', 'mnema'), '#!/bin/sh\n', { mode: 0o755 });
    symlinkSync(join(sandbox, 'bin', 'git'), join(sandbox, 'bin-with-mnema', 'git'));
    const onThePath = {
      ...here(local),
      processEnv: { ...env(), PATH: join(sandbox, 'bin-with-mnema') },
    };
    expect(git(local, 'config', 'merge.mnema-tail.driver', EARLIER).status).toBe(0);
    expect(fixMergeDriver(onThePath, { dryRun: false, driver: DRIVER }).refused).toBe(false);
    expect(git(local, 'config', '--get', 'merge.mnema-tail.driver').out.trim()).toBe(EARLIER);
    expect(git(local, 'config', '--get', 'merge.autoStash').out.trim()).toBe('true');
    expect(mergeDriverLines(onThePath)).toEqual([]);
  });

  it('says a driver whose paths are gone cannot run, in doctor and status before any pull, and the fix rewrites it', () => {
    const { local } = world();
    const script = join(sandbox, 'moved-cli.js');
    writeFileSync(script, '');
    const moved = driverCommand(process.execPath, script);
    expect(fixMergeDriver(here(local), { dryRun: false, driver: moved }).refused).toBe(false);
    expect(mergeDriverLines(here(local))).toEqual([]);
    expect(mnema(local, 'status').out).not.toMatch(/cannot run here/);

    rmSync(script);
    const asked = mnema(local, 'doctor').out.replace(/\s+/g, ' ');
    expect(asked).toMatch(
      /to do · merge-driver: the mnema-tail driver git holds in .* cannot run here \(.*moved-cli\.js is not a file\)/,
    );
    expect(asked).toMatch(/puts them aside in git's stash and exits 0/);
    const status = mnema(local, 'status').out.replace(/\s+/g, ' ');
    expect(status).toMatch(/Kept aside by a pull:/);
    expect(status).toMatch(
      /cannot run here \(.*moved-cli\.js is not a file\) and an autoStash is on/,
    );

    const fixed = fixMergeDriver(here(local), { dryRun: false, driver: DRIVER });
    expect(fixed.refused).toBe(false);
    expect(git(local, 'config', '--get', 'merge.mnema-tail.driver').out.trim()).toBe(DRIVER);
    expect(mnema(local, 'doctor').out).not.toMatch(/merge-driver/);
    expect(mnema(local, 'status').out).not.toMatch(/Kept aside by a pull/);
  });

  it('writes nothing when the driver this installation would write cannot run', () => {
    const { local } = world();
    const gone = driverCommand(process.execPath, join(sandbox, 'no-such-cli.js'));
    const refused = fixMergeDriver(here(local), { dryRun: false, driver: gone });
    expect(refused.refused).toBe(true);
    expect(refused.lines.join('\n')).toMatch(/no autoStash is written while the driver cannot run/);
    expect(configured(local)).toEqual([]);
  });

  it('warns of an autoStash that is on without the driver', () => {
    const { local } = world();
    expect(git(local, 'config', 'merge.autoStash', 'true').status).toBe(0);
    const says = mergeDriverLines(here(local));
    expect(says.join('\n')).toMatch(/merge\.autoStash is on without the driver/);
    expect(says.join('\n')).toMatch(/conflict markers inside signed tails/);
  });

  it('says a setting the person chose is left, once the driver is there', () => {
    const { local } = world();
    expect(fixMergeDriver(here(local), { dryRun: false, driver: DRIVER }).refused).toBe(false);
    expect(git(local, 'config', 'merge.autoStash', 'false').status).toBe(0);
    const says = mergeDriverLines(here(local));
    expect(says.join('\n')).toMatch(
      /merge\.autoStash is not on in .*mnema leaves a setting you chose where it is/,
    );
  });
});

describe('mnema init offers it', SLOW, () => {
  /** A clone of a remote, with nothing founded in it. */
  function clone(name: string, remote = true): string {
    const checkout = join(sandbox, name);
    if (remote) {
      const bare = join(sandbox, `${name}.git`);
      expect(git(sandbox, 'init', '-q', '--bare', bare).status).toBe(0);
      expect(git(sandbox, 'clone', '-q', bare, checkout).status).toBe(0);
    } else {
      expect(git(sandbox, 'init', '-q', checkout).status).toBe(0);
    }
    return checkout;
  }

  it('takes yes as the default under --yes in a repository with a remote, and writes the four settings', () => {
    const checkout = clone('yes');
    const founded = mnema(checkout, 'init', '--yes', '--hosts', 'none');
    expect(founded.status).toBe(0);
    expect(configured(checkout)).toEqual(THE_THREE);
    expect(founded.out).toMatch(/set merge\.autoStash = true/);
    expect(founded.out.replace(/\s+/g, ' ')).toMatch(/apply to every file of this clone/);
  });

  it('writes nothing under --git-pull no, --all-hosts, no remote, no repository, and without a flag or a terminal', () => {
    const no = clone('no');
    expect(mnema(no, 'init', '--yes', '--hosts', 'none', '--git-pull', 'no').status).toBe(0);
    expect(configured(no)).toEqual([]);

    const every = clone('every');
    expect(mnema(every, 'init', '--all-hosts').status).toBe(0);
    expect(configured(every)).toEqual([]);

    const lone = clone('lone', false);
    expect(mnema(lone, 'init', '--yes', '--hosts', 'none').status).toBe(0);
    expect(configured(lone)).toEqual([]);

    const plain = join(sandbox, 'plain');
    mkdirSync(plain);
    const outside = mnema(plain, 'init', '--yes', '--hosts', 'none', '--git-pull', 'yes');
    expect(outside.status).toBe(0);
    expect(existsSync(join(plain, '.git'))).toBe(false);

    const unasked = clone('unasked');
    expect(mnema(unasked, 'init', '--hosts', 'none').status).toBe(0);
    expect(configured(unasked)).toEqual([]);
  });

  it('answers yes by flag where there is no remote or where --all-hosts asked nothing', () => {
    const lone = clone('lone', false);
    expect(mnema(lone, 'init', '--yes', '--hosts', 'none', '--git-pull', 'yes').status).toBe(0);
    expect(configured(lone)).toEqual(THE_THREE);
    const every = clone('every');
    expect(mnema(every, 'init', '--all-hosts', '--git-pull', 'yes').status).toBe(0);
    expect(configured(every)).toEqual(THE_THREE);
  });

  it('leaves a setting of the person’s where it is, founds, and says so', () => {
    const checkout = clone('mine');
    expect(git(checkout, 'config', 'merge.autoStash', 'false').status).toBe(0);
    const founded = mnema(checkout, 'init', '--yes', '--hosts', 'none');
    expect(founded.status).toBe(0);
    expect(existsSync(join(checkout, '.mnema'))).toBe(true);
    expect(founded.out).toMatch(/merge\.autoStash is already set to false/);
    expect(configured(checkout)).toEqual(['merge.autostash=false']);
  });

  it('shows the four settings in the plan under --dry-run, and writes nothing', () => {
    const checkout = clone('dry');
    const planned = mnema(checkout, 'init', '--yes', '--hosts', 'none', '--dry-run');
    expect(planned.status).toBe(0);
    expect(planned.out).toMatch(/set\s+merge\.mnema-tail\.name/);
    expect(planned.out).toMatch(/set\s+merge\.mnema-tail\.driver/);
    expect(planned.out).toMatch(/set\s+merge\.autoStash/);
    expect(planned.out).toMatch(/set\s+rebase\.autoStash/);
    expect(planned.out.replace(/[\s│]+/g, ' ')).toMatch(/not only the record/);
    expect(existsSync(join(checkout, '.mnema'))).toBe(false);
    expect(configured(checkout)).toEqual([]);
    const none = mnema(
      checkout,
      'init',
      '--yes',
      '--hosts',
      'none',
      '--git-pull',
      'no',
      '--dry-run',
    );
    expect(none.out).not.toMatch(/merge\.autoStash/);
  });

  it('plans the settings only where an answer gives them: by flag, with --yes, never for --all-hosts or nobody', () => {
    const bare = join(sandbox, 'plan-bare.git');
    const checkout = join(sandbox, 'plan');
    expect(git(sandbox, 'init', '-q', '--bare', bare).status).toBe(0);
    expect(git(sandbox, 'clone', '-q', bare, checkout).status).toBe(0);
    const rows = (...args: string[]) => mnema(checkout, 'init', '--dry-run', ...args).out;
    expect(rows()).not.toMatch(/autoStash/);
    expect(rows('--all-hosts')).not.toMatch(/autoStash/);
    expect(rows('--all-hosts', '--git-pull', 'yes')).toMatch(/set\s+merge\.autoStash/);
    expect(rows('--git-pull', 'yes', '--hosts', 'none')).toMatch(/set\s+rebase\.autoStash/);
    expect(rows('--yes', '--hosts', 'none')).toMatch(/set\s+rebase\.autoStash/);
    const agent = rows('--yes', '--hosts', 'none', '--which', 'claude-code', '--accepts', 'yes');
    expect(agent).toMatch(/set\s+merge\.autoStash/);
    expect(agent).toMatch(/record\s+1 decision, proposed by the agent/);
    const plain = join(sandbox, 'plan-plain');
    mkdirSync(plain);
    expect(
      mnema(plain, 'init', '--dry-run', '--yes', '--hosts', 'none', '--git-pull', 'yes').out,
    ).not.toMatch(/autoStash/);
  });
});

describe('mnema init asks at a terminal', SLOW, () => {
  const ENTER = '\r';
  const ESC = '\u001b';
  const DOWN = '\u001b[B';
  const QUESTION = 'Make a plain `git pull` carry the record in this clone?';
  const CONFIRM = 'Found the project with this plan?';

  /** One invocation at a fake terminal that really draws, inside a clone of a remote. */
  function atATerminal(checkout: string, argv: readonly string[]) {
    process.env.HOME = join(sandbox, 'home');
    process.chdir(checkout);
    const device = fakeTerminal({ columns: 110, rows: 60 });
    const said: string[] = [];
    const io: CliIo = {
      out: (line) => said.push(line),
      err: () => undefined,
      fail: () => undefined,
      aPersonIsHere: true,
      terminal: { input: device.stdin, output: device.stdout, leaving: hooksNothing },
    };
    const running = run(argv, io);
    let mark = 0;
    return {
      sees: async (text: string) => {
        await until(() => device.bytes().slice(mark).includes(text), `drew "${text}"`, 800);
      },
      types: (keys: string) => {
        mark = device.bytes().length;
        device.type(keys);
      },
      finished: async () => {
        await running;
        return `${device.bytes()}\n${said.join('\n')}`;
      },
    };
  }

  function remoteClone(name: string): string {
    const bare = join(sandbox, `${name}.git`);
    const checkout = join(sandbox, name);
    expect(git(sandbox, 'init', '-q', '--bare', bare).status).toBe(0);
    expect(git(sandbox, 'clone', '-q', bare, checkout).status).toBe(0);
    return checkout;
  }

  async function through(person: ReturnType<typeof atATerminal>, pull: string): Promise<string> {
    await person.sees('Which agent hosts should read the mnema instructions?');
    person.types(ENTER);
    await person.sees('May an agent accept the decisions you choose?');
    person.types(ENTER);
    await person.sees(QUESTION);
    person.types(pull);
    await person.sees(CONFIRM);
    return 'asked';
  }

  it('asks after the question about accepting, lists the four settings in the plan, and writes them on yes', async () => {
    const checkout = remoteClone('terminal-yes');
    const person = atATerminal(checkout, ['init']);
    await through(person, ENTER);
    person.types(ENTER);
    const drawn = await person.finished();
    const shown = withoutSequences(drawn).replace(/[\s│]+/g, ' ');
    expect(shown).toMatch(/set merge\.mnema-tail\.name/);
    expect(shown).toMatch(/set merge\.mnema-tail\.driver/);
    expect(shown).toMatch(/set merge\.autoStash/);
    expect(shown).toMatch(/set rebase\.autoStash/);
    expect(configured(checkout).map((line) => line.replace(/driver=.*/, 'driver'))).toEqual([
      'merge.mnema-tail.name=mnema: keep the longer side of a tail that only grows',
      'merge.mnema-tail.driver',
      'merge.autostash=true',
      'rebase.autostash=true',
    ]);
  });

  it('is left at its own question, takes the default under --yes, and asks again when the person changes the answers', async () => {
    const leftAt = remoteClone('terminal-left-at-pull');
    const leaving = atATerminal(leftAt, ['init']);
    await leaving.sees('Which agent hosts should read the mnema instructions?');
    leaving.types(ENTER);
    await leaving.sees('May an agent accept the decisions you choose?');
    leaving.types(ENTER);
    await leaving.sees(QUESTION);
    leaving.types(ESC);
    await leaving.finished();
    expect(existsSync(join(leftAt, '.mnema'))).toBe(false);

    const yes = remoteClone('terminal-yes-flag');
    await atATerminal(yes, ['init', '--yes', '--hosts', 'none']).finished();
    expect(configured(yes)).toHaveLength(4);

    const given = remoteClone('terminal-given');
    const flagged = atATerminal(given, ['init', '--hosts', 'none', '--git-pull', 'no']);
    await flagged.sees('May an agent accept the decisions you choose?');
    flagged.types(ENTER);
    await flagged.sees(CONFIRM);
    flagged.types(ENTER);
    await flagged.finished();
    expect(configured(given)).toEqual([]);

    const again = remoteClone('terminal-again');
    const person = atATerminal(again, ['init']);
    await through(person, ENTER);
    person.types(`\u001b[C${ENTER}`);
    await person.sees('Which agent hosts should read the mnema instructions?');
    person.types(ENTER);
    await person.sees('May an agent accept the decisions you choose?');
    person.types(ENTER);
    await person.sees(QUESTION);
    person.types(`${DOWN}${ENTER}`);
    await person.sees(CONFIRM);
    person.types(ENTER);
    await person.finished();
    expect(configured(again)).toEqual([]);
  });

  it('writes none on no, and none when the person leaves', async () => {
    const no = remoteClone('terminal-no');
    const person = atATerminal(no, ['init']);
    await through(person, `${DOWN}${ENTER}`);
    person.types(ENTER);
    const drawn = await person.finished();
    expect(withoutSequences(drawn)).not.toMatch(/set\s+merge\.autoStash/);
    expect(existsSync(join(no, '.mnema'))).toBe(true);
    expect(configured(no)).toEqual([]);

    const left = remoteClone('terminal-left');
    const leaving = atATerminal(left, ['init']);
    await through(leaving, ENTER);
    leaving.types(ESC);
    await leaving.finished();
    expect(existsSync(join(left, '.mnema'))).toBe(false);
    expect(configured(left)).toEqual([]);
  });
});

describe('what a driver can run, and the sentence about what a pull left aside', () => {
  const PATHED = { PATH: '' };
  const EARLIER = 'mnema record merge-tail %O %A %B %P';

  it('says why a driver mnema wrote cannot run, and judges no driver that is not its own', () => {
    const here = mkdtempSync(join(sandbox, 'driver-'));
    const script = join(here, "it's cli.js");
    writeFileSync(script, '');
    // An apostrophe in a path survives the quoting `driverCommand` does.
    expect(whyTheDriverCannotRun(PATHED, driverCommand(process.execPath, script))).toBeUndefined();
    expect(whyTheDriverCannotRun(PATHED, driverCommand(join(here, 'no-node'), script))).toMatch(
      /no-node is not an executable file$/,
    );
    expect(
      whyTheDriverCannotRun(PATHED, driverCommand(process.execPath, join(here, 'gone.js'))),
    ).toMatch(/gone\.js is not a file$/);
    expect(whyTheDriverCannotRun(PATHED, 'cat')).toBeUndefined();
    expect(whyTheDriverCannotRun({ PATH: `:${here}` }, EARLIER)).toMatch(/no mnema on the PATH/);
    expect(whyTheDriverCannotRun({}, EARLIER)).toMatch(/no mnema on the PATH/);
  });

  it('finds mnema.cmd on a Windows PATH through PATHEXT, and only there', () => {
    const bin = mkdtempSync(join(sandbox, 'win-bin-'));
    const windowsEnv = { Path: `C:\\nowhere;${bin}`, PATHEXT: '.COM;.EXE;.BAT;.CMD' };
    expect(whyTheDriverCannotRun(windowsEnv, EARLIER, 'win32')).toMatch(/no mnema on the PATH/);
    writeFileSync(join(bin, 'mnema.cmd'), '');
    expect(whyTheDriverCannotRun(windowsEnv, EARLIER, 'win32')).toBeUndefined();
    // An extension PATHEXT does not list is not a program, and a bare name is not found by PATHEXT.
    expect(whyTheDriverCannotRun({ ...windowsEnv, PATHEXT: '.EXE' }, EARLIER, 'win32')).toMatch(
      /no mnema on the PATH/,
    );
    // Elsewhere the file must be named mnema, as before.
    expect(whyTheDriverCannotRun({ PATH: bin, PATHEXT: '.CMD' }, EARLIER, 'linux')).toMatch(
      /no mnema on the PATH/,
    );
  });

  it('names a stash, a conflict, both, and a driver that cannot run, each in its own words', () => {
    expect(saysForkKeptAside({ stashes: 1, conflicted: 0 })).toMatch(
      /^A pull left events of this record aside: an autostash entry of git's stash holds files/,
    );
    expect(saysForkKeptAside({ stashes: 2, conflicted: 3 })).toMatch(
      /2 autostash entries .*, and 3 tail files are in conflict in the index\./,
    );
    expect(saysForkKeptAside({ stashes: 0, conflicted: 1 })).toMatch(
      /a tail file is in conflict in the index/,
    );
    const dead = saysForkKeptAside({ stashes: 1, conflicted: 0, deadDriver: 'x is not a file' });
    expect(dead).toMatch(/cannot run here \(x is not a file\) and an autoStash is on/);
    expect(saysForkKeptAside({ stashes: 0, conflicted: 0, deadDriver: 'x is not a file' })).toMatch(
      /^Nothing is kept aside yet, but a plain `git pull` over events not yet committed would put them in git's stash and exit 0\. The merge driver/,
    );
  });
});
