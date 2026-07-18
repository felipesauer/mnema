import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { reconcileAuditState } from '@/services/integrity/audit-integrity.js';
import { AuditService } from '@/services/integrity/audit-service.js';
import { AuditWriter } from '@/storage/audit/audit-writer.js';
import { MigrationRunner } from '@/storage/sqlite/migration-runner.js';
import { AuditStateRepository } from '@/storage/sqlite/repositories/audit-state-repository.js';
import { SqliteAdapter } from '@/storage/sqlite/sqlite-adapter.js';

const migrationsDir = path.resolve('packages/core/src/storage/sqlite/migrations');

/**
 * `reconcileAuditState` is the recovery path for mirror drift: two concurrent
 * writers commit the SQLite mirror in one order but append to disk in another,
 * so the mirror ends up counting MORE events than ever landed on disk — a
 * divergence bigger than the one-ahead crash shape
 * `AuditStateRepository.reconcileToDisk` already self-heals.
 */
describe('reconcileAuditState', () => {
  let tempRoot: string;
  let auditDir: string;
  let adapter: SqliteAdapter;
  let state: AuditStateRepository;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-audit-reconcile-'));
    auditDir = path.join(tempRoot, '.audit');
    mkdirSync(auditDir, { recursive: true });
    adapter = new SqliteAdapter(path.join(tempRoot, 'state.db'));
    new MigrationRunner().run(adapter, migrationsDir);
    state = new AuditStateRepository(adapter);
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  function writeThreeEvents(): void {
    const audit = new AuditService(new AuditWriter(auditDir, state, () => Buffer.alloc(32, 7)));
    audit.write({ kind: 'task_created', actor: 'a', data: { key: 'T-1' } });
    audit.write({ kind: 'task_created', actor: 'a', data: { key: 'T-2' } });
    audit.write({ kind: 'task_created', actor: 'a', data: { key: 'T-3' } });
  }

  it('corrects a large mirror-ahead drift when the disk chain is clean (dry run does not write)', () => {
    writeThreeEvents();
    // Simulate the historical race: the mirror advanced far more than disk
    // ever received (two processes committing in one order, appending in
    // another — not the narrow one-ahead crash shape).
    adapter
      .getDatabase()
      .prepare('UPDATE audit_state SET event_count = event_count + 92 WHERE id = 1')
      .run();
    expect(state.read().eventCount).toBe(95);

    const dryRun = reconcileAuditState(auditDir, state, null, null, false);
    expect(dryRun.ok).toBe(true);
    if (dryRun.ok) {
      expect(dryRun.beforeEventCount).toBe(95);
      expect(dryRun.afterEventCount).toBe(3);
      expect(dryRun.changed).toBe(true);
      expect(dryRun.applied).toBe(false);
    }
    // Dry run must not have touched the database.
    expect(state.read().eventCount).toBe(95);

    const applied = reconcileAuditState(auditDir, state, null, null, true);
    expect(applied.ok).toBe(true);
    if (applied.ok) {
      expect(applied.applied).toBe(true);
      expect(applied.afterEventCount).toBe(3);
    }
    expect(state.read().eventCount).toBe(3);
    expect(state.read().chainHeadHash).not.toBeNull();
  });

  it('is a no-op when the mirror already matches disk', () => {
    writeThreeEvents();
    const before = state.read();
    const result = reconcileAuditState(auditDir, state, null, null, true);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.changed).toBe(false);
      expect(result.applied).toBe(false);
    }
    expect(state.read().eventCount).toBe(before.eventCount);
    expect(state.read().chainHeadHash).toBe(before.chainHeadHash);
  });

  it('refuses when the on-disk chain has a real prev_hash break (tampering, not drift)', () => {
    writeThreeEvents();
    const file = path.join(auditDir, 'current.jsonl');
    const lines = readFileSync(file, 'utf-8')
      .split('\n')
      .filter((l) => l.length > 0);
    const tampered = JSON.parse(lines[2] as string) as Record<string, unknown>;
    tampered.prev_hash = 'forged-prev-hash';
    lines[2] = JSON.stringify(tampered);
    writeFileSync(file, `${lines.join('\n')}\n`, 'utf-8');

    const result = reconcileAuditState(auditDir, state, null, null, true);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/not internally consistent|tampering/i);
    }
    // Must never have written anything.
    expect(state.read().eventCount).toBe(3);
  });

  it('refuses when a malformed line is present on disk', () => {
    writeThreeEvents();
    const file = path.join(auditDir, 'current.jsonl');
    writeFileSync(file, `${readFileSync(file, 'utf-8')}{not valid json\n`, 'utf-8');

    const result = reconcileAuditState(auditDir, state, null, null, true);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/unparseable/i);
    }
  });

  it('refuses when a signed checkpoint attests more events than the disk chain holds and its head is truncated away', () => {
    writeThreeEvents();
    // Simulate a valid signed checkpoint that covers event 3, then simulate
    // a truncation of the last line — walking the disk now finds only 2, and
    // the signed head (the truncated line's hash) is ABSENT from disk: a
    // genuine truncation, which reconcile must refuse (only accept-truncation
    // may accept it).
    const file = path.join(auditDir, 'current.jsonl');
    const lines = readFileSync(file, 'utf-8')
      .split('\n')
      .filter((l) => l.length > 0);
    const truncatedHead = (JSON.parse(lines[2] as string) as { hash: string }).hash;
    writeFileSync(file, `${lines.slice(0, 2).join('\n')}\n`, 'utf-8');

    const result = reconcileAuditState(
      auditDir,
      state,
      null,
      { eventCountAt: 3, coveredHeadHash: truncatedHead },
      true,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/signed checkpoint|truncation|absent/i);
    }
  });

  it('refuses when there are no chained events on disk yet', () => {
    const result = reconcileAuditState(auditDir, state, null, null, true);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/nothing to reconcile/i);
    }
  });

  it('never modifies the on-disk JSONL files', () => {
    writeThreeEvents();
    const file = path.join(auditDir, 'current.jsonl');
    const before = readFileSync(file, 'utf-8');
    adapter
      .getDatabase()
      .prepare('UPDATE audit_state SET event_count = event_count + 92 WHERE id = 1')
      .run();

    reconcileAuditState(auditDir, state, null, null, true);

    expect(readFileSync(file, 'utf-8')).toBe(before);
  });
});
