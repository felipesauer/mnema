import { describe, expect, it } from 'vitest';

import {
  barChart,
  donut,
  gauge,
  lineChart,
  nodeLink,
  scatter,
} from '@/services/dashboard/dashboard-charts.js';
import type { DependencyGraph } from '@/services/snapshot/dependency-graph-service.js';

/** Every chart must be self-contained SVG: no external refs of any kind. */
function assertSelfContained(svg: string): void {
  expect(svg).not.toMatch(/https?:\/\//);
  expect(svg).not.toContain('<image');
  expect(svg).not.toMatch(/\shref=/);
  expect(svg).not.toContain('src=');
}

describe('donut', () => {
  it('renders a self-contained ring with the center label', () => {
    const svg = donut(
      [
        { label: 'Terminal', value: 3, color: 'var(--ok)' },
        { label: 'Open', value: 1, color: 'var(--track)' },
      ],
      '75%',
    );
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('75%');
    assertSelfContained(svg);
  });

  it('does not divide by zero on an all-empty input', () => {
    const svg = donut([], '0%');
    expect(svg).toContain('<circle');
    expect(svg).not.toContain('NaN');
  });

  it('escapes a malicious segment label in the title', () => {
    const svg = donut([{ label: '<script>x', value: 1, color: 'var(--ok)' }], 'x');
    expect(svg).not.toContain('<script>x');
    expect(svg).toContain('&lt;script&gt;x');
  });
});

describe('barChart', () => {
  it('renders bars and an empty-state note', () => {
    expect(barChart([])).toContain('No data');
    const svg = barChart([
      { label: 'A', value: 5 },
      { label: 'B', value: 2, threshold: 3 },
    ]);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('<rect');
    assertSelfContained(svg);
  });

  it('does not produce NaN geometry when all values are zero', () => {
    const svg = barChart([{ label: 'Z', value: 0 }]);
    expect(svg).not.toContain('NaN');
  });
});

describe('lineChart', () => {
  it('renders a polyline for a series', () => {
    const svg = lineChart([
      { label: '2026-01-01', value: 1 },
      { label: '2026-01-02', value: 3 },
    ]);
    expect(svg).toContain('<polyline');
    assertSelfContained(svg);
  });

  it('degrades to a note on empty input', () => {
    expect(lineChart([])).toContain('No activity');
  });
});

describe('scatter', () => {
  it('plots points and a y=x reference', () => {
    const svg = scatter([{ x: 3, y: 4, label: 'T-1' }]);
    expect(svg).toContain('<circle');
    assertSelfContained(svg);
  });

  it('degrades to a note on empty input', () => {
    expect(scatter([])).toContain('No completed tasks');
  });
});

describe('gauge', () => {
  it('clamps the value into [0,1] and shows the display text', () => {
    const svg = gauge(1.5, '150%');
    expect(svg).toContain('150%');
    expect(svg).not.toContain('NaN');
    assertSelfContained(svg);
  });
});

describe('nodeLink', () => {
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

  it('renders nodes, an edge, and is self-contained', () => {
    const svg = nodeLink(graph());
    expect(svg).toContain('<svg');
    expect(svg).toContain('>A<');
    expect(svg).toContain('>B<');
    expect(svg).toContain('<path'); // the blocks edge
    assertSelfContained(svg);
  });

  it('degrades to a note on an empty graph', () => {
    expect(nodeLink(graph({ nodes: [] }))).toContain('No tasks');
  });

  it('terminates on a cyclic graph (layout cycle guard)', () => {
    // A cycle in blockedBy must not hang the layout DFS.
    const svg = nodeLink(
      graph({
        nodes: [
          { key: 'A', state: 'READY', terminal: false, blockedBy: ['B'], blocks: ['B'] },
          { key: 'B', state: 'READY', terminal: false, blockedBy: ['A'], blocks: ['A'] },
        ],
        cycles: [['A', 'B', 'A']],
        criticalPath: [],
      }),
    );
    expect(svg).toContain('<svg');
  });

  it('highlights only adjacent critical-path edges, not a shortcut edge', () => {
    // Path A→B→C, plus a shortcut edge A→C. Only A→B and B→C are critical;
    // A→C must render as a normal (track) edge, not accent.
    const svg = nodeLink(
      graph({
        nodes: [
          { key: 'A', state: 'READY', terminal: false, blockedBy: [], blocks: ['B', 'C'] },
          { key: 'B', state: 'READY', terminal: false, blockedBy: ['A'], blocks: ['C'] },
          { key: 'C', state: 'READY', terminal: false, blockedBy: ['A', 'B'], blocks: [] },
        ],
        frontier: { ready: ['A'], blocked: [] },
        criticalPath: ['A', 'B', 'C'],
      }),
    );
    // Three edges total; exactly two are accent-stroked (the adjacent pair).
    const accentEdges = (svg.match(/stroke="var\(--accent\)" stroke-width="2\.5"/g) ?? []).length;
    expect(accentEdges).toBe(2);
  });

  it('escapes a malicious node key', () => {
    const svg = nodeLink(
      graph({
        nodes: [{ key: '<script>', state: 'READY', terminal: false, blockedBy: [], blocks: [] }],
        frontier: { ready: [], blocked: [] },
        criticalPath: [],
      }),
    );
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
  });
});
