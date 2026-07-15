import { type ReactElement, useMemo, useRef, useState } from 'react';

import type { DashboardGraph, GraphNode } from './contract.js';

/**
 * Dependency-graph panel (MNEMA-290). The legacy string-rendered graph drew a
 * fixed-height SVG that stacked the ~90% of nodes with no blocking relation
 * into a ~10,700px vertical wall. This panel fixes the class of bug two ways:
 *
 *  - it renders ONLY the connected subgraph (nodes with at least one
 *    blocks/blockedBy edge) plus the critical path — the singletons are
 *    summarised aside, never drawn, so the canvas size tracks the real
 *    dependency structure, not the task count;
 *  - the SVG lives in a pan/zoom viewport (wheel to zoom, drag to pan) instead
 *    of a fixed-height image, so it stays usable as the project grows.
 *
 * No graph library — a hand-rolled layered layout keeps the offline-first
 * bundle small (ADR-8). Layout is deterministic: nodes are placed in columns
 * by their longest-blocker depth, so an edge always points left→right.
 */
export function Graph({ graph }: { graph: DashboardGraph }): ReactElement {
  const { connected, singletons, positions, depthOf } = useMemo(
    () => layout(graph.nodes),
    [graph.nodes],
  );
  const criticalPath = new Set(graph.criticalPath);

  return (
    <section aria-label="Dependency graph" data-panel="graph">
      <div className="card">
        <div className="panelhead">
          <span className="t">Connected subgraph</span>
          <span className="sub">
            <span data-count="connected">{connected.length}</span> connected ·{' '}
            <span data-count="singletons">{singletons.length}</span> aside ·{' '}
            crit <span data-count="critical-path">{graph.criticalPath.length}</span>
            {graph.cycles.length > 0 ? (
              <>
                {' · '}
                <span data-count="cycles">{graph.cycles.length}</span> cycle(s)
              </>
            ) : null}
          </span>
        </div>
        <div className="panelbody">
          {connected.length === 0 ? (
            <p className="q-empty" data-empty="true">
              No dependency edges yet — nothing to plot.
            </p>
          ) : (
            <>
              <Viewport>
                <GraphSvg
                  connected={connected}
                  positions={positions}
                  depthOf={depthOf}
                  criticalPath={criticalPath}
                />
              </Viewport>
              <div className="glegend">
                <span>
                  <i className="crit" /> critical path
                </span>
                <span>
                  <i /> blocks edge
                </span>
              </div>
            </>
          )}

          {singletons.length > 0 && (
            <details className="gaside" data-aside="singletons">
              <summary>{singletons.length} unconnected task(s)</summary>
              <ul>
                {singletons.map((n) => (
                  <li key={n.key}>
                    {n.key} · {n.state}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </div>
    </section>
  );
}

/** A node's placement in the layered layout. */
interface Pos {
  readonly x: number;
  readonly y: number;
}

const COL_W = 180;
const ROW_H = 48;
const NODE_W = 150;
const NODE_H = 30;

/**
 * Splits nodes into connected (has an edge) vs singletons, and lays the
 * connected ones out in columns by longest-blocker depth (a topological
 * layering; cycles fall back to depth 0 so the layout still terminates).
 */
function layout(nodes: readonly GraphNode[]): {
  connected: GraphNode[];
  singletons: GraphNode[];
  positions: Map<string, Pos>;
  depthOf: Map<string, number>;
} {
  const connected: GraphNode[] = [];
  const singletons: GraphNode[] = [];
  for (const n of nodes) {
    if (n.blockedBy.length > 0 || n.blocks.length > 0) connected.push(n);
    else singletons.push(n);
  }

  const byKey = new Map(connected.map((n) => [n.key, n]));
  const depthOf = new Map<string, number>();
  // Longest-blocker depth with cycle guard: a node currently on the stack
  // resolves to 0 rather than recursing forever.
  const onStack = new Set<string>();
  function depth(key: string): number {
    const cached = depthOf.get(key);
    if (cached !== undefined) return cached;
    if (onStack.has(key)) return 0;
    const node = byKey.get(key);
    if (node === undefined) return 0;
    onStack.add(key);
    let d = 0;
    for (const b of node.blockedBy) {
      if (byKey.has(b)) d = Math.max(d, depth(b) + 1);
    }
    onStack.delete(key);
    depthOf.set(key, d);
    return d;
  }
  for (const n of connected) depth(n.key);

  // Assign a row within each column, stable by key order.
  const rowInCol = new Map<number, number>();
  const positions = new Map<string, Pos>();
  for (const n of [...connected].sort((a, b) => a.key.localeCompare(b.key))) {
    const col = depthOf.get(n.key) ?? 0;
    const row = rowInCol.get(col) ?? 0;
    rowInCol.set(col, row + 1);
    positions.set(n.key, { x: col * COL_W, y: row * ROW_H });
  }
  return { connected, singletons, positions, depthOf };
}

/** Wheel-zoom + drag-pan viewport around arbitrary SVG children. */
function Viewport({ children }: { children: ReactElement }): ReactElement {
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const drag = useRef<{ x: number; y: number } | null>(null);

  return (
    <div
      className="gcanvas"
      data-viewport="graph"
      onWheel={(e) => {
        e.preventDefault();
        setScale((s) => Math.min(4, Math.max(0.2, s * (e.deltaY < 0 ? 1.1 : 0.9))));
      }}
      onPointerDown={(e) => {
        drag.current = { x: e.clientX - tx, y: e.clientY - ty };
        (e.target as Element).setPointerCapture?.(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (drag.current === null) return;
        setTx(e.clientX - drag.current.x);
        setTy(e.clientY - drag.current.y);
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
    >
      <svg width="100%" height="100%" role="img" aria-label="dependency graph viewport">
        <g transform={`translate(${tx},${ty}) scale(${scale})`}>{children}</g>
      </svg>
      <span className="hint">drag to pan · scroll to zoom</span>
    </div>
  );
}

/** The nodes + edges of the connected subgraph, critical path highlighted. */
function GraphSvg({
  connected,
  positions,
  depthOf,
  criticalPath,
}: {
  connected: readonly GraphNode[];
  positions: Map<string, Pos>;
  depthOf: Map<string, number>;
  criticalPath: ReadonlySet<string>;
}): ReactElement {
  const edges: ReactElement[] = [];
  for (const n of connected) {
    const from = positions.get(n.key);
    if (from === undefined) continue;
    for (const target of n.blocks) {
      const to = positions.get(target);
      if (to === undefined) continue;
      const onPath = criticalPath.has(n.key) && criticalPath.has(target);
      edges.push(
        <line
          key={`${n.key}->${target}`}
          x1={from.x + NODE_W}
          y1={from.y + NODE_H / 2}
          x2={to.x}
          y2={to.y + NODE_H / 2}
          stroke="currentColor"
          strokeWidth={onPath ? 2 : 1}
          strokeOpacity={onPath ? 1 : 0.4}
        />,
      );
    }
  }

  return (
    <>
      {edges}
      {connected.map((n) => {
        const p = positions.get(n.key);
        if (p === undefined) return null;
        const onPath = criticalPath.has(n.key);
        return (
          <g key={n.key} data-node={n.key} data-depth={depthOf.get(n.key) ?? 0} transform={`translate(${p.x},${p.y})`}>
            <rect
              width={NODE_W}
              height={NODE_H}
              rx={4}
              fill="none"
              stroke="currentColor"
              strokeWidth={onPath ? 2 : 1}
              strokeOpacity={onPath ? 1 : 0.6}
            />
            <text x={6} y={NODE_H / 2 + 4} fontSize={11} fill="currentColor">
              {n.key}
            </text>
          </g>
        );
      })}
    </>
  );
}
