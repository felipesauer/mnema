import { type ReactElement, useEffect, useState } from 'react';

import type { DashboardContract } from './contract.js';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: DashboardContract };

/**
 * Minimal SPA shell (MNEMA-331): fetches the `/api/dashboard` JSON contract on
 * mount and renders a placeholder layout with the panel regions the later
 * tasks fill in — Needs-you (291), Graph (290), Charts (292). No styling
 * framework, no external asset: the offline-first posture (ADR-8/ADR-65) is a
 * hard constraint, so everything ships inside the bundle.
 */
export function App(): ReactElement {
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    fetch('./api/dashboard')
      .then((res) => {
        if (!res.ok) throw new Error(`/api/dashboard returned ${res.status}`);
        return res.json() as Promise<DashboardContract>;
      })
      .then((data) => {
        if (!cancelled) setState({ status: 'ready', data });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({ status: 'error', message: err instanceof Error ? err.message : String(err) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === 'loading') {
    return <main>Loading…</main>;
  }
  if (state.status === 'error') {
    return <main role="alert">Failed to load dashboard: {state.message}</main>;
  }

  const { data } = state;
  return (
    <main>
      <header>
        <h1>mnema · {data.projectKey}</h1>
        <p>
          Snapshot {data.generatedAt} · window {data.window}
          {data.schemaDrift ? ' · schema drift' : ''}
        </p>
      </header>

      {/* Panel regions — placeholders the follow-up tasks replace. */}
      <section aria-label="Needs you" data-panel="needs-you">
        <h2>Needs you</h2>
        <p>
          {data.inbox.awaitingReview.length} awaiting review · {data.inbox.blocked.length} blocked ·{' '}
          {data.inbox.pendingDecisions} pending decisions
        </p>
      </section>

      <section aria-label="Dependency graph" data-panel="graph">
        <h2>Graph</h2>
        <p>{data.graph.nodes.length} nodes · critical path {data.graph.criticalPath.length}</p>
      </section>

      <section aria-label="Activity" data-panel="charts">
        <h2>Activity</h2>
        <p>{data.series.activityByDay.length} days of activity</p>
      </section>
    </main>
  );
}
