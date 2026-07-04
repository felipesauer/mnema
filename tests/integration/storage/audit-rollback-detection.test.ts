import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { inspectAuditIntegrity } from '@/services/audit-integrity.js';
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
 * Boot reconciliation (W1) rewinds the mirror to the on-disk tail after a
 * crash. On its own that would launder a malicious truncation to green (the
 * mirror is rewound to the truncated disk, so count/hash match). The
 * attestation layer closes that: a durable, signed checkpoint is evidence
 * the chain once reached event N; if the chain is later shorter than a
 * signed checkpoint, the log retreated below attested history — a hard
 * tamper error that reconciliation cannot hide.
 */
describe('rollback / truncation below a signed checkpoint', () => {
  let tempRoot: string;
  let projectRoot: string;
  let userDir: string;
  let auditDir: string;
  let adapter: SqliteAdapter;
  let signatures: AuditHeadSignatureRepository;
  let machineKey: MachineKeyService;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-rollback-'));
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

  /** A writer that signs a checkpoint on every event. */
  function signingWriter(): AuditService {
    const checkpoint = new HeadCheckpointService(
      signatures,
      () => ({ machineKey, actor: 'felipesauer' }),
      { events: 1, seconds: 100_000 },
    );
    return new AuditService(
      new AuditWriter(auditDir, new AuditStateRepository(adapter), undefined, null, checkpoint),
    );
  }

  const attestation = () => createAttestationSource(projectRoot, signatures);
  const attestVerdict = () =>
    inspectAuditIntegrity(adapter, auditDir, null, false, attestation()).find(
      (c) => c.name === 'audit machine attestation',
    );

  it('flags a truncation below a signed checkpoint as an error, even after mirror reconciliation', () => {
    const audit = signingWriter();
    audit.write({ kind: 'task_created', actor: 'felipesauer', data: { key: 'T-1' } });
    audit.write({ kind: 'task_created', actor: 'felipesauer', data: { key: 'T-2' } });
    audit.write({ kind: 'task_created', actor: 'felipesauer', data: { key: 'T-3' } });
    // A checkpoint signed event 3.
    expect(signatures.read()?.eventCountAt).toBe(3);

    // ATTACK: truncate the last line on disk, then let boot reconciliation
    // rewind the mirror to the truncated tail (W1). Count/hash now match the
    // truncated disk — the count/hash checks go green.
    const file = path.join(auditDir, 'current.jsonl');
    const lines = readFileSync(file, 'utf-8')
      .split('\n')
      .filter((l) => l.length > 0);
    writeFileSync(file, `${lines.slice(0, -1).join('\n')}\n`, 'utf-8');
    // Boot a fresh writer → reconcileMirror rewinds the mirror to 2 events.
    new AuditWriter(auditDir, new AuditStateRepository(adapter));
    expect(new AuditStateRepository(adapter).read().eventCount).toBe(2);

    // The attestation layer catches the retreat: a signature covers event 3
    // but the chain now holds only 2.
    const verdict = attestVerdict();
    expect(verdict?.ok).toBe(false);
    expect(verdict?.severity).toBe('error');
    expect(verdict?.detail).toMatch(/retreated below a signed checkpoint|truncated|rolled back/i);
  });

  it('a genuine crash (mirror one ahead, no truncation below the signed head) stays clean after reconcile', () => {
    const audit = signingWriter();
    audit.write({ kind: 'task_created', actor: 'felipesauer', data: { key: 'T-1' } });
    audit.write({ kind: 'task_created', actor: 'felipesauer', data: { key: 'T-2' } });
    // Signed checkpoint at event 2. Simulate a crash AFTER event 2 committed
    // to the mirror but before the (nonexistent) event-3 line — mirror ahead.
    adapter
      .getDatabase()
      .prepare('UPDATE audit_state SET event_count = 3, chain_head_hash = ? WHERE id = 1')
      .run('de'.repeat(32));
    // Boot reconciles the mirror back to 2 (the real tail). The signature
    // covers event 2, the chain holds 2 → no retreat, attestation ok.
    new AuditWriter(auditDir, new AuditStateRepository(adapter));
    expect(new AuditStateRepository(adapter).read().eventCount).toBe(2);
    const verdict = attestVerdict();
    expect(verdict?.ok).toBe(true);
  });

  it('documents the bound: truncating an UNSIGNED tail event (above the last checkpoint) is not caught by attestation', () => {
    // Checkpoint interval 2 signs at event 2; event 3 is then UNSIGNED.
    const checkpoint = new HeadCheckpointService(
      signatures,
      () => ({ machineKey, actor: 'felipesauer' }),
      { events: 2, seconds: 100_000 },
    );
    const audit = new AuditService(
      new AuditWriter(auditDir, new AuditStateRepository(adapter), undefined, null, checkpoint),
    );
    audit.write({ kind: 'task_created', actor: 'felipesauer', data: { key: 'T-1' } });
    audit.write({ kind: 'task_created', actor: 'felipesauer', data: { key: 'T-2' } });
    audit.write({ kind: 'task_created', actor: 'felipesauer', data: { key: 'T-3' } });
    expect(signatures.read()?.eventCountAt).toBe(2); // event 3 is UNSIGNED

    // Truncate the unsigned event 3, then reconcile on boot.
    const file = path.join(auditDir, 'current.jsonl');
    const lines = readFileSync(file, 'utf-8')
      .split('\n')
      .filter((l) => l.length > 0);
    writeFileSync(file, `${lines.slice(0, -1).join('\n')}\n`, 'utf-8');
    new AuditWriter(auditDir, new AuditStateRepository(adapter));
    expect(new AuditStateRepository(adapter).read().eventCount).toBe(2);

    // The signature covers event 2, the chain holds 2 → no retreat detected.
    // This is the documented checkpoint-window bound: only events at/below the
    // last signed checkpoint are truncation-protected. Closing this fully
    // would require signing every event (rejected for hot-path cost).
    expect(attestVerdict()?.ok).toBe(true);
  });
});
