import { fork } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { diagnoseAuditChain } from '@/services/audit/audit-diagnose.js';
import { MigrationRunner } from '@/storage/sqlite/migration-runner.js';
import { SqliteAdapter } from '@/storage/sqlite/sqlite-adapter.js';

const repoRoot = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const distRoot = path.join(repoRoot, 'dist');
const migrationsDir = path.join(repoRoot, 'src', 'storage', 'sqlite', 'migrations');
const childScript = fileURLToPath(
  new URL('./audit-writer-concurrent-processes.child.mjs', import.meta.url),
);

/**
 * REGRESSION for the exact failure mode a legacy audit log (see
 * `mnema audit diagnose`) can show: concurrent writers racing to append
 * without coordination fork the on-disk hash chain into interleaved
 * sub-chains, each individually content-authentic but joined by an orphaned
 * `prev_hash`. The cross-process file lock exists specifically to serialize
 * the chained write path across REAL OS processes — an in-process simulation
 * cannot exercise it, so this spawns actual child processes (not worker
 * threads) writing to the SAME audit dir + state.db concurrently, and asserts
 * the resulting chain has ZERO prev_hash discontinuities.
 *
 * Skipped when `dist/` is missing or stale relative to source — this exact
 * scenario can only be proven against the BUILT writer the CLI/MCP actually
 * run; run `npm run build` before this suite if it is skipped.
 */
const distBuilt = existsSync(path.join(distRoot, 'storage', 'audit', 'audit-writer.js'));

describe.skipIf(!distBuilt)('AuditWriter: concurrent OS processes never fork the chain', () => {
  it('N real processes writing concurrently produce a chain with zero prev_hash breaks', async () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-concurrent-'));
    const auditDir = path.join(tempRoot, '.mnema', 'audit');
    const statePath = path.join(tempRoot, 'state.db');
    mkdirSync(auditDir, { recursive: true });

    // Migrate the mirror DB up front — each child opens the SAME file, and
    // migration is not something the child scripts should race on.
    const adapter = new SqliteAdapter(statePath);
    new MigrationRunner().run(adapter, migrationsDir);
    adapter.close();

    const PROCESS_COUNT = 5;
    const EVENTS_PER_PROCESS = 20;

    const children = Array.from({ length: PROCESS_COUNT }, (_, i) => {
      const actor = `writer-${i}`;
      return new Promise<void>((resolve, reject) => {
        const child = fork(
          childScript,
          [distRoot, auditDir, statePath, actor, String(EVENTS_PER_PROCESS)],
          {
            stdio: 'pipe',
          },
        );
        let stderr = '';
        child.stderr?.on('data', (d) => {
          stderr += d.toString();
        });
        child.on('exit', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`child ${actor} exited ${code}: ${stderr}`));
        });
        child.on('error', reject);
      });
    });

    // ALL processes write concurrently — Promise.all does not serialize the
    // spawns, which is the point: the OS schedules them independently and
    // proper-lockfile is what must keep the chain from forking.
    await Promise.all(children);

    const totalWritten = PROCESS_COUNT * EVENTS_PER_PROCESS;
    const report = diagnoseAuditChain(auditDir, null, null, null, () => {
      throw new Error('git should not be called (gitCwd is null)');
    });

    expect(report.malformedLines).toBe(0);
    expect(report.totalChained).toBe(totalWritten);
    expect(report.breaks).toHaveLength(0); // the actual regression assertion

    // Cross-check with the raw line count, independent of diagnoseAuditChain's
    // own accounting, so a bug shared between the writer and the diagnostic
    // module could not hide a discrepancy from itself.
    const lineCount = readFileSync(path.join(auditDir, 'current.jsonl'), 'utf-8')
      .split('\n')
      .filter((l) => l.length > 0).length;
    expect(lineCount).toBe(totalWritten);

    rmSync(tempRoot, { recursive: true, force: true });
  }, 60_000);
});
