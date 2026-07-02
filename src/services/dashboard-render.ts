import type { IntegrityCheck } from './audit-integrity.js';
import type { DependencyGraph } from './dependency-graph-service.js';
import type { SlaBreach } from './inbox-service.js';

/**
 * Everything the dashboard renders, already read from the existing
 * read-only services by the caller. The renderer is a pure function of
 * this input — no IO, no service access, no data collection. Keeping the
 * read and the render separate is what lets the renderer be unit-tested
 * against fixtures and keeps the "consumes only already-recorded data"
 * guarantee obvious: this module cannot reach a database.
 */
export interface DashboardData {
  /** Project key, for the document title. */
  readonly projectKey: string;
  /** ISO8601 time the dashboard was generated (passed in, not read here). */
  readonly generatedAt: string;
  /** The audit-chain verdict rows from {@link inspectAuditIntegrity}. */
  readonly integrity: readonly IntegrityCheck[];
  /** The project-wide dependency graph. */
  readonly graph: DependencyGraph;
  /** SLA breaches from the inbox, most-overdue first. */
  readonly slaBreaches: readonly SlaBreach[];
  /** The most recent audit events, oldest-first within the window. */
  readonly recent: readonly RecentEvent[];
  /**
   * True when the SQLite schema has pending migrations. Surfaced as a
   * banner so a dashboard read under a drifted schema is not silently
   * trusted (read-only commands are deliberately allowed to run drifted).
   */
  readonly schemaDrift: boolean;
}

/**
 * One row in the recent-activity panel. The caller resolves `actor`/`via`
 * handles to display names (via IdentityService) before rendering, so the
 * renderer stays a pure formatter with no service dependency.
 */
export interface RecentEvent {
  readonly at: string;
  readonly kind: string;
  /** Display name of the responsible human. */
  readonly actor: string;
  /** Display name of the agent that executed the work, when present. */
  readonly via?: string;
  /** The task/decision key this event is about, when derivable. */
  readonly key?: string;
}

/**
 * The chain verdict, using the SAME severity-aware rule as `mnema doctor`
 * and `audit_verify`: a check only breaks the verdict when it is an
 * *error* (`ok:false` with severity `error`, the default). A
 * warning-severity `ok:false` row — e.g. a malformed line while the hash
 * chain itself verifies — does not make the chain "not intact"; it is
 * surfaced as a yellow warning row instead. An empty check list is
 * treated as intact (nothing failed), matching how `[].every`/`[].some`
 * decide it in doctor and audit-verify. Anything else would let the
 * dashboard disagree with the tool users already trust.
 */
function isIntact(checks: readonly IntegrityCheck[]): boolean {
  return !checks.some((c) => !c.ok && (c.severity ?? 'error') === 'error');
}

/** Coverage derived from the graph nodes — no separate collection. */
function coverageFromGraph(graph: DependencyGraph): {
  total: number;
  terminal: number;
  percent: number;
  byState: Array<[string, number]>;
} {
  const total = graph.nodes.length;
  const terminal = graph.nodes.filter((n) => n.terminal).length;
  const percent = total === 0 ? 0 : Math.round((terminal / total) * 100);
  const counts = new Map<string, number>();
  for (const node of graph.nodes) counts.set(node.state, (counts.get(node.state) ?? 0) + 1);
  const byState = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return { total, terminal, percent, byState };
}

/**
 * Renders a {@link DashboardData} as a single self-contained HTML
 * document — inline CSS, no external assets, no script, safe to write to
 * a file and open or attach to a review. Pure function; no IO. Mirrors
 * the idiom of {@link renderHtml} in snapshot-render (esc, color-scheme,
 * pills) so the two views feel like one product.
 *
 * @param d - The composed dashboard data
 * @returns A complete HTML document
 */
export function renderDashboard(d: DashboardData): string {
  const cov = coverageFromGraph(d.graph);
  const intact = isIntact(d.integrity);

  const driftBanner = d.schemaDrift
    ? '<p class="warn banner">⚠️ Schema drift: this database has pending migrations. Run <code>mnema migrate</code>; the figures below are read from the current shape.</p>'
    : '';

  const integrityRows = d.integrity
    .map((c) => {
      const cls = c.ok ? 'ok' : c.severity === 'warning' ? 'warn' : 'bad';
      const mark = c.ok ? '✓' : c.severity === 'warning' ? '⚠' : '✗';
      return `<li class="${cls}"><span class="mark">${mark}</span> <strong>${esc(c.name)}</strong> — ${esc(c.detail)}</li>`;
    })
    .join('');
  const chainVerdict = intact
    ? '<span class="ok">chain intact</span>'
    : '<span class="bad">chain NOT intact</span>';

  const byStatePills = cov.byState
    .map(([state, n]) => `<span class="pill">${esc(state)} ${n}</span>`)
    .join(' ');

  const graphBody =
    d.graph.cycles.length > 0
      ? `<p class="warn">⚠️ ${d.graph.cycles.length} cycle(s) — critical path suppressed</p>` +
        `<ul>${d.graph.cycles.map((c) => `<li>${c.map(esc).join(' → ')}</li>`).join('')}</ul>`
      : d.graph.criticalPath.length > 0
        ? `<p>Critical path (${d.graph.criticalPath.length}): <code>${d.graph.criticalPath.map(esc).join(' → ')}</code></p>`
        : '<p class="muted">No blocking chain.</p>';

  const ready = d.graph.frontier.ready;
  const blocked = d.graph.frontier.blocked;
  const frontierBody =
    `<p class="muted">${ready.length} ready · ${blocked.length} blocked</p>` +
    (ready.length > 0
      ? `<p><strong>Ready:</strong> ${ready.map((k) => `<code>${esc(k)}</code>`).join(' ')}</p>`
      : '') +
    (blocked.length > 0
      ? `<ul>${blocked
          .map(
            (b) =>
              `<li><code>${esc(b.key)}</code> <span class="muted">blocked by</span> ${b.blockedBy.map((k) => `<code>${esc(k)}</code>`).join(' ')}</li>`,
          )
          .join('')}</ul>`
      : '');

  const slaBody =
    d.slaBreaches.length === 0
      ? '<p class="muted">None.</p>'
      : `<ul>${d.slaBreaches
          .map(
            (b) =>
              `<li><strong>${esc(b.key)}</strong> <span class="muted">(${esc(b.state)})</span> — ${b.age_days}d / SLA ${b.sla_days}d</li>`,
          )
          .join('')}</ul>`;

  const recentBody =
    d.recent.length === 0
      ? '<p class="muted">No recorded activity yet.</p>'
      : `<table class="trail">
<thead><tr><th>When</th><th>Event</th><th>Key</th><th>Who</th><th>Via</th></tr></thead>
<tbody>${d.recent
          .map(
            (e) =>
              `<tr><td class="muted mono">${esc(e.at)}</td><td><code>${esc(e.kind)}</code></td><td>${e.key !== undefined ? `<code>${esc(e.key)}</code>` : '<span class="muted">—</span>'}</td><td>${esc(e.actor)}</td><td>${e.via !== undefined ? esc(e.via) : '<span class="muted">—</span>'}</td></tr>`,
          )
          .join('')}</tbody>
</table>`;

  // Self-contained: inline styles only, no external requests, no script.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Dashboard — ${esc(d.projectKey)}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; padding: 2rem 1.25rem; font: 15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #1a1a1a; background: #fafafa; max-width: 900px; margin-inline: auto; }
  h1 { font-size: 1.6rem; margin: 0 0 .25rem; }
  h2 { font-size: 1.05rem; margin: 1.8rem 0 .5rem; border-bottom: 1px solid #e3e3e3; padding-bottom: .25rem; }
  .scope { color: #777; font-size: .85rem; margin: 0 0 1rem; }
  .big { font-size: 2rem; font-weight: 700; }
  .pill { display: inline-block; background: #ececec; border-radius: 999px; padding: 1px 9px; font-size: .8rem; margin: 2px 2px 2px 0; }
  code { background: #ececec; padding: 1px 5px; border-radius: 3px; font-size: .85em; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .muted { color: #888; }
  .ok { color: #1a7f37; }
  .warn { color: #a8360c; font-weight: 600; }
  .bad { color: #b00020; font-weight: 700; }
  .banner { background: #fff3cd; border: 1px solid #ffe69c; border-radius: 6px; padding: .5rem .75rem; }
  ul { margin: .3rem 0; padding-left: 1.2rem; list-style: none; }
  li { margin: .25rem 0; }
  .mark { display: inline-block; width: 1.1em; }
  table.trail { border-collapse: collapse; width: 100%; font-size: .85rem; }
  table.trail th { text-align: left; border-bottom: 1px solid #ccc; padding: .3rem .5rem; }
  table.trail td { border-bottom: 1px solid #eee; padding: .3rem .5rem; vertical-align: top; }
  .verdict { font-size: 1.1rem; font-weight: 700; }
</style>
</head>
<body>
<h1>${esc(d.projectKey)} dashboard</h1>
<p class="scope">Read-only · generated ${esc(d.generatedAt)} · project-wide</p>
${driftBanner}

<h2>Audit chain</h2>
<p class="verdict">${chainVerdict}</p>
<ul>${integrityRows}</ul>

<h2>Coverage</h2>
<p><span class="big">${cov.percent}%</span> complete — ${cov.terminal}/${cov.total} terminal</p>
<p>${byStatePills}</p>

<h2>Dependencies</h2>
${graphBody}
${frontierBody}

<h2>SLA breaches</h2>
${slaBody}

<h2>Recent activity</h2>
${recentBody}
</body>
</html>
`;
}

/** Minimal HTML escaping for interpolated text. */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
