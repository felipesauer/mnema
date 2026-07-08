import { fork } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { ActorKind } from '@/domain/enums/actor-kind.js';
import { TaskState } from '@/domain/enums/task-state.js';
import { MigrationRunner } from '@/storage/sqlite/migration-runner.js';
import { ActorRepository } from '@/storage/sqlite/repositories/actor-repository.js';
import { ProjectRepository } from '@/storage/sqlite/repositories/project-repository.js';
import { TaskRepository } from '@/storage/sqlite/repositories/task-repository.js';
import { SqliteAdapter } from '@/storage/sqlite/sqlite-adapter.js';

const repoRoot = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const distRoot = path.join(repoRoot, 'dist');
const migrationsDir = path.join(repoRoot, 'src', 'storage', 'sqlite', 'migrations');
const childScript = fileURLToPath(
  new URL('./task-claim-concurrent-processes.child.mjs', import.meta.url),
);

/**
 * REGRESSION for the exact contention the claim lease exists to close:
 * multiple sessions (real OS processes, each its own `mnema mcp serve`)
 * reading the same READY task and each trying to reserve it. Optimistic
 * concurrency on `transition` only catches a lost write after the fact;
 * `TaskRepository.claim` folds the check into a single conditional UPDATE so
 * exactly one process can win. This spawns real child processes (not worker
 * threads) all claiming the SAME task against the SAME state.db and asserts
 * exactly one succeeds — an in-process simulation can't exercise the
 * cross-process write serialisation that makes that true.
 *
 * Skipped when `dist/` is missing or stale: the children run the BUILT
 * repository the CLI/MCP actually run; run `npm run build` before this suite
 * if it is skipped.
 */
/**
 * True only when the built repository exists AND is at least as new as its
 * source — a stale `dist/` would let this regression validate an OLD claim()
 * and pass green after a source edit that was never rebuilt. Checking mtime
 * (not just existence) makes the header's "or stale" promise real.
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

describe.skipIf(!distBuilt)('TaskRepository.claim: concurrent OS processes, one winner', () => {
  it('N real processes claiming the same task produce exactly one winner', async () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-claim-'));
    const statePath = path.join(tempRoot, 'state.db');

    // Migrate + build the fixture up front in the parent, then close: each
    // child opens the SAME file, and neither migration nor fixture creation
    // should be raced by the children — only the claim is under test.
    const adapter = new SqliteAdapter(statePath);
    new MigrationRunner().run(adapter, migrationsDir);
    const projects = new ProjectRepository(adapter);
    const tasks = new TaskRepository(adapter);
    const actors = new ActorRepository(adapter);

    const project = projects.insert({ key: 'WEBAPP', name: 'Webapp' });
    const task = tasks.insert({
      key: 'WEBAPP-1',
      projectId: project.id,
      title: 'Contended task',
      reporterId: actors.upsert('reporter', ActorKind.Human),
      state: TaskState.Ready,
    });

    const PROCESS_COUNT = 12;
    // Each child claims as a distinct actor so a winner is unambiguous — this
    // is contention between different actors, not one actor re-claiming.
    const actorIds = Array.from({ length: PROCESS_COUNT }, (_, i) =>
      actors.upsert(`agent-${i}`, ActorKind.Agent),
    );
    adapter.close();

    // One shared clock for every child: they all see the task as unclaimed at
    // the same `now`, and all write the same future `leaseExpiresAt`. That is
    // the genuine race — nothing about ordering or staggered timestamps picks
    // the winner, only the atomic conditional UPDATE does.
    const now = new Date().toISOString();
    const leaseExpiresAt = new Date(Date.now() + 30 * 60_000).toISOString();

    const children = actorIds.map((actorId) => {
      return new Promise<{ actorId: string; claimed: boolean }>((resolve, reject) => {
        const child = fork(
          childScript,
          [distRoot, statePath, task.id, actorId, leaseExpiresAt, now],
          { stdio: 'pipe' },
        );
        let stdout = '';
        let stderr = '';
        child.stdout?.on('data', (d) => {
          stdout += d.toString();
        });
        child.stderr?.on('data', (d) => {
          stderr += d.toString();
        });
        child.on('exit', (code) => {
          if (code === 0)
            resolve(JSON.parse(stdout.trim()) as { actorId: string; claimed: boolean });
          else reject(new Error(`child ${actorId} exited ${code}: ${stderr}`));
        });
        child.on('error', reject);
      });
    });

    // Promise.all does not serialise the spawns — the OS schedules the claim
    // attempts independently, which is the point.
    const results = await Promise.all(children);

    const winners = results.filter((r) => r.claimed);
    expect(winners).toHaveLength(1); // the actual regression assertion

    // The winner's actor is the one now recorded on the row — independent of
    // the child's own report, read straight from a fresh connection so a bug
    // shared between claim() and the child couldn't hide a mismatch.
    const verifyAdapter = new SqliteAdapter(statePath);
    const finalTask = new TaskRepository(verifyAdapter).findById(task.id);
    verifyAdapter.close();
    expect(finalTask?.claimedBy).toBe(winners[0]?.actorId);
    expect(finalTask?.leaseExpiresAt).toBe(leaseExpiresAt);

    rmSync(tempRoot, { recursive: true, force: true });
  }, 60_000);
});
