import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { inspectAuditIntegrity } from '@/cli/commands/doctor-command.js';
import { AuditService } from '@/services/audit-service.js';
import { AuditWriter } from '@/storage/audit/audit-writer.js';
import { MigrationRunner } from '@/storage/sqlite/migration-runner.js';
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

  it('reports legacy mode when no events have been written yet', () => {
    // No events written through the writer; chain head is null.
    const checks = inspectAuditIntegrity(adapter, auditDir);
    const integrity = checks.find((c) => c.name === 'audit integrity');
    expect(integrity?.ok).toBe(true);
    expect(integrity?.detail).toContain('legacy');
  });
});
