// @reads-the-tree
/**
 * THE PAGE `mnema site` WRITES BY DEFAULT LIVES UNDER THE RECORD, AND GIT LEAVES IT OUT.
 *
 * WHAT WAS WRONG. `--out` was required, so a person had to invent a directory, and the obvious
 * one (`.mnema/site`) sat inside the folder whose contents are the proof: a `git add .mnema` after
 * `mnema site` staged `.mnema/site/index.html` (measured on the binary). The record's own
 * `.gitignore` now carries `/site/`, `mnema site` makes sure it does before the first byte of the
 * page exists, `mnema init` gives an older record the line, and `mnema doctor` asks git, and not
 * the file, whether the page is ignored and whether git already tracks something there.
 *
 * WHAT IS ASSERTED:
 *   - with no `--out`, from a folder below the project, the page is `<project>/.mnema/site/index.html`
 *     and the path printed is relative to where it ran (and through the binary: the option that is
 *     absent reaches the default);
 *   - in a record whose `.gitignore` is the old one, the line is there before the page, and a
 *     `git add .mnema` stages nothing under `site/`;
 *   - an `--out` inside the record and outside `site/`, spelled any way (a `..`, a link, a sibling
 *     whose name starts with `site`), is refused and the disk is byte for byte as it was; one
 *     under `site/` is taken;
 *   - `doctor` says what git says (not ignored; tracked), says nothing outside a repository or
 *     with no git, and writes nothing;
 *   - `init` in a record that exists gives it the line, and a second `init` changes nothing.
 */

import { spawnSync } from 'node:child_process';
import {
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
import { gitignorePath } from '@mnema/chain';
import type { DiscoveryEnv } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type DoctorContext, runDoctor } from '../src/commands/doctor.js';
import { type InitResult, runInit } from '../src/commands/init.js';
import { runSite } from '../src/commands/site.js';
import { GIT_WITHOUT_MAINTENANCE } from './support/git-without-maintenance.js';

const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

let sandbox: string;
let repo: string;
let home: string;
let env: DiscoveryEnv;

/** The old `.gitignore`: what a record made before `/site/` existed holds. */
const OLD_GITIGNORE =
  "# Managed by mnema: this file governs only mnema's own tree.\n/private/\n/keys/*.key\n/keys/*.inst\n/keys/*.anchor\n/locks/\n";

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-site-out-'));
  repo = join(sandbox, 'repo');
  home = join(sandbox, 'home');
  env = { home };
  mkdirSync(repo, { recursive: true });
  mkdirSync(home, { recursive: true });
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function gitEnv(): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? '',
    HOME: join(sandbox, 'git'),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: GIT_WITHOUT_MAINTENANCE,
  };
}

/** `git <args>` in the repository, as every git a test writes a repository with runs. */
function git(...args: string[]): string {
  const ran = spawnSync(
    'git',
    [
      '-c',
      'user.name=mnema test',
      '-c',
      'user.email=test@example.invalid',
      '-c',
      'commit.gpgsign=false',
      '-c',
      'init.defaultBranch=main',
      ...args,
    ],
    {
      cwd: repo,
      encoding: 'utf-8',
      env: {
        PATH: process.env.PATH ?? '',
        HOME: join(sandbox, 'git'),
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: GIT_WITHOUT_MAINTENANCE,
      },
    },
  );
  if (ran.status !== 0) throw new Error(`setup: git ${args.join(' ')}: ${ran.stderr}`);
  return ran.stdout;
}

/** `mnema init` in the project, which is never refused here. */
function init(): InitResult {
  const ran = runInit({ cwd: repo, env });
  if ('refused' in ran) throw new Error('setup: init was refused');
  return ran;
}

function founded(): void {
  git('init', '-q');
  expect(init().created).toBe(true);
}

/** Puts the `.gitignore` of a record made before `/site/` existed in place. */
function makeTheRecordOld(): void {
  writeFileSync(gitignorePath({ root: join(repo, '.mnema') }), OLD_GITIGNORE, 'utf-8');
}

/** Every file and directory under `dir`, with the bytes of the files, as one string. */
function digest(dir: string): string {
  const lines: string[] = [];
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    const path = join(entry.parentPath, entry.name);
    lines.push(`${path} ${entry.isFile() ? readFileSync(path, 'utf-8') : 'dir'}`);
  }
  return lines.sort().join('\n');
}

const stagedUnderSite = (): string[] =>
  git('diff', '--cached', '--name-only', '--', '.mnema/site')
    .split('\n')
    .filter((l) => l !== '');

describe('mnema site with no --out', () => {
  it('writes under the record, from a folder below the project, and says the path as seen from there', () => {
    founded();
    mkdirSync(join(repo, 'packages', 'app'), { recursive: true });
    const cwd = join(repo, 'packages', 'app');
    const done = runSite({ cwd, env }, {});
    expect(done.ok && done.path).toBe(join('..', '..', '.mnema', 'site', 'index.html'));
    expect(existsSync(join(repo, '.mnema', 'site', 'index.html'))).toBe(true);
    expect(existsSync(join(cwd, '.mnema'))).toBe(false);
  });

  it('puts /site/ in an old record .gitignore BEFORE the page, and git add stages nothing of it', () => {
    founded();
    makeTheRecordOld();
    expect(runSite({ cwd: repo, env }, {}).ok).toBe(true);
    const lines = readFileSync(gitignorePath({ root: join(repo, '.mnema') }), 'utf-8').split('\n');
    expect(lines).toContain('/site/');
    expect(lines.filter((l) => l === '/site/')).toHaveLength(1);
    git('add', '.mnema');
    expect(stagedUnderSite()).toEqual([]);
    // The instrument is not blind: the same add DOES stage the record it came from.
    expect(git('diff', '--cached', '--name-only', '--', '.mnema/tails')).not.toBe('');
  });

  it('is the same bytes when asked twice, and the second asking changes no file of the record', () => {
    founded();
    expect(runSite({ cwd: repo, env }, {}).ok).toBe(true);
    const first = readFileSync(join(repo, '.mnema', 'site', 'index.html'));
    const before = digest(join(repo, '.mnema'));
    expect(runSite({ cwd: repo, env }, {}).ok).toBe(true);
    expect(readFileSync(join(repo, '.mnema', 'site', 'index.html')).equals(first)).toBe(true);
    expect(digest(join(repo, '.mnema'))).toBe(before);
  });

  it('is reached through the binary: the option that is absent lands on the default', () => {
    founded();
    mkdirSync(join(repo, 'sub'), { recursive: true });
    const ran = spawnSync(process.execPath, [CLI, 'site'], {
      cwd: join(repo, 'sub'),
      encoding: 'utf-8',
      env: { PATH: process.env.PATH ?? '', HOME: home },
    });
    expect(ran.status).toBe(0);
    expect(ran.stdout.split('\n')[0]).toBe(`Wrote ${join('..', '.mnema', 'site', 'index.html')}`);
    expect(statSync(join(repo, '.mnema', 'site', 'index.html')).isFile()).toBe(true);
  });
});

describe('--out inside the record', () => {
  it.each([
    ['the record itself', '.mnema'],
    ['a tail', '.mnema/tails/x'],
    ['the keys', '.mnema/keys'],
    ['a sibling that merely starts with site', '.mnema/site2'],
    ['a way out and back in', '../repo/.mnema/tails/x'],
    ['the record, spelled with a dot', '.mnema/./locks'],
  ])('refuses %s, and leaves the disk as it was', (_name, out) => {
    founded();
    const before = digest(sandbox);
    const refused = runSite({ cwd: repo, env }, { out });
    expect(refused.ok ? '' : refused.reason).toBe('OUT_IN_THE_RECORD');
    expect(digest(sandbox)).toBe(before);
  });

  it('refuses a link outside the record that points at it, and leaves the disk as it was', () => {
    founded();
    symlinkSync(join(repo, '.mnema', 'tails'), join(sandbox, 'link'));
    const before = digest(sandbox);
    const refused = runSite({ cwd: repo, env }, { out: join(sandbox, 'link', 'x') });
    expect(refused.ok ? '' : refused.reason).toBe('OUT_IN_THE_RECORD');
    expect(digest(sandbox)).toBe(before);
  });

  it('takes a directory under site/, and one outside the record', () => {
    founded();
    expect(runSite({ cwd: repo, env }, { out: '.mnema/site/sub' }).ok).toBe(true);
    expect(existsSync(join(repo, '.mnema', 'site', 'sub', 'index.html'))).toBe(true);
    expect(runSite({ cwd: repo, env }, { out: join(sandbox, 'elsewhere') }).ok).toBe(true);
    expect(runSite({ cwd: repo, env }, { out: '.mnemaX' }).ok).toBe(true);
  });
});

describe('mnema doctor and the page', () => {
  function said(processEnv: NodeJS.ProcessEnv = gitEnv(), cwd = repo): string[] {
    const ctx: DoctorContext = {
      cwd,
      env,
      processEnv,
      running: { file: join(sandbox, 'running', 'mnema'), version: '9.9.9' },
    };
    return runDoctor(ctx)
      .findings.filter((f) => f.topic === 'record-page')
      .map((f) => f.line);
  }

  it('says nothing for a record whose .gitignore carries /site/ and that tracks nothing there', () => {
    founded();
    expect(said()).toEqual([]);
  });

  it('sends a record git would not ignore the page of to `mnema init`, and init is the fix', () => {
    founded();
    makeTheRecordOld();
    const lines = said();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('would not ignore');
    expect(lines[0]).toContain('run `mnema init`');
    expect(init().completed?.gitignore).toBe(true);
    expect(said()).toEqual([]);
  });

  it('counts what git tracks under site/ and names the command, which it never runs', () => {
    founded();
    expect(runSite({ cwd: repo, env }, {}).ok).toBe(true);
    git('add', '-f', '.mnema/site/index.html');
    git('commit', '-q', '-m', 'track the page by mistake');
    const before = digest(sandbox);
    const lines = said();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('tracks 1 file(s)');
    expect(lines[0]).toContain('git rm -r --cached .mnema/site');
    expect(digest(sandbox)).toBe(before);
    expect(git('ls-files', '--', '.mnema/site').trim()).toBe('.mnema/site/index.html');
  });

  it('says nothing outside a repository, and nothing when git is not on the PATH', () => {
    expect(init().created).toBe(true);
    makeTheRecordOld();
    expect(said()).toEqual([]);
    git('init', '-q');
    expect(said({ ...gitEnv(), PATH: join(sandbox, 'nowhere') })).toHaveLength(0);
    expect(said()).toHaveLength(1);
  });
});

describe('mnema init in a record that exists', () => {
  it('gives an old .gitignore the /site/ line and says so, and the second init changes nothing', () => {
    founded();
    makeTheRecordOld();
    const first = init();
    expect(first.created).toBe(false);
    expect(first.completed?.gitignore).toBe(true);
    expect(readFileSync(gitignorePath({ root: join(repo, '.mnema') }), 'utf-8')).toBe(
      `${OLD_GITIGNORE}/site/\n`,
    );
    const before = digest(join(repo, '.mnema'));
    const second = init();
    expect(second.completed?.gitignore).toBeUndefined();
    expect(digest(join(repo, '.mnema'))).toBe(before);
  });
});
