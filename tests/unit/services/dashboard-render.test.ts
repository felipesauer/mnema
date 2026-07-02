import { describe, expect, it } from 'vitest';

import type { IntegrityCheck } from '@/services/audit-integrity.js';
import {
  type DashboardData,
  renderDashboard,
  renderEventRow,
  renderLiveShell,
  renderPanels,
} from '@/services/dashboard-render.js';
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

describe('renderPanels', () => {
  it('renders the four panels plus the drift fragment from shared builders', () => {
    const p = renderPanels(data());
    expect(p.chain).toContain('chain intact');
    expect(p.coverage).toContain('50%');
    expect(p.deps).toContain('Critical path');
    expect(p.sla).toContain('None.');
    expect(p.drift).toBe('');
  });

  it('emits the drift fragment only when the schema has drifted', () => {
    expect(renderPanels(data({ schemaDrift: true })).drift).toContain('Schema drift');
  });

  it('produces the same panel markup the static document embeds', () => {
    // The static doc must not diverge from the live /panels source.
    const d = data();
    const doc = renderDashboard(d);
    const panels = renderPanels(d);
    expect(doc).toContain(panels.chain);
    expect(doc).toContain(panels.coverage);
  });
});

describe('renderEventRow', () => {
  it('renders a table row with resolved dual-identity and key', () => {
    const row = renderEventRow({
      at: '2026-07-01T10:00:00Z',
      kind: 'task_transitioned',
      actor: 'Felipe',
      via: 'Claude',
      key: 'DEMO-1',
    });
    expect(row.startsWith('<tr>')).toBe(true);
    expect(row).toContain('Felipe');
    expect(row).toContain('Claude');
    expect(row).toContain('DEMO-1');
  });

  it('escapes recorded data to prevent injection in a pushed row', () => {
    const row = renderEventRow({ at: 'x', kind: 'k', actor: '<img src=x onerror=1>' });
    expect(row).not.toContain('<img src=x');
    expect(row).toContain('&lt;img');
  });

  it('shows an em dash when there is no via or key', () => {
    const row = renderEventRow({ at: 'x', kind: 'run_started', actor: 'a' });
    expect(row).toContain('—');
  });

  it('neutralises CR/LF so a recorded value cannot break the SSE frame', () => {
    // A bare CR in a free-text field (a display name / key) would otherwise
    // start a new SSE line in the browser and inject a second event.
    const row = renderEventRow({
      at: 'x',
      kind: 'k',
      actor: 'Bob\rdata: <img src=x onerror=alert(1)>',
      key: 'K\nINJECT',
    });
    expect(row).not.toContain('\r');
    expect(row).not.toContain('\n');
    // The payload survives only as escaped, single-line text.
    expect(row).toContain('&lt;img');
  });
});

describe('renderLiveShell', () => {
  it('is self-contained: the only script is the inline SSE client, no external requests', () => {
    const html = renderLiveShell(data());
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toContain('<link');
    // Exactly one <script> — and it has no src attribute (it is inline).
    const scriptTags = html.match(/<script/g) ?? [];
    expect(scriptTags).toHaveLength(1);
    expect(html).not.toMatch(/<script[^>]*\ssrc=/);
  });

  it('wires the EventSource on the stream endpoint and refreshes panels', () => {
    const html = renderLiveShell(data());
    expect(html).toContain("new EventSource('stream')");
    expect(html).toContain("fetch('panels'");
    // Stable insertion target for pushed rows must exist even with no rows.
    expect(html).toContain('id="trail-body"');
  });

  it('always emits the activity table (never the empty-state note) so pushes have a target', () => {
    const html = renderLiveShell(data({ recent: [] }));
    expect(html).toContain('id="trail-body"');
    expect(html).not.toContain('No recorded activity yet');
  });

  it('backfills newest-first so initial rows match the order live pushes prepend in', () => {
    // buildDashboardData yields recent oldest-first; the live shell must
    // reverse it so the newest backfilled row sits at the top, where the
    // next SSE push will also land.
    const html = renderLiveShell(
      data({
        recent: [
          { at: '2026-01-01T00:00:00Z', kind: 'first', actor: 'a', key: 'OLD' },
          { at: '2026-01-02T00:00:00Z', kind: 'second', actor: 'a', key: 'NEW' },
        ],
      }),
    );
    // NEW (newest) must appear before OLD in the document.
    expect(html.indexOf('NEW')).toBeLessThan(html.indexOf('OLD'));
  });
});
