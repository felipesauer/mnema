import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { DashboardContract } from '@/dashboard/contract.js';
import { NeedsYou } from '@/dashboard/NeedsYou.js';

/**
 * MNEMA-291 — the Needs-you panel. Rendered to static markup via
 * react-dom/server (no jsdom needed — the panel is presentational), so we
 * assert what a human sees. The data source (the /api/dashboard contract) is
 * covered by the dashboard-server integration test; here we prove the panel
 * surfaces the three human-attention queues the current serve discards.
 */

function inbox(overrides: Partial<DashboardContract['inbox']> = {}): DashboardContract['inbox'] {
  return {
    awaitingReview: [],
    blocked: [],
    pendingDecisions: 0,
    slaBreaches: [],
    wipBreaches: [],
    ...overrides,
  };
}

describe('NeedsYou panel', () => {
  it('lists tasks awaiting review with key + title', () => {
    const html = renderToStaticMarkup(
      <NeedsYou
        inbox={inbox({
          awaitingReview: [
            { key: 'PAY-1', title: 'Rate limiting', state: 'IN_REVIEW' },
            { key: 'PAY-2', title: 'Idempotency keys', state: 'IN_REVIEW' },
          ],
        })}
      />,
    );
    expect(html).toContain('Awaiting review');
    // Key (a mono chip) and title (separate) both render for each row.
    expect(html).toContain('PAY-1');
    expect(html).toContain('Rate limiting');
    expect(html).toContain('PAY-2');
    expect(html).toContain('Idempotency keys');
    // The queue count reflects the list length.
    expect(html).toMatch(/data-count="awaiting-review">2</);
  });

  it('lists blocked tasks and shows the pending-decisions count', () => {
    const html = renderToStaticMarkup(
      <NeedsYou
        inbox={inbox({
          blocked: [{ key: 'PAY-9', title: 'Webhook retries', state: 'BLOCKED' }],
          pendingDecisions: 3,
        })}
      />,
    );
    expect(html).toContain('PAY-9');
    expect(html).toContain('Webhook retries');
    expect(html).toMatch(/data-count="blocked">1</);
    expect(html).toMatch(/data-count="pending-decisions">3</);
  });

  it('shows an empty state when nothing needs attention', () => {
    const html = renderToStaticMarkup(<NeedsYou inbox={inbox()} />);
    expect(html).toContain('Nothing needs your attention');
    expect(html).not.toContain('Awaiting review');
  });

  it('does NOT show the empty state when only an SLA breach is present (inbox parity)', () => {
    // The three headline queues are empty, but the CLI `mnema inbox` still
    // reports the SLA breach — the panel must not claim "nothing".
    const html = renderToStaticMarkup(
      <NeedsYou
        inbox={inbox({
          slaBreaches: [{ key: 'PAY-7', title: 'Stuck in review', age_days: 5, sla_days: 2 }],
        })}
      />,
    );
    expect(html).not.toContain('Nothing needs your attention');
    expect(html).toContain('SLA breaches');
    expect(html).toContain('PAY-7');
    expect(html).toContain('5d / 2d');
    expect(html).toMatch(/data-count="sla-breaches">1</);
  });

  it('surfaces WIP breaches with the count over the limit', () => {
    const html = renderToStaticMarkup(
      <NeedsYou
        inbox={inbox({
          wipBreaches: [{ state: 'IN_PROGRESS', count: 6, limit: 3 }],
        })}
      />,
    );
    expect(html).not.toContain('Nothing needs your attention');
    expect(html).toContain('WIP breaches');
    expect(html).toContain('IN_PROGRESS');
    expect(html).toContain('6 / 3');
    expect(html).toMatch(/data-count="wip-breaches">1</);
  });

  it('does not render the breaches row when there are no breaches', () => {
    const html = renderToStaticMarkup(
      <NeedsYou inbox={inbox({ blocked: [{ key: 'X-1', title: 't', state: 'BLOCKED' }] })} />,
    );
    // A normal non-empty inbox with no breaches shows no breach cards.
    expect(html).not.toContain('SLA breaches');
    expect(html).not.toContain('WIP breaches');
  });
});
