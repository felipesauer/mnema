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

/** `mnema <argv>` in `cwd`, against this file's sandbox home only; stdout, after it succeeded. */
function mnemaIn(cwd: string, ...argv: string[]): string {
  const run = spawnSync(process.execPath, [CLI, ...argv], {
    cwd,
    encoding: 'utf-8',
    env: { PATH: process.env.PATH ?? '', HOME: home, GIT_CONFIG_NOSYSTEM: '1' },
  });
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
});
