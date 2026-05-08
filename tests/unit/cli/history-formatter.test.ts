import { describe, expect, it } from 'vitest';

import { formatEvent, formatHistory } from '@/cli/formatters/history-formatter.js';
import type { AuditEvent } from '@/storage/audit/audit-writer.js';

const sample = (
  kind: string,
  data: Record<string, unknown>,
  extras: Partial<AuditEvent> = {},
): AuditEvent => ({
  v: 1,
  at: '2026-05-01T10:00:00.000Z',
  kind,
  actor: 'daniel',
  data,
  ...extras,
});

// Strip ANSI escapes so assertions are not affected by colour codes.
// Built dynamically to avoid embedding control characters in the regex literal.
const ansiRegex = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
const noColor = (input: string): string => input.replace(ansiRegex, '');

describe('formatEvent', () => {
  it('serialises events to JSON in json mode', () => {
    const event = sample('task_created', { key: 'X-1' });
    expect(JSON.parse(formatEvent(event, 'json'))).toEqual(event);
  });

  it('renders aligned columns in table mode', () => {
    const line = noColor(
      formatEvent(
        sample(
          'task_transitioned',
          { key: 'X-1', from: 'DRAFT', to: 'READY' },
          { via: 'agent:cc' },
        ),
        'table',
      ),
    );
    expect(line).toContain('task_transitioned');
    expect(line).toContain('agent:cc');
  });

  it('shows the timestamp and a `via` clause in human mode (iso)', () => {
    const line = noColor(
      formatEvent(
        sample(
          'task_transitioned',
          { key: 'X-1', from: 'DRAFT', to: 'READY', action: 'submit' },
          { via: 'agent:cc' },
        ),
        'human',
        'iso',
      ),
    );
    expect(line).toContain('2026-05-01T10:00:00.000Z');
    expect(line).toContain('daniel via agent:cc');
    expect(line).toContain('submit');
    expect(line).toContain('DRAFT → READY');
  });

  it('uses relative timestamps by default in human mode', () => {
    const line = noColor(
      formatEvent(
        sample('task_created', { key: 'X-1', title: 'A' }, { at: new Date().toISOString() }),
        'human',
      ),
    );
    expect(line).toMatch(/just now|\dm ago|\dh ago/);
  });
});

describe('formatHistory', () => {
  it('collapses consecutive task_created from the same run into one summary line', () => {
    const events: AuditEvent[] = [
      sample('task_created', { key: 'X-1', title: 'A' }, { run: 'r1' }),
      sample(
        'task_created',
        { key: 'X-2', title: 'B' },
        { run: 'r1', at: '2026-05-01T10:00:01.000Z' },
      ),
      sample(
        'task_created',
        { key: 'X-3', title: 'C' },
        { run: 'r1', at: '2026-05-01T10:00:02.000Z' },
      ),
    ];

    const output = noColor(formatHistory(events, 'human'));
    const lines = output.split('\n');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('created 3 tasks');
    expect(lines[0]).toContain('X-1');
    expect(lines[0]).toContain('X-3');
  });

  it('keeps single creates verbose', () => {
    const events: AuditEvent[] = [
      sample('task_created', { key: 'X-1', title: 'A' }, { run: 'r1' }),
      sample(
        'task_transitioned',
        { key: 'X-1', from: 'DRAFT', to: 'READY', action: 'submit' },
        { run: 'r1', at: '2026-05-01T10:00:01.000Z' },
      ),
    ];

    const output = noColor(formatHistory(events, 'human'));
    const lines = output.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('created X-1');
  });

  it('emits raw JSON lines in json mode without aggregating', () => {
    const events: AuditEvent[] = [
      sample('task_created', { key: 'X-1', title: 'A' }, { run: 'r1' }),
      sample('task_created', { key: 'X-2', title: 'B' }, { run: 'r1' }),
    ];

    const output = formatHistory(events, 'json');
    expect(output.split('\n')).toHaveLength(2);
  });
});
