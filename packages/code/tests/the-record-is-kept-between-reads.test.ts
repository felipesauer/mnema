/**
 * A read of the command line leaves ONE new file in the tree, and deleting it changes nothing.
 *
 * It said, in the doc of `withCache` and in the doc-comments of the guards that digest a whole
 * sandbox around a read, that a command "opens it, rebuilds from the chain, reads, and closes —
 * every time", the price of "not leaving a derived database behind between runs". At 100 thousand
 * events that price was 3.3 s and 548 MB for a question a warm cache answers in a millisecond, and
 * the two hooks that open a session are such reads. A read now keeps the projection in the tree it
 * read (`projectionCachePath`) and the next one takes only what arrived.
 *
 * WHAT HAS TO STAY TRUE, over the real binary and not over the classes that make it:
 *
 *   - THE ONLY THING A READ ADDS IS THE CACHE, by the shape `isTheDerivedCache` names — not a tail,
 *     not a key, not a line of any file that was there;
 *   - GIT NEVER SEES IT. It lives where the tree's own `.gitignore` already looks away, so `git
 *     add` of the whole tree takes nothing of it;
 *   - DELETING IT CHANGES NO ANSWER: every read prints the same bytes cold, warm, and after the
 *     file is deleted — and after a write that landed between two reads, which is the case a cache
 *     that served what it knew would get wrong.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isTheDerivedCache } from './support/the-cache-is-not-the-record.js';

const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

let sandbox: string;
let repo: string;
let home: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-kept-between-reads-'));
  repo = join(sandbox, 'repo');
  home = join(sandbox, 'home');
  mkdirSync(repo, { recursive: true });
  mkdirSync(home, { recursive: true });
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function mnema(...argv: string[]): { status: number | null; stdout: string; stderr: string } {
  const ran = spawnSync(process.execPath, [CLI, ...argv], {
    cwd: repo,
    encoding: 'utf-8',
    env: { PATH: process.env.PATH ?? '', HOME: home, GIT_CONFIG_NOSYSTEM: '1' },
  });
  return { status: ran.status, stdout: ran.stdout, stderr: ran.stderr };
}

function ok(...argv: string[]): string {
  const ran = mnema(...argv);
  expect(ran.status, `${argv.join(' ')}: ${ran.stderr}`).toBe(0);
  return ran.stdout;
}

/** Every path under `dir`, relative to it — the tree as a list of what exists. */
function pathsUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string): void => {
    for (const name of readdirSync(current).sort()) {
      const path = join(current, name);
      out.push(relative(dir, path));
      if (statSync(path).isDirectory()) walk(path);
    }
  };
  walk(dir);
  return out;
}

const READS: readonly (readonly string[])[] = [
  ['search', 'cache'],
  ['status'],
  ['brief'],
  ['recall'],
  ['accountability'],
  ['rules', 'src'],
  ['skills'],
];

/** A project with a handful of facts, founded through the binary. */
function aProject(): void {
  spawnSync('git', ['init', '-q'], {
    cwd: repo,
    env: { PATH: process.env.PATH ?? '', HOME: home, GIT_CONFIG_NOSYSTEM: '1' },
  });
  ok('init');
  ok('task', 'create', 'warm the cache in the tree');
  ok('decision', 'record', 'Keep the projection between reads', 'a read should pay what arrived');
  ok('memory', 'the cache is derived and may be deleted');
}

function theCache(): string {
  return join(repo, '.mnema', 'locks', 'projection.db');
}

function deleteTheCache(): void {
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${theCache()}${suffix}`, { force: true });
}

describe('a read keeps the projection in the tree', () => {
  it('and that file is the only thing it adds', () => {
    aProject();
    // A numbered decision keeps the projection too (a write reads from it), so the file the setup
    // left is taken away: what is asked here is what a READ adds to a tree that has none.
    deleteTheCache();
    const before = pathsUnder(sandbox);
    ok('search', 'cache');
    const added = pathsUnder(sandbox).filter((path) => !before.includes(path));
    expect(added.length).toBeGreaterThan(0);
    for (const path of added) {
      expect(isTheDerivedCache(path), `a read added ${path}`).toBe(true);
    }
    expect(added).toContain(join('repo', '.mnema', 'locks', 'projection.db'));
  });

  it('and git never sees it', () => {
    aProject();
    ok('search', 'cache');
    const ignored = spawnSync('git', ['check-ignore', '-q', '.mnema/locks/projection.db'], {
      cwd: repo,
      env: { PATH: process.env.PATH ?? '', HOME: home, GIT_CONFIG_NOSYSTEM: '1' },
    });
    expect(ignored.status, 'the tree’s own .gitignore does not cover the cache').toBe(0);
  });

  it('and none is kept for a tree nobody has written to', () => {
    spawnSync('git', ['init', '-q'], {
      cwd: repo,
      env: { PATH: process.env.PATH ?? '', HOME: home },
    });
    ok('init');
    ok('search', 'nothing here');
    // `init` founds the tree and writes no tail of its own kind of fact the read would keep; what
    // matters is that a read of a tree with no tail does not create the directory.
    const noTail = !readdirSync(join(repo, '.mnema')).includes('tails');
    if (noTail) expect(readdirSync(join(repo, '.mnema'))).not.toContain('locks');
  });
});

describe('deleting it changes no answer', () => {
  it('every read prints the same bytes cold, warm, and after the file is deleted', () => {
    aProject();
    for (const argv of READS) {
      deleteTheCache();
      const cold = ok(...argv);
      const warm = ok(...argv);
      deleteTheCache();
      const rebuilt = ok(...argv);
      expect(warm, `${argv.join(' ')}: warm`).toBe(cold);
      expect(rebuilt, `${argv.join(' ')}: after deleting the file`).toBe(cold);
    }
  }, 120_000);

  it('and a write that landed between two reads is in the second', () => {
    aProject();
    const before = ok('search', 'cache');
    ok('memory', 'a second note about the cache, written between two reads');
    const warm = ok('search', 'cache');
    expect(warm).not.toBe(before);
    expect(warm).toContain('a second note about the cache');
    deleteTheCache();
    expect(ok('search', 'cache')).toBe(warm);
  }, 60_000);
});
