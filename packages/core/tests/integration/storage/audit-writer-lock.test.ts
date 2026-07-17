import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import lockfile from 'proper-lockfile';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { inspectAuditIntegrity } from '@/services/integrity/audit-integrity.js';
import { AuditService } from '@/services/integrity/audit-service.js';
import { AuditWriter } from '@/storage/audit/audit-writer.js';
import { MigrationRunner } from '@/storage/sqlite/migration-runner.js';
import { AuditStateRepository } from '@/storage/sqlite/repositories/audit-state-repository.js';
import { SqliteAdapter } from '@/storage/sqlite/sqlite-adapter.js';

const migrationsDir = path.resolve('packages/core/src/storage/sqlite/migrations');

/**
 * The chained write path (`AuditWriter` with a SQLite mirror) takes a
 * cross-process file lock around rotation + the transaction + the
 * post-commit append. Without it, two processes could commit in one order
 * but append in the other, forking the on-disk chain so doctor reads a
 * benign concurrent write as tampering. These prove the lock is actually
 * taken (a held lock blocks a write) and that the chain stays verifiable.
 */
describe('AuditWriter cross-process lock', () => {
  let tempRoot: string;
  let auditDir: string;
  let adapter: SqliteAdapter;
  let writer: AuditWriter;
  let audit: AuditService;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-audit-lock-'));
    auditDir = path.join(tempRoot, '.audit');
    mkdirSync(auditDir, { recursive: true });
    adapter = new SqliteAdapter(path.join(tempRoot, 'state.db'));
    new MigrationRunner().run(adapter, migrationsDir);
    const state = new AuditStateRepository(adapter);
    writer = new AuditWriter(auditDir, state);
    audit = new AuditService(writer);
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  const lockTarget = (): string => path.join(auditDir, '.audit.lock');

  it('creates the lock target inside the audit dir on the chained path', () => {
    audit.write({ kind: 'task_created', actor: 'a', data: { key: 'T-1' } });
    expect(existsSync(lockTarget())).toBe(true);
  });

  it('refuses to write while another holder holds the audit lock (respects the lock)', () => {
    // Simulate a second process holding the lock for the whole attempt.
    // `AuditWriter.write` drives a synchronous retry loop (10 × 50ms) and,
    // finding the lock held throughout, throws instead of appending. Before
    // the fix, write() took no lock at all and would append immediately —
    // exactly the interleaving that forks the on-disk chain. (The loop is a
    // sync spin, so a same-thread timed release can't unblock it; asserting
    // the held-lock refusal is the deterministic, single-process proof.)
    if (!existsSync(lockTarget())) writeFileSync(lockTarget(), '', 'utf-8');
    const release = lockfile.lockSync(lockTarget(), { stale: 2000, realpath: false });
    try {
      expect(() => audit.write({ kind: 'task_created', actor: 'a', data: { key: 'T-1' } })).toThrow(
        /already being held|lock/i,
      );
      // Nothing was appended and the mirror never advanced: no line on disk
      // and event_count still 0. (The write threw before its afterCommit.)
      expect(existsSync(path.join(auditDir, 'current.jsonl'))).toBe(false);
      const count = adapter
        .getDatabase()
        .prepare('SELECT event_count FROM audit_state WHERE id = 1')
        .get() as { event_count: number };
      expect(count.event_count).toBe(0);
    } finally {
      release();
    }

    // Once released, the same write succeeds and the chain verifies.
    audit.write({ kind: 'task_created', actor: 'a', data: { key: 'T-1' } });
    const after = inspectAuditIntegrity(adapter, auditDir);
    expect(after.find((c) => c.name === 'audit hash chain')?.ok).toBe(true);
    expect(after.find((c) => c.name === 'audit event count')?.detail).toContain('1 chained');
  });

  it('keeps the chain verifiable across a sequence of writes (no fork)', () => {
    for (let i = 1; i <= 5; i += 1) {
      audit.write({ kind: 'task_created', actor: 'a', data: { key: `T-${i}` } });
    }
    const checks = inspectAuditIntegrity(adapter, auditDir);
    expect(checks.find((c) => c.name === 'audit hash chain')?.ok).toBe(true);
    expect(checks.find((c) => c.name === 'audit event count')?.detail).toContain('5 chained');
  });
});
