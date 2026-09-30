/**
 * `whatTheSessionTouches` — the words a session's notes are chosen by, read off a real
 * repository in a sandbox.
 *
 * Every case builds the repository with git itself, because what is being read is what git
 * answers — a hand-written `status` output would test the parser against the author's idea
 * of git. The two parsers get their own cases too, for the entry shapes a sandbox cannot
 * cheaply produce (a rename, a conflict, a detached head).
 */

import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type DiscoveryEnv, resolveTrees } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GIT_WITHOUT_MAINTENANCE } from '../tests/support/git-without-maintenance.js';
import { runInit } from './commands/init.js';
import { runTask } from './commands/task.js';
import { runTaskTransition } from './commands/task-transition.js';
import { withScopedCaches } from './tree-sources.js';
import {
  COMMITS,
  MAX_WORDS,
  parseLog,
  parseStatus,
  type SessionTouch,
  whatTheSessionTouches,
} from './what-the-session-touches.js';

let sandbox: string;
let repo: string;
let env: DiscoveryEnv;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-what-the-session-touches-'));
  repo = join(sandbox, 'repo');
  mkdirSync(repo, { recursive: true });
  mkdirSync(join(sandbox, 'git-home'), { recursive: true });
  env = { home: join(sandbox, 'home') };
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** `git <args>` in the sandbox's repository, as every git a test writes a repository with runs. */
function git(...args: string[]): void {
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
    },
  });
  if (ran.status !== 0) throw new Error(`git ${args.join(' ')}: ${ran.stderr}`);
}

/** A file in the sandbox's repository, with its directories. */
function write(path: string, text = 'x\n'): void {
  mkdirSync(dirname(join(repo, path)), { recursive: true });
  writeFileSync(join(repo, path), text);
}

/** What a session opening in the sandbox's project touches, read as the recall reads it. */
function touched(): SessionTouch {
  const trees = resolveTrees(repo, env);
  return withScopedCaches(trees, (sources) => whatTheSessionTouches(repo, sources));
}

describe('whatTheSessionTouches — read off a real repository', () => {
  it('reads nothing outside git, and that is no signal rather than an error', () => {
    runInit({ cwd: repo, env });
    expect(touched()).toEqual({ words: [], changed: 0, tasks: 0, branch: false, commits: 0 });
  });

  it('reads the files changed in the working tree, a new directory file by file', () => {
    git('init', '-q', '-b', 'main');
    runInit({ cwd: repo, env });
    // Untracked, in a directory git would otherwise collapse to `src/`: the words of the
    // file are the new work, and `src` alone is not.
    write('src/invoice/rounding.ts');
    const read = touched();
    expect(read.changed).toBe(1);
    expect(read.words).toEqual(['src', 'invoice', 'rounding']);
  });

  it('leaves the record’s own files out — they change with every write', () => {
    git('init', '-q', '-b', 'main');
    runInit({ cwd: repo, env });
    // The record is all there is: `.mnema/` untracked, and nothing else.
    expect(touched().changed).toBe(0);
    expect(touched().words).toEqual([]);
    // Committed, then written to again: a change INSIDE the record, still not the work.
    git('add', '-A');
    git('commit', '-q', '-m', 'the record');
    runTask({ cwd: repo, env }, { title: 'a task' });
    const read = touched();
    expect(read.changed).toBe(0);
    // And the commit that only held the record is not a piece of work either.
    expect(read.commits).toBe(0);
  });

  it('reads the files of the last commits, newest first, up to the number it says', () => {
    git('init', '-q', '-b', 'main');
    for (const name of ['alpha', 'bravo', 'charlie', 'delta', 'echo']) {
      write(`lib/${name}.ts`);
      git('add', '-A');
      git('commit', '-q', '-m', name);
    }
    runInit({ cwd: repo, env });
    git('add', '-A');
    git('commit', '-q', '-m', 'the record');
    const read = touched();
    expect(read.commits).toBe(COMMITS);
    expect(read.words).toEqual(['lib', 'echo', 'delta', 'charlie']);
  });

  it('reads the branch, less a name that names no work', () => {
    git('init', '-q', '-b', 'fix/login-timeout');
    runInit({ cwd: repo, env });
    expect(touched()).toMatchObject({ branch: true, words: ['fix', 'login', 'timeout'] });

    git('checkout', '-q', '-b', 'main');
    expect(touched()).toMatchObject({ branch: false, words: [] });
    git('checkout', '-q', '-b', 'master');
    expect(touched()).toMatchObject({ branch: false, words: [] });
  });

  it('reads the tasks in progress, and only those', () => {
    runInit({ cwd: repo, env });
    const started = runTask({ cwd: repo, env }, { title: 'migrate the ledger' });
    const waiting = runTask({ cwd: repo, env }, { title: 'rename the exports' });
    if (!started.ok || !waiting.ok) throw new Error('no task');
    for (const action of ['submit', 'start'] as const) {
      expect(runTaskTransition({ cwd: repo, env }, { id: started.id, action }).ok).toBe(true);
    }
    const read = touched();
    expect(read.tasks).toBe(1);
    expect(read.words).toEqual(['migrate', 'the', 'ledger']);
  });

  it('ranks what is changing now above what was changed last, and stops at the cap', () => {
    git('init', '-q', '-b', 'main');
    // A commit of more words than the cap, then one changed file: the file's words lead.
    for (let i = 0; i < MAX_WORDS + 10; i += 1) write(`old/w${String(i).padStart(3, '0')}x.ts`);
    git('add', '-A');
    git('commit', '-q', '-m', 'many');
    runInit({ cwd: repo, env });
    write('now/changing.ts');
    const read = touched();
    expect(read.words).toHaveLength(MAX_WORDS);
    expect(read.words.slice(0, 2)).toEqual(['now', 'changing']);
  });

  it('keeps a hostile path as words, and nothing of it as syntax', () => {
    git('init', '-q', '-b', 'main');
    runInit({ cwd: repo, env });
    write('docs/"quoted" NEAR(x y) -minus star*.md');
    expect(touched().words).toEqual(['docs', 'quoted', 'NEAR', 'minus', 'star']);
  });

  it('writes nothing into the repository: the index is the same bytes after the read', () => {
    git('init', '-q', '-b', 'main');
    write('src/kept.ts');
    git('add', '-A');
    git('commit', '-q', '-m', 'kept');
    runInit({ cwd: repo, env });
    // A file whose content is committed and whose stat is not: a `git status` that may take
    // the index lock refreshes the stat into the index, which is a write. Measured on git
    // 2.55: without `--no-optional-locks` the index's bytes change here.
    utimesSync(join(repo, 'src/kept.ts'), new Date('2020-01-01'), new Date('2020-01-01'));
    const index = join(repo, '.git', 'index');
    const before = readFileSync(index);
    touched();
    expect(readFileSync(index).equals(before)).toBe(true);
  });

  it('runs no program the repository’s configuration names', () => {
    git('init', '-q', '-b', 'main');
    runInit({ cwd: repo, env });
    // `core.fsmonitor` naming a program is run by every `git status` that honours it — a
    // repository somebody cloned can name anything there.
    const marker = join(sandbox, 'the-monitor-ran');
    const monitor = join(sandbox, 'monitor.sh');
    writeFileSync(monitor, `#!/bin/sh\necho ran >> '${marker}'\n`);
    chmodSync(monitor, 0o755);
    git('config', 'core.fsmonitor', monitor);
    write('src/a.ts');
    expect(touched().changed).toBe(1);
    expect(existsSync(marker)).toBe(false);
  });

  it('is the same words for the same tree, read twice', () => {
    git('init', '-q', '-b', 'feature/ledger');
    write('a/b/c.ts');
    git('add', '-A');
    git('commit', '-q', '-m', 'one');
    runInit({ cwd: repo, env });
    write('d/e.ts');
    expect(touched()).toEqual(touched());
  });
});

describe('parseStatus — every entry shape git documents', () => {
  it('reads an ordinary change, a rename, a conflict and an untracked file', () => {
    const out = [
      '# branch.oid 0123',
      '# branch.head topic',
      '1 .M N... 100644 100644 100644 aaaa aaaa src/a file.ts',
      '2 R. N... 100644 100644 100644 bbbb bbbb R100 src/new.ts',
      'src/old.ts',
      'u UU N... 100644 100644 100644 100644 cccc dddd eeee src/both.ts',
      '? notes/new.md',
      '',
    ].join('\0');
    expect(parseStatus(out)).toEqual({
      branch: 'topic',
      changed: ['src/a file.ts', 'src/new.ts', 'src/both.ts', 'notes/new.md'],
    });
  });

  it('reads a detached head as no branch', () => {
    expect(parseStatus('# branch.oid 0123\0# branch.head (detached)\0')).toEqual({ changed: [] });
  });
});

describe('parseLog — a mark per commit, then its paths', () => {
  it('counts the commits and keeps every path', () => {
    expect(parseLog('\u0001\0\na.ts\0b.ts\0\u0001\0\nc.ts\0')).toEqual({
      paths: ['a.ts', 'b.ts', 'c.ts'],
      commits: 2,
    });
  });
});

describe('the pages say how far back the reading reaches', () => {
  /** A file of the workspace, by its path from the root. */
  const page = (path: string): string =>
    readFileSync(fileURLToPath(new URL(`../../../${path}`, import.meta.url)), 'utf-8');

  /** The number as the pages spell it, in words. */
  const IN_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five'];

  it('in the verb’s own help, and on the two pages that describe the opening', () => {
    // The help is written out rather than read off the constant, because the declaration of
    // a verb may not load what the verb runs (`the-floor-is-the-declaration.test.ts`) — so
    // this is the place a changed constant turns the help red.
    expect(page('packages/code/src/wiring/recall.ts')).toContain(`the last ${COMMITS} commits`);
    for (const path of ['packages/code/README.md', 'plugin/README.md']) {
      expect(page(path).replace(/\s+/g, ' '), path).toContain(`last ${IN_WORDS[COMMITS]} commits`);
    }
  });
});
