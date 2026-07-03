import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditService } from '@/services/audit-service.js';
import { HeadCheckpointService } from '@/services/head-checkpoint.js';
import { MachineKeyService } from '@/services/machine-key.js';
import { AuditWriter } from '@/storage/audit/audit-writer.js';
import { MigrationRunner } from '@/storage/sqlite/migration-runner.js';
import { AuditHeadSignatureRepository } from '@/storage/sqlite/repositories/audit-head-signature-repository.js';
import { AuditStateRepository } from '@/storage/sqlite/repositories/audit-state-repository.js';
import { SqliteAdapter } from '@/storage/sqlite/sqlite-adapter.js';

const migrationsDir = path.resolve('src/storage/sqlite/migrations');

/**
 * Layer 2 machine attestation (ADR-37): the chain head is signed with the
 * per-machine Ed25519 key at a checkpoint interval — exactly one signature
 * per interval, NOT one per event, and off the per-event hot path. The
 * signature verifies against the committed public key; a tampered head
 * makes verification fail.
 */
describe('head-signature checkpoint', () => {
  let tempRoot: string;
  let projectRoot: string;
  let userDir: string;
  let auditDir: string;
  let adapter: SqliteAdapter;
  let signatures: AuditHeadSignatureRepository;
  let machineKey: MachineKeyService;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-headsig-'));
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

  /** A writer wired with the given checkpoint signer. */
  function writer(checkpoint: HeadCheckpointService): AuditService {
    return new AuditService(
      new AuditWriter(auditDir, new AuditStateRepository(adapter), undefined, null, checkpoint),
    );
  }

  it('signs exactly once when the event-count interval is crossed, not per event', () => {
    const signSpy = vi.spyOn(machineKey, 'sign');
    // Checkpoint every 3 events; a long time window so only the count fires.
    const checkpoint = new HeadCheckpointService(signatures, machineKey, 'felipesauer', {
      events: 3,
      seconds: 100_000,
    });
    const audit = writer(checkpoint);

    // Events 1 and 2: below the interval, no signing.
    audit.write({ kind: 'task_created', actor: 'felipesauer', data: { key: 'T-1' } });
    audit.write({ kind: 'task_created', actor: 'felipesauer', data: { key: 'T-2' } });
    expect(signSpy).not.toHaveBeenCalled();
    expect(signatures.read()).toBeNull();

    // Event 3: crosses the interval → exactly one signature.
    audit.write({ kind: 'task_created', actor: 'felipesauer', data: { key: 'T-3' } });
    expect(signSpy).toHaveBeenCalledTimes(1);
    const sig = signatures.read();
    expect(sig?.eventCountAt).toBe(3);
    expect(sig?.signerActor).toBe('felipesauer');

    // Events 4 and 5: below the next interval, still just one signature total.
    audit.write({ kind: 'task_created', actor: 'felipesauer', data: { key: 'T-4' } });
    audit.write({ kind: 'task_created', actor: 'felipesauer', data: { key: 'T-5' } });
    expect(signSpy).toHaveBeenCalledTimes(1);
  });

  it('signs a head that verifies against the committed public key', () => {
    const checkpoint = new HeadCheckpointService(signatures, machineKey, 'felipesauer', {
      events: 1,
      seconds: 100_000,
    });
    const audit = writer(checkpoint);
    audit.write({ kind: 'task_created', actor: 'felipesauer', data: { key: 'T-1' } });

    const sig = signatures.read();
    expect(sig).not.toBeNull();
    const record = machineKey.readPublicKey();
    expect(record).not.toBeNull();
    const ok = MachineKeyService.verify(
      Buffer.from((sig as { coveredHeadHash: string }).coveredHeadHash, 'hex'),
      Buffer.from((sig as { signature: string }).signature, 'base64'),
      (record as { publicKey: string }).publicKey,
    );
    expect(ok).toBe(true);
  });

  it('a tampered head no longer verifies', () => {
    const checkpoint = new HeadCheckpointService(signatures, machineKey, 'felipesauer', {
      events: 1,
      seconds: 100_000,
    });
    const audit = writer(checkpoint);
    audit.write({ kind: 'task_created', actor: 'felipesauer', data: { key: 'T-1' } });

    const sig = signatures.read() as { signature: string };
    const record = machineKey.readPublicKey() as { publicKey: string };
    // Verify against a DIFFERENT head hash than the one signed.
    const forgedHead = Buffer.from('f'.repeat(64), 'hex');
    const ok = MachineKeyService.verify(
      forgedHead,
      Buffer.from(sig.signature, 'base64'),
      record.publicKey,
    );
    expect(ok).toBe(false);
  });

  it('does not re-sign the same head at a later checkpoint with no new events', () => {
    const signSpy = vi.spyOn(machineKey, 'sign');
    const checkpoint = new HeadCheckpointService(signatures, machineKey, 'felipesauer', {
      events: 1,
      seconds: 0, // time always "elapsed" — isolates the no-new-events guard
    });
    // One write signs; calling maybeSign again with the same count is a no-op.
    const audit = writer(checkpoint);
    audit.write({ kind: 'task_created', actor: 'felipesauer', data: { key: 'T-1' } });
    expect(signSpy).toHaveBeenCalledTimes(1);
    const state = new AuditStateRepository(adapter).read();
    expect(checkpoint.maybeSign(state.chainHeadHash as string, state.eventCount)).toBeNull();
    expect(signSpy).toHaveBeenCalledTimes(1);
  });
});
