import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type AuditEvent, AuditWriter, LOCK_STALE_MS } from '@/storage/audit/audit-writer.js';
import { SQLITE_BUSY_TIMEOUT_MS } from '@/storage/sqlite/sqlite-adapter.js';

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

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mnema-audit-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates the audit dir if missing', () => {
    rmSync(dir, { recursive: true, force: true });

    const writer = new AuditWriter(dir);
    writer.write(makeEvent('test'));

    expect(existsSync(path.join(dir, 'current.jsonl'))).toBe(true);
  });

  it('appends events as one JSON object per line', () => {
    const writer = new AuditWriter(dir);
    writer.write(makeEvent('a'));
    writer.write(makeEvent('b'));

    const content = readFileSync(path.join(dir, 'current.jsonl'), 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(2);

    const parsed = lines.map((line) => JSON.parse(line) as AuditEvent);
    expect(parsed[0]?.kind).toBe('a');
    expect(parsed[1]?.kind).toBe('b');
  });

  it('rotates current.jsonl when its month differs from now', () => {
    const writer = new AuditWriter(dir);
    writer.write(makeEvent('first'));

    const currentPath = path.join(dir, 'current.jsonl');
    const fakeJanuary = new Date('2026-01-15T12:00:00Z');
    utimesSync(currentPath, fakeJanuary, fakeJanuary);

    const february = new Date('2026-02-10T12:00:00Z');
    const rotating = new AuditWriter(dir, null, () => february);
    rotating.write(makeEvent('second'));

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
    const writer = new AuditWriter(dir, null, () => today);
    writer.write(makeEvent('only'));

    const files = readdirSync(dir).sort();
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
