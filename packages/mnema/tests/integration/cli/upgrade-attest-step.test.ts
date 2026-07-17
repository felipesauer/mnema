import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { verifyArtifact } from '@mnema/core/services/audit/attestation-artifact.js';
import { autoAttest, chainHealthyForAttest } from '@mnema/core/services/audit/attestation-cli.js';
import {
  committedSignerResolver,
  listArtifacts,
} from '@mnema/core/services/audit/attestation-store.js';
import { walkChainedEvents } from '@mnema/core/services/audit/audit-chain-walk.js';
import { inspectAuditIntegrity } from '@mnema/core/services/integrity/audit-integrity.js';
import { AuditService } from '@mnema/core/services/integrity/audit-service.js';
import { MachineKeyService } from '@mnema/core/services/integrity/machine-key.js';
import { ProjectSecretService } from '@mnema/core/services/integrity/project-secret.js';
import { AuditWriter } from '@mnema/core/storage/audit/audit-writer.js';
import { MigrationRunner } from '@mnema/core/storage/sqlite/migration-runner.js';
import { AuditStateRepository } from '@mnema/core/storage/sqlite/repositories/audit-state-repository.js';
import { SqliteAdapter } from '@mnema/core/storage/sqlite/sqlite-adapter.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const migrationsDir = path.resolve('packages/core/src/storage/sqlite/migrations');

/**
 * The `mnema upgrade` attestation step: an existing project with chained
 * events but no committed `.att` (it predates content attestation, or just
 * adopted this version) must have that unattested tail detected and, on
 * upgrade, emitted — so the anonymous-verify guarantee reaches an installed
 * project without the user hunting for `audit reattest`. This exercises the
 * step's detection + emission logic (the command wires the same calls behind
 * `withCliContext`).
 */
describe('upgrade attestation step', () => {
  let tempRoot: string;
  let projectRoot: string;
  let auditDir: string;
  let adapter: SqliteAdapter;
  let secret: ProjectSecretService;
  let machineKey: MachineKeyService;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-upg-attest-'));
    projectRoot = path.join(tempRoot, 'proj');
    auditDir = path.join(projectRoot, '.mnema', 'audit');
    const userDir = path.join(tempRoot, 'home', '.config', 'mnema');
    mkdirSync(auditDir, { recursive: true });
    mkdirSync(userDir, { recursive: true });
    adapter = new SqliteAdapter(path.join(tempRoot, 'state.db'));
    new MigrationRunner().run(adapter, migrationsDir);
    secret = new ProjectSecretService(projectRoot, 'DEMO', userDir);
    secret.getOrCreate();
    machineKey = new MachineKeyService(projectRoot, 'felipesauer', userDir);
    machineKey.getOrCreate();
  });
  afterEach(() => {
    adapter.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  /** Writes n events with NO checkpoint signer, so nothing auto-attests. */
  function writeUnattested(n: number): void {
    const audit = new AuditService(
      new AuditWriter(auditDir, new AuditStateRepository(adapter), undefined, () =>
        secret.getOrCreate(),
      ),
    );
    for (let i = 0; i < n; i++) {
      audit.write({ kind: 'task_created', actor: 'felipesauer', data: { key: `T-${i}` } });
    }
  }

  /** The detection the step runs: unattested tail = total − last attested `to`. */
  function unattestedTail(): number {
    const total = walkChainedEvents(auditDir).chained.length;
    const attestedTo = listArtifacts(auditDir).reduce((m, a) => Math.max(m, a.to), 0);
    return total - attestedTo;
  }

  /** The emission the step runs. */
  function runAttestStep(): void {
    autoAttest({
      projectRoot,
      auditDir,
      signer: { machineKey, actor: 'felipesauer' },
      projectHmacId: secret.readFingerprint(),
      chainHealthy: chainHealthyForAttest(
        inspectAuditIntegrity(adapter, auditDir, secret.read(), true),
      ),
      signedEventCountAt: null,
      headCount: walkChainedEvents(auditDir).chained.length,
      batchSize: 100,
    });
  }

  it('detects an unattested tail on a project that predates attestation', () => {
    writeUnattested(4);
    expect(listArtifacts(auditDir)).toHaveLength(0);
    expect(unattestedTail()).toBe(4);
  });

  it('emits verifying attestations, clearing the tail', () => {
    writeUnattested(4);
    runAttestStep();

    expect(unattestedTail()).toBe(0);
    const arts = listArtifacts(auditDir);
    expect(arts.length).toBeGreaterThanOrEqual(1);

    // What upgrade wrote verifies against the committed key with no secret.
    const walk = walkChainedEvents(auditDir);
    const events = walk.chained.slice(arts[0].from, arts[0].to).map((c) => c.event);
    expect(verifyArtifact(arts[0], events, committedSignerResolver(projectRoot))).toEqual({
      ok: true,
    });
  });

  it('is a no-op when the chain is already fully attested (tail = 0)', () => {
    writeUnattested(3);
    runAttestStep(); // first pass attests everything
    expect(unattestedTail()).toBe(0);
    // A second detection finds nothing to do — the step would not be offered.
    runAttestStep();
    expect(unattestedTail()).toBe(0);
  });

  it('detects nothing on an empty audit log', () => {
    expect(unattestedTail()).toBe(0);
  });
});
