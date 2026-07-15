import type { ReactElement } from 'react';

import type { DashboardContract } from './contract.js';

type Series = ReadonlyArray<{ label: string; value: number }>;

/**
 * Charts panel (MNEMA-292). The legacy serve had two legibility bugs: a
 * category series (events-by-kind) showed only the top-12 of ~29 with NO
 * "+N more" hint, so the reader silently lost 17 categories; and a dense
 * scatter drew 228 points at r=4 in a 220px box (an illegible blob).
 *
 * This panel fixes the truncation-honesty bug for the category + time series
 * it renders: every series shows the top rows AND an explicit "+N more" when
 * it is truncated, so a truncated view never masquerades as complete. Bars
 * are plain SVG (no chart library — keeps the offline-first bundle small).
 *
 * (The dense estimate-vs-actual scatter needs the contract to expose
 * flow.estimate_vs_actual.samples; it is tracked separately and not part of
 * this panel — binning/opacity for 200+ points lands when that data is wired.)
 */
const MAX_ROWS = 12;

export function Charts({ series }: { series: DashboardContract['series'] }): ReactElement {
  return (
    <section aria-label="Activity" data-panel="charts">
      <h2>Activity</h2>
      <BarChart title="Activity by day" testid="activity-by-day" data={series.activityByDay} />
      <BarChart title="Throughput by day" testid="throughput-by-day" data={series.throughputByDay} />
      <BarChart title="Events by kind" testid="events-by-kind" data={series.eventsByKind} />
    </section>
  );
}

function BarChart({
  title,
  testid,
  data,
}: {
  title: string;
  testid: string;
  data: Series;
}): ReactElement {
  if (data.length === 0) {
    return (
      <div data-chart={testid}>
        <h3>{title}</h3>
        <p data-empty="true">No data in this window.</p>
      </div>
    );
  }

  // Show the highest-value rows first, cap at MAX_ROWS, and be HONEST about
  // what was dropped — the truncation-hint the legacy chart lacked.
  const sorted = [...data].sort((a, b) => b.value - a.value);
  const shown = sorted.slice(0, MAX_ROWS);
  const hidden = sorted.length - shown.length;
  const max = Math.max(...shown.map((d) => d.value), 1);

  return (
    <div data-chart={testid}>
      <h3>{title}</h3>
      <ul data-bars={testid}>
        {shown.map((d) => (
          <li key={d.label} data-bar={d.label}>
            <span data-label>{d.label}</span>
            <span
              data-value
              role="img"
              aria-label={`${d.label}: ${d.value}`}
              style={{
                display: 'inline-block',
                width: `${(d.value / max) * 100}%`,
                minWidth: 1,
                background: 'currentColor',
              }}
            />
            <span data-num>{d.value}</span>
          </li>
        ))}
      </ul>
      {hidden > 0 && <p data-more={testid}>+{hidden} more</p>}
    </div>
  );
}
