import { describe, expect, it } from 'vitest';

import { parseLimit, toRecentEvent } from '@/cli/commands/dashboard-command.js';
import type { AuditEvent } from '@/storage/audit/audit-writer.js';

/** Builds a minimal persisted audit event for the projection tests. */
function event(
  kind: string,
  data: Record<string, unknown>,
  extra: Partial<AuditEvent> = {},
): AuditEvent {
  return { v: 2, at: '2026-07-01T00:00:00Z', kind, actor: 'felipe', data, ...extra };
}

/** Identity display that just uppercases, so we can assert it was applied. */
const display = (handle: string): string => handle.toUpperCase();

describe('parseLimit', () => {
  it('falls back to the default when the flag is absent', () => {
    expect(parseLimit(undefined)).toBe(25);
  });

  it('honors a plain decimal positive integer', () => {
    expect(parseLimit('8')).toBe(8);
    expect(parseLimit('1')).toBe(1);
  });

  it('rejects zero and negatives', () => {
    expect(parseLimit('0')).toBeNull();
    expect(parseLimit('-5')).toBeNull();
  });

  it('rejects non-numeric input', () => {
    expect(parseLimit('abc')).toBeNull();
    expect(parseLimit('')).toBeNull();
    expect(parseLimit('12x')).toBeNull();
  });

  it('rejects hex and exponent strings that Number() would silently coerce', () => {
    // Number('0x10') === 16 and Number('1e3') === 1000 both pass Number.isInteger;
    // the "positive integer" contract must reject them.
    expect(parseLimit('0x10')).toBeNull();
    expect(parseLimit('1e3')).toBeNull();
    expect(parseLimit('1.5')).toBeNull();
  });
});

describe('toRecentEvent', () => {
  it('applies the identity display to actor and via', () => {
    const r = toRecentEvent(
      event('task_transitioned', { key: 'DEMO-1' }, { via: 'claude' }),
      display,
    );
    expect(r.actor).toBe('FELIPE');
    expect(r.via).toBe('CLAUDE');
  });

  it('omits via when the event has none', () => {
    const r = toRecentEvent(event('task_created', { key: 'DEMO-1' }), display);
    expect(r.via).toBeUndefined();
  });

  it('resolves the key from data.key and data.task_key', () => {
    expect(toRecentEvent(event('task_created', { key: 'DEMO-1' }), display).key).toBe('DEMO-1');
    expect(toRecentEvent(event('note_added', { task_key: 'DEMO-2' }), display).key).toBe('DEMO-2');
  });

  it('resolves the key from decision/epic/sprint fields (not just task fields)', () => {
    // These kinds carry no `key`/`task_key`; without the fallback chain the
    // row would render an empty key column despite an obvious subject.
    expect(
      toRecentEvent(event('attachment_added', { decision_key: 'MNEMA-ADR-7' }), display).key,
    ).toBe('MNEMA-ADR-7');
    expect(toRecentEvent(event('epic_closed', { epic_key: 'MNEMA-EPIC-1' }), display).key).toBe(
      'MNEMA-EPIC-1',
    );
    expect(
      toRecentEvent(event('sprint_metric_added', { sprint_key: 'MNEMA-SPRINT-6' }), display).key,
    ).toBe('MNEMA-SPRINT-6');
  });

  it('leaves the key undefined when no known field is present', () => {
    expect(toRecentEvent(event('run_started', { goal: 'x' }), display).key).toBeUndefined();
  });
});
