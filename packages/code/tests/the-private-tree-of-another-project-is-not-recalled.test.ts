/**
 * Two projects on one machine share a home and nothing else. A note taken in the private tree
 * of the first is the first project's own: the second project's `recall`, plain and as a hook
 * reads it, never carries it, while the first project's does — so the absence is about where
 * the note went and not about a note that went nowhere.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

let sandbox: string;
let home: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-private-not-recalled-'));
  home = join(sandbox, 'home');
  mkdirSync(home, { recursive: true });
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** `mnema <argv>` in `cwd`, against this file's sandbox home only; the run as it ended. */
function runIn(cwd: string, ...argv: string[]) {
  return spawnSync(process.execPath, [CLI, ...argv], {
    cwd,
    encoding: 'utf-8',
    env: { PATH: process.env.PATH ?? '', HOME: home, GIT_CONFIG_NOSYSTEM: '1' },
  });
}

/** `mnema <argv>` in `cwd`, against this file's sandbox home only; stdout, after it succeeded. */
function mnemaIn(cwd: string, ...argv: string[]): string {
  const run = runIn(cwd, ...argv);
  expect(run.status, run.stderr).toBe(0);
  return run.stdout;
}

describe('the private tree of one project, read from another', () => {
  it('never reaches the recall of a project that shares the home', () => {
    const first = join(sandbox, 'first');
    const second = join(sandbox, 'second');
    mkdirSync(first);
    mkdirSync(second);
    mnemaIn(first, 'init');
    mnemaIn(second, 'init');

    const mark = 'PRIVATENOTEOFTHEFIRSTPROJECT';
    mnemaIn(first, 'memory', '--scope', 'private', `${mark}: for the first project only`);

    expect(mnemaIn(first, 'recall')).toContain(mark);
    expect(mnemaIn(second, 'recall')).not.toContain(mark);
    expect(mnemaIn(second, 'recall', '--hook')).not.toContain(mark);
  }, 60_000);

  it('is not promoted to the global tree, which every project reads', () => {
    // The first project holds the pattern in its PRIVATE tree; the second holds the same
    // words in its committed one. Counting the first as evidence would copy it to the one
    // tree the third project reads — the private note, published by a promotion.
    const first = join(sandbox, 'first');
    const second = join(sandbox, 'second');
    const third = join(sandbox, 'third');
    for (const dir of [first, second, third]) {
      mkdirSync(dir);
      mnemaIn(dir, 'init');
    }
    const mark = 'PRIVATEPATTERNOFTHEFIRSTPROJECT';
    const name = `${mark} habit`;
    const body = 'How the first project works.';
    const adopt = (dir: string, scope: string): string => {
      const made = mnemaIn(dir, 'skill', 'create', name, '--body', body, '--scope', scope);
      const id = /\(([0-9a-f-]{36})\)/.exec(made)?.[1] as string;
      mnemaIn(dir, 'skill', 'move', 'review', id, '--note', 'read');
      mnemaIn(dir, 'skill', 'move', 'adopt', id, '--note', 'good');
      return id;
    };
    const privateInFirst = adopt(first, 'private');
    const publicInSecond = adopt(second, 'public');

    // The listing does not show it, and the write refuses to cite it.
    const listed = mnemaIn(second, 'promote', '--workspace', first, second);
    expect(listed).toContain('Nothing recurs');
    expect(listed).not.toContain(privateInFirst);
    const refused = runIn(
      second,
      'promote',
      publicInSecond,
      '--evidence',
      `${first}:${privateInFirst}`,
    );
    expect(refused.status).not.toBe(0);
    expect(refused.stderr).toContain('UNKNOWN_INSTANCE');

    // And nothing of it is in the machine's tree: not by the search, not by either recall.
    expect(mnemaIn(first, 'search', 'habit')).toContain(mark);
    expect(mnemaIn(third, 'search', 'habit')).not.toContain(mark);
    for (const dir of [second, third]) {
      expect(mnemaIn(dir, 'recall')).not.toContain(mark);
      expect(mnemaIn(dir, 'recall', '--hook')).not.toContain(mark);
    }
  }, 90_000);
});
