import type { DependencyGraph } from '../snapshot/dependency-graph-service.js';
import type { SeriesPoint } from './dashboard-series.js';

/**
 * A tiny, dependency-free inline-SVG chart kit. Every function is pure and
 * returns a self-contained `<svg>` string with NO external references
 * (no `<image>`, no `href`, no CDN) so the dashboard stays self-contained
 * and the "no external request" guarantee holds. Colors are passed in via
 * CSS custom properties (`var(--...)`) resolved by the page theme, so the
 * same chart adapts to dark/light without re-rendering.
 */

/** Escapes text placed into SVG/HTML (matches the renderer's esc). */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/[\r\n]+/g, ' ');
}

/** Rounds to at most 2 decimals without trailing zeros. */
function num(n: number): string {
  return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : '0';
}

/** A labeled slice for {@link donut}. */
export interface DonutSegment {
  readonly label: string;
  readonly value: number;
  /** A CSS color (e.g. `var(--accent)` or a semantic token). */
  readonly color: string;
}

/**
 * A donut chart. Renders segments proportional to value with a hole in
 * the middle showing the headline (e.g. the percent). Empty input renders
 * an empty ring, never a divide-by-zero.
 */
export function donut(segments: readonly DonutSegment[], centerLabel: string): string {
  const size = 160;
  const r = 60;
  const stroke = 22;
  const cx = size / 2;
  const cy = size / 2;
  const circ = 2 * Math.PI * r;
  const total = segments.reduce((s, seg) => s + Math.max(0, seg.value), 0);

  let offset = 0;
  const rings =
    total <= 0
      ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--track)" stroke-width="${stroke}"/>`
      : segments
          .filter((s) => s.value > 0)
          .map((s) => {
            const frac = s.value / total;
            const len = frac * circ;
            const dash = `${num(len)} ${num(circ - len)}`;
            const dashoffset = num(-offset);
            offset += len;
            return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${esc(s.color)}" stroke-width="${stroke}" stroke-dasharray="${dash}" stroke-dashoffset="${dashoffset}" transform="rotate(-90 ${cx} ${cy})"><title>${esc(s.label)}: ${s.value}</title></circle>`;
          })
          .join('');

  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="${esc(centerLabel)}">
${rings}
<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" font-size="26" font-weight="700" fill="var(--fg)">${esc(centerLabel)}</text>
</svg>`;
}

/** A labeled bar for {@link barChart}. */
export interface Bar {
  readonly label: string;
  readonly value: number;
  /** Optional threshold drawn as a marker line (e.g. a WIP limit or SLA). */
  readonly threshold?: number;
  /** Optional per-bar color; defaults to the accent. */
  readonly color?: string;
}

/**
 * A horizontal bar chart — good for velocity, WIP-vs-limit, events-by-kind,
 * SLA aging. Bars scale to the largest value (or the largest threshold).
 * Renders an empty-state note when there is nothing to show.
 */
export function barChart(bars: readonly Bar[]): string {
  if (bars.length === 0) return '<p class="muted">No data.</p>';
  const rowH = 26;
  const gap = 8;
  const labelW = 130;
  const barW = 300;
  const width = labelW + barW + 40;
  const height = bars.length * (rowH + gap) + gap;
  const max = Math.max(1, ...bars.map((b) => Math.max(b.value, b.threshold ?? 0)));

  const rows = bars
    .map((b, i) => {
      const y = gap + i * (rowH + gap);
      const w = Math.max(0, (b.value / max) * barW);
      const color = b.color ?? 'var(--accent)';
      const thresholdMark =
        b.threshold !== undefined
          ? `<line x1="${labelW + (b.threshold / max) * barW}" y1="${y - 1}" x2="${labelW + (b.threshold / max) * barW}" y2="${y + rowH + 1}" stroke="var(--bad)" stroke-width="2" stroke-dasharray="3 2"><title>limit ${b.threshold}</title></line>`
          : '';
      return `<g>
<text x="0" y="${y + rowH / 2}" dominant-baseline="central" font-size="12" fill="var(--muted)">${esc(b.label)}</text>
<rect x="${labelW}" y="${y}" width="${num(w)}" height="${rowH}" rx="3" fill="${esc(color)}"><title>${esc(b.label)}: ${b.value}</title></rect>
<text x="${labelW + num(w) + 6}" y="${y + rowH / 2}" dominant-baseline="central" font-size="12" fill="var(--fg)">${b.value}</text>
${thresholdMark}
</g>`;
    })
    .join('');

  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img" aria-label="bar chart" preserveAspectRatio="xMinYMin meet">${rows}</svg>`;
}

/**
 * A line chart for a time series (throughput/day, activity/day). Draws a
 * filled area under the line with an emphasized last point. Flat/empty
 * input degrades gracefully.
 */
export function lineChart(series: readonly SeriesPoint[]): string {
  if (series.length === 0) return '<p class="muted">No activity in this window.</p>';
  const width = 480;
  const height = 140;
  const padX = 8;
  const padY = 12;
  const max = Math.max(1, ...series.map((p) => p.value));
  const n = series.length;
  const stepX = n > 1 ? (width - 2 * padX) / (n - 1) : 0;
  const x = (i: number): number => padX + i * stepX;
  const y = (v: number): number => height - padY - (v / max) * (height - 2 * padY);

  const pts = series.map((p, i) => `${num(x(i))},${num(y(p.value))}`).join(' ');
  const area = `${num(padX)},${num(height - padY)} ${pts} ${num(x(n - 1))},${num(height - padY)}`;
  const last = series[n - 1] ?? { label: '', value: 0 };

  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img" aria-label="line chart" preserveAspectRatio="none">
<polygon points="${area}" fill="var(--accent)" opacity="0.14"/>
<polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
<circle cx="${num(x(n - 1))}" cy="${num(y(last.value))}" r="3.5" fill="var(--accent)"><title>${esc(last.label)}: ${last.value}</title></circle>
</svg>`;
}

/** A point for {@link scatter}. */
export interface ScatterPoint {
  readonly x: number;
  readonly y: number;
  readonly label: string;
  readonly color?: string;
}

/**
 * A scatter plot (estimate vs actual). Auto-scales both axes; draws a
 * faint y=x reference so over/under-estimation reads at a glance.
 */
export function scatter(points: readonly ScatterPoint[]): string {
  if (points.length === 0) return '<p class="muted">No completed tasks with an estimate yet.</p>';
  const size = 220;
  const pad = 24;
  const maxX = Math.max(1, ...points.map((p) => p.x));
  const maxY = Math.max(1, ...points.map((p) => p.y));
  const max = Math.max(maxX, maxY);
  const sx = (v: number): number => pad + (v / max) * (size - 2 * pad);
  const sy = (v: number): number => size - pad - (v / max) * (size - 2 * pad);

  const dots = points
    .map(
      (p) =>
        `<circle cx="${num(sx(p.x))}" cy="${num(sy(p.y))}" r="4" fill="${esc(p.color ?? 'var(--accent)')}" opacity="0.85"><title>${esc(p.label)}: est ${p.x}, actual ${num(p.y)}h</title></circle>`,
    )
    .join('');

  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="estimate vs actual">
<line x1="${pad}" y1="${size - pad}" x2="${size - pad}" y2="${pad}" stroke="var(--muted)" stroke-width="1" stroke-dasharray="4 3" opacity="0.5"><title>y = x</title></line>
<line x1="${pad}" y1="${pad}" x2="${pad}" y2="${size - pad}" stroke="var(--track)" stroke-width="1"/>
<line x1="${pad}" y1="${size - pad}" x2="${size - pad}" y2="${size - pad}" stroke="var(--track)" stroke-width="1"/>
${dots}
</svg>`;
}

/**
 * A radial gauge for a 0..1 ratio (reopen rate, skill adoption). `value`
 * is clamped to [0, 1]; `display` is the text shown in the middle.
 */
export function gauge(value: number, display: string): string {
  const v = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  const size = 140;
  const r = 52;
  const stroke = 16;
  const cx = size / 2;
  const cy = size / 2;
  const circ = 2 * Math.PI * r;
  const len = v * circ;
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="${esc(display)}">
<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--track)" stroke-width="${stroke}"/>
<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--accent)" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${num(len)} ${num(circ - len)}" transform="rotate(-90 ${cx} ${cy})"/>
<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" font-size="20" font-weight="700" fill="var(--fg)">${esc(display)}</text>
</svg>`;
}

/**
 * A dependency node-link diagram. Nodes are placed in columns by their
 * depth along the longest blocks-chain (a deterministic layered layout, no
 * physics): a task sits one column right of the deepest task that blocks
 * it. Edges are `blocks` relations; the critical path is highlighted.
 * Nodes are colored by terminal/blocked/ready/other via CSS tokens.
 *
 * Falls back to a note when the graph is empty; when a cycle exists the
 * critical path is empty (upstream guarantee) so nothing is highlighted.
 */
export function nodeLink(graph: DependencyGraph): string {
  const nodes = graph.nodes;
  if (nodes.length === 0) return '<p class="muted">No tasks in the graph.</p>';

  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const critical = new Set(graph.criticalPath);
  const ready = new Set(graph.frontier.ready);
  const blocked = new Set(graph.frontier.blocked.map((b) => b.key));
  // Adjacent pairs on the critical path, as `from>to`, so only the edges
  // that are actually consecutive in the path get highlighted — a shortcut
  // edge between two path members that are not neighbours must not read as
  // critical.
  const criticalEdges = new Set<string>();
  for (let i = 0; i + 1 < graph.criticalPath.length; i += 1) {
    criticalEdges.add(`${graph.criticalPath[i]}>${graph.criticalPath[i + 1]}`);
  }

  // Column = longest chain of blockers ending at this node. Memoized DFS
  // over `blockedBy`; cycles (rare, upstream-detected) are guarded so the
  // layout still terminates.
  const depthCache = new Map<string, number>();
  const visiting = new Set<string>();
  function depth(key: string): number {
    const cached = depthCache.get(key);
    if (cached !== undefined) return cached;
    if (visiting.has(key)) return 0; // cycle guard
    visiting.add(key);
    const node = byKey.get(key);
    let d = 0;
    if (node !== undefined) {
      for (const b of node.blockedBy) {
        if (byKey.has(b)) d = Math.max(d, depth(b) + 1);
      }
    }
    visiting.delete(key);
    depthCache.set(key, d);
    return d;
  }

  const columns = new Map<number, string[]>();
  for (const n of nodes) {
    const d = depth(n.key);
    const col = columns.get(d) ?? [];
    col.push(n.key);
    columns.set(d, col);
  }

  const colW = 150;
  const rowH = 44;
  const nodeW = 116;
  const nodeH = 28;
  const padX = 12;
  const padY = 12;
  const maxCol = Math.max(...columns.keys());
  const maxRows = Math.max(...[...columns.values()].map((c) => c.length));
  const width = padX * 2 + (maxCol + 1) * colW;
  const height = padY * 2 + maxRows * rowH;

  const pos = new Map<string, { x: number; y: number }>();
  for (const [col, keys] of columns) {
    keys.forEach((key, row) => {
      pos.set(key, { x: padX + col * colW, y: padY + row * rowH });
    });
  }

  // Edges: from each node to the nodes it blocks.
  const edges: string[] = [];
  for (const n of nodes) {
    const from = pos.get(n.key);
    if (from === undefined) continue;
    for (const target of n.blocks) {
      const to = pos.get(target);
      if (to === undefined) continue;
      const onCritical = criticalEdges.has(`${n.key}>${target}`);
      const x1 = from.x + nodeW;
      const y1 = from.y + nodeH / 2;
      const x2 = to.x;
      const y2 = to.y + nodeH / 2;
      const midX = (x1 + x2) / 2;
      edges.push(
        `<path d="M ${num(x1)} ${num(y1)} C ${num(midX)} ${num(y1)}, ${num(midX)} ${num(y2)}, ${num(x2)} ${num(y2)}" fill="none" stroke="${onCritical ? 'var(--accent)' : 'var(--track)'}" stroke-width="${onCritical ? 2.5 : 1.5}" opacity="${onCritical ? 1 : 0.6}"/>`,
      );
    }
  }

  const boxes = nodes
    .map((n) => {
      const p = pos.get(n.key);
      if (p === undefined) return '';
      const fill = n.terminal
        ? 'var(--ok)'
        : blocked.has(n.key)
          ? 'var(--bad)'
          : ready.has(n.key)
            ? 'var(--accent)'
            : 'var(--track)';
      const onCritical = critical.has(n.key);
      return `<g><rect x="${p.x}" y="${p.y}" width="${nodeW}" height="${nodeH}" rx="5" fill="${fill}" opacity="0.85" stroke="${onCritical ? 'var(--accent)' : 'none'}" stroke-width="${onCritical ? 2 : 0}"><title>${esc(n.key)} (${esc(n.state)})</title></rect>
<text x="${p.x + nodeW / 2}" y="${p.y + nodeH / 2}" text-anchor="middle" dominant-baseline="central" font-size="11" font-weight="600" fill="var(--on-node)">${esc(n.key)}</text></g>`;
    })
    .join('');

  return `<div class="graph-scroll"><svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="dependency graph">
${edges.join('\n')}
${boxes}
</svg></div>`;
}
