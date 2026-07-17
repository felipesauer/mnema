import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { DashboardContract } from '@/dashboard/contract.js';
import { Metrics, projectScatter } from '@/dashboard/Metrics.js';

/**
 * MNEMA-336 — the Flow metrics panel. Rendered via react-dom/server; asserts
 * the tiles, duration/percent formatting, and velocity bars come off the
 * contract's flow section, and that null/empty degrade to a dash, not NaN.
 */
type Eva = DashboardContract['flow']['estimate_vs_actual'];

function eva(over: Partial<Eva> = {}): Eva {
  return {
    samples: [
      { task_key: 'T-1', estimate: 2, actual_hours: 3, actual_source: 'run_duration' },
      { task_key: 'T-2', estimate: 5, actual_hours: 12, actual_source: 'lead_time' },
    ],
    hours_per_point: 2.4,
    run_duration_samples: 1,
    lead_time_fallback_samples: 1,
    ...over,
  };
}

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
    estimate_vs_actual: eva(),
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

describe('projectScatter (estimate-vs-actual geometry)', () => {
  it('returns null when there are no samples', () => {
    expect(projectScatter([])).toBeNull();
  });

  it('scales each axis to its own max and flips y (0 = top)', () => {
    const plot = projectScatter([
      { task_key: 'A', estimate: 2, actual_hours: 5, actual_source: 'run_duration' },
      { task_key: 'B', estimate: 8, actual_hours: 20, actual_source: 'lead_time' },
    ]);
    expect(plot).not.toBeNull();
    if (plot === null) return;
    expect(plot.xMax).toBe(8);
    expect(plot.yMax).toBe(20);
    // Max-x sample sits at the right edge; max-y sample at the top (cy=0).
    expect(plot.points[1].cx).toBe(100);
    expect(plot.points[1].cy).toBe(0);
    // The smaller sample: x = 2/8 = 25%, y = 5/20 = 25% up → cy = 75.
    expect(plot.points[0].cx).toBe(25);
    expect(plot.points[0].cy).toBe(75);
    expect(plot.points[0].measured).toBe(true);
    expect(plot.points[1].measured).toBe(false);
  });

  it('gives duplicate (estimate, actual) pairs distinct keys', () => {
    const dup = { task_key: 'T', estimate: 3, actual_hours: 3, actual_source: 'run_duration' } as const;
    const plot = projectScatter([dup, dup]);
    if (plot === null) throw new Error('expected a plot');
    expect(plot.points[0].key).not.toBe(plot.points[1].key);
  });

  it('never divides by zero when a max is 0 (all-zero column)', () => {
    const plot = projectScatter([
      { task_key: 'Z', estimate: 0, actual_hours: 0, actual_source: 'lead_time' },
    ]);
    if (plot === null) throw new Error('expected a plot');
    expect(Number.isNaN(plot.points[0].cx)).toBe(false);
    expect(Number.isNaN(plot.points[0].cy)).toBe(false);
    // With yMax floored to 1, a 0-hour task sits on the baseline (cy=100).
    expect(plot.points[0].cy).toBe(100);
  });
});

describe('Metrics — estimate-vs-actual scatter render', () => {
  it('renders one point per sample, coloured by source', () => {
    const html = renderToStaticMarkup(<Metrics flow={flow()} />);
    expect((html.match(/data-src="run"/g) ?? []).length).toBe(1);
    expect((html.match(/data-src="lead"/g) ?? []).length).toBe(1);
    // Honest counts + the mean line legend.
    expect(html).toContain('2 tasks');
    expect(html).toContain('~2.4h per point');
    expect(html).toContain('data-ideal');
  });

  it('omits the ideal line when there is no mean (hours_per_point null)', () => {
    const html = renderToStaticMarkup(<Metrics flow={flow({ estimate_vs_actual: eva({ hours_per_point: null }) })} />);
    expect(html).not.toContain('data-ideal');
    expect(html).toContain('no mean');
  });

  it('shows an empty scatter state when no task carries an estimate', () => {
    const html = renderToStaticMarkup(
      <Metrics
        flow={flow({
          estimate_vs_actual: eva({ samples: [], run_duration_samples: 0, lead_time_fallback_samples: 0 }),
        })}
      />,
    );
    expect(html).toContain('No done tasks carry an estimate yet');
    expect(html).not.toContain('data-scatter');
  });
});
