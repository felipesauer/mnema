import { describe, expect, it } from 'vitest';
import type { DashboardData } from '@/services/dashboard/dashboard-data.js';
import {
  renderChainPill,
  renderEventRow,
  renderGraphTab,
  renderLiveShell,
  renderTabBody,
} from '@/services/dashboard/dashboard-render.js';
import type { IntegrityCheck } from '@/services/integrity/audit-integrity.js';
import type { FlowMetrics } from '@/services/metrics/flow-metrics-service.js';
import type { DependencyGraph } from '@/services/snapshot/dependency-graph-service.js';

function graph(overrides: Partial<DependencyGraph> = {}): DependencyGraph {
  return {
    scope: { kind: 'project' },
    nodes: [
      { key: 'A', state: 'DONE', terminal: true, blockedBy: [], blocks: ['B'] },
      { key: 'B', state: 'IN_PROGRESS', terminal: false, blockedBy: ['A'], blocks: [] },
    ],
    cycles: [],
    frontier: { ready: ['B'], blocked: [] },
    criticalPath: ['A', 'B'],
    ...overrides,
  };
}

function flow(overrides: Partial<FlowMetrics> = {}): FlowMetrics {
  return {
    throughput: 4,
    lead_time: { count: 3, avg_hours: 10, median_hours: 8, max_hours: 20 },
    cycle_time: { count: 3, avg_hours: 6, median_hours: 5, max_hours: 12 },
    reopen: { reopened_tasks: 1, completed_tasks: 4, rate: 0.25 },
    velocity: [
      { sprint_key: 'S-1', sprint_name: 'Sprint 1', completed_points: 8, completed_tasks: 3 },
    ],
    estimate_vs_actual: {
      samples: [{ task_key: 'T-1', estimate: 3, actual_hours: 4, actual_source: 'run_duration' }],
      hours_per_point: 1.3,
      run_duration_samples: 1,
      lead_time_fallback_samples: 0,
    },
    skill_adoption: { recorded: 5, used: 3, uses_per_run: 0.5, used_vs_recorded: 0.6 },
    ...overrides,
  };
}

function data(overrides: Partial<DashboardData> = {}): DashboardData {
  return {
    projectKey: 'DEMO',
    generatedAt: '2026-07-02T00:00:00.000Z',
    window: '30d',
    integrity: [{ name: 'audit hash chain', ok: true, detail: 'verified' }],
    graph: graph(),
    recent: [],
    schemaDrift: false,
    flow: flow(),
    inbox: {
      slaBreaches: [],
      wipBreaches: [],
      awaitingReview: [],
      blocked: [],
      pendingDecisions: 0,
    },
    series: { activityByDay: [], throughputByDay: [], eventsByKind: [] },
    ...overrides,
  };
}

describe('renderChainPill', () => {
  it('is intact when only warnings fail', () => {
    const checks: IntegrityCheck[] = [
      { name: 'chain', ok: true, detail: 'ok' },
      { name: 'parse', ok: false, detail: 'one bad line', severity: 'warning' },
    ];
    expect(renderChainPill(checks)).toContain('chain intact');
  });
  it('is NOT intact on an error-severity failure', () => {
    expect(
      renderChainPill([{ name: 'chain', ok: false, detail: 'mismatch', severity: 'error' }]),
    ).toContain('chain NOT intact');
  });
  it('treats empty as intact', () => {
    expect(renderChainPill([])).toContain('chain intact');
  });
});

describe('renderLiveShell', () => {
  it('is a self-contained dark document with one inline script and tabs', () => {
    const html = renderLiveShell(data());
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toContain('<link');
    const scripts = html.match(/<script/g) ?? [];
    expect(scripts).toHaveLength(1);
    expect(html).not.toMatch(/<script[^>]*\ssrc=/);
    // Dark tokens + tabs present.
    expect(html).toContain('color-scheme: dark');
    expect(html).toContain('data-tab="overview"');
    expect(html).toContain('data-tab="flow"');
    expect(html).toContain('data-tab="activity"');
    expect(html).toContain('data-tab="graph"');
    // Live client wiring.
    expect(html).toContain("new EventSource('stream')");
    expect(html).toContain('id="trail-body"');
  });

  it('wires the WAI-ARIA tabs pattern (roles, aria-controls, roving tabindex, keydown)', () => {
    const html = renderLiveShell(data());
    expect(html).toContain('role="tablist"');
    expect(html).toContain('role="tabpanel"');
    expect(html).toContain('aria-controls="pane-overview"');
    expect(html).toContain('aria-labelledby="tab-overview"');
    // Roving tabindex: the active tab is 0, the rest -1.
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('tabindex="-1"');
    // Non-active panes are hidden.
    expect(html).toContain('hidden');
    // Keyboard handling is present in the client.
    expect(html).toContain("addEventListener('keydown'");
    expect(html).toContain('ArrowRight');
  });
});

describe('renderTabBody', () => {
  it('overview shows coverage %, flow tiles and chain checks', () => {
    const html = renderTabBody('overview', data());
    expect(html).toContain('50%'); // 1 of 2 nodes terminal
    expect(html).toContain('Throughput');
    expect(html).toContain('Reopen rate');
    expect(html).toContain('audit hash chain');
  });

  it('flow shows velocity, reopen and estimate-vs-actual', () => {
    const html = renderTabBody('flow', data());
    expect(html).toContain('Velocity');
    expect(html).toContain('Reopen rate');
    expect(html).toContain('Estimate vs actual');
  });

  it('activity shows the filter, an events-by-kind card, and the feed table', () => {
    const html = renderTabBody(
      'activity',
      data({
        series: {
          activityByDay: [],
          throughputByDay: [],
          eventsByKind: [{ label: 'task_created', value: 2 }],
        },
      }),
    );
    expect(html).toContain('id="filter-text"');
    expect(html).toContain('Events by kind');
    expect(html).toContain('id="trail-body"');
  });

  it('graph shows the node-link diagram and critical path', () => {
    const html = renderGraphTab(data());
    expect(html).toContain('Dependency graph');
    expect(html).toContain('Critical path');
    expect(html).toContain('<svg');
  });

  it('unknown tab falls back to overview', () => {
    expect(renderTabBody('nope', data())).toContain('Coverage');
  });

  it('surfaces the drift banner only when drifted', () => {
    expect(renderTabBody('overview', data({ schemaDrift: false }))).not.toContain('Schema drift');
    expect(renderTabBody('overview', data({ schemaDrift: true }))).toContain('Schema drift');
  });
});

describe('renderEventRow', () => {
  it('renders dual-identity and carries filter data attributes', () => {
    const row = renderEventRow({
      at: 'x',
      kind: 'task_transitioned',
      actor: 'Felipe',
      via: 'Claude',
      key: 'DEMO-1',
    });
    expect(row.startsWith('<tr')).toBe(true);
    expect(row).toContain('data-kind="task_transitioned"');
    expect(row).toContain('data-actor="Felipe"');
    expect(row).toContain('DEMO-1');
    expect(row).toContain('Claude');
  });

  it('escapes and neutralises CR/LF so a pushed row cannot break SSE framing', () => {
    const row = renderEventRow({
      at: 'x',
      kind: 'k',
      actor: 'Bob\rdata: <img src=x>',
      key: 'K\nX',
    });
    expect(row).not.toContain('\r');
    expect(row).not.toContain('\n');
    expect(row).toContain('&lt;img');
  });

  it('shows an em dash when via/key are absent', () => {
    expect(renderEventRow({ at: 'x', kind: 'run_started', actor: 'a' })).toContain('—');
  });
});
