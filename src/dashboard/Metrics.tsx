import type { ReactElement } from 'react';

import type { DashboardContract } from './contract.js';

/**
 * Flow metrics panel (MNEMA-336 / ADR-67 slice 4). Throughput, lead/cycle
 * time, reopen rate, and per-sprint velocity — all from the `flow` section of
 * the /api/dashboard contract (server FlowMetrics). No new source of truth.
 */
export function Metrics({ flow }: { flow: DashboardContract['flow'] }): ReactElement {
  return (
    <section aria-label="Flow metrics" data-panel="metrics">
      <div className="grid g4">
        <div className="card tile">
          <div className="l">Throughput</div>
          <div className="v" data-metric="throughput">
            {flow.throughput}
          </div>
          <div className="d">tasks done</div>
        </div>
        <div className="card tile">
          <div className="l">Lead time</div>
          <div className="v" data-metric="lead">
            {formatDuration(flow.lead_time.median_hours)}
          </div>
          <div className="d">median · created→done</div>
        </div>
        <div className="card tile">
          <div className="l">Cycle time</div>
          <div className="v" data-metric="cycle">
            {formatDuration(flow.cycle_time.median_hours)}
          </div>
          <div className="d">median · start→done</div>
        </div>
        <div className="card tile">
          <div className="l">Reopen rate</div>
          <div className="v" data-metric="reopen">
            {formatPct(flow.reopen.rate)}
          </div>
          <div className="d">
            {flow.reopen.reopened_tasks}/{flow.reopen.completed_tasks} completed
          </div>
        </div>
      </div>

      <p className="eyebrow">Velocity by sprint</p>
      <div className="card">
        <div className="panelbody">
          {flow.velocity.length === 0 ? (
            <p className="q-empty" data-empty="velocity">
              No completed sprints yet.
            </p>
          ) : (
            <div className="bars" data-bars="velocity">
              {(() => {
                const max = Math.max(...flow.velocity.map((v) => v.completed_points), 1);
                return flow.velocity.map((v) => (
                  <div className="barrow" key={v.sprint_key} data-bar={v.sprint_key}>
                    <span className="lbl">{v.sprint_name || v.sprint_key}</span>
                    <span className="track">
                      <span
                        className="fill"
                        role="img"
                        aria-label={`${v.sprint_name || v.sprint_key}: ${v.completed_points} points`}
                        style={{ width: `${(v.completed_points / max) * 100}%` }}
                      />
                    </span>
                    <span className="num">{v.completed_points}</span>
                  </div>
                ));
              })()}
            </div>
          )}
        </div>
      </div>

      <p className="eyebrow">Estimate vs. actual</p>
      <EstimateScatter eva={flow.estimate_vs_actual} />
    </section>
  );
}

/**
 * Estimate-vs-actual scatter. The legacy serve drew ~228 points at r=4 in a
 * 220px box — a solid, unreadable blob. This renders the same data legibly:
 * points are small and semi-transparent, so overlap reads as density instead
 * of hiding it, and each is coloured by whether its `actual_hours` was measured
 * from run duration or fell back to lead time (the less certain source). A
 * dashed line marks the `hours_per_point` mean, so above/below the line reads
 * as over/under the typical realised effort.
 *
 * The frame/grid/mean line is a stretched SVG (a non-scaling stroke keeps the
 * hairlines crisp); the points are absolutely-positioned HTML dots, so they
 * stay perfectly round regardless of the panel's aspect ratio — an SVG circle
 * in that stretched box would render as an ellipse. No chart library.
 */
function EstimateScatter({
  eva,
}: {
  eva: DashboardContract['flow']['estimate_vs_actual'];
}): ReactElement {
  const plot = projectScatter(eva.samples);
  if (plot === null) {
    return (
      <div className="card">
        <div className="panelbody">
          <p className="q-empty" data-empty="scatter">
            No done tasks carry an estimate yet.
          </p>
        </div>
      </div>
    );
  }

  const { points, xMax, yMax } = plot;
  const n = eva.samples.length;
  // Ideal line y = hours_per_point · x, clipped to the plotted box.
  const hpp = eva.hours_per_point;
  const idealYAtXMax = hpp === null ? null : hpp * xMax;

  return (
    <div className="card">
      <div className="panelhead">
        <span className="t">
          {n} task{n === 1 ? '' : 's'}
        </span>
        <span className="sub">
          {hpp === null ? 'no mean' : `~${hpp.toFixed(1)}h per point`}
        </span>
      </div>
      <div className="panelbody">
        <div
          className="scatter"
          role="img"
          aria-label={`Estimate versus actual hours for ${n} task${n === 1 ? '' : 's'}; up to ${xMax} points estimated, up to ${Math.round(yMax)} hours realised`}
          data-scatter
        >
          <svg className="scatter-grid" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <line className="ax" x1="0" y1="100" x2="100" y2="100" />
            <line className="ax" x1="0" y1="0" x2="0" y2="100" />
            <line className="grid" x1="0" y1="50" x2="100" y2="50" />
            <line className="grid" x1="50" y1="0" x2="50" y2="100" />
            {idealYAtXMax !== null && (
              <line
                className="ideal"
                data-ideal
                x1="0"
                y1="100"
                x2="100"
                y2={100 - (Math.min(idealYAtXMax, yMax) / yMax) * 100}
              />
            )}
          </svg>
          {points.map((p) => (
            <i
              key={p.key}
              className={p.measured ? 'pt' : 'pt fallback'}
              data-src={p.measured ? 'run' : 'lead'}
              style={{ left: `${p.cx}%`, top: `${p.cy}%` }}
            />
          ))}
        </div>
        <div className="axlabels">
          <span>0</span>
          <span className="axname">estimate (points) →</span>
          <span>{xMax}</span>
        </div>
        <div className="legend" data-legend>
          <span className="lg">
            <i className="sw run" /> run duration ({eva.run_duration_samples})
          </span>
          <span className="lg">
            <i className="sw lead" /> lead-time fallback ({eva.lead_time_fallback_samples})
          </span>
          {hpp !== null && (
            <span className="lg">
              <i className="sw ideal" /> mean h/point
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/** One projected point in a 0..100 box, y flipped so 0 = top. */
interface ScatterPoint {
  readonly key: string;
  readonly cx: number;
  readonly cy: number;
  readonly measured: boolean;
}
interface ScatterPlot {
  readonly points: readonly ScatterPoint[];
  readonly xMax: number;
  readonly yMax: number;
}

/**
 * Project estimate/actual samples into a 0..100 coordinate box. Pure and
 * exported so the geometry is unit-testable without a DOM. Returns null when
 * there is nothing to plot. Axes start at 0 (a scatter of effort should not
 * hide the origin) and scale to the data's max, so any range stays legible.
 * Duplicate (estimate, actual) pairs get distinct keys via the sample index.
 */
export function projectScatter(
  samples: DashboardContract['flow']['estimate_vs_actual']['samples'],
): ScatterPlot | null {
  if (samples.length === 0) return null;
  const xMax = Math.max(...samples.map((s) => s.estimate), 1);
  const yMax = Math.max(...samples.map((s) => s.actual_hours), 1);
  const points = samples.map((s, i) => ({
    key: `${i}-${s.task_key}`,
    cx: (s.estimate / xMax) * 100,
    cy: 100 - (s.actual_hours / yMax) * 100,
    measured: s.actual_source === 'run_duration',
  }));
  return { points, xMax, yMax };
}

/** A 0..1 rate as a whole percent. */
function formatPct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

/**
 * Median/avg hours rendered compactly: <48h as `Nh`, otherwise `N.Nd`.
 * Null (no samples) shows an em dash rather than "null" or NaN.
 */
function formatDuration(hours: number | null): string {
  if (hours === null || Number.isNaN(hours)) return '—';
  if (hours < 48) return `${Math.round(hours)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}
