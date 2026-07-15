import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { DashboardContract } from '@/dashboard/contract.js';
import { Metrics } from '@/dashboard/Metrics.js';

/**
 * MNEMA-336 — the Flow metrics panel. Rendered via react-dom/server; asserts
 * the tiles, duration/percent formatting, and velocity bars come off the
 * contract's flow section, and that null/empty degrade to a dash, not NaN.
 */
function flow(over: Partial<DashboardContract['flow']> = {}): DashboardContract['flow'] {
  return {
    throughput: 18,
    lead_time: { count: 10, avg_hours: 80, median_hours: 72, max_hours: 200 },
    cycle_time: { count: 10, avg_hours: 40, median_hours: 30, max_hours: 90 },
    reopen: { reopened_tasks: 2, completed_tasks: 50, rate: 0.04 },
    velocity: [
      { sprint_key: 'S-33', sprint_name: 'Sprint 33', completed_points: 14, completed_tasks: 7 },
      { sprint_key: 'S-35', sprint_name: 'Sprint 35', completed_points: 20, completed_tasks: 10 },
    ],
    ...over,
  };
}

describe('Metrics panel', () => {
  it('renders the four flow tiles from the contract', () => {
    const html = renderToStaticMarkup(<Metrics flow={flow()} />);
    expect(html).toMatch(/data-metric="throughput">18</);
    // 72h median → "3.0d" (>=48h → days); 30h → "30h" (<48h → hours).
    expect(html).toMatch(/data-metric="lead">3\.0d</);
    expect(html).toMatch(/data-metric="cycle">30h</);
    expect(html).toMatch(/data-metric="reopen">4%</);
  });

  it('renders velocity bars per sprint', () => {
    const html = renderToStaticMarkup(<Metrics flow={flow()} />);
    expect(html).toContain('data-bar="S-33"');
    expect(html).toContain('data-bar="S-35"');
    expect(html).toContain('Sprint 33');
    expect(html).toContain('14');
    expect(html).toContain('20');
  });

  it('shows a dash for a null duration, never "null" or NaN', () => {
    const html = renderToStaticMarkup(
      <Metrics
        flow={flow({ lead_time: { count: 0, avg_hours: null, median_hours: null, max_hours: null } })}
      />,
    );
    expect(html).toMatch(/data-metric="lead">—</);
    expect(html).not.toContain('null');
    expect(html).not.toContain('NaN');
  });

  it('shows an empty velocity state', () => {
    const html = renderToStaticMarkup(<Metrics flow={flow({ velocity: [] })} />);
    expect(html).toContain('No completed sprints yet');
  });
});
