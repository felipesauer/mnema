import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { listArtifacts, writeArtifact } from '@mnema/core/services/audit/attestation-store.js';
import {
  diagnoseAuditChain,
  readTruncationWaiver,
  truncationWaiverPath,
  writeTruncationWaiver,
} from '@mnema/core/services/audit/audit-diagnose.js';
import type { GitCommandRunner } from '@mnema/core/services/git/git-commit-service.js';
import {
  assessAuditChain,
  type ChainAssessment,
  inspectAuditIntegrity,
  reconcileAuditState,
} from '@mnema/core/services/integrity/audit-integrity.js';
import { AuditService } from '@mnema/core/services/integrity/audit-service.js';
import {
  createAttestationSource,
  HeadCheckpointService,
} from '@mnema/core/services/integrity/head-checkpoint.js';
import { MachineKeyService } from '@mnema/core/services/integrity/machine-key.js';
import { AuditWriter } from '@mnema/core/storage/audit/audit-writer.js';
import { MigrationRunner } from '@mnema/core/storage/sqlite/migration-runner.js';
import { AuditHeadSignatureRepository } from '@mnema/core/storage/sqlite/repositories/audit-head-signature-repository.js';
import { AuditStateRepository } from '@mnema/core/storage/sqlite/repositories/audit-state-repository.js';
import { SqliteAdapter } from '@mnema/core/storage/sqlite/sqlite-adapter.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildHeadReSigner } from '@/cli/commands/audit-command.js';

const migrationsDir = path.resolve('packages/core/src/storage/sqlite/migrations');
const ACTOR = 'felipesauer';

/**
 * The interior-drift incident and its genuine-truncation counterpart.
 *
 * `reconcileAuditState` used to refuse ANY time `chainedLines <
 * signedEventCountAt` — reading interior mirror drift (the signed head is still
 * on disk, only the count is inflated) as a truncation, leaving `mnema doctor`
 * permanently red with no remedy. It now uses the chained-hash ancestry oracle:
 * a signed head still on disk is interior drift (heal + re-attest); a signed
 * head ABSENT from disk is a genuine truncation, refused by reconcile and
 * accepted only via the explicit `accept-truncation` path.
 */
describe('interior drift vs genuine truncation', () => {
  let tempRoot: string;
  let projectRoot: string;
  let userDir: string;
  let auditDir: string;
  let adapter: SqliteAdapter;
  let signatures: AuditHeadSignatureRepository;
  let state: AuditStateRepository;
  let machineKey: MachineKeyService;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-interior-drift-'));
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
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  /** A writer that signs a checkpoint on every event (interval 1). */
  function signingWriter(): AuditService {
    const checkpoint = new HeadCheckpointService(signatures, () => ({ machineKey, actor: ACTOR }), {
      events: 1,
      seconds: 100_000,
    });
    return new AuditService(
      new AuditWriter(auditDir, new AuditStateRepository(adapter), undefined, null, checkpoint),
    );
  }

  /** Writes `n` signed events and returns the on-disk chained hashes in order. */
  function writeSignedEvents(n: number): string[] {
    const audit = signingWriter();
    for (let i = 0; i < n; i++) {
      audit.write({ kind: 'task_created', actor: ACTOR, data: { key: `T-${i + 1}` } });
    }
    return diskHashes();
  }

  function diskHashes(): string[] {
    const file = path.join(auditDir, 'current.jsonl');
    return readFileSync(file, 'utf-8')
      .split('\n')
      .filter((l) => l.length > 0)
      .map((l) => (JSON.parse(l) as { hash: string }).hash);
  }

  const attestation = () => createAttestationSource(projectRoot, signatures);
  const checks = () => inspectAuditIntegrity(adapter, auditDir, null, false, attestation());
  const countCheck = () => checks().find((c) => c.name === 'audit event count');
  const attestCheck = () => checks().find((c) => c.name === 'audit machine attestation');

  const gitMatch: GitCommandRunner = (args) => {
    if (args[0] === 'rev-parse') return { status: 0, stdout: 'true\n', stderr: '' };
    return { status: 0, stdout: '', stderr: '' };
  };

  const reSign = () => buildHeadReSigner(projectRoot, ACTOR, signatures, () => new Date(), userDir);

  /**
   * Runs the same gates the `accept-truncation` CLI action composes, against
   * the shared service primitives (assess + forceReconcile + re-sign + waiver).
   * Returns a discriminated result mirroring the command's refuse/apply paths.
   */
  function acceptTruncation(opts: {
    apply: boolean;
    requireCommitted?: boolean;
    gitRunner?: GitCommandRunner;
  }): { ok: true; applied: boolean; reSigned: boolean } | { ok: false; reason: string } {
    const chain: ChainAssessment = assessAuditChain(auditDir, null);
    const sig = signatures.read();
    if (chain.malformedLines > 0) return { ok: false, reason: 'unparseable line(s)' };
    if (chain.chainBroken) return { ok: false, reason: `broken: ${chain.chainBreakDetail}` };
    if (!chain.chainEverStarted || chain.lastHash === null) {
      return { ok: false, reason: 'nothing to baseline to' };
    }
    if (sig === null) return { ok: false, reason: 'no signed checkpoint' };
    if (chain.chainedLines >= sig.eventCountAt) {
      return { ok: false, reason: 'no truncation below attested history' };
    }
    if (chain.chainedHashes.includes(sig.coveredHeadHash)) {
      return { ok: false, reason: 'signed head still present — interior drift' };
    }
    if (opts.requireCommitted === true) {
      const diag = diagnoseAuditChain(auditDir, null, projectRoot, opts.gitRunner);
      if (diag.matchesCommittedHead !== true) {
        return { ok: false, reason: 'require-committed: does not match git HEAD' };
      }
    }
    const overreaching = listArtifacts(auditDir).find((a) => a.to > chain.chainedLines);
    if (overreaching !== undefined) {
      return { ok: false, reason: `attest/${overreaching.to}.att overreaches` };
    }
    if (!opts.apply) return { ok: true, applied: false, reSigned: false };
    state.forceReconcile(chain.chainedLines, chain.lastHash, chain.lastAt);
    const reSigned = reSign()(chain.lastHash, chain.chainedLines);
    writeTruncationWaiver(auditDir, chain.lastHash, chain.chainedLines);
    return { ok: true, applied: true, reSigned };
  }

  it('INTERIOR DRIFT: reconcile heals a count inflated above disk when the signed head is still on disk, and re-attests', () => {
    // Three real signed events; the signature covers event 3 = the on-disk
    // tail hash. Now simulate the historical concurrent-writer drift: BOTH the
    // mirror count AND the recorded signature's eventCountAt were inflated to 5
    // (phantom events the mirror counted but that never reached disk), while
    // the signature's coveredHeadHash still points at the real on-disk tail.
    const hashes = writeSignedEvents(3);
    const realTail = hashes[2] as string;
    expect(signatures.read()?.coveredHeadHash).toBe(realTail);

    // Inflate the mirror and the signature's attested count to 5 (drift), head
    // unchanged — the exact interior-drift shape the old guard misread.
    adapter.getDatabase().prepare('UPDATE audit_state SET event_count = 5 WHERE id = 1').run();
    adapter
      .getDatabase()
      .prepare('UPDATE audit_head_signature SET event_count_at = 5 WHERE id = 1')
      .run();
    expect(state.read().eventCount).toBe(5);

    // Before: the count check is red (mirror 5 vs disk 3). Attestation still
    // reads green here only because the inflated mirror count (5) equals the
    // inflated signature count (5) — the retreat check has nothing to compare
    // against yet. The bug this fixes is that reconcile USED TO refuse this
    // shape outright (dead-ending doctor); and note that reconciling the count
    // DOWN to 3 without re-signing would then flip attestation to a retreat
    // error (3 < the signature's 5) — which is exactly why the re-sign matters.
    expect(countCheck()?.ok).toBe(false);

    const sig = signatures.read();
    const result = reconcileAuditState(
      auditDir,
      state,
      null,
      sig !== null
        ? { eventCountAt: sig.eventCountAt, coveredHeadHash: sig.coveredHeadHash }
        : null,
      true,
      null,
      projectRoot,
      gitMatch,
      reSign(),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.applied).toBe(true);
      expect(result.afterEventCount).toBe(3);
      expect(result.reSigned).toBe(true);
    }
    expect(state.read().eventCount).toBe(3);
    // The head was re-signed at the new baseline: attestation covers event 3.
    expect(signatures.read()?.eventCountAt).toBe(3);
    expect(signatures.read()?.coveredHeadHash).toBe(realTail);

    // After: green on both count and attestation.
    expect(countCheck()?.ok).toBe(true);
    expect(attestCheck()?.ok).toBe(true);
  });

  it('GENUINE TRUNCATION: reconcile refuses, accept-truncation --force re-baselines + re-signs + writes a re-verified waiver, and is idempotent', () => {
    const hashes = writeSignedEvents(3);
    const truncatedHead = hashes[2] as string;
    expect(signatures.read()?.eventCountAt).toBe(3);
    expect(signatures.read()?.coveredHeadHash).toBe(truncatedHead);

    // Truncate the last line: disk now holds 2, the signed head is GONE.
    const file = path.join(auditDir, 'current.jsonl');
    const lines = readFileSync(file, 'utf-8')
      .split('\n')
      .filter((l) => l.length > 0);
    writeFileSync(file, `${lines.slice(0, 2).join('\n')}\n`, 'utf-8');
    // Boot reconciliation rewinds the mirror to the truncated tail (count 2).
    new AuditWriter(auditDir, new AuditStateRepository(adapter));
    expect(state.read().eventCount).toBe(2);

    // reconcile still REFUSES: the signed head is absent from disk.
    const sig = signatures.read();
    const refused = reconcileAuditState(
      auditDir,
      state,
      null,
      sig !== null
        ? { eventCountAt: sig.eventCountAt, coveredHeadHash: sig.coveredHeadHash }
        : null,
      true,
      null,
      projectRoot,
      gitMatch,
      reSign(),
    );
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.reason).toMatch(/truncation|absent/i);
    // Attestation is red (retreat below the signed checkpoint).
    expect(attestCheck()?.ok).toBe(false);
    expect(attestCheck()?.severity).toBe('error');

    // accept-truncation --force: re-baseline, re-sign, write the waiver.
    const accepted = acceptTruncation({ apply: true });
    expect(accepted.ok).toBe(true);
    if (accepted.ok) {
      expect(accepted.applied).toBe(true);
      expect(accepted.reSigned).toBe(true);
    }
    const newTail = diskHashes()[1] as string;
    expect(state.read().eventCount).toBe(2);
    expect(signatures.read()?.eventCountAt).toBe(2);
    expect(signatures.read()?.coveredHeadHash).toBe(newTail);
    // The waiver was written and re-verifies against the current disk.
    const waiver = readTruncationWaiver(auditDir);
    expect(waiver?.acceptedEventCount).toBe(2);
    expect(waiver?.acceptedHeadHash).toBe(newTail);

    // doctor is green on count and attestation now.
    expect(countCheck()?.ok).toBe(true);
    expect(attestCheck()?.ok).toBe(true);

    // A second run is idempotent: the signed head now equals the disk tail, so
    // there is no longer a truncation below attested history to accept.
    const again = acceptTruncation({ apply: true });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.reason).toMatch(/no truncation below attested history/i);
    // State unchanged and still green.
    expect(state.read().eventCount).toBe(2);
    expect(attestCheck()?.ok).toBe(true);
  });

  it('accept-truncation REFUSES when a committed .att covers events beyond the new disk count (names the artifact)', () => {
    const hashes = writeSignedEvents(3);
    // Commit an .att that covers [0, 3): to = 3, one past the last covered
    // index. (Content need not verify for the overreach gate — the gate is
    // purely about coverage extent.)
    writeArtifact(auditDir, {
      version: 'mnema-attest/v1',
      signerActor: ACTOR,
      signerFingerprint: 'f'.repeat(64),
      projectHmacId: 'a'.repeat(64),
      from: 0,
      to: 3,
      coveredHeadHash: hashes[2] as string,
      contentRoot: '0'.repeat(64),
      signature: 'AA==',
    });

    // Truncate to 2 events, signed head gone.
    const file = path.join(auditDir, 'current.jsonl');
    const lines = readFileSync(file, 'utf-8')
      .split('\n')
      .filter((l) => l.length > 0);
    writeFileSync(file, `${lines.slice(0, 2).join('\n')}\n`, 'utf-8');
    new AuditWriter(auditDir, new AuditStateRepository(adapter));

    const result = acceptTruncation({ apply: true });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/attest\/3\.att/);
      expect(result.reason).toMatch(/overreach/i);
    }
    // Fail-closed: nothing written.
    expect(existsSync(truncationWaiverPath(auditDir))).toBe(false);
    expect(signatures.read()?.eventCountAt).toBe(3); // untouched
  });

  it('accept-truncation --require-committed refuses when the audit files do not match committed git HEAD', () => {
    writeSignedEvents(3);
    const file = path.join(auditDir, 'current.jsonl');
    const lines = readFileSync(file, 'utf-8')
      .split('\n')
      .filter((l) => l.length > 0);
    writeFileSync(file, `${lines.slice(0, 2).join('\n')}\n`, 'utf-8');
    new AuditWriter(auditDir, new AuditStateRepository(adapter));

    const gitDirty: GitCommandRunner = (args) => {
      if (args[0] === 'rev-parse') return { status: 0, stdout: 'true\n', stderr: '' };
      if (args[0] === 'ls-files') return { status: 0, stdout: '', stderr: '' };
      return { status: 1, stdout: '', stderr: '' }; // diff --quiet: local change
    };
    const result = acceptTruncation({ apply: true, requireCommitted: true, gitRunner: gitDirty });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/require-committed|git HEAD/i);
    expect(existsSync(truncationWaiverPath(auditDir))).toBe(false);
  });

  it('DRY RUN writes nothing: audit_state, the signature row, and the waiver file are unchanged', () => {
    writeSignedEvents(3);
    const file = path.join(auditDir, 'current.jsonl');
    const lines = readFileSync(file, 'utf-8')
      .split('\n')
      .filter((l) => l.length > 0);
    writeFileSync(file, `${lines.slice(0, 2).join('\n')}\n`, 'utf-8');
    new AuditWriter(auditDir, new AuditStateRepository(adapter));

    const beforeCount = state.read().eventCount;
    const beforeSig = signatures.read();

    // reconcile dry-run (interior-drift-shaped call, but here it is a genuine
    // truncation → refuses without writing regardless).
    const sig = signatures.read();
    reconcileAuditState(
      auditDir,
      state,
      null,
      sig !== null
        ? { eventCountAt: sig.eventCountAt, coveredHeadHash: sig.coveredHeadHash }
        : null,
      false,
      null,
      projectRoot,
      gitMatch,
      reSign(),
    );

    // accept-truncation dry-run.
    const plan = acceptTruncation({ apply: false });
    expect(plan.ok).toBe(true);
    if (plan.ok) expect(plan.applied).toBe(false);

    expect(state.read().eventCount).toBe(beforeCount);
    expect(signatures.read()).toEqual(beforeSig);
    expect(existsSync(truncationWaiverPath(auditDir))).toBe(false);
  });

  /** Builds the reconcile call the way both tamper cases do (full arg list). */
  function reconcileWithSig(): ReturnType<typeof reconcileAuditState> {
    const sig = signatures.read();
    return reconcileAuditState(
      auditDir,
      state,
      null,
      sig !== null
        ? { eventCountAt: sig.eventCountAt, coveredHeadHash: sig.coveredHeadHash }
        : null,
      true,
      null,
      projectRoot,
      gitMatch,
      reSign(),
    );
  }

  it('TAMPERING (malformed line) still refuses under both reconcile and accept-truncation', () => {
    writeSignedEvents(3);
    const file = path.join(auditDir, 'current.jsonl');
    writeFileSync(file, `${readFileSync(file, 'utf-8')}{not valid json\n`, 'utf-8');

    const recon = reconcileWithSig();
    expect(recon.ok).toBe(false);
    if (!recon.ok) expect(recon.reason).toMatch(/unparseable/i);

    const acc = acceptTruncation({ apply: true });
    expect(acc.ok).toBe(false);
    if (!acc.ok) expect(acc.reason).toMatch(/unparseable/i);
    expect(existsSync(truncationWaiverPath(auditDir))).toBe(false);
  });

  it('TAMPERING (content-invalid prev_hash break) still refuses under both reconcile and accept-truncation', () => {
    writeSignedEvents(3);
    const file = path.join(auditDir, 'current.jsonl');
    const clean = readFileSync(file, 'utf-8')
      .split('\n')
      .filter((l) => l.length > 0);
    const forged = JSON.parse(clean[2] as string) as Record<string, unknown>;
    forged.prev_hash = 'forged-prev-hash';
    clean[2] = JSON.stringify(forged);
    writeFileSync(file, `${clean.join('\n')}\n`, 'utf-8');

    const recon = reconcileWithSig();
    expect(recon.ok).toBe(false);
    if (!recon.ok) expect(recon.reason).toMatch(/not internally consistent|tampering/i);

    const acc = acceptTruncation({ apply: true });
    expect(acc.ok).toBe(false);
    if (!acc.ok) expect(acc.reason).toMatch(/broken/i);
    expect(existsSync(truncationWaiverPath(auditDir))).toBe(false);
  });

  it('end-to-end with a REAL git repo: --require-committed accepts after commit', () => {
    const run = (args: string[]): void => {
      execFileSync('git', args, { cwd: projectRoot });
    };
    mkdirSync(projectRoot, { recursive: true });
    run(['init', '-q']);
    run(['config', 'user.email', 'a@b.c']);
    run(['config', 'user.name', 'test']);

    writeSignedEvents(3);
    // Commit the FULL chain, then truncate + reconcile mirror on boot.
    run(['add', '-A']);
    run(['commit', '-q', '-m', 'audit']);

    const file = path.join(auditDir, 'current.jsonl');
    const lines = readFileSync(file, 'utf-8')
      .split('\n')
      .filter((l) => l.length > 0);
    writeFileSync(file, `${lines.slice(0, 2).join('\n')}\n`, 'utf-8');
    new AuditWriter(auditDir, new AuditStateRepository(adapter));

    // Uncommitted truncation → --require-committed (real git) refuses.
    const before = acceptTruncation({ apply: false, requireCommitted: true });
    expect(before.ok).toBe(false);

    // Commit the truncation, then it matches HEAD and the plan is accepted.
    run(['add', '-A']);
    run(['commit', '-q', '-m', 'truncate']);
    const after = acceptTruncation({ apply: true, requireCommitted: true });
    expect(after.ok).toBe(true);
    if (after.ok) expect(after.reSigned).toBe(true);
    expect(readTruncationWaiver(auditDir)?.acceptedEventCount).toBe(2);
  });
});
