import { type ReactElement, useEffect, useState } from 'react';

import { Charts } from './Charts.js';
import type { DashboardContract } from './contract.js';
import { Graph } from './Graph.js';
import {
  IconActivity,
  IconAgents,
  IconAudit,
  IconBoard,
  IconCheck,
  IconDecisions,
  IconDrift,
  IconEpics,
  IconGraph,
  IconMetrics,
  IconNeeds,
  IconOverview,
  IconSearch,
  IconSkills,
  IconTheme,
} from './icons.js';
import { NeedsYou } from './NeedsYou.js';
import { Overview } from './Overview.js';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: DashboardContract };

/**
 * Dashboard shell (MNEMA-ADR-67, slice 1). The design-system frame every module
 * lives in: a module-grouped rail with the always-visible chain-integrity card,
 * a header with search + theme toggle, and a content area that switches views.
 *
 * This slice ships the frame + the three existing panels (Needs-you, Graph,
 * Charts) restyled into the system. The other modules are declared in the rail
 * and render a "coming soon" placeholder — the later slices fill them in. All
 * data still comes from the single /api/dashboard contract.
 */

interface NavItem {
  readonly id: string;
  readonly label: string;
  readonly Icon: () => ReactElement;
  readonly badge?: (d: DashboardContract) => number;
  readonly ready?: boolean;
}
interface NavGroup {
  readonly label?: string;
  readonly items: readonly NavItem[];
}

const NAV: readonly NavGroup[] = [
  { items: [{ id: 'overview', label: 'Overview', Icon: IconOverview, ready: true }] },
  {
    label: 'Work',
    items: [
      {
        id: 'needs',
        label: 'Needs you',
        Icon: IconNeeds,
        ready: true,
        badge: (d) =>
          d.inbox.awaitingReview.length + d.inbox.blocked.length + d.inbox.pendingDecisions,
      },
      { id: 'board', label: 'Board', Icon: IconBoard },
      { id: 'epics', label: 'Epics & sprints', Icon: IconEpics },
      { id: 'graph', label: 'Graph', Icon: IconGraph, ready: true },
    ],
  },
  {
    label: 'Flow',
    items: [
      { id: 'metrics', label: 'Metrics', Icon: IconMetrics },
      { id: 'activity', label: 'Activity', Icon: IconActivity, ready: true },
    ],
  },
  {
    label: 'Integrity',
    items: [
      { id: 'audit', label: 'Audit trail', Icon: IconAudit },
      { id: 'drift', label: 'Drift', Icon: IconDrift },
    ],
  },
  {
    label: 'Knowledge',
    items: [
      { id: 'decisions', label: 'Decisions', Icon: IconDecisions },
      { id: 'skills', label: 'Skills & memory', Icon: IconSkills },
    ],
  },
  { label: 'Agents', items: [{ id: 'agents', label: 'Runs', Icon: IconAgents }] },
];

export function App(): ReactElement {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [view, setView] = useState('overview');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/dashboard')
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

  const data = state.status === 'ready' ? state.data : null;

  return (
    <div className="app">
      <Rail data={data} view={view} onNavigate={setView} />
      <div className="main">
        <Header />
        <div className="content">
          {state.status === 'loading' && <p className="subtitle">Loading…</p>}
          {state.status === 'error' && (
            <p className="subtitle" role="alert">
              Failed to load dashboard: {state.message}
            </p>
          )}
          {data && <Content view={view} data={data} />}
        </div>
      </div>
    </div>
  );
}

function toggleTheme(): void {
  const root = document.documentElement;
  root.setAttribute('data-theme', root.getAttribute('data-theme') === 'light' ? 'dark' : 'light');
}

function Header(): ReactElement {
  return (
    <div className="header">
      <div className="search">
        <IconSearch /> Search tasks, decisions, skills… <kbd>⌘K</kbd>
      </div>
      <button type="button" className="themetoggle" aria-label="Toggle theme" onClick={toggleTheme}>
        <IconTheme />
      </button>
    </div>
  );
}

function Rail({
  data,
  view,
  onNavigate,
}: {
  data: DashboardContract | null;
  view: string;
  onNavigate: (id: string) => void;
}): ReactElement {
  return (
    <aside className="rail">
      <div className="brand">
        <div className="mark">m</div>
        <div>
          <div className="name">mnema</div>
          <div className="proj">{data?.projectKey ?? '…'}</div>
        </div>
      </div>

      {NAV.map((group, gi) => (
        <div className="modgroup" key={group.label ?? `g${gi}`}>
          {group.label && <div className="gl">{group.label}</div>}
          {group.items.map((item) => {
            const badge = data && item.badge ? item.badge(data) : 0;
            return (
              <button
                type="button"
                key={item.id}
                className={`nav-i${view === item.id ? ' active' : ''}`}
                onClick={() => onNavigate(item.id)}
              >
                <span className="ic">
                  <item.Icon />
                </span>
                {item.label}
                {badge > 0 && <span className="badge">{badge}</span>}
                {item.ready !== true && <span className="soon">soon</span>}
              </button>
            );
          })}
        </div>
      ))}

      <ChainIntegrity data={data} />
    </aside>
  );
}

function ChainIntegrity({ data }: { data: DashboardContract | null }): ReactElement {
  const checks = data?.integrity ?? [];
  const broken = checks.some((c) => !c.ok);
  const eventCount = checks.find((c) => /event count/i.test(c.name));
  return (
    <div className={`integrity${broken ? ' broken' : ''}`}>
      <div className="head">
        <span className="icon">
          <IconCheck />
        </span>
        <span className="label">{broken ? 'Chain needs attention' : 'Chain verified'}</span>
      </div>
      <div className="body">
        {checks.slice(0, 3).map((c) => (
          <div className="row" key={c.name}>
            <span className="k">{c.name}</span>
            <span className={`v ${c.ok ? 'ok' : 'bad'}`}>{c.ok ? 'ok' : 'fail'}</span>
          </div>
        ))}
        {checks.length === 0 && <div className="row">
          <span className="k">verifying…</span>
        </div>}
        {eventCount && <div className="hash">{eventCount.detail.slice(0, 60)}</div>}
      </div>
    </div>
  );
}

/** A module the later slices build out. */
function ComingSoon({ label }: { label: string }): ReactElement {
  return (
    <div className="card soon-panel">
      <div className="t">{label}</div>
      <div>This module is part of the dashboard redesign and lands in an upcoming slice.</div>
    </div>
  );
}

function Content({ view, data }: { view: string; data: DashboardContract }): ReactElement {
  switch (view) {
    case 'overview':
      return <Overview data={data} />;
    case 'needs':
      return (
        <>
          <h1>Needs you</h1>
          <p className="subtitle">
            The human-attention queues — awaiting review, blocked, and pending decisions.
          </p>
          <NeedsYou inbox={data.inbox} />
        </>
      );
    case 'graph':
      return (
        <>
          <h1>Dependency graph</h1>
          <p className="subtitle">
            The connected subgraph and critical path; singletons summarised aside.
          </p>
          <Graph graph={data.graph} />
        </>
      );
    case 'activity':
      return (
        <>
          <h1>Activity</h1>
          <p className="subtitle">Event volume by kind and over time.</p>
          <Charts series={data.series} />
        </>
      );
    default: {
      const label = NAV.flatMap((g) => g.items).find((i) => i.id === view)?.label ?? view;
      return (
        <>
          <h1>{label}</h1>
          <p className="subtitle">Coming soon.</p>
          <ComingSoon label={label} />
        </>
      );
    }
  }
}
