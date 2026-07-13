import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { inspectAuditDiskDelta } from '@/cli/commands/doctor-command.js';
import { AuditService } from '@/services/audit-service.js';
import { AuditWriter } from '@/storage/audit/audit-writer.js';
import { MigrationRunner } from '@/storage/sqlite/migration-runner.js';
import { AuditStateRepository } from '@/storage/sqlite/repositories/audit-state-repository.js';
import { SqliteAdapter } from '@/storage/sqlite/sqlite-adapter.js';

const migrationsDir = path.resolve('src/storage/sqlite/migrations');

/**
 * `inspectAuditDiskDelta` is the read-only doctor check that surfaces the
 * data-loss shape from the field incident: the SQLite mirror's `event_count`
 * sits ABOVE the hash-chained lines actually on disk, because a git rewind of
 * the tracked audit log removed events the gitignored counter still counts.
 */
describe('inspectAuditDiskDelta', () => {
  let tempRoot: string;
  let auditDir: string;
  let adapter: SqliteAdapter;
  let state: AuditStateRepository;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-audit-delta-'));
    auditDir = path.join(tempRoot, 'audit');
    mkdirSync(auditDir, { recursive: true });
    adapter = new SqliteAdapter(path.join(tempRoot, 'state.db'));
    new MigrationRunner().run(adapter, migrationsDir);
    state = new AuditStateRepository(adapter);
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  const writeEvents = (n: number): void => {
    const audit = new AuditService(new AuditWriter(auditDir, state));
    for (let i = 0; i < n; i += 1) {
      audit.write({ kind: 'task_created', actor: 'a', data: { key: `T-${i}` } });
    }
  };

  it('is green when the mirror count equals the on-disk chained lines', () => {
    writeEvents(3);
    const checks = inspectAuditDiskDelta(adapter, auditDir, null);
    expect(checks).toHaveLength(1);
    expect(checks[0]?.name).toBe('audit mirror vs disk');
    expect(checks[0]?.ok).toBe(true);
  });

  it('is green (not flagged) when disk is AHEAD of the mirror (the reconcile-covered crash window)', () => {
    writeEvents(3);
    // Pretend the mirror lags disk — reconcile covers this direction, so the
    // DB-ahead delta check must NOT fire.
    adapter.getDatabase().prepare('UPDATE audit_state SET event_count = 1 WHERE id = 1').run();
    const check = inspectAuditDiskDelta(adapter, auditDir, null)[0];
    expect(check?.ok).toBe(true);
  });

  it('flags an error with the numeric delta when the mirror counts events absent from disk', () => {
    writeEvents(3);
    // The incident shape: counter inflated above the on-disk chain.
    adapter
      .getDatabase()
      .prepare('UPDATE audit_state SET event_count = event_count + 234 WHERE id = 1')
      .run();

    const check = inspectAuditDiskDelta(adapter, auditDir, null)[0];
    expect(check?.ok).toBe(false);
    expect(check?.severity).toBe('error');
    expect(check?.detail).toContain('event_count 237');
    expect(check?.detail).toContain('3 chained line(s)');
    expect(check?.detail).toContain('by 234');
    // No git cwd given → no culprit-commit clause.
    expect(check?.detail).not.toContain('last shrank');
    // Points the operator at the recovery path.
    expect(check?.detail).toContain('mnema audit reconcile');
  });

  it('names the commit that shrank the on-disk chain when the audit files are git-tracked', () => {
    const git = (...args: string[]): void => {
      execFileSync('git', args, { cwd: tempRoot, stdio: 'pipe' });
    };
    git('init', '-q');
    git('config', 'user.email', 't@t');
    git('config', 'user.name', 't');

    // Commit a full 3-event chain.
    writeEvents(3);
    const currentFile = path.join(auditDir, 'current.jsonl');
    const fullChain = readFileSync(currentFile, 'utf-8');
    git('add', '-A');
    git('commit', '-q', '-m', 'full chain');

    // A rewind commit drops the tail line from the tracked file (the shape a
    // squash-merge of a stale branch snapshot leaves behind).
    const lines = fullChain.split('\n').filter((l) => l.length > 0);
    writeFileSync(currentFile, `${lines.slice(0, 2).join('\n')}\n`, 'utf-8');
    git('add', '-A');
    git('commit', '-q', '-m', 'rewind: drop the tail');
    const rewindSha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: tempRoot,
      encoding: 'utf-8',
    }).trim();

    // The mirror still counts the original 3 (its counter is gitignored and
    // never retreated); disk now holds 2.
    // (event_count is already 3 from writeEvents; do not touch it.)
    const check = inspectAuditDiskDelta(adapter, auditDir, tempRoot)[0];
    expect(check?.ok).toBe(false);
    expect(check?.detail).toContain('event_count 3 exceeds 2');
    expect(check?.detail).toContain('last shrank in commit');
    expect(check?.detail).toContain(rewindSha.slice(0, 12));
    expect(check?.detail).toContain('3 → 2 lines');
  });

  it('handles a malformed line on disk without counting it as a chained event', () => {
    writeEvents(2);
    appendFileSync(path.join(auditDir, 'current.jsonl'), '{ this is not json\n', 'utf-8');
    // Disk still has 2 chained lines; mirror at 2 → green (the malformed line
    // is inspectAuditIntegrity's concern, not the delta's).
    const check = inspectAuditDiskDelta(adapter, auditDir, null)[0];
    expect(check?.ok).toBe(true);
    expect(check?.detail).toContain('2 chained line(s)');
  });
});
