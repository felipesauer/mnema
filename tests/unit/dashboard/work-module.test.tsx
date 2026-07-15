import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { BoardView } from '@/dashboard/Board.js';
import type { BoardData, WorklinesData } from '@/dashboard/contract.js';
import { WorklinesView } from '@/dashboard/Worklines.js';

/**
 * MNEMA-335 — the Work module (Board + Epics & sprints). The presentation
 * views are rendered via react-dom/server (the fetch wrappers Board/Worklines
 * are covered by the /api integration test). Asserts columns-by-state, cards,
 * and coverage rendering.
 */

describe('BoardView', () => {
  const data: BoardData = {
    total: 3,
    by_state: { READY: 1, IN_PROGRESS: 2 },
    tasks: [
      { key: 'PAY-1', title: 'A', state: 'READY', priority: 3, assignee_id: null, updated_at: '', labels: ['api'] },
      { key: 'PAY-2', title: 'B', state: 'IN_PROGRESS', priority: 3, assignee_id: null, updated_at: '', labels: [] },
      { key: 'PAY-3', title: 'C', state: 'IN_PROGRESS', priority: 3, assignee_id: null, updated_at: '', labels: [] },
    ],
  };

  it('renders a column per state with the right counts', () => {
    const html = renderToStaticMarkup(<BoardView data={data} />);
    expect(html).toContain('data-col="READY"');
    expect(html).toContain('data-col="IN_PROGRESS"');
    // Column count badges reflect by_state.
    expect(html).toMatch(/READY <span class="count">1</);
    expect(html).toMatch(/IN_PROGRESS <span class="count">2</);
  });

  it('places each task card in its own state column', () => {
    const html = renderToStaticMarkup(<BoardView data={data} />);
    expect(html).toContain('data-card="PAY-1"');
    expect(html).toContain('data-card="PAY-2"');
    expect(html).toContain('data-card="PAY-3"');
    // A task's labels render as chips.
    expect(html).toContain('api');
  });

  it('shows an empty state when there are no tasks', () => {
    const html = renderToStaticMarkup(
      <BoardView data={{ total: 0, by_state: {}, tasks: [] }} />,
    );
    expect(html).toContain('No tasks yet');
  });
});

describe('WorklinesView', () => {
  const data: WorklinesData = {
    epics: [
      { key: 'EPIC-1', title: 'Alpha', state: 'OPEN', coverage: { total: 4, terminal: 2, percent: 50 } },
      { key: 'EPIC-2', title: 'Beta', state: 'OPEN', coverage: null },
    ],
    sprints: [
      { key: 'SPRINT-1', name: 'S1', state: 'CLOSED', coverage: { total: 5, terminal: 5, percent: 100 } },
    ],
  };

  it('lists epics and sprints with coverage', () => {
    const html = renderToStaticMarkup(<WorklinesView data={data} />);
    expect(html).toContain('EPIC-1 · Alpha');
    expect(html).toContain('50%');
    expect(html).toContain('2/4');
    expect(html).toContain('SPRINT-1 · S1');
    expect(html).toContain('100%');
    // A workline without coverage shows a dash, not a crash.
    expect(html).toContain('EPIC-2 · Beta');
  });

  it('renders empty states', () => {
    const html = renderToStaticMarkup(<WorklinesView data={{ epics: [], sprints: [] }} />);
    expect(html).toContain('No epics');
    expect(html).toContain('No sprints');
  });
});
