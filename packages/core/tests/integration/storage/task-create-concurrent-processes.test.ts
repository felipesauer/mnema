import { fork } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { ActorKind } from '@/domain/enums/actor-kind.js';
import { MigrationRunner } from '@/storage/sqlite/migration-runner.js';
import { ActorRepository } from '@/storage/sqlite/repositories/actor-repository.js';
import { ProjectRepository } from '@/storage/sqlite/repositories/project-repository.js';
import { SqliteAdapter } from '@/storage/sqlite/sqlite-adapter.js';

const repoRoot = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const distRoot = path.join(repoRoot, 'dist');
const migrationsDir = path.join(repoRoot, 'src', 'storage', 'sqlite', 'migrations');
const childScript = fileURLToPath(
  new URL('./task-create-concurrent-processes.child.mjs', import.meta.url),
);

/**
 * REGRESSION for cross-process contention on the create path: two
 * `mnema mcp serve` processes sharing one state.db each inserting a task. The
 * create path runs under `BEGIN IMMEDIATE`, taking the write lock up front so
 * concurrent creators serialise on the single state.db instead of racing a
 * read-then-write. This spawns real child processes (not worker threads) all
 * inserting a task against the SAME state.db and asserts every committed id is
 * distinct — never a duplicate, and never a raw (unmapped) SqliteError. An
 * in-process simulation can't exercise the cross-process write serialisation
 * that makes that true.
 *
 * Skipped when `dist/` is missing or stale (children run the BUILT repository).
 */
function distFresh(): boolean {
  const built = path.join(distRoot, 'storage', 'sqlite', 'repositories', 'task-repository.js');
  const source = path.join(
    repoRoot,
    'src',
    'storage',
    'sqlite',
    'repositories',
    'task-repository.ts',
  );
  if (!existsSync(built) || !existsSync(source)) return false;
  return statSync(built).mtimeMs >= statSync(source).mtimeMs;
}

const distBuilt = distFresh();

describe.skipIf(!distBuilt)('TaskRepository create: concurrent OS processes, distinct ids', () => {
  it('N real processes inserting against one state.db get N distinct ids', async () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-create-'));
    const statePath = path.join(tempRoot, 'state.db');

    const adapter = new SqliteAdapter(statePath);
    new MigrationRunner().run(adapter, migrationsDir);
    const projects = new ProjectRepository(adapter);
    const actors = new ActorRepository(adapter);
    const project = projects.insert({ key: 'WEBAPP', name: 'Webapp' });
    const reporterId = actors.upsert('reporter', ActorKind.Human);
    adapter.close();

    const PROCESS_COUNT = 12;
    const children = Array.from({ length: PROCESS_COUNT }, () => {
      return new Promise<{ ok: boolean; id?: string; mappedKind?: string | null }>(
        (resolve, reject) => {
          const child = fork(childScript, [distRoot, statePath, project.id, reporterId], {
            stdio: 'pipe',
          });
          let stdout = '';
          let stderr = '';
          child.stdout?.on('data', (d) => {
            stdout += d.toString();
          });
          child.stderr?.on('data', (d) => {
            stderr += d.toString();
          });
          child.on('exit', (code) => {
            if (code === 0) resolve(JSON.parse(stdout.trim()));
            else reject(new Error(`child exited ${code}: ${stderr}`));
          });
          child.on('error', reject);
        },
      );
    });

    const results = await Promise.all(children);

    // The core regression: every successful insert produced a distinct id.
    const ids = results.filter((r) => r.ok).map((r) => r.id as string);
    expect(new Set(ids).size).toBe(ids.length);

    // Any failure must be a cleanly mapped, retryable error — never a raw
    // SqliteError leaking through (mappedKind === null).
    for (const failure of results.filter((r) => !r.ok)) {
      expect(failure.mappedKind).not.toBeNull();
    }

    // With BEGIN IMMEDIATE serialising the write, all creators should in fact
    // succeed — every one committing its own distinct id.
    expect(ids.length).toBe(PROCESS_COUNT);

    rmSync(tempRoot, { recursive: true, force: true });
  }, 60_000);
});
