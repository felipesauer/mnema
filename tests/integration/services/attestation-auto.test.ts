import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { verifyArtifact } from '@/services/audit/attestation-artifact.js';
import { autoAttest, chainHealthyForAttest } from '@/services/audit/attestation-cli.js';
import { committedSignerResolver, listArtifacts } from '@/services/audit/attestation-store.js';
import { walkChainedEvents } from '@/services/audit/audit-chain-walk.js';
import { inspectAuditIntegrity } from '@/services/integrity/audit-integrity.js';
import { AuditService } from '@/services/integrity/audit-service.js';
import { HeadCheckpointService } from '@/services/integrity/head-checkpoint.js';
import { MachineKeyService } from '@/services/integrity/machine-key.js';
import { ProjectSecretService } from '@/services/integrity/project-secret.js';
import { AuditWriter } from '@/storage/audit/audit-writer.js';
import { MigrationRunner } from '@/storage/sqlite/migration-runner.js';
import { AuditHeadSignatureRepository } from '@/storage/sqlite/repositories/audit-head-signature-repository.js';
import { AuditStateRepository } from '@/storage/sqlite/repositories/audit-state-repository.js';
import { SqliteAdapter } from '@/storage/sqlite/sqlite-adapter.js';

const migrationsDir = path.resolve('src/storage/sqlite/migrations');

/**
 * Auto-attestation: a normal writing session (events crossing the checkpoint
 * interval) must leave the closed batch attested on disk WITHOUT anyone
 * running `mnema audit reattest` — the writer's checkpoint hook materialises
 * the `.att` off the write lock, and what it writes must verify with no secret.
 */
describe('auto-attestation on checkpoint', () => {
  let tempRoot: string;
  let projectRoot: string;
  let auditDir: string;
  let adapter: SqliteAdapter;
  let secret: ProjectSecretService;
  let machineKey: MachineKeyService;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-autoattest-'));
    projectRoot = path.join(tempRoot, 'proj');
    auditDir = path.join(projectRoot, '.mnema', 'audit');
    const userDir = path.join(tempRoot, 'home', '.config', 'mnema');
    mkdirSync(auditDir, { recursive: true });
    mkdirSync(userDir, { recursive: true });
    adapter = new SqliteAdapter(path.join(tempRoot, 'state.db'));
    new MigrationRunner().run(adapter, migrationsDir);
    secret = new ProjectSecretService(projectRoot, 'DEMO', userDir);
    secret.getOrCreate(); // mint + commit the fingerprint
    machineKey = new MachineKeyService(projectRoot, 'felipesauer', userDir);
    machineKey.getOrCreate();
  });
  afterEach(() => {
    adapter.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  /** A writer wired exactly like the container: checkpoint every 3 + auto-attest. */
  function makeAudit(): AuditService {
    const state = new AuditStateRepository(adapter);
    const checkpoint = new HeadCheckpointService(
      new AuditHeadSignatureRepository(adapter),
      () => ({ machineKey, actor: 'felipesauer' }),
      { events: 3, seconds: 100_000 },
    );
    const onCheckpoint = (_head: string, eventCount: number): void => {
      autoAttest({
        projectRoot,
        auditDir,
        signer: { machineKey, actor: 'felipesauer' },
        projectHmacId: secret.readFingerprint(),
        chainHealthy: chainHealthyForAttest(
          inspectAuditIntegrity(adapter, auditDir, secret.read(), true),
        ),
        signedEventCountAt: new AuditHeadSignatureRepository(adapter).read()?.eventCountAt ?? null,
        headCount: eventCount,
        batchSize: 3,
      });
    };
    return new AuditService(
      new AuditWriter(
        auditDir,
        state,
        undefined,
        () => secret.getOrCreate(),
        checkpoint,
        null,
        onCheckpoint,
      ),
    );
  }

  it('materialises a verifying .att once the checkpoint interval is crossed — no manual reattest', () => {
    const audit = makeAudit();
    // No .att before enough events accrue.
    audit.write({ kind: 'task_created', actor: 'felipesauer', data: { key: 'T-1' } });
    expect(listArtifacts(auditDir)).toHaveLength(0);

    // Cross the interval (3 events → checkpoint signs → hook attests).
    audit.write({ kind: 'task_created', actor: 'felipesauer', data: { key: 'T-2' } });
    audit.write({ kind: 'task_created', actor: 'felipesauer', data: { key: 'T-3' } });

    const arts = listArtifacts(auditDir);
    expect(arts.length).toBeGreaterThanOrEqual(1);
    expect(arts[0].from).toBe(0);

    // What the hook wrote verifies against the committed key with no secret.
    const walk = walkChainedEvents(auditDir);
    const events = walk.chained.slice(arts[0].from, arts[0].to).map((c) => c.event);
    expect(verifyArtifact(arts[0], events, committedSignerResolver(projectRoot))).toEqual({
      ok: true,
    });
    // The .att is on disk under attest/ (committable).
    expect(existsSync(path.join(auditDir, 'attest', `${arts[0].to}.att`))).toBe(true);
  });

  it('a write never fails even if attestation cannot proceed (no signer)', () => {
    // Wire a hook with a null signer: autoAttest refuses, writer swallows,
    // the write still succeeds. Fail-open contract.
    const state = new AuditStateRepository(adapter);
    const checkpoint = new HeadCheckpointService(
      new AuditHeadSignatureRepository(adapter),
      () => ({ machineKey, actor: 'felipesauer' }),
      { events: 1, seconds: 100_000 },
    );
    const audit = new AuditService(
      new AuditWriter(
        auditDir,
        state,
        undefined,
        () => secret.getOrCreate(),
        checkpoint,
        null,
        (_head: string, eventCount: number) =>
          autoAttest({
            projectRoot,
            auditDir,
            signer: null, // no identity → refusal
            projectHmacId: secret.readFingerprint(),
            chainHealthy: true,
            signedEventCountAt: null,
            headCount: eventCount,
          }),
      ),
    );
    expect(() =>
      audit.write({ kind: 'task_created', actor: 'felipesauer', data: { key: 'T-1' } }),
    ).not.toThrow();
    expect(listArtifacts(auditDir)).toHaveLength(0); // nothing attested, but write ok
  });
});
