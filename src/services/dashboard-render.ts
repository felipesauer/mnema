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
 * The four aggregate-panel fragments, rendered from {@link DashboardData}.
 * Shared verbatim between the static document ({@link renderDashboard})
 * and the live server's `/panels` endpoint so the two views never drift.
 * Each value is an HTML fragment (no document scaffolding).
 */
export interface DashboardPanels {
  readonly chain: string;
  readonly coverage: string;
  readonly deps: string;
  readonly sla: string;
  /** The drift banner fragment, empty when the schema is current. */
  readonly drift: string;
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

/** The audit-chain panel body: verdict headline + per-check rows. */
function renderChainPanel(integrity: readonly IntegrityCheck[]): string {
  const chainVerdict = isIntact(integrity)
    ? '<span class="ok">chain intact</span>'
    : '<span class="bad">chain NOT intact</span>';
  const rows = integrity
    .map((c) => {
      const cls = c.ok ? 'ok' : c.severity === 'warning' ? 'warn' : 'bad';
      const mark = c.ok ? '✓' : c.severity === 'warning' ? '⚠' : '✗';
      return `<li class="${cls}"><span class="mark">${mark}</span> <strong>${esc(c.name)}</strong> — ${esc(c.detail)}</li>`;
    })
    .join('');
  return `<p class="verdict">${chainVerdict}</p>\n<ul>${rows}</ul>`;
}

/** The coverage panel body: percent complete + per-state pills. */
function renderCoveragePanel(graph: DependencyGraph): string {
  const cov = coverageFromGraph(graph);
  const byStatePills = cov.byState
    .map(([state, n]) => `<span class="pill">${esc(state)} ${n}</span>`)
    .join(' ');
  return `<p><span class="big">${cov.percent}%</span> complete — ${cov.terminal}/${cov.total} terminal</p>\n<p>${byStatePills}</p>`;
}

/** The dependencies panel body: cycles/critical path + ready/blocked frontier. */
function renderDepsPanel(graph: DependencyGraph): string {
  const graphBody =
    graph.cycles.length > 0
      ? `<p class="warn">⚠️ ${graph.cycles.length} cycle(s) — critical path suppressed</p>` +
        `<ul>${graph.cycles.map((c) => `<li>${c.map(esc).join(' → ')}</li>`).join('')}</ul>`
      : graph.criticalPath.length > 0
        ? `<p>Critical path (${graph.criticalPath.length}): <code>${graph.criticalPath.map(esc).join(' → ')}</code></p>`
        : '<p class="muted">No blocking chain.</p>';

  const ready = graph.frontier.ready;
  const blocked = graph.frontier.blocked;
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

  return `${graphBody}\n${frontierBody}`;
}

/** The SLA-breaches panel body. */
function renderSlaPanel(slaBreaches: readonly SlaBreach[]): string {
  return slaBreaches.length === 0
    ? '<p class="muted">None.</p>'
    : `<ul>${slaBreaches
        .map(
          (b) =>
            `<li><strong>${esc(b.key)}</strong> <span class="muted">(${esc(b.state)})</span> — ${b.age_days}d / SLA ${b.sla_days}d</li>`,
        )
        .join('')}</ul>`;
}

/** The schema-drift banner, or empty when the schema is current. */
function renderDriftBanner(schemaDrift: boolean): string {
  return schemaDrift
    ? '<p class="warn banner">⚠️ Schema drift: this database has pending migrations. Run <code>mnema migrate</code>; the figures below are read from the current shape.</p>'
    : '';
}

/**
 * Renders the four aggregate panels plus the drift banner from a
 * {@link DashboardData}. Pure. This is the single source of panel markup:
 * the static document embeds these fragments, and the live server ships
 * the same fragments as JSON over its `/panels` endpoint so the page can
 * refresh in place without a full reload.
 *
 * @param d - The composed dashboard data
 * @returns The panel HTML fragments
 */
export function renderPanels(d: DashboardData): DashboardPanels {
  return {
    chain: renderChainPanel(d.integrity),
    coverage: renderCoveragePanel(d.graph),
    deps: renderDepsPanel(d.graph),
    sla: renderSlaPanel(d.slaBreaches),
    drift: renderDriftBanner(d.schemaDrift),
  };
}

/**
 * Renders one recent-activity table row for a {@link RecentEvent}. Shared
 * by the static table, the live shell's initial rows, and the SSE client
 * (which appends the same markup on each pushed event) so a live row is
 * byte-identical to a reloaded one.
 *
 * @param e - A recent event with handles already resolved to display names
 * @returns A single `<tr>` element
 */
export function renderEventRow(e: RecentEvent): string {
  const key = e.key !== undefined ? `<code>${esc(e.key)}</code>` : '<span class="muted">—</span>';
  const via = e.via !== undefined ? esc(e.via) : '<span class="muted">—</span>';
  return `<tr><td class="muted mono">${esc(e.at)}</td><td><code>${esc(e.kind)}</code></td><td>${key}</td><td>${esc(e.actor)}</td><td>${via}</td></tr>`;
}

/**
 * The recent-activity table (header + rows).
 *
 * @param recent - Events to render, oldest-first (as the query returns them)
 * @param live - When true, two things change for the live shell: (1) the
 *   table is always emitted with a `<tbody id="trail-body">` even with zero
 *   rows, so the SSE client has a stable insertion target; and (2) the
 *   backfilled rows are reversed to newest-first, so they match the order
 *   the client prepends live events in — otherwise the initial rows would
 *   read oldest-at-top while every pushed row lands newest-at-top. The
 *   static document keeps the natural oldest-first order and shows a
 *   friendly empty-state note.
 */
function renderRecentTable(recent: readonly RecentEvent[], live = false): string {
  if (recent.length === 0 && !live) return '<p class="muted">No recorded activity yet.</p>';
  const rows = live ? [...recent].reverse() : recent;
  return `<table class="trail">
<thead><tr><th>When</th><th>Event</th><th>Key</th><th>Who</th><th>Via</th></tr></thead>
<tbody id="trail-body">${rows.map(renderEventRow).join('')}</tbody>
</table>`;
}

/** Shared inline stylesheet for both the static document and the live shell. */
const DASHBOARD_CSS = `  :root { color-scheme: light dark; }
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
  .live-dot { display: inline-block; width: .6em; height: .6em; border-radius: 50%; background: #1a7f37; margin-right: .3em; vertical-align: middle; }
  tr.flash { animation: flash 1s ease-out; }
  @keyframes flash { from { background: #fff3b0; } to { background: transparent; } }
  @media (prefers-reduced-motion: reduce) { tr.flash { animation: none; } }`;

/**
 * Renders a {@link DashboardData} as a single self-contained HTML
 * document — inline CSS, no external assets, no script, safe to write to
 * a file and open or attach to a review. Pure function; no IO. Composes
 * the shared panel builders so it never drifts from the live server.
 *
 * @param d - The composed dashboard data
 * @returns A complete HTML document
 */
export function renderDashboard(d: DashboardData): string {
  const panels = renderPanels(d);
  // Self-contained: inline styles only, no external requests, no script.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Dashboard — ${esc(d.projectKey)}</title>
<style>
${DASHBOARD_CSS}
</style>
</head>
<body>
<h1>${esc(d.projectKey)} dashboard</h1>
<p class="scope">Read-only · generated ${esc(d.generatedAt)} · project-wide</p>
${panels.drift}

<h2>Audit chain</h2>
${panels.chain}

<h2>Coverage</h2>
${panels.coverage}

<h2>Dependencies</h2>
${panels.deps}

<h2>SLA breaches</h2>
${panels.sla}

<h2>Recent activity</h2>
${renderRecentTable(d.recent)}
</body>
</html>
`;
}

/**
 * Renders the LIVE dashboard shell: the same panels as the static
 * document, plus a single inline `<script>` (no external requests) that
 * opens an `EventSource` on `/stream`, prepends each pushed event to the
 * activity table, and refreshes the aggregate panels from `/panels` on
 * change. Every `id`/class the script touches is emitted here so the
 * page is coherent before the first event arrives.
 *
 * The script is inline and asset-free by design — it must never add an
 * external request, to keep the same "nothing leaves the machine"
 * guarantee the static view has.
 *
 * @param d - The composed dashboard data for the initial render
 * @returns A complete HTML document with a live SSE client
 */
export function renderLiveShell(d: DashboardData): string {
  const panels = renderPanels(d);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Live — ${esc(d.projectKey)}</title>
<style>
${DASHBOARD_CSS}
</style>
</head>
<body>
<h1>${esc(d.projectKey)} dashboard</h1>
<p class="scope"><span class="live-dot" id="live-dot"></span><span id="live-status">live</span> · loopback · project-wide</p>
<div id="drift">${panels.drift}</div>

<h2>Audit chain</h2>
<div id="panel-chain">${panels.chain}</div>

<h2>Coverage</h2>
<div id="panel-coverage">${panels.coverage}</div>

<h2>Dependencies</h2>
<div id="panel-deps">${panels.deps}</div>

<h2>SLA breaches</h2>
<div id="panel-sla">${panels.sla}</div>

<h2>Recent activity</h2>
${renderRecentTable(d.recent, true)}
<script>
${LIVE_CLIENT_SCRIPT}
</script>
</body>
</html>
`;
}

/**
 * The inline SSE client. Kept as a plain string (not a bundled asset) so
 * the shell stays self-contained. It reuses the exact row markup the
 * server sends (each SSE `data:` line is a ready-to-insert `<tr>` string),
 * debounces panel refreshes, and degrades quietly if the stream drops
 * (EventSource reconnects on its own).
 */
const LIVE_CLIENT_SCRIPT = `(function () {
  var body = document.getElementById('trail-body');
  var dot = document.getElementById('live-dot');
  var status = document.getElementById('live-status');
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var timer = null;

  function refreshPanels() {
    fetch('panels', { headers: { 'accept': 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (p) {
        if (!p) return;
        setHtml('panel-chain', p.chain);
        setHtml('panel-coverage', p.coverage);
        setHtml('panel-deps', p.deps);
        setHtml('panel-sla', p.sla);
        setHtml('drift', p.drift);
      })
      .catch(function () {});
  }

  function setHtml(id, html) {
    var el = document.getElementById(id);
    if (el && typeof html === 'string') el.innerHTML = html;
  }

  function scheduleRefresh() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(refreshPanels, 250);
  }

  var es = new EventSource('stream');
  es.onopen = function () { if (status) status.textContent = 'live'; if (dot) dot.style.background = '#1a7f37'; };
  es.onerror = function () { if (status) status.textContent = 'reconnecting…'; if (dot) dot.style.background = '#a8360c'; };
  es.onmessage = function (ev) {
    if (body && ev.data) {
      body.insertAdjacentHTML('afterbegin', ev.data);
      if (!reduce && body.firstElementChild) body.firstElementChild.classList.add('flash');
    }
    scheduleRefresh();
  };
})();`;

/**
 * HTML-escapes interpolated text AND neutralises line terminators.
 *
 * Beyond the usual `& < > "`, this collapses CR/LF to a space. That
 * matters specifically for the live server: each pushed row is sent as a
 * single Server-Sent-Events `data:` frame, and the EventSource wire format
 * treats a bare CR, LF, or CRLF as a line boundary. A recorded value
 * carrying a `\r` (display names and event keys are free-text written by
 * any process and are not otherwise sanitised) could otherwise break out
 * of the frame and inject a second event whose markup the client would
 * insert into the DOM. Escaping newlines here closes that at the source,
 * so every consumer — the static document and the SSE stream alike — is
 * safe by construction.
 */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/[\r\n]+/g, ' ');
}
