import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
 * A writer wired with a project secret seals v3 (HMAC-keyed) events, and
 * the verifier recomputes them with the same secret (ADR-37 layer 2).
 * With the wrong/absent secret the same on-disk lines are NOT falsely
 * flagged as tampered — authenticity is reported unverifiable while chain
 * consistency still holds.
 */
describe('v3 HMAC audit chain', () => {
  let tempRoot: string;
  let auditDir: string;
  let adapter: SqliteAdapter;
  const secret = Buffer.from(`ab`.repeat(32), 'hex');
  const wrong = Buffer.from(`cd`.repeat(32), 'hex');

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-hmac-'));
    auditDir = path.join(tempRoot, '.audit');
    mkdirSync(auditDir, { recursive: true });
    adapter = new SqliteAdapter(path.join(tempRoot, 'state.db'));
    new MigrationRunner().run(adapter, migrationsDir);
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  /** Writes 3 events through a secret-wired writer (v3). */
  function writeV3(): void {
    const audit = new AuditService(
      new AuditWriter(auditDir, new AuditStateRepository(adapter), undefined, secret),
    );
    audit.write({ kind: 'task_created', actor: 'alice', data: { key: 'T-1' } });
    audit.write({ kind: 'task_created', actor: 'bob', data: { key: 'T-2' } });
    audit.write({
      kind: 'task_transitioned',
      actor: 'alice',
      data: { key: 'T-1', from: 'DRAFT', to: 'READY', action: 'submit' },
    });
  }

  it('writes v3 lines and verifies them with the correct secret', () => {
    writeV3();
    // Every chained line is v3.
    const versions = readFileSync(path.join(auditDir, 'current.jsonl'), 'utf-8')
      .split('\n')
      .filter((l) => l.length > 0)
      .map((l) => (JSON.parse(l) as { v: number }).v);
    expect(versions).toEqual([3, 3, 3]);

    const checks = inspectAuditIntegrity(adapter, auditDir, secret);
    expect(checks.find((c) => c.name === 'audit event count')?.ok).toBe(true);
    expect(checks.find((c) => c.name === 'audit hash chain')?.ok).toBe(true);
    // No authenticity warning when the secret is present.
    expect(checks.find((c) => c.name === 'audit authenticity')).toBeUndefined();
  });

  it('reports a hash-chain break when verified with the WRONG secret', () => {
    writeV3();
    const checks = inspectAuditIntegrity(adapter, auditDir, wrong);
    // The recomputed HMAC does not match, so the chain reads as broken —
    // a different secret cannot verify a project's authentic v3 lines.
    expect(checks.find((c) => c.name === 'audit hash chain')?.ok).toBe(false);
  });

  it('reports authenticity UNVERIFIABLE (not tampered) with no secret', () => {
    writeV3();
    const checks = inspectAuditIntegrity(adapter, auditDir, null);
    // Chain consistency (prev_hash continuity, count) still holds…
    expect(checks.find((c) => c.name === 'audit hash chain')?.ok).toBe(true);
    expect(checks.find((c) => c.name === 'audit event count')?.ok).toBe(true);
    // …but authenticity is a WARNING, never an error/tamper.
    const auth = checks.find((c) => c.name === 'audit authenticity');
    expect(auth?.ok).toBe(false);
    expect(auth?.severity).toBe('warning');
    expect(auth?.detail).toMatch(/project secret not present/i);
  });

  it('still detects an in-place tamper of a v3 line (with the secret)', () => {
    writeV3();
    const file = path.join(auditDir, 'current.jsonl');
    const lines = readFileSync(file, 'utf-8')
      .split('\n')
      .filter((l) => l.length > 0);
    const first = JSON.parse(lines[0] as string) as Record<string, unknown>;
    first.actor = 'mallory'; // forge the actor without re-keying the hash
    lines[0] = JSON.stringify(first);
    writeFileSync(file, `${lines.join('\n')}\n`, 'utf-8');

    const checks = inspectAuditIntegrity(adapter, auditDir, secret);
    expect(checks.find((c) => c.name === 'audit hash chain')?.ok).toBe(false);
  });
});
