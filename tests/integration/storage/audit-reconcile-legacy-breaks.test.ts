import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readLegacyBreaksWaiver } from '@/services/audit/audit-diagnose.js';
import type { GitCommandRunner } from '@/services/git/git-commit-service.js';
import { reconcileAuditState } from '@/services/integrity/audit-integrity.js';
import { hashEvent } from '@/storage/audit/audit-hash.js';
import type { AuditEvent } from '@/storage/audit/audit-writer.js';
import { MigrationRunner } from '@/storage/sqlite/migration-runner.js';
import { AuditStateRepository } from '@/storage/sqlite/repositories/audit-state-repository.js';
import { SqliteAdapter } from '@/storage/sqlite/sqlite-adapter.js';

const migrationsDir = path.resolve('src/storage/sqlite/migrations');

/**
 * `reconcileAuditState`'s `acceptLegacyBreaks` opt-in: recovery for a chain
 * broken by concurrent writers racing to append without a cross-process lock.
 * It must accept ONLY the exact shape proven safe — sequence-only breaks,
 * content-authentic throughout, at/before the cutoff, disk matching the
 * committed git HEAD — and refuse everything else, including the cases a
 * careless implementation would be tempted to wave through.
 */
describe('reconcileAuditState with acceptLegacyBreaks', () => {
  let tempRoot: string;
  let auditDir: string;
  let adapter: SqliteAdapter;
  let state: AuditStateRepository;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-legacy-break-'));
    auditDir = path.join(tempRoot, '.mnema', 'audit');
    mkdirSync(auditDir, { recursive: true });
    adapter = new SqliteAdapter(path.join(tempRoot, 'state.db'));
    new MigrationRunner().run(adapter, migrationsDir);
    state = new AuditStateRepository(adapter);
  });
  afterEach(() => {
    adapter.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  function buildChain(n: number, startAt: number, startPrev: string | null = null): AuditEvent[] {
    const events: AuditEvent[] = [];
    let prevHash = startPrev;
    for (let i = 0; i < n; i++) {
      // startAt/i are SECONDS OFFSET from 2026-06-01T00:00:00Z — go through
      // Date arithmetic so an offset >= 60 rolls into minutes/hours instead
      // of producing an invalid "00:00:100.000Z" timestamp.
      const at = new Date(Date.UTC(2026, 5, 1, 0, 0, startAt + i)).toISOString();
      const unsealed: AuditEvent = {
        v: 2,
        at,
        kind: 'task_created',
        actor: 'felipesauer',
        data: { key: `T-${startAt + i}` },
        prev_hash: prevHash,
      };
      const hash = hashEvent(unsealed);
      events.push({ ...unsealed, hash });
      prevHash = hash;
    }
    return events;
  }
  const writeLines = (events: readonly AuditEvent[]): void => {
    writeFileSync(
      path.join(auditDir, 'current.jsonl'),
      `${events.map((e) => JSON.stringify(e)).join('\n')}\n`,
      'utf-8',
    );
  };

  const gitMatch: GitCommandRunner = (args) => {
    if (args[0] === 'rev-parse') return { status: 0, stdout: 'true\n', stderr: '' };
    return { status: 0, stdout: '', stderr: '' }; // diff --quiet: 0 = clean
  };
  const gitDirty: GitCommandRunner = (args) => {
    if (args[0] === 'rev-parse') return { status: 0, stdout: 'true\n', stderr: '' };
    return { status: 1, stdout: '', stderr: '' }; // diff --quiet: 1 = local diff
  };

  it('the notagrafo shape: accepts a sequence-only break, content-valid, before cutoff, git-clean', () => {
    const events = [...buildChain(5, 0), ...buildChain(5, 100)]; // independent 2nd sub-chain = 1 break
    writeLines(events);
    const result = reconcileAuditState(
      auditDir,
      state,
      null,
      null,
      true,
      '2026-12-31',
      tempRoot,
      gitMatch,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.applied).toBe(true);
  });

  it('still refuses without acceptLegacyBreaks (unchanged default behaviour)', () => {
    const events = [...buildChain(5, 0), ...buildChain(5, 100)];
    writeLines(events);
    const result = reconcileAuditState(auditDir, state, null, null, true);
    expect(result.ok).toBe(false);
  });

  it('refuses when a break is AFTER the cutoff date', () => {
    const events = [...buildChain(5, 0), ...buildChain(5, 100)];
    writeLines(events);
    // The break event is timestamped 2026-06-01; a cutoff before that must refuse.
    const result = reconcileAuditState(
      auditDir,
      state,
      null,
      null,
      true,
      '2026-05-01',
      tempRoot,
      gitMatch,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/after the cutoff/i);
  });

  it('refuses when the disk has LOCAL, uncommitted changes vs git HEAD', () => {
    const events = [...buildChain(5, 0), ...buildChain(5, 100)];
    writeLines(events);
    const result = reconcileAuditState(
      auditDir,
      state,
      null,
      null,
      true,
      '2026-12-31',
      tempRoot,
      gitDirty,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/uncommitted|local/i);
  });

  it('refuses when no gitCwd is given, even with a date', () => {
    const events = [...buildChain(5, 0), ...buildChain(5, 100)];
    writeLines(events);
    const result = reconcileAuditState(auditDir, state, null, null, true, '2026-12-31', null);
    expect(result.ok).toBe(false);
  });

  it('NEVER accepts when a real content edit accompanies a break (the tamper shape)', () => {
    const first = buildChain(5, 0);
    const second = buildChain(5, 100);
    // Forge the content of the line right after the break, hash left stale.
    second[0] = { ...second[0], data: { key: 'HACKED' } } as AuditEvent;
    writeLines([...first, ...second]);
    const result = reconcileAuditState(
      auditDir,
      state,
      null,
      null,
      true,
      '2026-12-31',
      tempRoot,
      gitMatch,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/INVALID|content/i);
  });

  it('NEVER accepts a version downgrade, even alongside an otherwise-legacy break', () => {
    const v3ish = buildChain(3, 0); // v2 built, then hand-bump to v3-shaped hash won't match; simulate via raw write instead
    // Simpler: directly construct a v3-then-v2 sequence with valid v2 hashes,
    // so ONLY the downgrade rule (not a hash mismatch) should trigger.
    const e1: AuditEvent = {
      v: 3,
      at: '2026-06-01T00:00:00.000Z',
      kind: 'task_created',
      actor: 'a',
      data: { key: 'T-0' },
      prev_hash: null,
      hash: 'irrelevant-v3-no-secret-check-here',
    };
    const e2u: AuditEvent = {
      v: 2,
      at: '2026-06-01T00:00:01.000Z',
      kind: 'task_created',
      actor: 'a',
      data: { key: 'T-1' },
      prev_hash: e1.hash,
    };
    const e2 = { ...e2u, hash: hashEvent(e2u) };
    writeLines([e1, e2, ...v3ish.map((e) => ({ ...e, prev_hash: e2.hash }))]);
    const result = reconcileAuditState(
      auditDir,
      state,
      null,
      null,
      true,
      '2026-12-31',
      tempRoot,
      gitMatch,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/downgrade/i);
  });

  it('end-to-end with a REAL git repo: accepts after commit, refuses before it', () => {
    const events = [...buildChain(5, 0), ...buildChain(5, 100)];
    writeLines(events);
    const run = (args: string[]): void => {
      execFileSync('git', args, { cwd: tempRoot });
    };
    run(['init', '-q']);
    run(['config', 'user.email', 'a@b.c']);
    run(['config', 'user.name', 'test']);

    // Refuses before committing: file exists on disk but isn't in HEAD's history.
    const before = reconcileAuditState(auditDir, state, null, null, true, '2026-12-31', tempRoot);
    expect(before.ok).toBe(false);

    run(['add', '-A']);
    run(['commit', '-q', '-m', 'audit']);

    const after = reconcileAuditState(auditDir, state, null, null, true, '2026-12-31', tempRoot);
    expect(after.ok).toBe(true);
  });

  describe('the persisted waiver', () => {
    it('is written to disk only when apply is true (never on a dry run)', () => {
      const events = [...buildChain(5, 0), ...buildChain(5, 100)];
      writeLines(events);
      reconcileAuditState(auditDir, state, null, null, false, '2026-12-31', tempRoot, gitMatch);
      expect(readLegacyBreaksWaiver(auditDir)).toBeNull();

      reconcileAuditState(auditDir, state, null, null, true, '2026-12-31', tempRoot, gitMatch);
      expect(readLegacyBreaksWaiver(auditDir)?.acceptedCutoff).toBe('2026-12-31');
    });

    it('downgrades inspectAuditIntegrity to a WARNING under a distinct name, unblocking reattest', async () => {
      const { inspectAuditIntegrity } = await import('@/services/integrity/audit-integrity.js');
      const { chainHealthyForAttest } = await import('@/services/audit/attestation-cli.js');
      const events = [...buildChain(5, 0), ...buildChain(5, 100)];
      writeLines(events);

      const before = inspectAuditIntegrity(adapter, auditDir);
      const beforeChain = before.find((c) => c.name.startsWith('audit hash chain'));
      expect(beforeChain?.severity).toBe('error');
      expect(chainHealthyForAttest(before)).toBe(false);

      reconcileAuditState(auditDir, state, null, null, true, '2026-12-31', tempRoot, gitMatch);

      const after = inspectAuditIntegrity(adapter, auditDir);
      const afterChain = after.find((c) => c.name.startsWith('audit hash chain'));
      expect(afterChain?.name).toBe('audit hash chain (legacy-accepted)');
      expect(afterChain?.ok).toBe(false); // still surfaced, never silently green
      expect(afterChain?.severity).toBe('warning');
      // The whole point: reattest's stricter-than-doctor gate must not treat
      // this specific, human-reviewed warning as the truncation shape it
      // otherwise blocks on.
      expect(chainHealthyForAttest(after)).toBe(true);
    });

    it('a waiver NEVER covers a NEW content edit made after it was written', async () => {
      const { inspectAuditIntegrity } = await import('@/services/integrity/audit-integrity.js');
      const events = [...buildChain(5, 0), ...buildChain(5, 100)];
      writeLines(events);
      reconcileAuditState(auditDir, state, null, null, true, '2026-12-31', tempRoot, gitMatch);
      const covered = inspectAuditIntegrity(adapter, auditDir);
      expect(covered.find((c) => c.name.startsWith('audit hash chain'))?.severity).toBe('warning');

      // Tamper content AFTER the waiver exists, without recomputing its hash.
      const tampered = [...events];
      tampered[7] = { ...tampered[7], data: { key: 'HACKED-AFTER-WAIVER' } } as AuditEvent;
      writeLines(tampered);

      const after = inspectAuditIntegrity(adapter, auditDir);
      const afterChain = after.find((c) => c.name.startsWith('audit hash chain'));
      expect(afterChain?.name).toBe('audit hash chain'); // NOT '(legacy-accepted)'
      expect(afterChain?.severity).toBe('error');
    });

    it('a waiver NEVER covers a break that appears after the accepted cutoff', async () => {
      const { inspectAuditIntegrity } = await import('@/services/integrity/audit-integrity.js');
      const events = [...buildChain(5, 0), ...buildChain(5, 100)];
      writeLines(events);
      reconcileAuditState(auditDir, state, null, null, true, '2026-12-31', tempRoot, gitMatch);

      // Add a THIRD independent sub-chain, timestamped after the cutoff.
      const third = buildChain(3, 200).map((e) => ({
        ...e,
        at: e.at.replace('2026-06-01', '2027-01-01'),
      }));
      writeLines([...events, ...third]);

      const after = inspectAuditIntegrity(adapter, auditDir);
      const afterChain = after.find((c) => c.name.startsWith('audit hash chain'));
      expect(afterChain?.name).toBe('audit hash chain');
      expect(afterChain?.severity).toBe('error');
    });
  });
});
