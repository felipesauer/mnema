import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { DashboardGraph, GraphNode } from '@/dashboard/contract.js';
import { Graph } from '@/dashboard/Graph.js';

/**
 * MNEMA-290 — the dependency-graph panel. The legacy graph stacked ~90% of
 * nodes (the singletons with no edge) into a giant vertical wall. The fix:
 * plot ONLY the connected subgraph, summarise singletons aside, and put it in
 * a pan/zoom viewport. Rendered via react-dom/server (no jsdom); we assert the
 * structural guarantees, not pixel layout.
 */

function node(key: string, over: Partial<GraphNode> = {}): GraphNode {
  return { key, state: 'READY', terminal: false, blockedBy: [], blocks: [], ...over };
}

function graph(over: Partial<DashboardGraph> = {}): DashboardGraph {
  return {
    scope: { kind: 'project' },
    nodes: [],
    cycles: [],
    frontier: { ready: [], blocked: [] },
    criticalPath: [],
    ...over,
  };
}

describe('Graph panel', () => {
  it('plots only the connected subgraph and keeps singletons out of the SVG', () => {
    const nodes = [
      node('A', { blocks: ['B'] }),
      node('B', { blockedBy: ['A'] }),
      node('LONE1'),
      node('LONE2'),
      node('LONE3'),
    ];
    const html = renderToStaticMarkup(<Graph graph={graph({ nodes })} />);
    // Connected nodes are drawn as SVG nodes…
    expect(html).toContain('data-node="A"');
    expect(html).toContain('data-node="B"');
    // …singletons are NOT drawn (no wall), only summarised aside.
    expect(html).not.toContain('data-node="LONE1"');
    expect(html).toContain('data-count="connected">2<');
    expect(html).toContain('data-count="singletons">3<');
    // The aside lists the unconnected tasks.
    expect(html).toContain('LONE1 · READY');
  });

  it('lays a blocker before the tasks it blocks (depth increases along an edge)', () => {
    const nodes = [node('A', { blocks: ['B'] }), node('B', { blockedBy: ['A'] })];
    const html = renderToStaticMarkup(<Graph graph={graph({ nodes })} />);
    // A is a root (depth 0); B is blocked by A (depth 1).
    expect(html).toMatch(/data-node="A"[^>]*data-depth="0"/);
    expect(html).toMatch(/data-node="B"[^>]*data-depth="1"/);
  });

  it('does not hang on a dependency cycle and reports it', () => {
    const nodes = [
      node('X', { blocks: ['Y'], blockedBy: ['Y'] }),
      node('Y', { blocks: ['X'], blockedBy: ['X'] }),
    ];
    const html = renderToStaticMarkup(<Graph graph={graph({ nodes, cycles: [['X', 'Y', 'X']] })} />);
    expect(html).toContain('data-count="cycles">1<');
    expect(html).toContain('data-node="X"');
    expect(html).toContain('data-node="Y"');
  });

  it('shows an empty state when there are no edges', () => {
    const html = renderToStaticMarkup(<Graph graph={graph({ nodes: [node('A'), node('B')] })} />);
    expect(html).toContain('nothing to plot');
    expect(html).not.toContain('data-viewport="graph"');
  });
});
