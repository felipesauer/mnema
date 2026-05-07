import { describe, expect, it } from 'vitest';

import { formatTaskBlock } from '@/cli/formatters/task-formatter.js';
import type { Task } from '@/domain/entities/task.js';
import { TaskState } from '@/domain/enums/task-state.js';

const REPORTER_ID = '11111111-2222-3333-4444-555555555555';
const ASSIGNEE_ID = '99999999-aaaa-bbbb-cccc-dddddddddddd';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-id',
    key: 'TEST-1',
    projectId: 'p1',
    epicId: null,
    sprintId: null,
    title: 'A task',
    description: null,
    acceptanceCriteria: [],
    state: TaskState.Draft,
    estimate: null,
    priority: 3,
    assigneeId: null,
    reporterId: REPORTER_ID,
    reopenCount: 0,
    metadata: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    closedAt: null,
    deletedAt: null,
    ...overrides,
  };
}

// Strip picocolors ANSI escapes for assertions.
const ansiRegex = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
const strip = (s: string): string => s.replace(ansiRegex, '');

describe('formatTaskBlock', () => {
  it('renders the reporter handle when the resolver returns one', () => {
    const out = strip(formatTaskBlock(makeTask(), (id) => (id === REPORTER_ID ? 'daniel' : null)));
    expect(out).toContain('reporter: daniel');
    expect(out).not.toContain(REPORTER_ID);
  });

  it('falls back to a truncated id when the resolver returns null', () => {
    const out = strip(formatTaskBlock(makeTask(), () => null));
    expect(out).toContain('reporter: 11111111');
    expect(out).not.toContain(REPORTER_ID);
  });

  it('renders the assignee handle when present and resolvable', () => {
    const out = strip(
      formatTaskBlock(makeTask({ assigneeId: ASSIGNEE_ID }), (id) =>
        id === ASSIGNEE_ID ? 'alice' : id === REPORTER_ID ? 'daniel' : null,
      ),
    );
    expect(out).toContain('reporter: daniel');
    expect(out).toContain('assignee: alice');
  });

  it('still works without a resolver — uses truncated ids', () => {
    const out = strip(formatTaskBlock(makeTask()));
    expect(out).toContain('reporter: 11111111');
  });
});
