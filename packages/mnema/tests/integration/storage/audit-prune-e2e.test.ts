import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { committedSignerResolver } from '@mnema/core/services/audit/attestation-store.js';
import { applyPrune, buildPrunePlan } from '@mnema/core/services/audit/prune-apply.js';
import { decideAttLockstep } from '@mnema/core/services/audit/prune-att-lockstep.js';
import { buildRebaselineResolver } from '@mnema/core/services/audit/rebaseline-resolve.js';
import { readRebaselineWaiver } from '@mnema/core/services/audit/rebaseline-store.js';
import { verifyRebaselineWaiver } from '@mnema/core/services/audit/rebaseline-waiver.js';
import { computeCutPoint } from '@mnema/core/services/audit/retention-cut-point.js';
import {
  assessAuditChain,
  inspectAuditIntegrity,
} from '@mnema/core/services/integrity/audit-integrity.js';
import { AuditService } from '@mnema/core/services/integrity/audit-service.js';
import { HeadCheckpointService } from '@mnema/core/services/integrity/head-checkpoint.js';
import { MachineKeyService } from '@mnema/core/services/integrity/machine-key.js';
import { AuditWriter } from '@mnema/core/storage/audit/audit-writer.js';
import { MigrationRunner } from '@mnema/core/storage/sqlite/migration-runner.js';
import { AnchorRepository } from '@mnema/core/storage/sqlite/repositories/anchor-repository.js';
import { AuditHeadSignatureRepository } from '@mnema/core/storage/sqlite/repositories/audit-head-signature-repository.js';
import { AuditStateRepository } from '@mnema/core/storage/sqlite/repositories/audit-state-repository.js';
import { SqliteAdapter } from '@mnema/core/storage/sqlite/sqlite-adapter.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildHeadReSigner } from '@/cli/commands/audit-command.js';

const migrationsDir = path.resolve('packages/core/src/storage/sqlite/migrations');
const ACTOR = 'felipesauer';

/**
 * End-to-end prune (ADR-68 / MNEMA-350): a real signed chain, spread across
 * archived months, pruned via the same cut-point → .att lockstep → plan →
 * applyPrune chain the `mnema audit prune` command wires. The load-bearing
 * assertion is that after the prune the integrity walk reads CLEAN through the
 * committed re-baseline, and a bare walk (no waiver) still reads tamper.
 */
describe('audit prune end-to-end', () => {
  let tempRoot: string;
  let projectRoot: string;
  let userDir: string;
  let auditDir: string;
  let adapter: SqliteAdapter;
  let signatures: AuditHeadSignatureRepository;
  let state: AuditStateRepository;
  let machineKey: MachineKeyService;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-prune-e2e-'));
    projectRoot = path.join(tempRoot, 'proj');
    userDir = path.join(tempRoot, 'home', '.config', 'mnema');
    auditDir = path.join(projectRoot, '.mnema', 'audit');
    mkdirSync(auditDir, { recursive: true });
    mkdirSync(userDir, { recursive: true });
    adapter = new SqliteAdapter(path.join(tempRoot, 'state.db'));
    new MigrationRunner().run(adapter, migrationsDir);
    signatures = new AuditHeadSignatureRepository(adapter);
    state = new AuditStateRepository(adapter);
    machineKey = new MachineKeyService(projectRoot, ACTOR, userDir);
    // Materialise the machine keypair + committed .pub so verify can resolve it.
    machineKey.getOrCreate();
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  function writer(): AuditService {
    const checkpoint = new HeadCheckpointService(signatures, () => ({ machineKey, actor: ACTOR }), {
      events: 1,
      seconds: 100_000,
    });
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

  /**
   * Writes `n` events, then splits current.jsonl into archived monthly
   * segments so the prune has old months to drop. Returns the on-disk chained
   * hashes in order.
   */
  function writeAndArchive(counts: { month: string; n: number }[]): string[] {
    const audit = writer();
    let total = 0;
    for (const { n } of counts) {
      for (let i = 0; i < n; i++) {
        audit.write({ kind: 'task_created', actor: ACTOR, data: { key: `T-${total + i + 1}` } });
      }
      total += n;
    }
    const all = readFileSync(path.join(auditDir, 'current.jsonl'), 'utf-8')
      .split('\n')
      .filter((l) => l.length > 0);
    // Slice the single current.jsonl into segment files by the given counts;
    // the last group stays as current.jsonl.
    let offset = 0;
    for (let g = 0; g < counts.length; g++) {
      const grp = counts[g];
      const lines = all.slice(offset, offset + grp.n);
      offset += grp.n;
      const name = g === counts.length - 1 ? 'current.jsonl' : `${grp.month}.jsonl`;
      writeFileSync(path.join(auditDir, name), `${lines.join('\n')}\n`, 'utf-8');
    }
    // If the last group was archived (not current), drop the now-empty current.
    return all.map((l) => (JSON.parse(l) as { hash: string }).hash);
  }

  const NOW = new Date('2026-07-16T12:00:00.000Z');

  it('prunes old months and the surviving chain verifies clean', () => {
    // Two old months (dropped) + a recent month + current (kept).
    const hashes = writeAndArchive([
      { month: '2024-01', n: 3 },
      { month: '2024-02', n: 2 },
      { month: '2026-07', n: 2 },
      { month: 'current', n: 1 },
    ]);
    expect(hashes).toHaveLength(8);

    const cut = computeCutPoint(auditDir, 'local', 12, NOW);
    expect(cut.hasCut).toBe(true);
    expect(cut.keepFromIndex).toBe(5);

    const attDecision = decideAttLockstep(auditDir, cut.keepFromIndex);
    expect(attDecision.blocked).toBe(false);

    const plan = buildPrunePlan(auditDir, cut);
    const anchorRepo = new AnchorRepository(adapter);

    const projectHmacId = 'ab'.repeat(32);
    const { fingerprint } = machineKey.getOrCreate();
    const { waiver, reSigned } = applyPrune({
      auditDir,
      plan,
      droppedFiles: cut.dropped.map((d) => d.file),
      attToRemove: attDecision.toRemove,
      signerActor: ACTOR,
      signerFingerprint: fingerprint,
      projectHmacId,
      sign: (m) => machineKey.sign(m),
      forceReconcile: (c, h, at) => state.forceReconcile(c, h, at),
      reSignHead: buildHeadReSigner(projectRoot, ACTOR, signatures, () => NOW, userDir),
      deleteAnchorsBelow: (c) => anchorRepo.deleteBelowEventCount(c),
      now: () => NOW,
    });
    expect(reSigned).toBe(true);

    // The dropped months are gone; the surviving genesis is event index 5.
    const survivingGenesis = hashes[5];
    expect(waiver.kind).toBe('prune');
    expect(waiver.newHeadHash).toBe(survivingGenesis);
    expect(waiver.prunedHeadHash).toBe(hashes[4]);

    // The committed waiver verifies against the surviving genesis, no secret —
    // resolved via the SAME committed .pub resolver the verify path uses.
    const stored = readRebaselineWaiver(auditDir);
    expect(stored).not.toBeNull();
    const resolve = committedSignerResolver(projectRoot);
    expect(
      verifyRebaselineWaiver(
        stored as never,
        survivingGenesis,
        (stored as never as { tailId: string }).tailId,
        projectHmacId,
        resolve,
      ),
    ).toEqual({
      ok: true,
    });

    // The integrity walk reads CLEAN with the re-baseline (prunedHeadHash is
    // the on-disk genesis prev_hash), and audit_state matches the survivors.
    const clean = assessAuditChain(auditDir, null, () => ({
      anchorPrevHash: waiver.prunedHeadHash,
      genesisHash: waiver.newHeadHash,
    }));
    expect(clean.chainBroken).toBe(false);
    expect(clean.chainedLines).toBe(3);
    expect(state.read().eventCount).toBe(3);

    // A bare walk (no re-baseline) still reads the deleted prefix as tamper.
    expect(assessAuditChain(auditDir, null).chainBroken).toBe(true);

    // inspectAuditIntegrity with the re-baseline reports the event-count check ok.
    const report = inspectAuditIntegrity(adapter, auditDir, null, null, null, () => ({
      anchorPrevHash: waiver.prunedHeadHash,
      genesisHash: waiver.newHeadHash,
    }));
    const countCheck = report.find((c) => c.name === 'audit event count');
    expect(countCheck?.ok).toBe(true);

    // THE PRODUCTION WIRING: the same verify reads GREEN when handed the real
    // resolver (which reads + verifies the committed waiver off disk), not a
    // hand-built rebaseline. This is the fix — before it, every verify passed
    // `null` here and a legitimate prune read as a `prev_hash` break (tamper).
    const resolver = buildRebaselineResolver(projectHmacId, committedSignerResolver(projectRoot));
    const prod = inspectAuditIntegrity(adapter, auditDir, null, null, null, resolver);
    expect(prod.find((c) => c.name === 'audit hash chain')?.ok).toBe(true);
    // And WITHOUT the resolver (the pre-fix behaviour) it still reads as tamper —
    // proving the resolver is load-bearing, not cosmetic.
    const noResolver = inspectAuditIntegrity(adapter, auditDir, null);
    expect(noResolver.find((c) => c.name === 'audit hash chain')?.ok).toBe(false);

    // The `audit prune` Gate-1 runs `assessAuditChain(tailDir, secret, resolver)`
    // and REFUSES on chainBroken. On an ALREADY-pruned tail that gate must NOT
    // fire, or a second retention prune is refused forever. With the resolver
    // the surviving genesis is accepted (not a break); without it, it is not —
    // this pins that the gate carries the resolver.
    expect(assessAuditChain(auditDir, null, resolver).chainBroken).toBe(false);
    expect(assessAuditChain(auditDir, null).chainBroken).toBe(true);
  });
});
