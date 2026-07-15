import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { DashboardContract } from '@/dashboard/contract.js';
import { Overview } from '@/dashboard/Overview.js';

/**
 * MNEMA-334 — the Overview landing. Rendered via react-dom/server; asserts the
 * stat tiles, the condensed needs-you queues, and the activity timeline all
 * come off the contract.
 */
function contract(over: Partial<DashboardContract> = {}): DashboardContract {
  return {
    projectKey: 'PAY',
    generatedAt: '2026-07-15T14:42:00.000Z',
    window: '30d',
    schemaDrift: false,
    integrity: [{ name: 'audit hash chain', ok: true, detail: 'verified' }],
    flow: {
      throughput: 18,
      lead_time: { count: 10, avg_hours: 76, median_hours: 60, max_hours: 200 },
      cycle_time: { count: 10, avg_hours: 40, median_hours: 30, max_hours: 90 },
      reopen: { reopened_tasks: 2, completed_tasks: 50, rate: 0.04 },
      velocity: [],
    },
    // The server delivers `recent` oldest-first (allEvents.slice(-limit)); the
    // Overview reverses it to show newest-first. So the older event is first here.
    recent: [
      { at: '2026-07-15T14:31:00.000Z', kind: 'task_blocked', actor: 'felipe', key: 'PAY-158' },
      { at: '2026-07-15T14:41:00.000Z', kind: 'task_approved', actor: 'felipe', key: 'PAY-140' },
    ],
    inbox: {
      awaitingReview: [{ key: 'PAY-142', title: 'Rate limiting', state: 'IN_REVIEW' }],
      blocked: [],
      pendingDecisions: 3,
      slaBreaches: [],
      wipBreaches: [],
    },
    graph: {
      scope: { kind: 'project' },
      nodes: [],
      cycles: [],
      frontier: { ready: [], blocked: [] },
      criticalPath: [],
    },
    series: { activityByDay: [], throughputByDay: [], eventsByKind: [] },
    ...over,
  };
}

describe('Overview', () => {
  it('shows the four stat tiles from the contract', () => {
    const html = renderToStaticMarkup(<Overview data={contract()} />);
    expect(html).toContain('Chain');
    expect(html).toContain('verified');
    expect(html).toContain('Throughput');
    expect(html).toContain('18');
    expect(html).toContain('Reopen rate');
    expect(html).toContain('4%'); // 0.04 → 4%
    // Needs-you tile = review + blocked + pendingDecisions = 1 + 0 + 3 = 4.
    expect(html).toContain('Needs you');
    expect(html).toContain('4');
  });

  it('condenses the needs-you queues and lists a review item', () => {
    const html = renderToStaticMarkup(<Overview data={contract()} />);
    expect(html).toContain('Awaiting review');
    expect(html).toContain('PAY-142');
    expect(html).toContain('Rate limiting');
  });

  it('renders the activity timeline newest-first with HH:MM', () => {
    const html = renderToStaticMarkup(<Overview data={contract()} />);
    expect(html).toContain('task_approved');
    expect(html).toContain('PAY-140');
    // Newest (14:41) appears before the older (14:31).
    expect(html.indexOf('task_approved')).toBeLessThan(html.indexOf('task_blocked'));
  });

  it('shows a chain-needs-attention tile when a check fails', () => {
    const html = renderToStaticMarkup(
      <Overview
        data={contract({
          integrity: [{ name: 'audit hash chain', ok: false, detail: 'hash mismatch' }],
        })}
      />,
    );
    expect(html).toContain('needs attention');
  });
});
