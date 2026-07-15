import { describe, expect, it } from 'vitest';

import {
  activityByDay,
  eventsByKind,
  throughputByDay,
} from '@/services/dashboard/dashboard-series.js';
import type { AuditEvent } from '@/storage/audit/audit-writer.js';

function ev(at: string, kind: string, data: Record<string, unknown> = {}): AuditEvent {
  return { v: 2, at, kind, actor: 'a', data };
}

describe('activityByDay', () => {
  it('counts events per UTC day and fills gaps', () => {
    const events = [
      ev('2026-01-01T09:00:00Z', 'task_created'),
      ev('2026-01-01T18:00:00Z', 'note_added'),
      ev('2026-01-03T10:00:00Z', 'task_transitioned'),
    ];
    const series = activityByDay(events);
    // Jan 1 (2), Jan 2 (0, filled), Jan 3 (1).
    expect(series).toEqual([
      { label: '2026-01-01', value: 2 },
      { label: '2026-01-02', value: 0 },
      { label: '2026-01-03', value: 1 },
    ]);
  });

  it('returns empty for no events', () => {
    expect(activityByDay([])).toEqual([]);
  });

  it('skips events with an unparseable timestamp', () => {
    const series = activityByDay([ev('not-a-date', 'x'), ev('2026-02-01T00:00:00Z', 'y')]);
    expect(series).toEqual([{ label: '2026-02-01', value: 1 }]);
  });

  it('keeps the newest days (never drops recent data) when the span exceeds the cap', () => {
    // Earliest event ~2 years before the latest, with real activity on the
    // last day. The capped series must END at the last day, not start at the
    // first — dropping the newest day would be the bug we are guarding.
    const series = activityByDay([
      ev('2024-01-01T00:00:00Z', 'task_created'),
      ev('2026-01-01T00:00:00Z', 'task_transitioned'),
    ]);
    expect(series.length).toBeLessThanOrEqual(366);
    expect(series[series.length - 1]).toEqual({ label: '2026-01-01', value: 1 });
  });
});

describe('throughputByDay', () => {
  const terminal = new Set(['DONE', 'CANCELED']);

  it('counts only terminal task_transitioned events', () => {
    const events = [
      ev('2026-01-01T10:00:00Z', 'task_transitioned', { to: 'IN_PROGRESS' }),
      ev('2026-01-01T12:00:00Z', 'task_transitioned', { to: 'DONE' }),
      ev('2026-01-01T13:00:00Z', 'note_added', { to: 'DONE' }),
      ev('2026-01-02T09:00:00Z', 'task_transitioned', { to: 'CANCELED' }),
    ];
    const series = throughputByDay(events, terminal);
    expect(series).toEqual([
      { label: '2026-01-01', value: 1 },
      { label: '2026-01-02', value: 1 },
    ]);
  });

  it('is empty when nothing reaches terminal', () => {
    expect(
      throughputByDay([ev('2026-01-01T10:00:00Z', 'task_transitioned', { to: 'READY' })], terminal),
    ).toEqual([]);
  });
});

describe('eventsByKind', () => {
  it('counts by kind, most frequent first, ties broken by name', () => {
    const events = [
      ev('2026-01-01T00:00:00Z', 'task_transitioned'),
      ev('2026-01-01T00:00:01Z', 'task_transitioned'),
      ev('2026-01-01T00:00:02Z', 'note_added'),
      ev('2026-01-01T00:00:03Z', 'evidence_attached'),
    ];
    const series = eventsByKind(events);
    expect(series[0]).toEqual({ label: 'task_transitioned', value: 2 });
    // The two 1-count kinds are alphabetical: evidence_attached before note_added.
    expect(series.slice(1)).toEqual([
      { label: 'evidence_attached', value: 1 },
      { label: 'note_added', value: 1 },
    ]);
  });
});
