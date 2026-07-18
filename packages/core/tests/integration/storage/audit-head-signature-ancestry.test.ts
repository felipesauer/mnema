import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { inspectAuditIntegrity } from '@/services/integrity/audit-integrity.js';
import { AuditService } from '@/services/integrity/audit-service.js';
import {
  createAttestationSource,
  HeadCheckpointService,
} from '@/services/integrity/head-checkpoint.js';
import { MachineKeyService } from '@/services/integrity/machine-key.js';
import { AuditWriter } from '@/storage/audit/audit-writer.js';
import { MigrationRunner } from '@/storage/sqlite/migration-runner.js';
import { AuditHeadSignatureRepository } from '@/storage/sqlite/repositories/audit-head-signature-repository.js';
import { AuditStateRepository } from '@/storage/sqlite/repositories/audit-state-repository.js';
import { SqliteAdapter } from '@/storage/sqlite/sqlite-adapter.js';

const migrationsDir = path.resolve('packages/core/src/storage/sqlite/migrations');

/**
 * A machine attestation must confirm the signed head is genuinely on the
 * current on-disk chain. A valid signature over a head the chain never held
 * (a fork/replay, or the events beneath it rewritten while event_count was
 * kept level so the rollback guard stays silent) must NOT read green — the
 * signature is authentic but points off-chain.
 */
describe('machine attestation: signed head must be an ancestor of the current chain', () => {
  let tempRoot: string;
  let projectRoot: string;
  let userDir: string;
  let auditDir: string;
  let adapter: SqliteAdapter;
  let signatures: AuditHeadSignatureRepository;
  let machineKey: MachineKeyService;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-headsig-ancestry-'));
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
      new AuditWriter(
        auditDir,
        new AuditStateRepository(adapter),
        () => Buffer.alloc(32, 7),
        undefined,
        checkpoint,
      ),
    );
  }

  const attestation = () => createAttestationSource(projectRoot, signatures);
  const attestVerdict = () =>
    inspectAuditIntegrity(adapter, auditDir, null, attestation()).find(
      (c) => c.name === 'audit machine attestation',
    );

  /** Every chained line's own `hash`, in order. */
  function onDiskHashes(): string[] {
    return readFileSync(path.join(auditDir, 'current.jsonl'), 'utf-8')
      .split('\n')
      .filter((l) => l.length > 0)
      .map((l) => (JSON.parse(l) as { hash: string }).hash);
  }

  it('(1) is ok when the signature covers the current head', () => {
    const audit = signingWriter();
    audit.write({ kind: 'task_created', actor: 'felipesauer', data: { key: 'T-1' } });
    audit.write({ kind: 'task_created', actor: 'felipesauer', data: { key: 'T-2' } });
    audit.write({ kind: 'task_created', actor: 'felipesauer', data: { key: 'T-3' } });
    // The checkpoint (interval 1) signs the head after every event, so the
    // recorded signature covers the CURRENT head.
    const state = new AuditStateRepository(adapter).read();
    expect(signatures.read()?.coveredHeadHash).toBe(state.chainHeadHash);

    const verdict = attestVerdict();
    expect(verdict?.ok).toBe(true);
    expect(verdict?.detail).toMatch(/head signed by felipesauer/i);
  });

  it('(2) is ok when the signature covers a real EARLIER checkpoint of the chain', () => {
    const audit = signingWriter();
    audit.write({ kind: 'task_created', actor: 'felipesauer', data: { key: 'T-1' } });
    audit.write({ kind: 'task_created', actor: 'felipesauer', data: { key: 'T-2' } });
    // Head hash after event 2 — a genuine earlier checkpoint of THIS chain.
    const earlierHead = onDiskHashes()[1] as string;
    audit.write({ kind: 'task_created', actor: 'felipesauer', data: { key: 'T-3' } });

    // Pin the recorded signature to the earlier (event-2) head, as if the head
    // has since advanced to event 3 and the checkpoint has not re-signed yet.
    // event_count stays 3 (no retreat), so this exercises the ancestry path,
    // not the rollback guard. Re-sign the earlier head so the signature is
    // genuinely valid for it (only the covered head differs from current).
    const earlier = signatures.read();
    if (earlier === null) throw new Error('expected a recorded signature');
    signatures.upsert({
      ...earlier,
      coveredHeadHash: earlierHead,
      eventCountAt: 2,
      signature: machineKey.sign(Buffer.from(earlierHead, 'hex')).toString('base64'),
    });

    const verdict = attestVerdict();
    expect(verdict?.ok).toBe(true);
    expect(verdict?.detail).toMatch(/earlier checkpoint/i);
  });

  it('(3) is a NON-OK error when the signature covers a head absent from the chain (event_count not decreased)', () => {
    const audit = signingWriter();
    audit.write({ kind: 'task_created', actor: 'felipesauer', data: { key: 'T-1' } });
    audit.write({ kind: 'task_created', actor: 'felipesauer', data: { key: 'T-2' } });
    audit.write({ kind: 'task_created', actor: 'felipesauer', data: { key: 'T-3' } });

    // A VALID signature over a fabricated head that lives nowhere on the chain.
    // event_count is left at 3 (>= eventCountAt), so the rollback/truncation
    // guard does NOT fire — only the ancestry check can catch this.
    const fabricated = 'f'.repeat(64);
    const current = signatures.read();
    if (current === null) throw new Error('expected a recorded signature');
    signatures.upsert({
      ...current,
      coveredHeadHash: fabricated,
      eventCountAt: 3,
      signature: machineKey.sign(Buffer.from(fabricated, 'hex')).toString('base64'),
    });
    // Sanity: event_count did not decrease, so this is NOT the rollback case.
    expect(new AuditStateRepository(adapter).read().eventCount).toBe(3);

    const verdict = attestVerdict();
    expect(verdict?.ok).toBe(false);
    expect(verdict?.severity).toBe('error');
    expect(verdict?.detail).toMatch(/not on the current chain/i);
    // Distinct from a bad-signature verdict: the signature itself is authentic.
    expect(verdict?.detail).not.toMatch(/does not verify/i);
  });
});
