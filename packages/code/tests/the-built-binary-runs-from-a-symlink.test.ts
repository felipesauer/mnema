/**
 * THE BINARY A BUILD LEAVES RUNS WHEN IT IS LINKED ONTO THE PATH, the way the page says to.
 *
 * WHAT WAS WRONG. The root page tells a reader who builds from a clone to *"symlink it onto your
 * `PATH` under the name `mnema`"*. `tsc` keeps no executable bit — it wrote `dist/cli.js` with mode
 * 0664 — so the symlink the page asks for gave `Permission denied`, exit 126, on the last step of
 * the only install that works while the package is not on the registry. Measured on the built
 * binary; it was not a test that was missing, it was that nothing ran the recipe.
 *
 * WHAT IS RUN. The recipe itself, on the binary the gates built: a directory of its own on the
 * `PATH`, a symlink there named `mnema`, and `mnema --version` asked of the shell's own lookup.
 * Beside it the file's mode (every reader of the file may run it) and the root `build` script
 * (`tsc -b && node .github/the-binary-runs/mark-it-runnable.mjs`), because the mode is only as lasting as
 * the step that sets it — `tsc` rewriting the file would take it away again.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { VERSION } from '../src/version.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const BINARY = join(ROOT, 'packages', 'code', 'dist', 'cli.js');

let sandbox: string;

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-symlink-'));
  mkdirSync(join(sandbox, 'bin'));
  mkdirSync(join(sandbox, 'home'));
  symlinkSync(BINARY, join(sandbox, 'bin', 'mnema'));
});

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe('the binary a build leaves', () => {
  it('can be run by everybody who can read it', () => {
    const mode = statSync(BINARY).mode;
    // The user, the group and the others each hold an execute bit wherever they hold a read bit.
    expect(mode & 0o111 & ((mode & 0o444) >> 2)).toBe((mode & 0o444) >> 2);
    expect(mode & 0o100).toBe(0o100);
  });

  it('is found on the PATH by its link’s name and answers the version, as the page promises', () => {
    const ran = spawnSync('mnema', ['--version'], {
      encoding: 'utf-8',
      env: {
        PATH: `${join(sandbox, 'bin')}:${process.env.PATH ?? ''}`,
        HOME: join(sandbox, 'home'),
      },
    });
    expect(ran.error).toBeUndefined();
    expect(ran.stderr).toBe('');
    expect(ran.stdout.trim()).toBe(VERSION);
    expect(ran.status).toBe(0);
  });

  it('is marked by the step the build runs after tsc, which is what keeps it marked', () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8')) as {
      scripts: Record<string, string>;
    };
    expect(manifest.scripts.build).toBe(
      'tsc -b && node .github/the-binary-runs/mark-it-runnable.mjs',
    );
  });

  it('is what the page tells a reader to link', () => {
    // The sentence the recipe comes from. If the page stops saying it, this case is the one to
    // read before deleting the step that makes it true.
    const page = readFileSync(join(ROOT, 'README.md'), 'utf-8');
    expect(page).toContain('`pnpm build` leaves the binary at `packages/code/dist/cli.js`');
    expect(page).toContain('symlink it onto your `PATH` under the name `mnema`');
  });
});
