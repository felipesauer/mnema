import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { EVENT_FORMAT_VERSION } from '@/storage/audit/audit-hash.js';
import { type AuditEvent, AuditWriter, LOCK_STALE_MS } from '@/storage/audit/audit-writer.js';
import { MigrationRunner } from '@/storage/sqlite/migration-runner.js';
import { AuditStateRepository } from '@/storage/sqlite/repositories/audit-state-repository.js';
import { SQLITE_BUSY_TIMEOUT_MS, SqliteAdapter } from '@/storage/sqlite/sqlite-adapter.js';

const migrationsDir = path.resolve('packages/core/src/storage/sqlite/migrations');
const FIXTURE_SECRET = Buffer.alloc(32, 7);

function makeEvent(kind: string): AuditEvent {
  return {
    v: 1,
    at: new Date().toISOString(),
    kind,
    actor: 'daniel',
    data: {},
  };
}

describe('AuditWriter', () => {
  let dir: string;
  let adapter: SqliteAdapter;

  /** A real chained, HMAC-keyed writer — the only kind that exists. */
  function makeWriter(now: () => Date = () => new Date()): AuditWriter {
    return new AuditWriter(dir, new AuditStateRepository(adapter), () => FIXTURE_SECRET, now);
  }

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mnema-audit-'));
    adapter = new SqliteAdapter(path.join(dir, 'state.db'));
    new MigrationRunner().run(adapter, migrationsDir);
  });

  afterEach(() => {
    adapter.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates the audit dir if missing', () => {
    const auditDir = path.join(dir, 'audit');
    const writer = new AuditWriter(
      auditDir,
      new AuditStateRepository(adapter),
      () => FIXTURE_SECRET,
    );
    writer.write(makeEvent('test'));
    expect(existsSync(path.join(auditDir, 'current.jsonl'))).toBe(true);
  });

  it('appends events as one sealed JSON object per line', () => {
    const writer = makeWriter();
    writer.write(makeEvent('a'));
    writer.write(makeEvent('b'));

    const content = readFileSync(path.join(dir, 'current.jsonl'), 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(2);

    const parsed = lines.map((line) => JSON.parse(line) as AuditEvent);
    expect(parsed[0]?.kind).toBe('a');
    expect(parsed[1]?.kind).toBe('b');
    // Every line is a keyed event with a hash and a prev_hash link.
    expect(parsed.every((e) => e.v === EVENT_FORMAT_VERSION && typeof e.hash === 'string')).toBe(
      true,
    );
    expect(parsed[0]?.prev_hash).toBeNull();
    expect(parsed[1]?.prev_hash).toBe(parsed[0]?.hash);
  });

  it('refuses to seal without a project secret (mandatory-keyed)', () => {
    const writer = new AuditWriter(dir, new AuditStateRepository(adapter), () => null);
    expect(() => writer.write(makeEvent('nope'))).toThrow(/project secret is not available/);
  });

  it('rotates current.jsonl when its month differs from now', () => {
    makeWriter().write(makeEvent('first'));

    const currentPath = path.join(dir, 'current.jsonl');
    const fakeJanuary = new Date('2026-01-15T12:00:00Z');
    utimesSync(currentPath, fakeJanuary, fakeJanuary);

    const february = new Date('2026-02-10T12:00:00Z');
    makeWriter(() => february).write(makeEvent('second'));

    const files = readdirSync(dir).sort();
    expect(files).toContain('2026-01.jsonl');
    expect(files).toContain('current.jsonl');

    const archived = readFileSync(path.join(dir, '2026-01.jsonl'), 'utf-8');
    expect(archived.trim().split('\n')).toHaveLength(1);

    const current = readFileSync(currentPath, 'utf-8');
    expect(current.trim().split('\n')).toHaveLength(1);
    expect(JSON.parse(current.trim()).kind).toBe('second');
  });

  it('does not rotate when the month matches', () => {
    const today = new Date();
    makeWriter(() => today).write(makeEvent('only'));

    const files = readdirSync(dir)
      .filter((f) => f.endsWith('.jsonl'))
      .sort();
    expect(files).toEqual(['current.jsonl']);
  });

  it('holds the audit lock stale threshold strictly above the SQLite busy_timeout', () => {
    // A write can block on the WAL writer for up to busy_timeout; if the lock
    // could be judged stale before then, a peer could steal it mid-write and
    // let two writers into the critical section. The stale threshold must stay
    // strictly greater than busy_timeout — this pins that ordering so a change
    // to either constant that reopened the overlap fails here.
    expect(LOCK_STALE_MS).toBeGreaterThan(SQLITE_BUSY_TIMEOUT_MS);
  });
});
