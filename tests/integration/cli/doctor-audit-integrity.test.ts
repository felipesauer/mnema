import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { inspectAuditIntegrity } from '@/cli/commands/doctor-command.js';
import { anchorStatusCheck } from '@/services/anchor/anchor-inspect.js';
import { AuditService } from '@/services/integrity/audit-service.js';
import {
  createAttestationSource,
  HeadCheckpointService,
} from '@/services/integrity/head-checkpoint.js';
import { MachineKeyService } from '@/services/integrity/machine-key.js';
import { AuditWriter } from '@/storage/audit/audit-writer.js';
import { MigrationRunner } from '@/storage/sqlite/migration-runner.js';
import { AnchorRepository } from '@/storage/sqlite/repositories/anchor-repository.js';
import { AuditHeadSignatureRepository } from '@/storage/sqlite/repositories/audit-head-signature-repository.js';
import { AuditStateRepository } from '@/storage/sqlite/repositories/audit-state-repository.js';
import { SqliteAdapter } from '@/storage/sqlite/sqlite-adapter.js';

const migrationsDir = path.resolve('src/storage/sqlite/migrations');

describe('inspectAuditIntegrity', () => {
  let tempRoot: string;
  let auditDir: string;
  let adapter: SqliteAdapter;
  let writer: AuditWriter;
  let audit: AuditService;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-audit-integrity-'));
    auditDir = path.join(tempRoot, '.audit');
    mkdirSync(auditDir, { recursive: true });
    adapter = new SqliteAdapter(path.join(tempRoot, 'state.db'));
    new MigrationRunner().run(adapter, migrationsDir);

    const state = new AuditStateRepository(adapter);
    writer = new AuditWriter(auditDir, state);
    audit = new AuditService(writer);
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  function writeSampleEvents(): void {
    audit.write({ kind: 'task_created', actor: 'daniel', data: { key: 'T-1' } });
    audit.write({ kind: 'task_created', actor: 'eve', data: { key: 'T-2' } });
    audit.write({
      kind: 'task_transitioned',
      actor: 'daniel',
      data: { key: 'T-1', from: 'DRAFT', to: 'READY', action: 'submit' },
    });
  }

  it('reports a clean chain on freshly-written events', () => {
    writeSampleEvents();

    const checks = inspectAuditIntegrity(adapter, auditDir);
    expect(checks.find((c) => c.name === 'audit event count')?.ok).toBe(true);
    expect(checks.find((c) => c.name === 'audit hash chain')?.ok).toBe(true);
  });

  it('detects an edit-in-place tampering (actor changed)', () => {
    writeSampleEvents();
    const file = path.join(auditDir, 'current.jsonl');
    const lines = readFileSync(file, 'utf-8')
      .split('\n')
      .filter((l) => l.length > 0);
    // Tamper with the second line — flip the actor.
    const second = JSON.parse(lines[1] as string) as Record<string, unknown>;
    second.actor = 'mallory';
    lines[1] = JSON.stringify(second);
    writeFileSync(file, `${lines.join('\n')}\n`, 'utf-8');

    const checks = inspectAuditIntegrity(adapter, auditDir);
    expect(checks.find((c) => c.name === 'audit hash chain')?.ok).toBe(false);
  });

  it('detects a forged appended event', () => {
    writeSampleEvents();
    const file = path.join(auditDir, 'current.jsonl');
    const forged = {
      v: 2,
      at: new Date().toISOString(),
      kind: 'task_transitioned',
      actor: 'mallory',
      data: { key: 'T-1', from: 'READY', to: 'DONE', action: 'force_complete' },
      prev_hash: 'wrong',
      hash: 'also-wrong',
    };
    writeFileSync(file, `${JSON.stringify(forged)}\n`, { flag: 'a' });

    const checks = inspectAuditIntegrity(adapter, auditDir);
    expect(checks.find((c) => c.name === 'audit hash chain')?.ok).toBe(false);
  });

  it('detects a truncated tail (lines removed)', () => {
    writeSampleEvents();
    const file = path.join(auditDir, 'current.jsonl');
    const lines = readFileSync(file, 'utf-8')
      .split('\n')
      .filter((l) => l.length > 0);
    // Drop the last line.
    writeFileSync(file, `${lines.slice(0, -1).join('\n')}\n`, 'utf-8');

    const checks = inspectAuditIntegrity(adapter, auditDir);
    expect(checks.find((c) => c.name === 'audit event count')?.ok).toBe(false);
  });

  it('detects a deleted current.jsonl', () => {
    writeSampleEvents();
    rmSync(path.join(auditDir, 'current.jsonl'));

    const checks = inspectAuditIntegrity(adapter, auditDir);
    expect(checks.find((c) => c.name === 'audit event count')?.ok).toBe(false);
  });

  it('detects a replayed (duplicated) line', () => {
    writeSampleEvents();
    const file = path.join(auditDir, 'current.jsonl');
    const lines = readFileSync(file, 'utf-8')
      .split('\n')
      .filter((l) => l.length > 0);
    writeFileSync(file, `${lines.join('\n')}\n${lines[0]}\n`, 'utf-8');

    const checks = inspectAuditIntegrity(adapter, auditDir);
    // Either the count check or the chain check must fire.
    const countOk = checks.find((c) => c.name === 'audit event count')?.ok;
    const chainOk = checks.find((c) => c.name === 'audit hash chain')?.ok;
    expect(countOk === false || chainOk === false).toBe(true);
  });

  it('flags malformed JSON lines as a warning', () => {
    writeSampleEvents();
    const file = path.join(auditDir, 'current.jsonl');
    writeFileSync(file, `${readFileSync(file, 'utf-8')}{not valid json\n`, 'utf-8');

    const checks = inspectAuditIntegrity(adapter, auditDir);
    const parseCheck = checks.find((c) => c.name === 'audit lines parse');
    expect(parseCheck?.ok).toBe(false);
    expect(parseCheck?.severity).toBe('warning');
  });

  it('escalates a one-ahead count to ERROR when a malformed line is present (masked interior deletion)', () => {
    // Attack: delete an interior chained line, drop a garbage line in its
    // place (so it is not counted), and decrement audit_state.event_count so
    // the count is only "one ahead". Without the guard this masquerades as
    // the benign crash-window warning; it must be a hard error instead.
    writeSampleEvents(); // 3 chained events, event_count = 3
    const file = path.join(auditDir, 'current.jsonl');
    const lines = readFileSync(file, 'utf-8')
      .split('\n')
      .filter((l) => l.length > 0);
    lines[1] = '{garbage not json'; // replace an interior line with malformed
    writeFileSync(file, `${lines.join('\n')}\n`, 'utf-8');
    // Now disk has 2 chained + 1 malformed; event_count is still 3 → count is
    // "one ahead" (3 === 2+1) but with a malformed line present. The benign
    // crash-window path must NOT apply — this is a masked interior deletion.

    const count = inspectAuditIntegrity(adapter, auditDir).find(
      (c) => c.name === 'audit event count',
    );
    expect(count?.ok).toBe(false);
    expect(count?.severity).toBe('error'); // NOT the benign warning
    expect(count?.detail).toMatch(/masked interior deletion|malformed/i);
  });

  it('reports legacy mode when no events have been written yet', () => {
    // No events written through the writer; chain head is null.
    const checks = inspectAuditIntegrity(adapter, auditDir);
    const integrity = checks.find((c) => c.name === 'audit integrity');
    expect(integrity?.ok).toBe(true);
    expect(integrity?.detail).toContain('legacy');
  });

  it('does not count archived legacy (pre-chain) lines against audit_state', () => {
    // An archived month written before the hash chain existed: plain v1
    // lines with no hash. `audit_state.event_count` never tracked these.
    const legacy = [
      { v: 1, at: '2026-05-01T00:00:00.000Z', kind: 'task_created', actor: 'old', data: {} },
      { v: 1, at: '2026-05-02T00:00:00.000Z', kind: 'task_created', actor: 'old', data: {} },
    ]
      .map((e) => JSON.stringify(e))
      .join('\n');
    writeFileSync(path.join(auditDir, '2026-05.jsonl'), `${legacy}\n`, 'utf-8');

    // Then a normal chained current month.
    writeSampleEvents();

    const checks = inspectAuditIntegrity(adapter, auditDir);
    const count = checks.find((c) => c.name === 'audit event count');
    // The 2 legacy lines must not inflate the comparison: 3 chained
    // events match audit_state, even though 5 lines sit on disk.
    expect(count?.ok).toBe(true);
    expect(count?.detail).toContain('3 chained events');
    expect(count?.detail).toContain('2 legacy pre-chain');
    // The chain itself is unaffected by the archived legacy file.
    expect(checks.find((c) => c.name === 'audit hash chain')?.ok).toBe(true);
  });

  /**
   * Splits `current.jsonl` at `keepInArchive` lines into an archived
   * segment plus a fresh current file — exactly the shape month rotation
   * produces (`renameSync(current → YYYY-MM.jsonl)`, then new writes append
   * to a new current whose first `prev_hash` is the archived tail). The
   * hash chain stays continuous across the two files.
   */
  function rotateInto(archiveName: string, keepInArchive: number): void {
    const file = path.join(auditDir, 'current.jsonl');
    const lines = readFileSync(file, 'utf-8')
      .split('\n')
      .filter((l) => l.length > 0);
    writeFileSync(
      path.join(auditDir, archiveName),
      `${lines.slice(0, keepInArchive).join('\n')}\n`,
    );
    writeFileSync(file, `${lines.slice(keepInArchive).join('\n')}\n`);
  }

  it('verifies a chain that spans a rotation boundary (no false break)', () => {
    writeSampleEvents(); // 3 chained events
    rotateInto('2026-05.jsonl', 2); // 2 in the archive, 1 in current — chain continuous

    const checks = inspectAuditIntegrity(adapter, auditDir);
    // The old per-file walk reported a false `prev_hash break` here.
    expect(checks.find((c) => c.name === 'audit hash chain')?.ok).toBe(true);
    expect(checks.find((c) => c.name === 'audit event count')?.ok).toBe(true);
  });

  it('detects a whole archived segment being deleted (cross-file break)', () => {
    writeSampleEvents();
    rotateInto('2026-05.jsonl', 2);
    rmSync(path.join(auditDir, '2026-05.jsonl')); // lose the head of the chain

    const chain = inspectAuditIntegrity(adapter, auditDir).find(
      (c) => c.name === 'audit hash chain',
    );
    expect(chain?.ok).toBe(false);
    expect(chain?.detail).toContain('prior segment may be missing');
  });

  it('detects tampering inside an archived segment', () => {
    writeSampleEvents();
    rotateInto('2026-05.jsonl', 2);
    const archive = path.join(auditDir, '2026-05.jsonl');
    writeFileSync(archive, readFileSync(archive, 'utf-8').replace('"daniel"', '"mallory"'));

    const chain = inspectAuditIntegrity(adapter, auditDir).find(
      (c) => c.name === 'audit hash chain',
    );
    expect(chain?.ok).toBe(false);
    expect(chain?.detail).toContain('2026-05.jsonl');
  });

  // Layer-2 machine attestation, as surfaced by doctor (which passes an
  // attestation source into inspectAuditIntegrity).
  describe('machine attestation line', () => {
    it('shows a signed head when a checkpoint has signed', () => {
      const userDir = path.join(tempRoot, 'home', '.config', 'mnema');
      mkdirSync(userDir, { recursive: true });
      const projectRoot = tempRoot; // .audit lives under tempRoot here
      const signatures = new AuditHeadSignatureRepository(adapter);
      const machineKey = new MachineKeyService(projectRoot, 'felipesauer', userDir);
      const checkpoint = new HeadCheckpointService(
        signatures,
        () => ({ machineKey, actor: 'felipesauer' }),
        {
          events: 1,
          seconds: 100_000,
        },
      );
      // A writer that signs every event (checkpoint interval = 1).
      const signedAudit = new AuditService(
        new AuditWriter(auditDir, new AuditStateRepository(adapter), undefined, null, checkpoint),
      );
      signedAudit.write({ kind: 'task_created', actor: 'felipesauer', data: { key: 'T-1' } });

      const attest = createAttestationSource(projectRoot, signatures);
      const verdict = inspectAuditIntegrity(adapter, auditDir, null, false, attest).find(
        (c) => c.name === 'audit machine attestation',
      );
      expect(verdict?.ok).toBe(true);
      expect(verdict?.detail).toMatch(/head signed by felipesauer/i);
    });

    it('warns (no signature yet) when nothing has signed', () => {
      writeSampleEvents(); // written through the unsigned writer
      const attest = createAttestationSource(tempRoot, new AuditHeadSignatureRepository(adapter));
      const verdict = inspectAuditIntegrity(adapter, auditDir, null, false, attest).find(
        (c) => c.name === 'audit machine attestation',
      );
      expect(verdict?.ok).toBe(true);
      expect(verdict?.severity).toBe('warning');
      expect(verdict?.detail).toMatch(/no head signature yet/i);
    });
  });

  // Layer-3 anchoring line, as surfaced by doctor (offline status only).
  describe('anchoring line', () => {
    it('shows anchoring disabled for the default none provider', () => {
      const check = anchorStatusCheck(new AnchorRepository(adapter), 'none');
      expect(check.name).toBe('audit anchoring');
      expect(check.ok).toBe(true);
      expect(check.detail).toMatch(/disabled/i);
    });

    it('summarises anchored/pending when a provider is configured', () => {
      const anchors = new AnchorRepository(adapter);
      anchors.upsert({
        headHash: 'a'.repeat(64),
        provider: 'git-signed',
        status: 'anchored',
        receipt: 'sha',
      });
      const check = anchorStatusCheck(anchors, 'git-signed');
      expect(check.detail).toMatch(/1 anchored/);
    });
  });
});
