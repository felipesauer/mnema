/**
 * The page `mnema site` writes: one HTML file with everything in it.
 *
 * NOTHING IS LOADED FROM ELSEWHERE. The style, the verifier and the record's files are
 * inside the file, and a `Content-Security-Policy` in the page says so to the browser: the
 * one script allowed is the verifier, named by its hash, and no request may leave. A record
 * is text people wrote, and the page is where a stranger reads it — so the text is escaped
 * where it is written into the page ({@link escapeHtml}) and, behind that, a title that
 * somehow reached the page as markup would meet a policy that runs no script but ours.
 *
 * THE LISTS ARE WRITTEN HERE AND THE VERDICT IS COMPUTED THERE. The decisions and the raw
 * events are rendered by `mnema site` from the public tree's files; the verdict is computed in
 * the reader's browser from the same files, which travel inside the page. The page does not
 * derive the lists from them again, and says so beside the verdict.
 *
 * The filter is a checkbox and a style rule, not a script: the page shows the decisions in
 * force and a control shows the rest, and that works with the verifier switched off.
 */

import { createHash } from 'node:crypto';

/** One move a decision went through, as the record says it. */
export interface DecisionMove {
  readonly at: string;
  readonly action: string;
  readonly before: string | null;
  readonly to: string;
  readonly who: string;
  readonly which?: string;
  /** What the move said, as the record prints a proof; absent when it carried none. */
  readonly said?: string;
}

/** A decision, with what the page shows of it. */
export interface SiteDecision {
  readonly id: string;
  readonly adr: string;
  readonly title: string;
  readonly rationale: string;
  readonly alternatives?: string;
  readonly state: string;
  /** Whether the record says it governs now (never decided here). */
  readonly inForce: boolean;
  readonly supersedes?: string;
  readonly supersededBy?: string;
  readonly createdAt: string;
  readonly recordedBy?: { readonly who: string; readonly which?: string };
  readonly acceptedBy?: { readonly who: string; readonly which?: string };
  readonly moves: readonly DecisionMove[];
}

/** One tail's stored lines, as they sit in its segment files. */
export interface SiteTail {
  readonly id: string;
  readonly events: number;
  readonly text: string;
}

/** Everything the page is written from. */
export interface SiteModel {
  readonly decisions: readonly SiteDecision[];
  readonly tails: readonly SiteTail[];
  /** The record's files, path under the chain root to base64 — what the verifier reads. */
  readonly files: Readonly<Record<string, string>>;
}

/** Text as it may appear between tags and inside a quoted attribute. */
export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const STYLE = `
:root { color-scheme: light dark; font-family: system-ui, sans-serif; line-height: 1.5; }
body { max-width: 52rem; margin: 2rem auto; padding: 0 1rem; }
h1, h2 { line-height: 1.2; }
code, pre { font-family: ui-monospace, monospace; font-size: 0.85em; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; }
code { overflow-wrap: anywhere; }
#verdict { border: 2px solid; padding: 0.75rem 1rem; border-radius: 0.5rem; }
#verdict-status { font-weight: 700; }
#verdict-status[data-state="verified"] { color: #0a7d2c; }
#verdict-status[data-state="broken"], #verdict-status[data-state="unverified"] { color: #b3261e; }
.decision { border-top: 1px solid; padding: 0.75rem 0; }
.state { font-size: 0.8em; border: 1px solid; border-radius: 0.25rem; padding: 0 0.35rem; }
.meta { font-size: 0.9em; opacity: 0.85; }
#all { margin-right: 0.4rem; }
#all:not(:checked) ~ #decisions .not-in-force { display: none; }
`;

/** The identity as the record names it, and the agent that carried it out when there is one. */
function actor(who: string, which?: string): string {
  return `<code>${escapeHtml(who)}</code>${which === undefined ? '' : ` via <code>${escapeHtml(which)}</code>`}`;
}

function decisionHtml(d: SiteDecision): string {
  const history = d.moves
    .map(
      (move) =>
        `<li><time>${escapeHtml(move.at)}</time> ${escapeHtml(move.action)}` +
        ` (${escapeHtml(move.before ?? 'new')} → ${escapeHtml(move.to)}) by ${actor(move.who, move.which)}` +
        (move.said === undefined ? '' : `<pre>${escapeHtml(move.said)}</pre>`) +
        '</li>',
    )
    .join('');
  const rows = [
    d.recordedBy === undefined
      ? ''
      : `<p class="meta">Recorded by ${actor(d.recordedBy.who, d.recordedBy.which)} at ${escapeHtml(d.createdAt)}.</p>`,
    d.acceptedBy === undefined
      ? ''
      : `<p class="meta">Accepted by ${actor(d.acceptedBy.who, d.acceptedBy.which)}.</p>`,
    d.supersedes === undefined
      ? ''
      : `<p class="meta">Supersedes <code>${escapeHtml(d.supersedes)}</code>.</p>`,
    d.supersededBy === undefined
      ? ''
      : `<p class="meta">Superseded by <code>${escapeHtml(d.supersededBy)}</code>.</p>`,
  ].join('');
  return (
    `<article class="decision ${d.inForce ? 'in-force' : 'not-in-force'}" id="${escapeHtml(d.id)}">` +
    `<h3>${escapeHtml(d.adr)} · ${escapeHtml(d.title)} <span class="state">${escapeHtml(d.state)}</span></h3>` +
    `<pre>${escapeHtml(d.rationale)}</pre>` +
    (d.alternatives === undefined
      ? ''
      : `<p><strong>Turned down:</strong></p><pre>${escapeHtml(d.alternatives)}</pre>`) +
    rows +
    (d.moves.length === 0
      ? ''
      : `<details><summary>History</summary><ol>${history}</ol></details>`) +
    '</article>'
  );
}

/** The base64 digest a `Content-Security-Policy` names a script or a style by. */
function cspHash(text: string): string {
  return `'sha256-${createHash('sha256').update(text).digest('base64')}'`;
}

/** JSON that may sit inside a `<script>`: no `<`, so nothing in it can close the element. */
function inertJson(value: unknown): string {
  return JSON.stringify(value).replaceAll('<', '\\u003c');
}

/** The page, as the text of `index.html`. `verifier` is the script `dist/site-verifier.js` holds. */
export function renderPage(model: SiteModel, verifier: string): string {
  const inForce = model.decisions.filter((d) => d.inForce).length;
  const others = model.decisions.length - inForce;
  const fileCount = Object.keys(model.files).length;
  const policy = [
    "default-src 'none'",
    `script-src ${cspHash(verifier)}`,
    `style-src ${cspHash(STYLE)}`,
  ].join('; ');
  const decisions =
    model.decisions.length === 0
      ? '<p>No decision is recorded in the public tree.</p>'
      : model.decisions.map(decisionHtml).join('\n');
  const tails = model.tails
    .map(
      (tail) =>
        `<details><summary><code>${escapeHtml(tail.id)}</code> — ${tail.events} event(s)</summary>` +
        `<pre>${escapeHtml(tail.text)}</pre></details>`,
    )
    .join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${escapeHtml(policy)}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>The record</title>
<style>${STYLE}</style>
</head>
<body>
<h1>The record</h1>
<section id="verdict">
<p><span id="verdict-status" data-state="pending">verifying…</span></p>
<p id="verdict-summary">This page is checking the record it carries.</p>
<ul id="verdict-issues"></ul>
<noscript><p>This page verifies the record with JavaScript. Without it, nothing here has been verified.</p></noscript>
</section>
<p>The verdict above is the sentence <code>mnema verify</code> gives a fresh clone of the repository,
computed in this browser by the same verifier (<code>@mnema/chain</code>) over the ${fileCount} file(s)
this page carries, with no network request and no key of yours. It checks the hash chain and every
checkpoint signature against the public keys carried with the files. It does not say that a key
belongs to the person a list names, and it does not check the lists below against the files: they
were written from those files by <code>mnema site</code>. Only the committed public tree is in this
page — no private tree and no machine-global tree — and all of its text is.</p>
<h2>Decisions</h2>
<p>${inForce} in force, ${others} not in force.</p>
<input type="checkbox" id="all"><label for="all">Also show the rejected, superseded and proposed decisions</label>
<div id="decisions">
${decisions}
</div>
<h2>Events</h2>
<p>The stored lines of each tail, exactly as the verdict read them.</p>
${tails}
<script type="application/json" id="record-files">${inertJson(model.files)}</script>
<script>${verifier}</script>
</body>
</html>
`;
}
