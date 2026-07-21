import { deriveAlias } from '@mnema/core/domain/entity-alias.js';
import type { AuditEvent } from '@mnema/core/storage/audit/audit-writer.js';
import { describe, expect, it } from 'vitest';
import { formatEvent, formatHistory } from '@/cli/formatters/history-formatter.js';

/** Deterministic committed ids for fixtures, and their derived task aliases. */
const ID1 = '019f7700-0000-7000-8000-000000000001';
const ID2 = '019f7700-0000-7000-8000-000000000002';
const ID3 = '019f7700-0000-7000-8000-000000000003';
const alias = (id: string): string => deriveAlias('task', id);

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

  it('renders decision_recorded as a typed line', () => {
    const line = noColor(
      formatEvent(
        sample('decision_recorded', {
          key: 'X-ADR-1',
          title: 'Use SQLite',
          status: 'proposed',
        }),
        'human',
        'iso',
      ),
    );
    expect(line).toContain('recorded X-ADR-1');
    expect(line).toContain('"Use SQLite"');
    expect(line).toContain('[proposed]');
    expect(line).not.toContain('decision_recorded');
  });

  it('renders decision_status_changed with from→to arrow', () => {
    const line = noColor(
      formatEvent(
        sample('decision_status_changed', {
          key: 'X-ADR-1',
          from: 'proposed',
          to: 'accepted',
        }),
        'human',
        'iso',
      ),
    );
    expect(line).toContain('decision X-ADR-1');
    expect(line).toContain('proposed → accepted');
    expect(line).not.toContain('decision_status_changed');
  });

  it('shows the supersedes target when a decision is superseded', () => {
    const line = noColor(
      formatEvent(
        sample('decision_status_changed', {
          key: 'X-ADR-1',
          from: 'accepted',
          to: 'superseded',
          superseded_by: 'X-ADR-7',
        }),
        'human',
        'iso',
      ),
    );
    expect(line).toContain('accepted → superseded');
    expect(line).toContain('→ X-ADR-7');
  });

  it('renders note_added with the target task alias and kind', () => {
    const line = noColor(
      formatEvent(
        sample('note_added', {
          task_id: ID1,
          note_kind: 'comment',
          content_size: 42,
        }),
        'human',
        'iso',
      ),
    );
    expect(line).toContain(`note on ${alias(ID1)}`);
    expect(line).toContain('[comment]');
    expect(line).not.toContain('note_added');
    expect(line).not.toContain('content_size');
  });

  it('renders attachment_added with filename, target and size', () => {
    const line = noColor(
      formatEvent(
        sample('attachment_added', {
          task_key: 'X-1',
          filename: 'README.md',
          size: 7099,
          hash: '68bf90c4',
          deduplicated: false,
        }),
        'human',
        'iso',
      ),
    );
    expect(line).toContain('attached README.md');
    expect(line).toContain('to X-1');
    expect(line).toContain('6.9KB');
    expect(line).not.toContain('attachment_added');
    expect(line).not.toContain('hash');
    expect(line).not.toContain('(dedup)');
  });

  it('marks deduplicated attachments', () => {
    const line = noColor(
      formatEvent(
        sample('attachment_added', {
          task_key: 'X-1',
          filename: 'README.md',
          size: 7099,
          hash: '68bf90c4',
          deduplicated: true,
        }),
        'human',
        'iso',
      ),
    );
    expect(line).toContain('(dedup)');
  });
});

describe('formatHistory', () => {
  it('collapses consecutive task_created from the same run into one summary line', () => {
    const events: AuditEvent[] = [
      sample('task_created', { id: ID1, title: 'A' }, { run: 'r1' }),
      sample(
        'task_created',
        { id: ID2, title: 'B' },
        { run: 'r1', at: '2026-05-01T10:00:01.000Z' },
      ),
      sample(
        'task_created',
        { id: ID3, title: 'C' },
        { run: 'r1', at: '2026-05-01T10:00:02.000Z' },
      ),
    ];

    const output = noColor(formatHistory(events, 'human'));
    const lines = output.split('\n');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('created 3 tasks');
    expect(lines[0]).toContain(alias(ID1));
    expect(lines[0]).toContain(alias(ID3));
  });

  it('keeps single creates verbose', () => {
    const events: AuditEvent[] = [
      sample('task_created', { id: ID1, title: 'A' }, { run: 'r1' }),
      sample(
        'task_transitioned',
        { id: ID1, from: 'DRAFT', to: 'READY', action: 'submit' },
        { run: 'r1', at: '2026-05-01T10:00:01.000Z' },
      ),
    ];

    const output = noColor(formatHistory(events, 'human'));
    const lines = output.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain(`created ${alias(ID1)}`);
  });

  it('emits raw JSON lines in json mode without aggregating', () => {
    const events: AuditEvent[] = [
      sample('task_created', { key: 'X-1', title: 'A' }, { run: 'r1' }),
      sample('task_created', { key: 'X-2', title: 'B' }, { run: 'r1' }),
    ];

    const output = formatHistory(events, 'json');
    expect(output.split('\n')).toHaveLength(2);
  });

  it('substitutes display names for actor and via via the resolver', () => {
    const event = sample(
      'task_transitioned',
      { key: 'X-1', from: 'DRAFT', to: 'READY', action: 'submit' },
      { actor: 'joaop', via: 'agent:claude-code' },
    );
    const display = (handle: string): string => {
      if (handle === 'joaop') return 'João Pereira';
      if (handle === 'agent:claude-code') return 'Claude Code';
      return handle;
    };

    const line = noColor(formatEvent(event, 'human', 'iso', display));
    expect(line).toContain('João Pereira via Claude Code');
    expect(line).not.toContain('joaop ');
    expect(line).not.toContain('agent:claude-code');
  });

  it('substitutes display names in the aggregated `created N tasks` line', () => {
    const events: AuditEvent[] = [
      sample(
        'task_created',
        { key: 'X-1', title: 'A' },
        { actor: 'joaop', via: 'agent:claude-code', run: 'r1' },
      ),
      sample(
        'task_created',
        { key: 'X-2', title: 'B' },
        {
          actor: 'joaop',
          via: 'agent:claude-code',
          run: 'r1',
          at: '2026-05-01T10:00:01.000Z',
        },
      ),
    ];
    const display = (handle: string): string =>
      handle === 'joaop' ? 'João Pereira' : handle === 'agent:claude-code' ? 'Claude Code' : handle;

    const output = noColor(formatHistory(events, 'human', 'iso', display));
    expect(output).toContain('João Pereira via Claude Code');
    expect(output).toContain('created 2 tasks');
  });

  it('falls back to the raw handle when no resolver is provided', () => {
    const event = sample(
      'task_transitioned',
      { key: 'X-1', from: 'DRAFT', to: 'READY', action: 'submit' },
      { actor: 'joaop', via: 'agent:claude-code' },
    );
    const line = noColor(formatEvent(event, 'human', 'iso'));
    expect(line).toContain('joaop via agent:claude-code');
  });
});
