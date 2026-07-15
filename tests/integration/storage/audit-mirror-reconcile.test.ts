import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { inspectAuditIntegrity } from '@/services/integrity/audit-integrity.js';
import { AuditService } from '@/services/integrity/audit-service.js';
import { AuditWriter } from '@/storage/audit/audit-writer.js';
import { MigrationRunner } from '@/storage/sqlite/migration-runner.js';
import { AuditStateRepository } from '@/storage/sqlite/repositories/audit-state-repository.js';
import { SqliteAdapter } from '@/storage/sqlite/sqlite-adapter.js';

const migrationsDir = path.resolve('src/storage/sqlite/migrations');

/**
 * A crash between the mirror COMMIT and the JSONL append leaves the mirror
 * exactly one event ahead of disk, pointing at a head whose line was never
 * written. Without reconciliation the NEXT write chains onto that phantom
 * head and forks the on-disk chain permanently (a prev_hash break that can
 * never be repaired). The writer must, on boot, rewind the mirror to the
 * real on-disk tail so the next write chains from a line that exists.
 */
describe('audit mirror reconciliation on boot', () => {
  let tempRoot: string;
  let auditDir: string;
  let adapter: SqliteAdapter;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-reconcile-'));
    auditDir = path.join(tempRoot, '.audit');
    mkdirSync(auditDir, { recursive: true });
    adapter = new SqliteAdapter(path.join(tempRoot, 'state.db'));
    new MigrationRunner().run(adapter, migrationsDir);
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  const state = () => new AuditStateRepository(adapter);
  const newWriter = () => new AuditWriter(auditDir, state());

  function writeTwoEvents(): void {
    const audit = new AuditService(newWriter());
    audit.write({ kind: 'task_created', actor: 'a', data: { key: 'T-1' } });
    audit.write({ kind: 'task_created', actor: 'a', data: { key: 'T-2' } });
  }

  /** Simulate the commit→append crash: mirror committed N+1, disk has N. */
  function simulateCrash(): void {
    adapter
      .getDatabase()
      .prepare(
        'UPDATE audit_state SET event_count = event_count + 1, chain_head_hash = ? WHERE id = 1',
      )
      .run('de'.repeat(32)); // phantom head, no matching disk line
  }

  it('rewinds the mirror on boot so the next write does NOT fork the chain', () => {
    writeTwoEvents();
    const goodHead = state().read().chainHeadHash;
    simulateCrash();
    // Sanity: the mirror is now one ahead with a phantom head.
    expect(state().read().eventCount).toBe(3);
    expect(state().read().chainHeadHash).toBe('de'.repeat(32));

    // Boot a fresh writer — reconciliation runs in the constructor, under the
    // lock, and must rewind the mirror to the real disk tail.
    const audit = new AuditService(newWriter());
    expect(state().read().eventCount).toBe(2);
    expect(state().read().chainHeadHash).toBe(goodHead);

    // The next write now chains from the REAL tail, not the phantom.
    audit.write({ kind: 'task_created', actor: 'a', data: { key: 'T-3' } });

    // The chain verifies cleanly — no fork, no prev_hash break.
    const checks = inspectAuditIntegrity(adapter, auditDir);
    expect(checks.find((c) => c.name === 'audit hash chain')?.ok).toBe(true);
    expect(checks.find((c) => c.name === 'audit event count')?.ok).toBe(true);
  });

  it('does NOT rewind when the mirror matches disk (no spurious reconciliation)', () => {
    writeTwoEvents();
    const head = state().read().chainHeadHash;
    // Boot again with a consistent state — reconciliation must be a no-op.
    newWriter();
    expect(state().read().eventCount).toBe(2);
    expect(state().read().chainHeadHash).toBe(head);
  });

  it('does NOT rewind an ahead-by-two divergence (leaves it for the verifier)', () => {
    writeTwoEvents();
    adapter
      .getDatabase()
      .prepare('UPDATE audit_state SET event_count = event_count + 2 WHERE id = 1')
      .run();
    newWriter(); // boot
    // Ahead-by-two is NOT the recoverable shape → left untouched (still 4).
    expect(state().read().eventCount).toBe(4);
  });
});
