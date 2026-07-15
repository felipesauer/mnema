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
    </section>
  );
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
