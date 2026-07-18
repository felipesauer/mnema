import type { ReactElement } from 'react';

import type { AgentsData } from './contract.js';
import { useApi } from './useApi.js';

/**
 * Agents panel. Surfaces orphaned (stale-open)
 * agent runs from the /api/agents read (the existing orphan-run service).
 *
 * Note: a full "all runs with diff" list is intentionally NOT here — the
 * AgentRunService exposes summarize/findById/findChildren but no list-all, so
 * a complete run feed would need a new service method (backend capability,
 * beyond this slice's read-only projection). Orphan detection is the actionable
 * signal available today.
 */
export function Agents(): ReactElement {
  const state = useApi<AgentsData>('/api/agents');
  if (state.status === 'loading') return <p className="subtitle">Loading runs…</p>;
  if (state.status === 'error')
    return (
      <p className="subtitle" role="alert">
        Failed to load runs: {state.message}
      </p>
    );
  return <AgentsView data={state.data} />;
}

/** Pure presentation, testable without a fetch. */
export function AgentsView({ data }: { data: AgentsData }): ReactElement {
  return (
    <div className="card">
      <div className="panelhead">
        <span className="t">Orphaned runs</span>
        <span className="sub">open &gt; {data.thresholdHours}h</span>
      </div>
      <div className="panelbody">
        {data.orphans.length === 0 ? (
          <p className="q-empty" data-empty="orphans">
            No orphaned runs — every agent run was closed within {data.thresholdHours}h.
          </p>
        ) : (
          <div className="rows">
            {data.orphans.map((o) => (
              <div className="lrow" key={o.id} data-orphan={o.id}>
                <span className="key">{o.id.slice(0, 8)}</span>
                <span className="name">{o.goal}</span>
                <span className="cov">
                  <span className="pill warn">open {o.ageHours}h</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
