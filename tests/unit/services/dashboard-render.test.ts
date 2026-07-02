import { describe, expect, it } from 'vitest';

import type { IntegrityCheck } from '@/services/audit-integrity.js';
import { type DashboardData, renderDashboard } from '@/services/dashboard-render.js';
import type { DependencyGraph } from '@/services/dependency-graph-service.js';

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

function data(overrides: Partial<DashboardData> = {}): DashboardData {
  return {
    projectKey: 'DEMO',
    generatedAt: '2026-07-02T00:00:00.000Z',
    integrity: [{ name: 'audit hash chain', ok: true, detail: 'verified up to abc123…' }],
    graph: graph(),
    slaBreaches: [],
    recent: [],
    schemaDrift: false,
    ...overrides,
  };
}

describe('renderDashboard', () => {
  it('produces a self-contained HTML document with no external requests', () => {
    const html = renderDashboard(data());
    expect(html.startsWith('<!doctype html>')).toBe(true);
    // No external assets of any kind — the whole point of the static view.
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toContain('<script');
    expect(html).not.toContain('src=');
    expect(html).not.toContain('<link');
  });

  it('derives coverage from the graph nodes (no separate collection)', () => {
    const html = renderDashboard(data());
    // 1 of 2 nodes terminal → 50%.
    expect(html).toContain('50%');
    expect(html).toContain('1/2 terminal');
  });

  it('shows the chain verdict as intact when every check passes', () => {
    const html = renderDashboard(data());
    expect(html).toContain('chain intact');
    expect(html).not.toContain('chain NOT intact');
  });

  it('shows the chain verdict as NOT intact when an error-severity check fails', () => {
    const checks: IntegrityCheck[] = [
      { name: 'audit hash chain', ok: false, detail: 'hash mismatch', severity: 'error' },
    ];
    const html = renderDashboard(data({ integrity: checks }));
    expect(html).toContain('chain NOT intact');
  });

  it('keeps the verdict intact when only a warning-severity check fails (matches doctor)', () => {
    // A malformed line while the hash chain itself verifies: doctor prints a
    // yellow warning and still passes. The dashboard must agree — a warning
    // row must NOT flip the headline to red.
    const checks: IntegrityCheck[] = [
      { name: 'audit hash chain', ok: true, detail: 'verified' },
      { name: 'audit lines parse', ok: false, detail: '1 unparseable line', severity: 'warning' },
    ];
    const html = renderDashboard(data({ integrity: checks }));
    expect(html).toContain('chain intact');
    expect(html).not.toContain('chain NOT intact');
  });

  it('treats an empty integrity list as intact (matches audit_verify and doctor)', () => {
    const html = renderDashboard(data({ integrity: [] }));
    expect(html).toContain('chain intact');
    expect(html).not.toContain('chain NOT intact');
  });

  it('surfaces a schema-drift banner only when drift is present', () => {
    expect(renderDashboard(data({ schemaDrift: false }))).not.toContain('Schema drift');
    expect(renderDashboard(data({ schemaDrift: true }))).toContain('Schema drift');
  });

  it('renders cycles and suppresses the critical path when the graph has one', () => {
    const html = renderDashboard(
      data({ graph: graph({ cycles: [['A', 'B', 'A']], criticalPath: [] }) }),
    );
    expect(html).toContain('cycle(s)');
    expect(html).toContain('A → B → A');
    expect(html).not.toContain('Critical path');
  });

  it('renders the dual-identity of a recent event (actor + via)', () => {
    const html = renderDashboard(
      data({
        recent: [
          {
            at: '2026-07-01T10:00:00Z',
            kind: 'task_transitioned',
            actor: 'felipe',
            via: 'claude',
            key: 'DEMO-1',
          },
        ],
      }),
    );
    expect(html).toContain('felipe');
    expect(html).toContain('claude');
    expect(html).toContain('DEMO-1');
    expect(html).toContain('task_transitioned');
  });

  it('escapes interpolated text to prevent HTML injection from recorded data', () => {
    const html = renderDashboard(
      data({
        recent: [{ at: 'x', kind: 'k', actor: '<script>alert(1)</script>', key: '<b>K</b>' }],
      }),
    );
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;b&gt;K&lt;/b&gt;');
  });

  it('reports no activity gracefully when the trail window is empty', () => {
    expect(renderDashboard(data({ recent: [] }))).toContain('No recorded activity yet');
  });
});
