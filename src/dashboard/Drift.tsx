import type { ReactElement } from 'react';

import type { DriftData } from './contract.js';
import { useApi } from './useApi.js';

/**
 * Drift panel (MNEMA-337 / ADR-67 slice 5). Commits on this branch not tied to
 * a task — the a-posteriori "untracked work" signal, from the on-demand
 * /api/drift read (the existing drift service). `checked=false` means git
 * could not be consulted → shown as "unknown", never "clean".
 */
export function Drift(): ReactElement {
  const state = useApi<DriftData>('/api/drift');
  if (state.status === 'loading') return <p className="subtitle">Scanning commits…</p>;
  if (state.status === 'error')
    return (
      <p className="subtitle" role="alert">
        Failed to scan drift: {state.message}
      </p>
    );
  return <DriftView data={state.data} />;
}

/** Pure presentation, testable without a fetch. */
export function DriftView({ data }: { data: DriftData }): ReactElement {
  if (!data.checked) {
    return (
      <div className="card soon-panel">
        <div className="t">Drift unknown</div>
        <div>git could not be consulted here (no repo, or not a work tree).</div>
      </div>
    );
  }

  const clean = data.linkable.length === 0 && data.untracked.length === 0;
  if (clean) {
    return (
      <div className="card">
        <div className="panelbody">
          <p className="q-empty" data-empty="drift">
            No untracked commits — every commit on this branch is tied to a task.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="panelhead">
        <span className="t">Untracked commits</span>
        <span className="sub">
          {data.linkable.length} linkable · {data.untracked.length} task-less
        </span>
      </div>
      <div className="panelbody">
        <div className="rows">
          {data.linkable.map((c) => (
            <div className="lrow" key={c.sha} data-commit={c.sha}>
              <span className="sha">{c.sha}</span>
              <span className="name">{c.subject}</span>
              <span className="cov">
                <span className="pill accent">{c.taskKeys.join(', ')}</span>
              </span>
            </div>
          ))}
          {data.untracked.map((c) => (
            <div className="lrow" key={c.sha} data-commit={c.sha}>
              <span className="sha">{c.sha}</span>
              <span className="name">{c.subject}</span>
              <span className="cov">
                <span className="pill warn">no task</span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
