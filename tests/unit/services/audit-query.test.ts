import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AuditQuery, parseTimeBound } from '@/services/integrity/audit-query.js';

function writeJsonl(file: string, events: readonly object[]): void {
  writeFileSync(file, events.map((e) => JSON.stringify(e)).join('\n'), 'utf-8');
}

describe('AuditQuery', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mnema-audit-q-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns every event when no filter is supplied', () => {
    writeJsonl(path.join(dir, 'current.jsonl'), [
      { v: 1, at: '2026-05-01T10:00:00Z', kind: 'task_created', actor: 'd', data: {} },
      { v: 1, at: '2026-05-01T10:01:00Z', kind: 'task_transitioned', actor: 'd', data: {} },
    ]);

    const events = new AuditQuery(dir).run();
    expect(events.map((e) => e.kind)).toEqual(['task_created', 'task_transitioned']);
  });

  it('filters by kind, actor, via and run', () => {
    writeJsonl(path.join(dir, 'current.jsonl'), [
      { v: 1, at: '2026-05-01T10:00:00Z', kind: 'task_created', actor: 'a', data: {} },
      {
        v: 1,
        at: '2026-05-01T10:01:00Z',
        kind: 'task_created',
        actor: 'b',
        via: 'agent:cc',
        run: 'r1',
        data: {},
      },
      { v: 1, at: '2026-05-01T10:02:00Z', kind: 'task_transitioned', actor: 'a', data: {} },
    ]);
    const q = new AuditQuery(dir);

    expect(q.run({ kind: 'task_created' })).toHaveLength(2);
    expect(q.run({ actor: 'b' })).toHaveLength(1);
    expect(q.run({ via: 'agent:cc' })).toHaveLength(1);
    expect(q.run({ run: 'r1' })).toHaveLength(1);
  });

  it('combines current.jsonl with archived months in chronological order', () => {
    writeJsonl(path.join(dir, '2026-04.jsonl'), [
      { v: 1, at: '2026-04-30T23:00:00Z', kind: 'task_created', actor: 'a', data: {} },
    ]);
    writeJsonl(path.join(dir, 'current.jsonl'), [
      { v: 1, at: '2026-05-01T00:01:00Z', kind: 'task_transitioned', actor: 'a', data: {} },
    ]);

    const events = new AuditQuery(dir).run();
    expect(events.map((e) => e.kind)).toEqual(['task_created', 'task_transitioned']);
  });

  it('applies the limit to the most recent events', () => {
    writeJsonl(path.join(dir, 'current.jsonl'), [
      { v: 1, at: '2026-05-01T10:00:00Z', kind: 'a', actor: 'd', data: {} },
      { v: 1, at: '2026-05-01T10:01:00Z', kind: 'b', actor: 'd', data: {} },
      { v: 1, at: '2026-05-01T10:02:00Z', kind: 'c', actor: 'd', data: {} },
    ]);

    const events = new AuditQuery(dir).run({ limit: 2 });
    expect(events.map((e) => e.kind)).toEqual(['b', 'c']);
  });

  it('respects the since/until bounds', () => {
    writeJsonl(path.join(dir, 'current.jsonl'), [
      { v: 1, at: '2026-05-01T10:00:00Z', kind: 'a', actor: 'd', data: {} },
      { v: 1, at: '2026-05-01T11:00:00Z', kind: 'b', actor: 'd', data: {} },
      { v: 1, at: '2026-05-01T12:00:00Z', kind: 'c', actor: 'd', data: {} },
    ]);

    const events = new AuditQuery(dir).run({
      since: new Date('2026-05-01T10:30:00Z'),
      until: new Date('2026-05-01T11:30:00Z'),
    });
    expect(events.map((e) => e.kind)).toEqual(['b']);
  });

  it('handles missing audit dir gracefully', () => {
    const events = new AuditQuery(path.join(dir, 'nonexistent')).run();
    expect(events).toEqual([]);
  });

  it('filters by taskKey across data.key and data.task_key, isolating other tasks', () => {
    writeJsonl(path.join(dir, 'current.jsonl'), [
      {
        v: 1,
        at: '2026-05-01T10:00:00Z',
        kind: 'task_created',
        actor: 'd',
        data: { key: 'MNEMA-1', title: 'one' },
      },
      {
        v: 1,
        at: '2026-05-01T10:01:00Z',
        kind: 'task_transitioned',
        actor: 'd',
        data: { key: 'MNEMA-1', from: 'TODO', to: 'DOING', action: 'start' },
      },
      {
        v: 1,
        at: '2026-05-01T10:02:00Z',
        kind: 'note_added',
        actor: 'd',
        data: { task_key: 'MNEMA-1', note_kind: 'comment' },
      },
      {
        v: 1,
        at: '2026-05-01T10:03:00Z',
        kind: 'attachment_added',
        actor: 'd',
        data: { task_key: 'MNEMA-1', filename: 'README.md' },
      },
      {
        v: 1,
        at: '2026-05-01T11:00:00Z',
        kind: 'task_created',
        actor: 'd',
        data: { key: 'MNEMA-2', title: 'two' },
      },
      {
        v: 1,
        at: '2026-05-01T11:01:00Z',
        kind: 'note_added',
        actor: 'd',
        data: { task_key: 'MNEMA-2', note_kind: 'comment' },
      },
    ]);

    const events = new AuditQuery(dir).run({ taskKey: 'MNEMA-1' });
    expect(events.map((e) => e.kind)).toEqual([
      'task_created',
      'task_transitioned',
      'note_added',
      'attachment_added',
    ]);
  });

  it('does not collide task keys with decision keys (MNEMA-ADR-*)', () => {
    writeJsonl(path.join(dir, 'current.jsonl'), [
      {
        v: 1,
        at: '2026-05-01T10:00:00Z',
        kind: 'task_created',
        actor: 'd',
        data: { key: 'MNEMA-1' },
      },
      {
        v: 1,
        at: '2026-05-01T10:01:00Z',
        kind: 'decision_recorded',
        actor: 'd',
        data: { key: 'MNEMA-ADR-1', title: 'x', status: 'proposed' },
      },
    ]);

    expect(new AuditQuery(dir).run({ taskKey: 'MNEMA-1' })).toHaveLength(1);
    expect(new AuditQuery(dir).run({ taskKey: 'MNEMA-ADR-1' })).toHaveLength(1);
  });

  describe('limit guard', () => {
    beforeEach(() => {
      writeJsonl(path.join(dir, 'current.jsonl'), [
        { v: 1, at: '2026-05-01T10:00:00Z', kind: 'a', actor: 'd', data: {} },
        { v: 1, at: '2026-05-01T10:01:00Z', kind: 'b', actor: 'd', data: {} },
        { v: 1, at: '2026-05-01T10:02:00Z', kind: 'c', actor: 'd', data: {} },
      ]);
    });

    it('ignores a zero limit (non-positive) and returns all events', () => {
      const events = new AuditQuery(dir).run({ limit: 0 });
      expect(events.map((e) => e.kind)).toEqual(['a', 'b', 'c']);
    });

    it('ignores a negative limit instead of producing an empty slice', () => {
      const events = new AuditQuery(dir).run({ limit: -2 });
      expect(events.map((e) => e.kind)).toEqual(['a', 'b', 'c']);
    });

    it('ignores a non-integer limit instead of truncating', () => {
      const events = new AuditQuery(dir).run({ limit: 1.5 });
      expect(events.map((e) => e.kind)).toEqual(['a', 'b', 'c']);
    });

    it('ignores a NaN limit and returns all events', () => {
      const events = new AuditQuery(dir).run({ limit: Number('abc') });
      expect(events.map((e) => e.kind)).toEqual(['a', 'b', 'c']);
    });

    it('applies a positive integer limit to the most recent events', () => {
      const events = new AuditQuery(dir).run({ limit: 2 });
      expect(events.map((e) => e.kind)).toEqual(['b', 'c']);
    });
  });
});

describe('parseTimeBound', () => {
  it('returns null for undefined', () => {
    expect(parseTimeBound(undefined)).toBeNull();
  });

  it('parses Date instances directly', () => {
    const date = new Date('2026-05-01T00:00:00Z');
    expect(parseTimeBound(date)).toBe(date.getTime());
  });

  it('parses ISO8601 strings', () => {
    expect(parseTimeBound('2026-05-01T00:00:00Z')).toBe(new Date('2026-05-01T00:00:00Z').getTime());
  });

  it('parses relative durations', () => {
    const before = Date.now();
    const result = parseTimeBound('30s');
    const after = Date.now();
    expect(result).not.toBeNull();
    if (result === null) return;
    expect(result).toBeLessThanOrEqual(after - 30 * 1000);
    expect(result).toBeGreaterThanOrEqual(before - 31 * 1000);
  });

  it('returns null for malformed strings', () => {
    expect(parseTimeBound('not-a-date')).toBeNull();
  });
});
