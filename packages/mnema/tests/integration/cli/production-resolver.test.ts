import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

/**
 * Regression test for Phase H finding H-2.
 *
 * The bug: `bundledMigrationsDir` in `createServiceContainer` was
 * resolved cwd-relative via `path.resolve('packages/core/src/storage/sqlite/migrations')`.
 * When the installed CLI ran from any directory outside the Mnema
 * source tree, the path pointed at a non-existent directory and
 * `detectDrift` silently saw zero migrations. The integration suite
 * never caught it because every test passes `options.migrationsDir`
 * explicitly, so the production resolver was never exercised.
 *
 * This test spawns the **compiled** `dist/index.js` with `cwd` set
 * to a tmpdir far from the source tree, then asserts `mnema doctor`
 * reports the full migration set as applied. If the production
 * resolver regresses to cwd-relative (or otherwise fails to find
 * the bundled migrations), the init won't apply any migrations and
 * the doctor check fails.
 */

const repoRoot = path.resolve('.');
const cliEntry = path.join(repoRoot, 'packages', 'mnema', 'dist', 'index.js');

describe('CLI production resolver (H-2 regression)', () => {
  let isolated: string | undefined;

  beforeAll(() => {
    if (!existsSync(cliEntry)) {
      throw new Error(`CLI not built. Run pnpm build before tests. Path: ${cliEntry}`);
    }
  });

  afterEach(() => {
    if (isolated !== undefined) {
      rmSync(isolated, { recursive: true, force: true });
      isolated = undefined;
    }
  });

  it('resolves bundled migrations when spawned from outside the source tree', () => {
    isolated = mkdtempSync(path.join(tmpdir(), 'mnema-isolated-'));

    // `cwd` is the tmpdir; a cwd-relative migrations resolver would
    // point at <isolated>/src/storage/sqlite/migrations, which does
    // not exist. The production resolver walks from dist/utils
    // upward to the package root, so it stays correct here.
    const init = spawnSync('node', [cliEntry, 'init', '--name', 'Resolver', '--key', 'RES'], {
      cwd: isolated,
      env: { ...process.env, MNEMA_ACTOR: 'test-resolver' },
      encoding: 'utf-8',
    });

    expect(init.status).toBe(0);
    expect(existsSync(path.join(isolated, '.mnema/state/state.db'))).toBe(true);

    const doctor = spawnSync('node', [cliEntry, 'doctor'], {
      cwd: isolated,
      env: { ...process.env, MNEMA_ACTOR: 'test-resolver' },
      encoding: 'utf-8',
    });

    expect(doctor.status).toBe(0);
    // The compiled binary ships 11 migrations as of this commit. If
    // future migrations land, the assertion just needs the new count
    // — bumping it intentionally is fine; an unexpected drop to 0
    // means the resolver regressed.
    expect(doctor.stdout).toMatch(/\b\d+ applied, \d+ on disk\b/);
    const match = doctor.stdout.match(/(\d+) applied, (\d+) on disk/);
    expect(match).not.toBeNull();
    if (match === null) return;
    const [, applied, onDisk] = match;
    expect(Number(applied)).toBeGreaterThanOrEqual(11);
    expect(Number(applied)).toBe(Number(onDisk));
  });
});
