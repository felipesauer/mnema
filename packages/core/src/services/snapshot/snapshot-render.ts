import type { Snapshot } from './snapshot-service.js';

/**
 * Renders a {@link Snapshot} as markdown — the default, copy-pasteable
 * form. Pure function; no IO.
 *
 * @param s - The composed snapshot
 * @returns A markdown document
 */
export function renderMarkdown(s: Snapshot): string {
  const scopeLabel = `${s.scope.kind} ${s.scope.key}`;
  const lines: string[] = [];
  lines.push(`# Snapshot — ${s.title}`);
  lines.push('');
  lines.push(`_${scopeLabel}_`);
  lines.push('');

  lines.push('## Coverage');
  lines.push('');
  lines.push(
    `- **${s.coverage.percent}% complete** — ${s.coverage.terminal}/${s.coverage.total} terminal`,
  );
  if (s.coverage.blocked > 0) lines.push(`- ${s.coverage.blocked} blocked`);
  const byState = Object.entries(s.coverage.byState)
    .sort((a, b) => b[1] - a[1])
    .map(([state, n]) => `${state} ${n}`)
    .join(' · ');
  if (byState.length > 0) lines.push(`- By state: ${byState}`);
  lines.push('');

  lines.push('## Dependencies');
  lines.push('');
  if (s.graph.cycles.length > 0) {
    lines.push(`- ⚠️ **${s.graph.cycles.length} cycle(s)** — critical path suppressed:`);
    for (const cycle of s.graph.cycles) lines.push(`  - ${cycle.join(' → ')}`);
  } else if (s.graph.criticalPath.length > 0) {
    lines.push(
      `- Critical path (${s.graph.criticalPath.length}): ${s.graph.criticalPath.join(' → ')}`,
    );
  } else {
    lines.push('- No blocking chain.');
  }
  lines.push(`- ${s.graph.ready.length} ready · ${s.graph.blockedCount} blocked`);
  lines.push('');

  lines.push('## SLA breaches');
  lines.push('');
  if (s.slaBreaches.length === 0) {
    lines.push('- None.');
  } else {
    for (const b of s.slaBreaches) {
      lines.push(`- **${b.key}** (${b.state}) — ${b.age_days}d / SLA ${b.sla_days}d`);
    }
  }
  lines.push('');

  if (s.coverage.open.length > 0) {
    lines.push('## Still open');
    lines.push('');
    lines.push(s.coverage.open.map((k) => `\`${k}\``).join(', '));
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

/**
 * Renders a {@link Snapshot} as a self-contained HTML document — no
 * external assets, inline CSS, safe to write to a file and open or
 * attach. Pure function; no IO.
 *
 * @param s - The composed snapshot
 * @returns A complete HTML document
 */
export function renderHtml(s: Snapshot): string {
  const scopeLabel = `${s.scope.kind} ${s.scope.key}`;
  const byState = Object.entries(s.coverage.byState)
    .sort((a, b) => b[1] - a[1])
    .map(([state, n]) => `<span class="pill">${esc(state)} ${n}</span>`)
    .join(' ');

  const depBody =
    s.graph.cycles.length > 0
      ? `<p class="warn">⚠️ ${s.graph.cycles.length} cycle(s) — critical path suppressed</p>` +
        `<ul>${s.graph.cycles.map((c) => `<li>${c.map(esc).join(' → ')}</li>`).join('')}</ul>`
      : s.graph.criticalPath.length > 0
        ? `<p>Critical path (${s.graph.criticalPath.length}): <code>${s.graph.criticalPath.map(esc).join(' → ')}</code></p>`
        : '<p class="muted">No blocking chain.</p>';

  const slaBody =
    s.slaBreaches.length === 0
      ? '<p class="muted">None.</p>'
      : `<ul>${s.slaBreaches
          .map(
            (b) =>
              `<li><strong>${esc(b.key)}</strong> <span class="muted">(${esc(b.state)})</span> — ${b.age_days}d / SLA ${b.sla_days}d</li>`,
          )
          .join('')}</ul>`;

  // Self-contained: inline styles only, no external requests.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Snapshot — ${esc(s.title)}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; padding: 2rem 1.25rem; font: 15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #1a1a1a; background: #fafafa; max-width: 760px; margin-inline: auto; }
  h1 { font-size: 1.6rem; margin: 0 0 .25rem; }
  h2 { font-size: 1.05rem; margin: 1.6rem 0 .5rem; border-bottom: 1px solid #e3e3e3; padding-bottom: .25rem; }
  .scope { color: #777; font-size: .85rem; margin: 0 0 1rem; }
  .big { font-size: 2rem; font-weight: 700; }
  .pill { display: inline-block; background: #ececec; border-radius: 999px; padding: 1px 9px; font-size: .8rem; margin: 2px 2px 2px 0; }
  code { background: #ececec; padding: 1px 5px; border-radius: 3px; font-size: .85em; }
  .muted { color: #888; }
  .warn { color: #a8360c; font-weight: 600; }
  ul { margin: .3rem 0; padding-left: 1.2rem; }
  li { margin: .2rem 0; }
</style>
</head>
<body>
<h1>${esc(s.title)}</h1>
<p class="scope">${esc(scopeLabel)}</p>
<h2>Coverage</h2>
<p><span class="big">${s.coverage.percent}%</span> complete — ${s.coverage.terminal}/${s.coverage.total} terminal${s.coverage.blocked > 0 ? ` · ${s.coverage.blocked} blocked` : ''}</p>
<p>${byState}</p>
<h2>Dependencies</h2>
${depBody}
<p class="muted">${s.graph.ready.length} ready · ${s.graph.blockedCount} blocked</p>
<h2>SLA breaches</h2>
${slaBody}
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
