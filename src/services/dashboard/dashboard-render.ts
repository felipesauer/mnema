import type { IntegrityCheck } from '../integrity/audit-integrity.js';
import { barChart, donut, gauge, lineChart, nodeLink, scatter } from './dashboard-charts.js';
import type { DashboardData, RecentEvent } from './dashboard-data.js';

/**
 * Renders the live dashboard: a dark, tabbed, self-contained page whose
 * charts are inline SVG (no external asset, no chart library). The page is
 * built from a {@link DashboardData} snapshot; the per-tab fragments are
 * ALSO what the server's JSON routes return, so the initial shell and the
 * live refresh never diverge.
 *
 * Security note: every interpolated value goes through {@link esc}, which
 * additionally strips CR/LF so a recorded value cannot break the SSE
 * framing used to push live rows.
 */

/** HTML escaping that also neutralises line terminators (SSE-safe). */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/[\r\n]+/g, ' ');
}

/**
 * The chain verdict, using the SAME severity-aware rule as `mnema doctor`
 * and `audit_verify`: only an error-severity failed check breaks it; a
 * warning stays a warning; an empty list is intact.
 */
function isIntact(checks: readonly IntegrityCheck[]): boolean {
  return !checks.some((c) => !c.ok && (c.severity ?? 'error') === 'error');
}

/** Coverage donut segments derived from the graph nodes (no collection). */
function coverageDonut(data: DashboardData): string {
  const nodes = data.graph.nodes;
  const total = nodes.length;
  const terminal = nodes.filter((n) => n.terminal).length;
  const percent = total === 0 ? 0 : Math.round((terminal / total) * 100);
  return donut(
    [
      { label: 'Terminal', value: terminal, color: 'var(--ok)' },
      { label: 'Open', value: total - terminal, color: 'var(--track)' },
    ],
    `${percent}%`,
  );
}

/** A small labeled metric tile. */
function tile(label: string, value: string, sub = ''): string {
  const subLine = sub === '' ? '' : `<div class="tile-sub">${esc(sub)}</div>`;
  return `<div class="tile"><div class="tile-value">${esc(value)}</div><div class="tile-label">${esc(label)}</div>${subLine}</div>`;
}

/** A card wrapper with a heading. */
function card(title: string, body: string, extraClass = ''): string {
  return `<section class="card ${extraClass}"><h2>${esc(title)}</h2>${body}</section>`;
}

function hours(v: number | null): string {
  return v === null ? '—' : `${v}h`;
}

/** The chain verdict pill for the top bar. */
export function renderChainPill(integrity: readonly IntegrityCheck[]): string {
  return isIntact(integrity)
    ? '<span class="pill ok">chain intact</span>'
    : '<span class="pill bad">chain NOT intact</span>';
}

/** The drift banner, or empty when the schema is current. */
function renderDrift(schemaDrift: boolean): string {
  return schemaDrift
    ? '<div class="banner warn">⚠️ Schema drift: pending migrations. Run <code>mnema migrate</code>; figures are read from the current shape.</div>'
    : '';
}

// ── Tab bodies. Each is pure and returned both in the shell and by the
// matching JSON route, so a refresh swaps identical markup. ──

/** Overview: coverage, flow tiles, WIP, SLA, chain checks. */
export function renderOverviewTab(d: DashboardData): string {
  const cov = card('Coverage', `<div class="center">${coverageDonut(d)}</div>`);

  const flowTiles = card(
    'Flow',
    `<div class="tiles">
${tile('Throughput', String(d.flow.throughput), `in ${d.window}`)}
${tile('Lead time', hours(d.flow.lead_time.median_hours), 'median')}
${tile('Cycle time', hours(d.flow.cycle_time.median_hours), 'median')}
${tile('Reopen rate', `${Math.round(d.flow.reopen.rate * 100)}%`, `${d.flow.reopen.reopened_tasks}/${d.flow.reopen.completed_tasks}`)}
</div>`,
  );

  const wip = card(
    'WIP vs limit',
    d.inbox.wipBreaches.length === 0
      ? '<p class="muted">Within limits.</p>'
      : barChart(
          d.inbox.wipBreaches.map((w) => ({
            label: w.state,
            value: w.count,
            threshold: w.limit,
            color: 'var(--warn)',
          })),
        ),
  );

  const sla = card(
    'SLA aging',
    d.inbox.slaBreaches.length === 0
      ? '<p class="muted">None overdue.</p>'
      : barChart(
          d.inbox.slaBreaches.slice(0, 10).map((b) => ({
            label: b.key,
            value: b.age_days,
            threshold: b.sla_days,
            color: 'var(--bad)',
          })),
        ),
  );

  const chain = card(
    'Audit chain',
    `<ul class="checks">${d.integrity
      .map((c) => {
        const cls = c.ok ? 'ok' : c.severity === 'warning' ? 'warn' : 'bad';
        const mark = c.ok ? '✓' : c.severity === 'warning' ? '⚠' : '✗';
        return `<li class="${cls}"><span class="mark">${mark}</span> <strong>${esc(c.name)}</strong> — ${esc(c.detail)}</li>`;
      })
      .join('')}</ul>`,
  );

  return `${renderDrift(d.schemaDrift)}<div class="grid">${cov}${flowTiles}${wip}${sla}${chain}</div>`;
}

/** Flow: velocity, reopen gauge, estimate-vs-actual, throughput line, skills. */
export function renderFlowTab(d: DashboardData): string {
  const velocity = card(
    'Velocity',
    d.flow.velocity.length === 0
      ? '<p class="muted">No completed sprints yet.</p>'
      : barChart(
          d.flow.velocity
            .slice(0, 8)
            .map((v) => ({ label: v.sprint_key, value: v.completed_points })),
        ),
  );

  const reopen = card(
    'Reopen rate',
    `<div class="center">${gauge(d.flow.reopen.rate, `${Math.round(d.flow.reopen.rate * 100)}%`)}</div>`,
  );

  const eva = card(
    'Estimate vs actual',
    `<div class="center">${scatter(
      d.flow.estimate_vs_actual.samples.map((s) => ({
        x: s.estimate,
        y: s.actual_hours,
        label: s.task_key,
        color: s.actual_source === 'run_duration' ? 'var(--accent)' : 'var(--warn)',
      })),
    )}</div><p class="muted">accent = measured run duration · amber = lead-time fallback</p>`,
  );

  const throughput = card('Throughput over time', lineChart(d.series.throughputByDay));

  const adoption = card(
    'Skill adoption',
    `<div class="center">${gauge(
      Math.min(1, d.flow.skill_adoption.used_vs_recorded ?? 0),
      d.flow.skill_adoption.used_vs_recorded === null
        ? '—'
        : `${d.flow.skill_adoption.used}/${d.flow.skill_adoption.recorded}`,
    )}</div><p class="muted">used vs recorded</p>`,
  );

  return `<div class="grid">${velocity}${throughput}${reopen}${adoption}${eva}</div>`;
}

/** Activity: events-by-kind, activity line, and the live feed with filters. */
export function renderActivityTab(d: DashboardData): string {
  const byKind = card(
    'Events by kind',
    barChart(d.series.eventsByKind.slice(0, 12).map((p) => ({ label: p.label, value: p.value }))),
  );
  const overTime = card('Activity over time', lineChart(d.series.activityByDay));
  const feed = card(
    'Live activity',
    `<div class="filters">
<input id="filter-text" type="search" placeholder="filter…" aria-label="filter activity" />
</div>
${renderRecentTable(d.recent)}`,
    'span-2',
  );
  return `<div class="grid">${byKind}${overTime}${feed}</div>`;
}

/** Graph: the dependency node-link diagram + frontier summary. */
export function renderGraphTab(d: DashboardData): string {
  const g = d.graph;
  const summary =
    g.cycles.length > 0
      ? `<p class="warn">⚠️ ${g.cycles.length} cycle(s) — critical path suppressed</p>`
      : g.criticalPath.length > 0
        ? `<p>Critical path (${g.criticalPath.length}): <code>${g.criticalPath.map(esc).join(' → ')}</code></p>`
        : '<p class="muted">No blocking chain.</p>';
  const frontier = `<p class="muted">${g.frontier.ready.length} ready · ${g.frontier.blocked.length} blocked</p>`;
  return `<div class="grid"><section class="card span-2"><h2>Dependency graph</h2>${summary}${frontier}${nodeLink(g)}
<p class="legend"><span class="dot ok"></span>terminal <span class="dot accent"></span>ready <span class="dot bad"></span>blocked <span class="dot track"></span>other · <span class="accent-line"></span> critical path</p>
</section></div>`;
}

/** Renders one recent-activity table row (shared by shell + SSE push). */
export function renderEventRow(e: RecentEvent): string {
  const key = e.key !== undefined ? `<code>${esc(e.key)}</code>` : '<span class="muted">—</span>';
  const via = e.via !== undefined ? esc(e.via) : '<span class="muted">—</span>';
  // data-* attributes let the client filter rows without re-fetching.
  return `<tr data-kind="${esc(e.kind)}" data-actor="${esc(e.actor)}"><td class="muted mono">${esc(e.at)}</td><td><code>${esc(e.kind)}</code></td><td>${key}</td><td>${esc(e.actor)}</td><td>${via}</td></tr>`;
}

/** The recent-activity table with a stable `#trail-body` insertion target. */
function renderRecentTable(recent: readonly RecentEvent[]): string {
  const rows = [...recent].reverse().map(renderEventRow).join('');
  return `<div class="trail-wrap"><table class="trail">
<thead><tr><th>When</th><th>Event</th><th>Key</th><th>Who</th><th>Via</th></tr></thead>
<tbody id="trail-body">${rows}</tbody>
</table></div>`;
}

/** The four tabs, keyed by id — the single source both shell and routes use. */
export function renderTabBody(tab: string, d: DashboardData): string {
  switch (tab) {
    case 'flow':
      return renderFlowTab(d);
    case 'activity':
      return renderActivityTab(d);
    case 'graph':
      return renderGraphTab(d);
    default:
      return renderOverviewTab(d);
  }
}

/**
 * Renders the full live dashboard document: dark tokens, top bar, tab bar,
 * the four tab sections, and one inline SSE client. Self-contained — no
 * external requests.
 *
 * @param d - The composed dashboard data
 * @returns A complete HTML document
 */
export function renderLiveShell(d: DashboardData): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(d.projectKey)} — dashboard</title>
<style>
${DASHBOARD_CSS}
</style>
</head>
<body>
<header class="topbar">
  <div class="brand"><span class="live-dot" id="live-dot"></span>${esc(d.projectKey)} <span class="muted" id="live-status">live</span></div>
  <div class="topbar-right">${renderChainPill(d.integrity)} <span class="muted">${esc(d.window)} window</span></div>
</header>
<nav class="tabs" role="tablist" aria-label="Dashboard sections">
  <button class="tab active" role="tab" id="tab-overview" data-tab="overview" aria-selected="true" aria-controls="pane-overview" tabindex="0">Overview</button>
  <button class="tab" role="tab" id="tab-flow" data-tab="flow" aria-selected="false" aria-controls="pane-flow" tabindex="-1">Flow</button>
  <button class="tab" role="tab" id="tab-activity" data-tab="activity" aria-selected="false" aria-controls="pane-activity" tabindex="-1">Activity</button>
  <button class="tab" role="tab" id="tab-graph" data-tab="graph" aria-selected="false" aria-controls="pane-graph" tabindex="-1">Graph</button>
</nav>
<main>
  <section class="tabpane active" id="pane-overview" role="tabpanel" aria-labelledby="tab-overview" data-tab="overview" tabindex="0">${renderOverviewTab(d)}</section>
  <section class="tabpane" id="pane-flow" role="tabpanel" aria-labelledby="tab-flow" data-tab="flow" tabindex="0" hidden>${renderFlowTab(d)}</section>
  <section class="tabpane" id="pane-activity" role="tabpanel" aria-labelledby="tab-activity" data-tab="activity" tabindex="0" hidden>${renderActivityTab(d)}</section>
  <section class="tabpane" id="pane-graph" role="tabpanel" aria-labelledby="tab-graph" data-tab="graph" tabindex="0" hidden>${renderGraphTab(d)}</section>
</main>
<script>
${LIVE_CLIENT_SCRIPT}
</script>
</body>
</html>
`;
}

/** Dark-first token system; light via prefers-color-scheme. */
const DASHBOARD_CSS = `:root {
  --bg: #14161a; --panel: #1c1f26; --fg: #e6e8ec; --muted: #8b93a1;
  --track: #333a45; --accent: #4c9ffe; --ok: #2ea043; --warn: #d29922; --bad: #f85149;
  --on-node: #0b0d10; --border: #2a2e37;
  color-scheme: dark;
}
@media (prefers-color-scheme: light) {
  :root {
    --bg: #fafafa; --panel: #ffffff; --fg: #1a1a1a; --muted: #6b7280;
    --track: #d6dbe1; --accent: #1f6feb; --ok: #1a7f37; --warn: #9a6700; --bad: #b00020;
    --on-node: #ffffff; --border: #e3e6ea;
    color-scheme: light;
  }
}
* { box-sizing: border-box; }
body { margin: 0; font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: var(--fg); background: var(--bg); }
.topbar { display: flex; align-items: center; justify-content: space-between; padding: .75rem 1.25rem; border-bottom: 1px solid var(--border); position: sticky; top: 0; background: var(--bg); z-index: 5; }
.brand { font-weight: 700; font-size: 1.05rem; }
.topbar-right { display: flex; align-items: center; gap: .6rem; font-size: .85rem; }
.live-dot { display: inline-block; width: .6em; height: .6em; border-radius: 50%; background: var(--ok); margin-right: .35em; vertical-align: middle; }
.muted { color: var(--muted); }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
code { background: var(--panel); border: 1px solid var(--border); padding: 0 4px; border-radius: 3px; font-size: .85em; }
.pill { display: inline-block; border-radius: 999px; padding: 2px 10px; font-size: .78rem; font-weight: 600; }
.pill.ok { background: color-mix(in srgb, var(--ok) 22%, transparent); color: var(--ok); }
.pill.bad { background: color-mix(in srgb, var(--bad) 22%, transparent); color: var(--bad); }
.tabs { display: flex; gap: .25rem; padding: .5rem 1.25rem 0; border-bottom: 1px solid var(--border); position: sticky; top: 49px; background: var(--bg); z-index: 4; }
.tab { background: none; border: none; border-bottom: 2px solid transparent; color: var(--muted); font: inherit; padding: .5rem .9rem; cursor: pointer; border-radius: 6px 6px 0 0; }
.tab:hover { color: var(--fg); background: var(--panel); }
.tab.active { color: var(--fg); border-bottom-color: var(--accent); }
.tab:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
main { padding: 1.25rem; max-width: 1100px; margin-inline: auto; }
.tabpane { display: none; }
.tabpane.active { display: block; }
.tabpane[hidden] { display: none; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1rem; }
.card { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 1rem 1.1rem; }
.card.span-2 { grid-column: 1 / -1; }
.card h2 { font-size: .95rem; margin: 0 0 .75rem; color: var(--fg); }
.center { display: flex; justify-content: center; }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: .75rem; }
.tile { background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: .6rem .7rem; }
.tile-value { font-size: 1.5rem; font-weight: 700; }
.tile-label { font-size: .75rem; color: var(--muted); }
.tile-sub { font-size: .7rem; color: var(--muted); }
.banner { border-radius: 8px; padding: .5rem .75rem; margin-bottom: 1rem; }
.banner.warn { background: color-mix(in srgb, var(--warn) 18%, transparent); border: 1px solid var(--warn); }
ul.checks { list-style: none; margin: 0; padding: 0; }
ul.checks li { margin: .3rem 0; }
.checks .ok { color: var(--ok); } .checks .warn { color: var(--warn); } .checks .bad { color: var(--bad); }
.mark { display: inline-block; width: 1.1em; }
.warn { color: var(--warn); }
.filters { margin-bottom: .6rem; }
.filters input { background: var(--bg); border: 1px solid var(--border); color: var(--fg); border-radius: 6px; padding: .35rem .6rem; width: 220px; font: inherit; }
.trail-wrap { overflow-x: auto; }
table.trail { border-collapse: collapse; width: 100%; font-size: .82rem; }
table.trail th { text-align: left; border-bottom: 1px solid var(--border); padding: .3rem .5rem; white-space: nowrap; color: var(--muted); }
table.trail td { border-bottom: 1px solid var(--border); padding: .3rem .5rem; vertical-align: top; }
.graph-scroll { overflow-x: auto; }
.legend { font-size: .78rem; color: var(--muted); margin-top: .6rem; }
.legend .dot { display: inline-block; width: .7em; height: .7em; border-radius: 50%; margin: 0 .2em 0 .6em; vertical-align: middle; }
.legend .dot.ok { background: var(--ok); } .legend .dot.accent { background: var(--accent); } .legend .dot.bad { background: var(--bad); } .legend .dot.track { background: var(--track); }
.legend .accent-line { display: inline-block; width: 1.4em; height: 2px; background: var(--accent); vertical-align: middle; margin: 0 .2em 0 .6em; }
tr.flash { animation: flash 1s ease-out; }
@keyframes flash { from { background: color-mix(in srgb, var(--accent) 30%, transparent); } to { background: transparent; } }
@media (prefers-reduced-motion: reduce) { tr.flash { animation: none; } }`;

/**
 * The inline live client. One script, no external requests. Handles:
 *  - keyboard-operable tabs (WAI-ARIA pattern: click, arrows, Home/End,
 *    roving tabindex, hidden panels);
 *  - SSE feed prepend on the Activity tab (never a fragment swap there, so
 *    live rows are not destroyed mid-flight);
 *  - dirty-gated, single-in-flight refresh of the OTHER tabs' charts;
 *  - a client-side text filter over the feed.
 */
const LIVE_CLIENT_SCRIPT = `(function () {
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var ORDER = ['overview', 'flow', 'activity', 'graph'];
  var current = 'overview';
  var dirty = false;          // an event arrived since the visible tab last rendered
  var inflight = false;       // a chart refetch is in progress

  var tabs = Array.prototype.slice.call(document.querySelectorAll('.tab'));
  function tabEl(name) { return document.getElementById('tab-' + name); }
  function paneEl(name) { return document.getElementById('pane-' + name); }

  function show(name) {
    tabs.forEach(function (t) {
      var on = t.getAttribute('data-tab') === name;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.setAttribute('tabindex', on ? '0' : '-1');
    });
    ORDER.forEach(function (n) {
      var p = paneEl(n);
      if (!p) return;
      var on = n === name;
      p.classList.toggle('active', on);
      if (on) p.removeAttribute('hidden'); else p.setAttribute('hidden', '');
    });
  }

  function activate(name, focus) {
    current = name;
    show(name);
    var t = tabEl(name);
    if (focus && t) t.focus();
    // The Activity feed updates live via SSE; the other tabs hold charts
    // that only change when new events land — refetch them, but only when
    // something is actually dirty, and never the Activity pane (a swap
    // there would drop rows the SSE handler just prepended).
    if (name !== 'activity' && dirty) refreshTab(name);
    else if (name === 'activity') applyFilter();
  }

  tabs.forEach(function (t) {
    t.addEventListener('click', function () { activate(t.getAttribute('data-tab'), false); });
    t.addEventListener('keydown', function (e) {
      var i = ORDER.indexOf(t.getAttribute('data-tab'));
      var next = -1;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % ORDER.length;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i - 1 + ORDER.length) % ORDER.length;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = ORDER.length - 1;
      if (next !== -1) { e.preventDefault(); activate(ORDER[next], true); }
    });
  });

  // Fetch the visible tab's fragment and swap its pane. Guarded so at most
  // one request is in flight; a burst collapses to a single trailing fetch.
  function refreshTab(name) {
    if (inflight) { dirty = true; return; }
    inflight = true;
    dirty = false;
    fetch(name, { headers: { 'accept': 'text/html' } })
      .then(function (r) { return r.ok ? r.text() : null; })
      .then(function (html) {
        var pane = paneEl(name);
        if (html !== null && pane) pane.innerHTML = html;
      })
      .catch(function () {})
      .then(function () {
        inflight = false;
        // If more events arrived during the fetch, and this tab is still
        // visible and not Activity, catch up once.
        if (dirty && current === name && name !== 'activity') refreshTab(name);
      });
  }

  var timer = null;
  function scheduleRefresh() {
    dirty = true;
    if (current === 'activity') return; // feed already updated in place
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () { refreshTab(current); }, 300);
  }

  // Client-side activity filter (text over the row's kind/actor/key/time).
  function applyFilter() {
    var input = document.getElementById('filter-text');
    if (!input) return;
    var q = input.value.trim().toLowerCase();
    var rows = document.querySelectorAll('#trail-body tr');
    rows.forEach(function (row) {
      var hit = q === '' || row.textContent.toLowerCase().indexOf(q) !== -1;
      row.style.display = hit ? '' : 'none';
    });
  }
  document.addEventListener('input', function (e) {
    if (e.target && e.target.id === 'filter-text') applyFilter();
  });

  // SSE: prepend new rows to the feed; mark other tabs dirty.
  var es = new EventSource('stream');
  var dot = document.getElementById('live-dot');
  var status = document.getElementById('live-status');
  es.onopen = function () { if (status) status.textContent = 'live'; if (dot) dot.style.background = 'var(--ok)'; };
  es.onerror = function () { if (status) status.textContent = 'reconnecting…'; if (dot) dot.style.background = 'var(--bad)'; };
  es.onmessage = function (ev) {
    var body = document.getElementById('trail-body');
    if (body && ev.data) {
      body.insertAdjacentHTML('afterbegin', ev.data);
      if (!reduce && body.firstElementChild) body.firstElementChild.classList.add('flash');
      applyFilter();
    }
    scheduleRefresh();
  };
})();`;
