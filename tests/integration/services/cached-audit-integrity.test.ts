import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CachedAuditIntegrity, inspectAuditIntegrity } from '@/services/audit-integrity.js';
import { AuditService } from '@/services/audit-service.js';
import { AuditWriter } from '@/storage/audit/audit-writer.js';
import { MigrationRunner } from '@/storage/sqlite/migration-runner.js';
import { AuditStateRepository } from '@/storage/sqlite/repositories/audit-state-repository.js';
import { SqliteAdapter } from '@/storage/sqlite/sqlite-adapter.js';

const migrationsDir = path.resolve('src/storage/sqlite/migrations');

/**
 * The dashboard composes a snapshot per request and per tab switch, each
 * re-hashing the whole chain. CachedAuditIntegrity verifies at most once
 * per audit-file change: repeated get()s with no change return the SAME
 * cached array (no recompute), while any file mutation — including an
 * in-place edit of a past line (tampering, size unchanged) — invalidates
 * the cache so the mutation is still caught.
 */
describe('CachedAuditIntegrity', () => {
  let tempRoot: string;
  let auditDir: string;
  let adapter: SqliteAdapter;
  let audit: AuditService;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-cai-'));
    auditDir = path.join(tempRoot, '.audit');
    mkdirSync(auditDir, { recursive: true });
    adapter = new SqliteAdapter(path.join(tempRoot, 'state.db'));
    new MigrationRunner().run(adapter, migrationsDir);
    const writer = new AuditWriter(auditDir, new AuditStateRepository(adapter));
    audit = new AuditService(writer);
    audit.write({ kind: 'task_created', actor: 'a', data: { key: 'T-1' } });
    audit.write({ kind: 'task_created', actor: 'a', data: { key: 'T-2' } });
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  const currentFile = (): string => path.join(auditDir, 'current.jsonl');

  it('returns the identical cached result across repeated calls with no change', () => {
    const cache = new CachedAuditIntegrity(adapter, auditDir);
    const first = cache.get();
    const second = cache.get();
    const third = cache.get();
    // Same array reference ⇒ no recompute (a fresh inspect returns a new array).
    expect(second).toBe(first);
    expect(third).toBe(first);
    // And the cached verdict is a healthy chain.
    expect(first.find((c) => c.name === 'audit hash chain')?.ok).toBe(true);
  });

  it('recomputes after a new event is appended (signature changes)', () => {
    const cache = new CachedAuditIntegrity(adapter, auditDir);
    const before = cache.get();

    audit.write({ kind: 'task_created', actor: 'a', data: { key: 'T-3' } });

    const after = cache.get();
    expect(after).not.toBe(before); // recomputed
    expect(after.find((c) => c.name === 'audit event count')?.detail).toContain('3 chained');
  });

  it('still detects an in-place edit of a past line between calls (tamper, size unchanged)', () => {
    const cache = new CachedAuditIntegrity(adapter, auditDir);
    expect(cache.get().find((c) => c.name === 'audit hash chain')?.ok).toBe(true);

    // Tamper: flip a character in a past line WITHOUT changing the file
    // size (replace one actor letter), then bump mtime as any editor would.
    const raw = readFileSync(currentFile(), 'utf-8');
    const tampered = raw.replace('"actor":"a"', '"actor":"b"'); // same length
    expect(tampered.length).toBe(raw.length); // size is unchanged
    writeFileSync(currentFile(), tampered, 'utf-8');
    utimesSync(currentFile(), new Date(), new Date());

    // The signature (mtime) moved, so the cache recomputes and catches it.
    const after = cache.get();
    const chain = after.find((c) => c.name === 'audit hash chain');
    expect(chain?.ok).toBe(false);
    // Parity with a direct (uncached) verification of the same tampered log.
    const direct = inspectAuditIntegrity(adapter, auditDir).find(
      (c) => c.name === 'audit hash chain',
    );
    expect(chain?.ok).toBe(direct?.ok);
  });
});
