import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { inspectAuditIntegrity } from '@/services/audit-integrity.js';
import { AuditService } from '@/services/audit-service.js';
import { AuditWriter } from '@/storage/audit/audit-writer.js';
import { MigrationRunner } from '@/storage/sqlite/migration-runner.js';
import { AuditStateRepository } from '@/storage/sqlite/repositories/audit-state-repository.js';
import { SqliteAdapter } from '@/storage/sqlite/sqlite-adapter.js';

const migrationsDir = path.resolve('src/storage/sqlite/migrations');

/**
 * The writer commits the SQLite mirror BEFORE appending the JSONL line, so a
 * crash in that window leaves the mirror exactly one event ahead of disk.
 * The writer/repo comments promise this is recoverable and benign — the
 * verifier must therefore report it as a WARNING, not a hard tamper error.
 * A mirror behind disk, or ahead by more than one, stays an error.
 */
describe('audit crash-recovery reconciliation', () => {
  let tempRoot: string;
  let auditDir: string;
  let adapter: SqliteAdapter;
  let audit: AuditService;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-crashrec-'));
    auditDir = path.join(tempRoot, '.audit');
    mkdirSync(auditDir, { recursive: true });
    adapter = new SqliteAdapter(path.join(tempRoot, 'state.db'));
    new MigrationRunner().run(adapter, migrationsDir);
    audit = new AuditService(new AuditWriter(auditDir, new AuditStateRepository(adapter)));
    audit.write({ kind: 'task_created', actor: 'a', data: { key: 'T-1' } });
    audit.write({ kind: 'task_created', actor: 'a', data: { key: 'T-2' } });
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  /** Bump audit_state to simulate the mirror leading disk by `n` events. */
  function advanceMirror(n: number): void {
    adapter
      .getDatabase()
      .prepare('UPDATE audit_state SET event_count = event_count + ? WHERE id = 1')
      .run(n);
  }

  const check = (name: string) =>
    inspectAuditIntegrity(adapter, auditDir).find((c) => c.name === name);

  it('reports mirror-one-ahead as a WARNING (not a hard error) — the crash window is ambiguous with a last-line truncation', () => {
    advanceMirror(1);
    const count = check('audit event count');
    // Not a clean pass (a truncation must never be silently green) and not a
    // hard error (a genuine crash must not be a screaming false-tamper): a
    // warning that names both causes.
    expect(count?.ok).toBe(false);
    expect(count?.severity).toBe('warning');
    expect(count?.detail).toMatch(/one event ahead|crash|truncat/i);
  });

  it('the full crash window (count +1 AND head past disk) is a warning on both lines, not an error', () => {
    // Simulate the real window: mirror head points at an event whose line was
    // never appended. Bump the count AND set chain_head_hash to a phantom.
    adapter
      .getDatabase()
      .prepare(
        'UPDATE audit_state SET event_count = event_count + 1, chain_head_hash = ? WHERE id = 1',
      )
      .run('f'.repeat(64));
    const count = check('audit event count');
    expect(count?.ok).toBe(false);
    expect(count?.severity).toBe('warning');
    const chain = check('audit hash chain');
    expect(chain?.ok).toBe(false);
    expect(chain?.severity).toBe('warning');
    expect(chain?.detail).toMatch(/lags|crash|truncat/i);
  });

  it('still reports mirror-ahead-by-TWO as a hard error (not the crash window)', () => {
    advanceMirror(2);
    const count = check('audit event count');
    expect(count?.ok).toBe(false);
    expect(count?.severity ?? 'error').toBe('error');
  });

  it('still reports mirror BEHIND disk as a hard error (truncation shape)', () => {
    advanceMirror(-1); // mirror now behind the 2 lines on disk
    const count = check('audit event count');
    expect(count?.ok).toBe(false);
  });
});
