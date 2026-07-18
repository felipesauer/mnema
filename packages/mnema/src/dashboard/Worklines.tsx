import type { ReactElement } from 'react';

import type { CoverageSummary, WorklinesData } from './contract.js';
import { useApi } from './useApi.js';

/**
 * Epics & sprints panel. Lists epics and sprints
 * with their coverage (terminal/total → percent), from the /api/epics read
 * (the existing epic/sprint + coverage services). No new source of truth.
 */
export function Worklines(): ReactElement {
  const state = useApi<WorklinesData>('/api/epics');

  if (state.status === 'loading') return <p className="subtitle">Loading epics & sprints…</p>;
  if (state.status === 'error')
    return (
      <p className="subtitle" role="alert">
        Failed to load epics &amp; sprints: {state.message}
      </p>
    );

  return <WorklinesView data={state.data} />;
}

/** Pure presentation, so it can be rendered/tested without a fetch. */
export function WorklinesView({ data }: { data: WorklinesData }): ReactElement {
  const { epics, sprints } = data;

  return (
    <div className="grid g2">
      <div className="card">
        <div className="panelhead">
          <span className="t">Epics</span>
          <span className="sub">{epics.length}</span>
        </div>
        <div className="panelbody">
          {epics.length === 0 ? (
            <p className="q-empty">No epics.</p>
          ) : (
            <div className="rows">
              {epics.map((e) => (
                <CoverageRow key={e.key} label={`${e.key} · ${e.title}`} coverage={e.coverage} />
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="panelhead">
          <span className="t">Sprints</span>
          <span className="sub">{sprints.length}</span>
        </div>
        <div className="panelbody">
          {sprints.length === 0 ? (
            <p className="q-empty">No sprints.</p>
          ) : (
            <div className="rows">
              {sprints.map((s) => (
                <CoverageRow key={s.key} label={`${s.key} · ${s.name}`} coverage={s.coverage} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CoverageRow({
  label,
  coverage,
}: {
  label: string;
  coverage: CoverageSummary | null;
}): ReactElement {
  const pct = coverage?.percent ?? 0;
  return (
    <div className="lrow">
      <span className="name">{label}</span>
      <span className="cov">
        {coverage ? (
          <>
            <span className="cov-track">
              <span className="cov-fill" style={{ width: `${pct}%` }} />
            </span>
            <span className="cov-num">
              {coverage.terminal}/{coverage.total}
            </span>
            <span className={`pill ${pct === 100 ? 'ok' : pct >= 50 ? 'accent' : 'warn'}`}>
              {pct}%
            </span>
          </>
        ) : (
          <span className="pill muted">—</span>
        )}
      </span>
    </div>
  );
}
