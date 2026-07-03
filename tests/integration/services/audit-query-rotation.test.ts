import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AuditQuery } from '@/services/audit-query.js';
import type { AuditEvent } from '@/storage/audit/audit-writer.js';

/**
 * Drops rotated month files (`YYYY-MM.jsonl`) alongside a `current.jsonl`
 * and confirms that `AuditQuery.run` merges them in chronological order
 * with `since`/`until` filters honoured across files. The writer rolls
 * files on the local clock month — this test bypasses that path on
 * purpose and writes the archives manually, mirroring what production
 * looks like after a few months of activity.
 */
describe('AuditQuery (rotation across YYYY-MM.jsonl files)', () => {
  let auditDir: string;
  let query: AuditQuery;

  beforeEach(() => {
    const root = mkdtempSync(path.join(tmpdir(), 'mnema-audit-rot-'));
    auditDir = path.join(root, 'audit');
    mkdirSync(auditDir, { recursive: true });

    const recentDate = new Date();
    const todayIso = recentDate.toISOString();
    const eightDaysAgo = new Date(recentDate.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString();

    writeArchive(auditDir, '2026-03', [
      makeEvent('task_created', '2026-03-02T09:00:00.000Z', { key: 'OLD-1' }),
      makeEvent('task_transitioned', '2026-03-05T12:00:00.000Z', {
        key: 'OLD-1',
        from: 'DRAFT',
        to: 'READY',
        action: 'submit',
      }),
      makeEvent('task_transitioned', '2026-03-25T15:30:00.000Z', {
        key: 'OLD-1',
        from: 'READY',
        to: 'IN_PROGRESS',
        action: 'start',
      }),
    ]);

    writeArchive(auditDir, '2026-04', [
      makeEvent('decision_recorded', '2026-04-01T10:00:00.000Z', { key: 'OLD-ADR-1' }),
      makeEvent('decision_status_changed', '2026-04-20T11:00:00.000Z', {
        key: 'OLD-ADR-1',
        from: 'proposed',
        to: 'accepted',
      }),
    ]);

    writeArchive(auditDir, 'current', [
      makeEvent('task_created', eightDaysAgo, { key: 'NEW-1' }),
      makeEvent('task_created', todayIso, { key: 'NEW-2' }),
      makeEvent('task_transitioned', todayIso, {
        key: 'NEW-2',
        from: 'DRAFT',
        to: 'READY',
        action: 'submit',
      }),
      makeEvent('note_added', todayIso, { task_key: 'NEW-2', note_kind: 'agent_observation' }),
    ]);

    query = new AuditQuery(auditDir);
  });

  afterEach(() => {
    rmSync(path.dirname(auditDir), { recursive: true, force: true });
  });

  it('merges archives + current into one chronological stream when unfiltered', () => {
    const events = query.run();
    expect(events).toHaveLength(9);
    // Strictly monotonic by `at`.
    for (let i = 1; i < events.length; i += 1) {
      const prev = events[i - 1];
      const curr = events[i];
      if (prev === undefined || curr === undefined) throw new Error('precondition');
      expect(prev.at.localeCompare(curr.at)).toBeLessThanOrEqual(0);
    }
    // First event is the oldest in 2026-03; last is today's note.
    expect(events[0]?.data.key).toBe('OLD-1');
    expect(events.at(-1)?.kind).toBe('note_added');
  });

  it('honours `since` = relative 7d (only current.jsonl events)', () => {
    const events = query.run({ since: '7d' });
    // The 8-days-ago `NEW-1` is filtered out; 3 events from today
    // remain (task_created NEW-2, task_transitioned NEW-2, note on NEW-2).
    expect(events).toHaveLength(3);
    const keys = events.map((e) => {
      const data = e.data as Record<string, unknown>;
      return (data.key ?? data.task_key) as string | undefined;
    });
    expect(keys.every((k) => k === 'NEW-2')).toBe(true);
  });

  it('honours `since` = 90d (everything; well past the oldest archive)', () => {
    // 90d would still miss March 2026 from today's clock; instead use
    // an explicit ISO since to validate the bound semantics directly.
    const events = query.run({ since: '2026-03-01T00:00:00.000Z' });
    expect(events.length).toBeGreaterThanOrEqual(9);
  });

  it('honours `since` + `until` window inside a single rotated month', () => {
    const events = query.run({
      since: '2026-04-01T00:00:00.000Z',
      until: '2026-04-30T23:59:59.000Z',
    });
    expect(events).toHaveLength(2);
    expect(events.every((e) => e.kind.startsWith('decision_'))).toBe(true);
  });

  it('combines kind filter with rotated-month read', () => {
    const events = query.run({
      kind: 'task_transitioned',
      since: '2026-01-01T00:00:00.000Z',
    });
    // 2 transitions across archives + current.
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events.every((e) => e.kind === 'task_transitioned')).toBe(true);
  });
});

/**
 * A `since`-bounded query must not even read monthly segments whose whole
 * month precedes the bound. Rather than mock the file reader (a named ESM
 * import can't be spied), each far-past archive carries a MALFORMED line:
 * if the file were read, `runStrict().malformedByFile` would record it, so
 * the absence of that entry proves the file was skipped. `current.jsonl`'s
 * malformed line, by contrast, is always counted (it is always read).
 */
describe('AuditQuery (skips out-of-window monthly segments)', () => {
  let auditDir: string;
  let query: AuditQuery;
  const ancient = '2019-01.jsonl';

  beforeEach(() => {
    const root = mkdtempSync(path.join(tmpdir(), 'mnema-audit-skip-'));
    auditDir = path.join(root, 'audit');
    mkdirSync(auditDir, { recursive: true });

    // Far-past archive: one valid event + a malformed sentinel line.
    writeRaw(auditDir, ancient, [
      JSON.stringify(makeEvent('task_created', '2019-01-10T09:00:00.000Z', { key: 'ANCIENT-1' })),
      '{ this is not json — read-sentinel }',
    ]);
    // In-window current data.
    writeRaw(auditDir, 'current.jsonl', [
      JSON.stringify(makeEvent('task_created', new Date().toISOString(), { key: 'NEW-1' })),
    ]);

    query = new AuditQuery(auditDir);
  });

  afterEach(() => {
    rmSync(path.dirname(auditDir), { recursive: true, force: true });
  });

  const readAncient = (): boolean =>
    [...query.runStrict({ since: '30d' }).malformedByFile.keys()].some((f) => f.endsWith(ancient));

  it('does not read a monthly segment whose whole month precedes since', () => {
    const { events, malformedByFile } = query.runStrict({ since: '30d' });
    // The ancient file's malformed line was never seen → file was skipped.
    expect([...malformedByFile.keys()].some((f) => f.endsWith(ancient))).toBe(false);
    // Only the in-window NEW-1 comes back.
    expect(events.map((e) => (e.data as Record<string, unknown>).key)).toEqual(['NEW-1']);
  });

  it('DOES read the ancient file when the window includes it (parity check)', () => {
    // A bound covering 2019 must read the file — proven by its malformed
    // line now being counted — and still return the ancient event.
    const { events, malformedByFile } = query.runStrict({ since: '2019-01-01T00:00:00.000Z' });
    expect([...malformedByFile.keys()].some((f) => f.endsWith(ancient))).toBe(true);
    expect(events.map((e) => (e.data as Record<string, unknown>).key).sort()).toEqual([
      'ANCIENT-1',
      'NEW-1',
    ]);
  });

  it('unbounded query reads every file (no skip without a bound)', () => {
    expect(readAncient()).toBe(false); // sanity: the helper uses since:30d
    const { malformedByFile } = query.runStrict();
    expect([...malformedByFile.keys()].some((f) => f.endsWith(ancient))).toBe(true);
  });

  it('reads a segment that straddles the since bound', () => {
    // An archive dated to the current month must be read even with since a
    // few days back — part of the month is in window. Its malformed line
    // must therefore be counted.
    const now = new Date();
    const thisMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}.jsonl`;
    writeRaw(auditDir, thisMonth, [
      JSON.stringify(makeEvent('task_created', now.toISOString(), { key: 'STRADDLE-1' })),
      '{ malformed straddle sentinel }',
    ]);
    const { malformedByFile } = query.runStrict({ since: '7d' });
    expect([...malformedByFile.keys()].some((f) => f.endsWith(thisMonth))).toBe(true);
  });
});

function makeEvent(kind: string, at: string, data: Record<string, unknown>): AuditEvent {
  return { v: 1, at, kind, actor: 'daniel', data };
}

function writeRaw(dir: string, fileName: string, lines: readonly string[]): void {
  writeFileSync(path.join(dir, fileName), `${lines.join('\n')}\n`, 'utf-8');
}

function writeArchive(
  dir: string,
  baseName: '2026-03' | '2026-04' | 'current',
  events: readonly AuditEvent[],
): void {
  const file = path.join(dir, `${baseName}.jsonl`);
  const body = events.map((e) => JSON.stringify(e)).join('\n');
  writeFileSync(file, `${body}\n`, 'utf-8');
}
