import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CachedAuditIntegrity } from '@/services/audit-integrity.js';
import { AuditService } from '@/services/audit-service.js';
import { createAttestationSource, HeadCheckpointService } from '@/services/head-checkpoint.js';
import { MachineKeyService } from '@/services/machine-key.js';
import { AuditWriter } from '@/storage/audit/audit-writer.js';
import { MigrationRunner } from '@/storage/sqlite/migration-runner.js';
import { AuditHeadSignatureRepository } from '@/storage/sqlite/repositories/audit-head-signature-repository.js';
import { AuditStateRepository } from '@/storage/sqlite/repositories/audit-state-repository.js';
import { SqliteAdapter } from '@/storage/sqlite/sqlite-adapter.js';

const migrationsDir = path.resolve('src/storage/sqlite/migrations');

/**
 * The dashboard's CachedAuditIntegrity must run the machine-attestation
 * check (so a forged head signature is not invisible on the dashboard) and
 * must invalidate its cache when the recorded head signature changes — the
 * signature lives in SQLite, not the audit files, so the file-stat signature
 * alone would serve a stale verdict.
 */
describe('CachedAuditIntegrity with attestation', () => {
  let tempRoot: string;
  let projectRoot: string;
  let userDir: string;
  let auditDir: string;
  let adapter: SqliteAdapter;
  let signatures: AuditHeadSignatureRepository;
  let machineKey: MachineKeyService;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-cachedattest-'));
    projectRoot = path.join(tempRoot, 'proj');
    userDir = path.join(tempRoot, 'home', '.config', 'mnema');
    auditDir = path.join(projectRoot, '.mnema', 'audit');
    mkdirSync(auditDir, { recursive: true });
    mkdirSync(userDir, { recursive: true });
    adapter = new SqliteAdapter(path.join(tempRoot, 'state.db'));
    new MigrationRunner().run(adapter, migrationsDir);
    signatures = new AuditHeadSignatureRepository(adapter);
    machineKey = new MachineKeyService(projectRoot, 'felipesauer', userDir);
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  function writeSignedEvent(): void {
    const checkpoint = new HeadCheckpointService(
      signatures,
      () => ({ machineKey, actor: 'felipesauer' }),
      { events: 1, seconds: 100_000 },
    );
    new AuditService(
      new AuditWriter(auditDir, new AuditStateRepository(adapter), undefined, null, checkpoint),
    ).write({ kind: 'task_created', actor: 'felipesauer', data: { key: 'T-1' } });
  }

  const attestation = () => createAttestationSource(projectRoot, signatures);

  it('runs the machine-attestation check (not hidden like it was before)', () => {
    writeSignedEvent();
    const cache = new CachedAuditIntegrity(adapter, auditDir, null, attestation());
    const checks = cache.get();
    const attest = checks.find((c) => c.name === 'audit machine attestation');
    expect(attest).toBeDefined();
    expect(attest?.ok).toBe(true);
  });

  it('invalidates the cache when the recorded head signature changes (no stale verdict)', () => {
    writeSignedEvent();
    const cache = new CachedAuditIntegrity(adapter, auditDir, null, attestation());
    // First get: attestation ok.
    expect(cache.get().find((c) => c.name === 'audit machine attestation')?.ok).toBe(true);

    // Tamper the signature row directly (SQLite change, NO audit-file change)
    // to a signature that no longer verifies for the covered head.
    adapter
      .getDatabase()
      .prepare('UPDATE audit_head_signature SET signature = ? WHERE id = 1')
      .run(Buffer.from('forged-signature-bytes-000000').toString('base64'));

    // A stale cache (keyed only on file-stat) would still say ok. With the
    // signature folded into the key, the cache recomputes and now flags it.
    const attest = cache.get().find((c) => c.name === 'audit machine attestation');
    expect(attest?.ok).toBe(false);
    expect(attest?.severity).toBe('error');
  });

  it('without an attestation source, the attestation line is absent (backward-compatible)', () => {
    writeSignedEvent();
    const cache = new CachedAuditIntegrity(adapter, auditDir, null);
    expect(cache.get().find((c) => c.name === 'audit machine attestation')).toBeUndefined();
  });
});
