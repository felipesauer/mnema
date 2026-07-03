import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { inspectAuditIntegrity } from '@/cli/commands/doctor-command.js';
import { AuditService } from '@/services/audit-service.js';
import { AuditWriter } from '@/storage/audit/audit-writer.js';
import { MigrationRunner } from '@/storage/sqlite/migration-runner.js';
import { AuditStateRepository } from '@/storage/sqlite/repositories/audit-state-repository.js';
import { SqliteAdapter } from '@/storage/sqlite/sqlite-adapter.js';

const migrationsDir = path.resolve('src/storage/sqlite/migrations');

/**
 * Guards the crash-ordering invariant (C1): the JSONL append must happen
 * only AFTER the SQLite chain commit. If a crash falls between the two,
 * the safe direction is the mirror being one event AHEAD of disk
 * (recoverable), never a line on disk the committed mirror never
 * recorded (which reads as tampering — a benign crash indistinguishable
 * from an attack).
 */
describe('AuditWriter crash ordering', () => {
  let tempRoot: string;
  let auditDir: string;
  let adapter: SqliteAdapter;
  let writer: AuditWriter;
  let audit: AuditService;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-audit-crash-'));
    auditDir = path.join(tempRoot, '.audit');
    mkdirSync(auditDir, { recursive: true });
    adapter = new SqliteAdapter(path.join(tempRoot, 'state.db'));
    new MigrationRunner().run(adapter, migrationsDir);

    const state = new AuditStateRepository(adapter);
    writer = new AuditWriter(auditDir, state);
    audit = new AuditService(writer);
  });

  afterEach(() => {
    // Restore perms so cleanup can remove the tree.
    try {
      chmodSync(path.join(auditDir, 'current.jsonl'), 0o644);
    } catch {
      // best effort
    }
    adapter.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  function diskLineCount(): number {
    const file = path.join(auditDir, 'current.jsonl');
    return readFileSync(file, 'utf-8')
      .split('\n')
      .filter((l) => l.length > 0).length;
  }

  it('a post-commit append failure leaves the mirror one ahead, not a tamper verdict', () => {
    // Two clean events establish a healthy chain.
    audit.write({ kind: 'task_created', actor: 'daniel', data: { key: 'T-1' } });
    audit.write({ kind: 'task_created', actor: 'eve', data: { key: 'T-2' } });
    expect(diskLineCount()).toBe(2);

    // Simulate a crash exactly after COMMIT but before the append lands:
    // make current.jsonl read-only so appendFileSync throws. Because the
    // append now runs AFTER the commit, the mirror has already advanced to
    // 3 while the third line never reaches disk.
    chmodSync(path.join(auditDir, 'current.jsonl'), 0o444);
    expect(() =>
      audit.write({ kind: 'task_created', actor: 'mallory', data: { key: 'T-3' } }),
    ).toThrow();
    chmodSync(path.join(auditDir, 'current.jsonl'), 0o644);

    // Disk still has two lines; the committed mirror counts three.
    expect(diskLineCount()).toBe(2);

    const checks = inspectAuditIntegrity(adapter, auditDir);
    const chain = checks.find((c) => c.name === 'audit hash chain');
    const count = checks.find((c) => c.name === 'audit event count');

    // The count is off by one (mirror ahead) — surfaced, but NOT as a
    // hash-chain tamper. The two lines actually on disk verify cleanly.
    expect(count?.ok).toBe(false);
    expect(count?.detail).toContain('2 chained events');
    // The chain hash check must NOT report a mismatch: the on-disk lines
    // are internally consistent; only the tail differs from the mirror's
    // head (the recoverable direction), never a "hash mismatch on a line".
    expect(chain?.detail ?? '').not.toContain('hash mismatch');
  });

  it('runs the append only after the mirror is committed (ordering guard)', () => {
    // Directly probe the ordering that the whole fix rests on: when the
    // append action runs, the mirror UPDATE must already be committed and
    // visible. In the pre-fix code the append happened INSIDE the
    // transaction, before the UPDATE, so event_count would still read the
    // old value here — this assertion fails on the old ordering and holds
    // on the new one.
    const state = new AuditStateRepository(adapter);
    const db = adapter.getDatabase();

    const countBefore = (
      db.prepare('SELECT event_count AS n FROM audit_state WHERE id = 1').get() as { n: number }
    ).n;

    let countSeenByAppend = -1;
    state.withChainAdvance(() => ({
      hash: 'deadbeef',
      at: '2026-07-03T00:00:00.000Z',
      afterCommit: () => {
        // No BEGIN IMMEDIATE is held now (commit already ran), so this
        // read sees the committed mirror. On the old in-transaction
        // ordering this would run before COMMIT and see countBefore.
        countSeenByAppend = (
          db.prepare('SELECT event_count AS n FROM audit_state WHERE id = 1').get() as { n: number }
        ).n;
      },
    }));

    expect(countSeenByAppend).toBe(countBefore + 1);
  });

  it('keeps the chain green on a clean run (append after commit still lands every line)', () => {
    audit.write({ kind: 'task_created', actor: 'daniel', data: { key: 'T-1' } });
    audit.write({ kind: 'task_created', actor: 'eve', data: { key: 'T-2' } });
    audit.write({
      kind: 'task_transitioned',
      actor: 'daniel',
      data: { key: 'T-1', from: 'DRAFT', to: 'READY', action: 'submit' },
    });

    expect(diskLineCount()).toBe(3);
    const checks = inspectAuditIntegrity(adapter, auditDir);
    expect(checks.find((c) => c.name === 'audit event count')?.ok).toBe(true);
    expect(checks.find((c) => c.name === 'audit hash chain')?.ok).toBe(true);
  });
});
