/**
 * The git log read for the decisions in it: trailers, touched paths, counts — over a real
 * repository, and over a directory that is none.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GIT_WITHOUT_MAINTENANCE } from '../tests/support/git-without-maintenance.js';
import {
  commitsSince,
  commitsTouching,
  commitsWithTrailer,
  filesOf,
  inAWorkTree,
  LISTED,
  parseCommits,
  resolveCommit,
} from './git-log.js';

let sandbox: string;
let repo: string;

/** `git <args>` in the sandbox repository, the way every git a test writes a repository with runs. */
function git(args: string[], dated?: string): string {
  const ran = spawnSync('git', args, {
    cwd: repo,
    encoding: 'utf-8',
    env: {
      PATH: process.env.PATH ?? '',
      HOME: join(sandbox, 'git-home'),
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: GIT_WITHOUT_MAINTENANCE,
      GIT_AUTHOR_NAME: 'a',
      GIT_AUTHOR_EMAIL: 'a@example.com',
      GIT_COMMITTER_NAME: 'a',
      GIT_COMMITTER_EMAIL: 'a@example.com',
      ...(dated !== undefined ? { GIT_COMMITTER_DATE: dated } : {}),
    },
  });
  if (ran.status !== 0) throw new Error(`git ${args.join(' ')}: ${ran.stderr}`);
  return ran.stdout.trim();
}

/** Writes `file` and commits it with `message`. */
function commit(file: string, message: string, dated?: string): string {
  mkdirSync(join(repo, file, '..'), { recursive: true });
  writeFileSync(join(repo, file), `${message}\n${Math.random()}`);
  git(['add', file]);
  git(['commit', '-m', message], dated);
  return git(['rev-parse', 'HEAD']);
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-git-log-'));
  repo = join(sandbox, 'repo');
  mkdirSync(repo, { recursive: true });
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe('the git log, read for the decisions in it', () => {
  it('says there is no git work tree where there is none, and nothing where there are no commits', () => {
    expect(inAWorkTree(repo)).toBe(false);
    expect(commitsWithTrailer(repo)).toBeNull();
    expect(commitsTouching(repo, ['src'])).toBeNull();
    expect(commitsSince(repo, '2000-01-01T00:00:00Z', ['src'])).toBeNull();
    git(['init', '-q']);
    expect(inAWorkTree(repo)).toBe(true);
    expect(commitsWithTrailer(repo)).toEqual([]);
    expect(commitsSince(repo, '2000-01-01T00:00:00Z', ['src'])).toEqual({ touching: 0, all: 0 });
  });

  it('reads a trailer, in any case, and not a line in the body that only starts like one', () => {
    git(['init', '-q']);
    const cited = commit('src/a.ts', 'Add a\n\nMnema-Decision: ADR-4\nmnema-decision: 01ABC');
    commit('src/b.ts', 'Add b\n\nMnema-Decision: ADR-9 is mentioned here\n\nand then prose');
    commit('src/c.ts', 'Add c');
    const found = commitsWithTrailer(repo) ?? [];
    expect(found.map((one) => one.sha)).toContain(cited);
    const one = found.find((entry) => entry.sha === cited);
    expect(one?.cites).toEqual(['ADR-4', '01ABC']);
    expect(one?.subject).toBe('Add a');
    // The body line that merely starts with the key is no trailer: the paragraph it sits in
    // is not the last one.
    expect(found.some((entry) => entry.subject === 'Add b')).toBe(false);
    expect(found.some((entry) => entry.subject === 'Add c')).toBe(false);
  });

  it('lists what touched a path, a literal one, and stops one past the page', () => {
    git(['init', '-q']);
    commit('docs/x.md', 'Add docs');
    for (let i = 0; i < LISTED + 2; i++) commit('src/a.ts', `Change ${i}`);
    expect(commitsTouching(repo, ['docs'])?.map((one) => one.subject)).toEqual(['Add docs']);
    expect(commitsTouching(repo, ['src'])).toHaveLength(LISTED + 1);
    // A glob character is a character: nothing is named `*`.
    expect(commitsTouching(repo, ['*'])).toEqual([]);
  });

  it('counts the commits since a date, those touching the paths and all', () => {
    git(['init', '-q']);
    commit('src/old.ts', 'Before', '2020-01-01T00:00:00Z');
    commit('docs/x.md', 'Add docs');
    commit('src/a.ts', 'Change a');
    commit('src/b.ts', 'Change b');
    expect(commitsSince(repo, '2000-01-01T00:00:00Z', ['src'])).toEqual({ touching: 3, all: 4 });
    expect(commitsSince(repo, '2021-01-01T00:00:00Z', ['src'])).toEqual({ touching: 2, all: 3 });
  });

  it('resolves a commit by name, refuses a name that is an option, and lists the files it changed', () => {
    git(['init', '-q']);
    const first = commit('src/a.ts', 'Add a');
    expect(resolveCommit(repo, first)?.subject).toBe('Add a');
    expect(resolveCommit(repo, 'HEAD')?.sha).toBe(first);
    expect(resolveCommit(repo, '--all')).toBeUndefined();
    expect(resolveCommit(repo, 'no-such-name')).toBeUndefined();
    expect(filesOf(repo, first)).toEqual({ files: ['src/a.ts'], more: false });
  });

  it('parses an empty log as no commits', () => {
    expect(parseCommits('')).toEqual([]);
  });
});
