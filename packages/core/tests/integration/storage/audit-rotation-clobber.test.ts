import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { inspectAuditIntegrity } from '@/services/integrity/audit-integrity.js';
import { AuditService } from '@/services/integrity/audit-service.js';
import { AuditWriter } from '@/storage/audit/audit-writer.js';
import { MigrationRunner } from '@/storage/sqlite/migration-runner.js';
import { AuditStateRepository } from '@/storage/sqlite/repositories/audit-state-repository.js';
import { SqliteAdapter } from '@/storage/sqlite/sqlite-adapter.js';

const migrationsDir = path.resolve('packages/core/src/storage/sqlite/migrations');

/**
 * Guards audit-log rotation against two failure modes:
 *  - A1: rotating onto an existing YYYY-MM.jsonl must fail closed rather
 *    than clobber an archived month of the chain.
 *  - A2: rotation on the chained path runs inside the chain-advance lock,
 *    so a month-boundary write rotates and appends atomically and the
 *    line lands in the correct (fresh) file.
 */
describe('AuditWriter rotation hardening', () => {
  let tempRoot: string;
  let auditDir: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-audit-rot-'));
    auditDir = path.join(tempRoot, '.audit');
    mkdirSync(auditDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('A1: refuses to overwrite an existing archived month and keeps it intact', () => {
    // Seed current.jsonl in a January-dated file, and a pre-existing
    // January archive that a rotation would collide with.
    const currentPath = path.join(auditDir, 'current.jsonl');
    writeFileSync(currentPath, '{"v":1,"kind":"x","actor":"a","data":{}}\n', 'utf-8');
    const january = new Date('2026-01-15T12:00:00Z');
    utimesSync(currentPath, january, january);

    const archivePath = path.join(auditDir, '2026-01.jsonl');
    const archiveContent = '{"v":1,"kind":"archived","actor":"a","data":{}}\n';
    writeFileSync(archivePath, archiveContent, 'utf-8');

    // Now() is February, so the writer wants to rotate current → 2026-01.
    // The constructor triggers an immediate rotation check, so the throw
    // surfaces there; either way it must refuse and leave the archive intact.
    const february = new Date('2026-02-10T12:00:00Z');
    expect(() => new AuditWriter(auditDir, null, () => february)).toThrow(/already exists/);
    expect(readFileSync(archivePath, 'utf-8')).toBe(archiveContent);
  });

  it('A1: rotates normally when the destination is absent', () => {
    const currentPath = path.join(auditDir, 'current.jsonl');
    writeFileSync(currentPath, '{"v":1,"kind":"x","actor":"a","data":{}}\n', 'utf-8');
    const january = new Date('2026-01-15T12:00:00Z');
    utimesSync(currentPath, january, january);

    const february = new Date('2026-02-10T12:00:00Z');
    const writer = new AuditWriter(auditDir, null, () => february);
    writer.checkRotation();

    const files = readdirSync(auditDir).sort();
    expect(files).toContain('2026-01.jsonl');
    expect(files).not.toContain('current.jsonl');
  });

  it('A2: a month-boundary write on the chained path rotates and stays verifiable across the boundary', () => {
    // Scope: this asserts rotation on the chained path leaves the chain
    // verifiable across the fresh-file boundary (single-process). The
    // concurrency property — that rotation + append happen under a
    // cross-process lock — is not observable single-threaded and is
    // covered separately in audit-writer-lock.test.ts.
    const adapter = new SqliteAdapter(path.join(tempRoot, 'state.db'));
    new MigrationRunner().run(adapter, migrationsDir);
    const state = new AuditStateRepository(adapter);

    try {
      // First write in January.
      const january = new Date('2026-01-20T12:00:00Z');
      const janWriter = new AuditWriter(auditDir, state, () => january);
      new AuditService(janWriter).write({ kind: 'task_created', actor: 'a', data: { key: 'T-1' } });

      // Age current.jsonl into January, then write in February: the write
      // must rotate and land the new line in a fresh current.jsonl, with
      // the chain intact across the boundary.
      const currentPath = path.join(auditDir, 'current.jsonl');
      utimesSync(currentPath, january, january);

      const february = new Date('2026-02-05T12:00:00Z');
      const febWriter = new AuditWriter(auditDir, state, () => february);
      new AuditService(febWriter).write({ kind: 'task_created', actor: 'b', data: { key: 'T-2' } });

      // January line archived; February line in the fresh current.jsonl.
      const files = readdirSync(auditDir).sort();
      expect(files).toContain('2026-01.jsonl');
      expect(files).toContain('current.jsonl');
      const current = readFileSync(currentPath, 'utf-8').trim().split('\n');
      expect(current).toHaveLength(1);
      expect(JSON.parse(current[0] as string).data.key).toBe('T-2');

      // The chain verifies end-to-end across the rotation boundary.
      const checks = inspectAuditIntegrity(adapter, auditDir);
      expect(checks.find((c) => c.name === 'audit event count')?.ok).toBe(true);
      expect(checks.find((c) => c.name === 'audit hash chain')?.ok).toBe(true);
    } finally {
      adapter.close();
    }
  });
});
