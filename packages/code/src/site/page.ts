/**
 * The page `mnema site` writes: one HTML file with everything in it.
 *
 * NOTHING IS LOADED FROM ELSEWHERE. The style, the script and the record's files are
 * inside the file, and a `Content-Security-Policy` in the page says so to the browser: the
 * one script allowed is the page's own, named by its hash, and no request may leave. A record
 * is text people wrote, and the page is where a stranger reads it, so the text is escaped
 * where it is written into the page ({@link escapeHtml}) and, behind that, a title that
 * somehow reached the page as markup would meet a policy that runs no script but ours.
 *
 * THE LISTS ARE WRITTEN HERE AND THE VERDICT IS COMPUTED THERE. The decisions, their notes and
 * the timeline are rendered by `mnema site` from the public tree's events (`model.ts`); the verdict
 * is computed in the reader's browser from the files, which travel inside the page. The page does
 * not derive the lists from those files again, and says so beside the verdict.
 *
 * WITHOUT THE SCRIPT THE WHOLE LIST IS THERE. Every decision, note and entry of the timeline is
 * written visible, and no rule of the style hides one: a reader whose browser runs no script, or
 * whose script is switched off, reads everything the page lists. Only the controls that need the
 * script (the filters) are written with `hidden`, and the script shows them. With the script, the
 * filter opens on the decisions in force, and the page says how many of how many it shows. This
 * replaces a checkbox and a rule of style that hid the rest, which was a filter of one word and
 * hid decisions from a reader who had not asked.
 *
 * THE RAW LINES ARE NOT IN THE PAGE TWICE. The files the verifier reads are in the page, in
 * base64; the stored lines of each tail used to be written a second time as escaped text, 435 KB
 * of 1.3 MB for this repository's own record. They are now drawn from those files when a reader
 * opens a tail, so without the script they are not drawn (the files are still in the page).
 *
 * THE COLOURS ARE THE BANNER'S. {@link PALETTE} takes the accent and the ground of the front
 * page's banner, and the darker accent small text needs is calculated from it by the rule the
 * site's theme uses ({@link textAccent}). Every pair of text and ground is held to WCAG AA in
 * both themes by `page.test.ts`.
 */

import { createHash } from 'node:crypto';
import { mix, textAccent } from './colour.js';
import {
  actWording,
  type PageDecision,
  type PageLink,
  type PageModel,
  type PageNote,
  type TimelineEntry,
} from './model.js';

export type { DecisionMove, PageDecision, PageModel, PageNote, TimelineEntry } from './model.js';

/** One tail's stored lines: how many there are. The lines themselves are drawn from the files. */
export interface SiteTail {
  readonly id: string;
  readonly events: number;
}

/** Everything the page is written from. */
export interface SiteModel extends PageModel {
  readonly tails: readonly SiteTail[];
  /** The record's files, path under the chain root to base64: what the verifier reads. */
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

/** The floor for text: WCAG 2, level AA. */
export const TEXT_FLOOR = 4.5;

/** The floor for the border of a focused control: WCAG 2.2, 1.4.11. */
export const FOCUS_FLOOR = 3;

/**
 * The front page's banner colours this page takes: the accent per theme and the ground per theme.
 * They are copies of `ACCENT` (`.github/the-front-page/accent.mjs`) and `PAGE`
 * (`.github/the-front-page/draw.mjs`), and `page.test.ts` fails when either drifts from its source.
 */
const BANNER = {
  accent: { dark: '#c4a0f5', light: '#997dbf' },
  page: { dark: '#0d1117', light: '#ffffff' },
} as const;

/** One theme's colours. Every one that is text must read at {@link TEXT_FLOOR} on `bg` and on `surface`. */
export interface Colours {
  /** The ground of the page. */
  readonly bg: string;
  /** The ground of a card and of a control. */
  readonly surface: string;
  readonly text: string;
  readonly muted: string;
  /** A rule between things: not text, not held to a floor. */
  readonly border: string;
  /** The banner's accent, for what is not text. */
  readonly accent: string;
  /** The accent as small text: the banner's, taken only as far toward the ink as the floor needs. */
  readonly accentText: string;
  /** A verified record, a decision accepted. */
  readonly ok: string;
  /** A record that is broken or unverified, a decision rejected. */
  readonly bad: string;
  /** A record still being checked, a decision proposed. */
  readonly wait: string;
  /** The ring round a control or a link that has the keyboard: held to {@link FOCUS_FLOOR}. */
  readonly focus: string;
}

function themeOf(theme: 'dark' | 'light', rest: Omit<Colours, 'accent' | 'accentText' | 'focus'>) {
  const other = theme === 'dark' ? 'light' : 'dark';
  const accent = BANNER.accent[theme];
  const accentText = textAccent({
    ink: accent,
    toward: BANNER.page[other],
    grounds: [rest.bg, rest.surface],
    floor: TEXT_FLOOR,
  });
  return { ...rest, accent, accentText, focus: accentText };
}

/**
 * The palette, light and dark. The ground is the banner's; the surface is the ground taken a
 * little toward the other theme's, the way the site's greys are; the state colours are chosen
 * for 4.5:1 on both grounds of their theme (the light verified green is the one GitHub uses, the
 * dark one a lighter green: the dark page's old verified green read 3.59:1).
 */
export const PALETTE: { readonly dark: Colours; readonly light: Colours } = {
  dark: themeOf('dark', {
    bg: BANNER.page.dark,
    surface: mix(BANNER.page.dark, BANNER.page.light, 0.06),
    text: '#e6edf3',
    muted: '#8b949e',
    border: '#30363d',
    ok: '#3fb950',
    bad: '#ff7b72',
    wait: '#d29922',
  }),
  light: themeOf('light', {
    bg: BANNER.page.light,
    surface: mix(BANNER.page.light, BANNER.page.dark, 0.035),
    text: '#0d1117',
    muted: '#57606a',
    border: '#d0d7de',
    ok: '#1a7f37',
    bad: '#cf222e',
    wait: '#8a5a00',
  }),
};

function variables(theme: Colours): string {
  return [
    `--bg: ${theme.bg};`,
    `--surface: ${theme.surface};`,
    `--text: ${theme.text};`,
    `--muted: ${theme.muted};`,
    `--border: ${theme.border};`,
    `--accent: ${theme.accent};`,
    `--accent-text: ${theme.accentText};`,
    `--ok: ${theme.ok};`,
    `--bad: ${theme.bad};`,
    `--wait: ${theme.wait};`,
    `--focus: ${theme.focus};`,
  ].join(' ');
}

/** The page's style. A class or an attribute selects; nothing in the page carries a `style=`. */
export const STYLE = `
:root { color-scheme: light dark; ${variables(PALETTE.light)} font-family: system-ui, sans-serif; line-height: 1.55; }
@media (prefers-color-scheme: dark) { :root { ${variables(PALETTE.dark)} } }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
body { max-width: 52rem; margin: 0 auto; padding: 1rem; background: var(--bg); color: var(--text); overflow-wrap: anywhere; }
h1, h2, h3, h4 { line-height: 1.25; }
h1 { margin: 0.5rem 0; }
h2 { margin-top: 2rem; }
a { color: var(--accent-text); }
code, pre { font-family: ui-monospace, monospace; font-size: 0.85em; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; margin: 0.5rem 0; }
code { overflow-wrap: anywhere; }
:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
.skip { position: absolute; left: -999px; top: 0; padding: 0.5rem 1rem; background: var(--surface); }
.skip:focus { left: 0.5rem; top: 0.5rem; z-index: 1; }
.meta, .muted { color: var(--muted); }
.meta { font-size: 0.9em; margin: 0.25rem 0; }
.card, #verdict, .filters { background: var(--surface); border: 1px solid var(--border); border-radius: 0.5rem; padding: 0.75rem 1rem; }
#verdict { border-width: 2px; }
#verdict-status { font-weight: 700; }
#verdict-status[data-state="verified"] { color: var(--ok); }
#verdict-status[data-state="broken"], #verdict-status[data-state="unverified"] { color: var(--bad); }
#verdict-status[data-state="pending"] { color: var(--wait); }
.decision { margin: 1rem 0; border-left: 4px solid var(--accent); }
.decision h3 { margin: 0 0 0.25rem; }
.permalink { margin-left: 0.5rem; font-size: 0.85em; text-decoration: none; }
.state { display: inline-block; font-size: 0.8em; font-weight: 600; border: 1px solid; border-radius: 0.25rem; padding: 0 0.4rem; color: var(--muted); }
.state[data-state="accepted"] { color: var(--ok); }
.state[data-state="rejected"] { color: var(--bad); }
.state[data-state="proposed"] { color: var(--wait); }
.badge { font-size: 0.8em; border: 1px solid var(--border); border-radius: 0.25rem; padding: 0 0.35rem; color: var(--muted); }
.notes, .addresses { margin: 0.75rem 0 0; padding: 0; list-style: none; }
.note { border-top: 1px solid var(--border); padding: 0.5rem 0; }
.note.retracted pre { text-decoration: line-through; }
.retraction { color: var(--bad); margin: 0.25rem 0; }
.rel { color: var(--muted); margin-right: 0.35rem; }
.timeline { padding-left: 1.5rem; }
.timeline li { margin: 0.35rem 0; }
.filters { display: flex; flex-wrap: wrap; gap: 0.75rem; margin: 1rem 0 0.5rem; }
.filters label { display: flex; flex-direction: column; flex: 1 1 10rem; min-width: 0; font-size: 0.85em; color: var(--muted); }
.filters select, .filters input, .filters button { font: inherit; color: var(--text); background: var(--bg); border: 1px solid var(--muted); border-radius: 0.25rem; padding: 0.25rem 0.5rem; width: 100%; max-width: 100%; }
.filters button { width: auto; align-self: flex-end; cursor: pointer; }
details { margin: 0.5rem 0; }
summary { cursor: pointer; }
`;

/** The identity as the record names it, and what carried the act out: a person or an agent. */
function actor(who: string, which?: string): string {
  return `<code>${escapeHtml(who)}</code> <span class="badge">${escapeHtml(actWording(which))}</span>`;
}

function permalinkOf(d: PageDecision): string {
  return d.adrIsUnique ? d.adr : d.id;
}

/** The people, and the agents, who acted on a decision: what the filters by author read. */
function actorsOf(d: PageDecision): { who: string[]; by: string[] } {
  const acts = [
    ...(d.recordedBy === undefined ? [] : [d.recordedBy]),
    ...(d.acceptedBy === undefined ? [] : [d.acceptedBy]),
    ...d.moves,
  ];
  return {
    who: [...new Set(acts.map((act) => act.who))],
    by: [...new Set(acts.map((act) => actWording(act.which)))],
  };
}

function noteHtml(note: PageNote, firstTime: boolean): string {
  const retraction =
    note.retracted === undefined
      ? ''
      : `<p class="retraction">Retracted at <time>${escapeHtml(note.retracted.at)}</time> by ${actor(note.retracted.who, note.retracted.which)}. Why: ${escapeHtml(note.retracted.reason)}</p>`;
  const what = note.kind === 'memory' ? 'Memory' : 'Observation';
  const topic = note.topic === undefined ? '' : ` on <strong>${escapeHtml(note.topic)}</strong>`;
  const about = note.about === undefined ? '' : ` about <code>${escapeHtml(note.about)}</code>`;
  return (
    `<li class="note${note.retracted === undefined ? '' : ' retracted'}"${firstTime ? ` id="note-${escapeHtml(note.id)}"` : ''}>` +
    `<p class="meta">${what}${topic}${about}, by ${actor(note.who, note.which)} at <time>${escapeHtml(note.at)}</time></p>` +
    `<pre>${escapeHtml(note.text)}</pre>${retraction}</li>`
  );
}

function linkHtml(link: PageLink): string {
  return `<span class="rel">${escapeHtml(link.rel)}</span><code class="target">${escapeHtml(link.target)}</code>`;
}

function decisionHtml(
  d: PageDecision,
  known: ReadonlyMap<string, PageDecision>,
  shown: Set<string>,
): string {
  const history = d.moves
    .map(
      (move) =>
        `<li><time>${escapeHtml(move.at)}</time> ${escapeHtml(move.action)}` +
        ` (${escapeHtml(move.before ?? 'new')} → ${escapeHtml(move.to)}) by ${actor(move.who, move.which)}` +
        (move.said === undefined ? '' : `<pre>${escapeHtml(move.said)}</pre>`) +
        '</li>',
    )
    .join('');
  const reference = (id: string): string => {
    const other = known.get(id);
    return other === undefined
      ? `<code>${escapeHtml(id)}</code>`
      : `<a href="#${escapeHtml(id)}">${escapeHtml(other.adr)}</a>`;
  };
  const rows = [
    d.recordedBy === undefined
      ? ''
      : `<p class="meta">Recorded by ${actor(d.recordedBy.who, d.recordedBy.which)} at <time>${escapeHtml(d.createdAt)}</time>.</p>`,
    d.acceptedBy === undefined
      ? ''
      : `<p class="meta">Accepted by ${actor(d.acceptedBy.who, d.acceptedBy.which)}.</p>`,
    d.supersedes === undefined ? '' : `<p class="meta">Supersedes ${reference(d.supersedes)}.</p>`,
    d.supersededBy === undefined
      ? ''
      : `<p class="meta">Superseded by ${reference(d.supersededBy)}.</p>`,
  ].join('');
  const notes =
    d.notes.length === 0
      ? ''
      : `<h4>Notes</h4><ul class="notes">${d.notes
          .map((note) => {
            const firstTime = !shown.has(note.id);
            shown.add(note.id);
            return noteHtml(note, firstTime);
          })
          .join('')}</ul>`;
  const addresses =
    d.addresses.length === 0
      ? ''
      : `<h4>Addressed at</h4><ul class="addresses">${d.addresses
          .map((link) => `<li>${linkHtml(link)}</li>`)
          .join('')}</ul>`;
  const linked =
    d.linkedTo.length === 0
      ? ''
      : `<p class="meta">Linked to: ${d.linkedTo.map((link) => linkHtml(link)).join(', ')}</p>`;
  const { who, by } = actorsOf(d);
  const data = [
    ['data-state', d.state],
    ['data-force', d.inForce ? 'in-force' : 'not-in-force'],
    ['data-date', d.createdAt.slice(0, 10)],
    ['data-who', JSON.stringify(who)],
    ['data-by', JSON.stringify(by)],
  ]
    .map(([name, value]) => `${name}="${escapeHtml(value as string)}"`)
    .join(' ');
  const anchor = d.adrIsUnique ? `<span id="${escapeHtml(d.adr)}"></span>` : '';
  return (
    `<article class="card decision ${d.inForce ? 'in-force' : 'not-in-force'}" id="${escapeHtml(d.id)}" ${data}>` +
    `<h3>${anchor}${escapeHtml(d.adr)} · ${escapeHtml(d.title)} ` +
    `<span class="state" data-state="${escapeHtml(d.state)}">${escapeHtml(d.state)}</span>` +
    `<a class="permalink" href="#${escapeHtml(permalinkOf(d))}" aria-label="Permanent link to ${escapeHtml(d.adr)}">#</a></h3>` +
    `<pre>${escapeHtml(d.rationale)}</pre>` +
    (d.alternatives === undefined
      ? ''
      : `<p><strong>Turned down:</strong></p><pre>${escapeHtml(d.alternatives)}</pre>`) +
    rows +
    addresses +
    linked +
    (d.moves.length === 0
      ? ''
      : `<details><summary>History</summary><ol>${history}</ol></details>`) +
    notes +
    '</article>'
  );
}

function timelineHtml(entry: TimelineEntry): string {
  const by = actor(entry.who, entry.which);
  const topic = entry.topic === undefined ? '' : ` on ${escapeHtml(entry.topic)}`;
  const text = {
    'decision-recorded': `${escapeHtml(entry.adr ?? '')} recorded by ${by}`,
    'decision-moved': `${escapeHtml(entry.adr ?? '')}: ${escapeHtml(entry.action ?? '')} (to ${escapeHtml(entry.to ?? '')}) by ${by}`,
    'note-recorded': `Note recorded${topic} by ${by}`,
    'note-retracted': `Note retracted by ${by}`,
  }[entry.kind];
  const target =
    entry.kind === 'decision-recorded' || entry.kind === 'decision-moved'
      ? entry.subject
      : `note-${entry.subject}`;
  return (
    `<li class="entry"><time>${escapeHtml(entry.at)}</time> ${text} ` +
    `<a href="#${escapeHtml(target)}">open</a></li>`
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

/**
 * The controls the script shows. They are written `hidden`: a reader without the script is not
 * offered a control that does nothing. The options of the selects are filled by the script from
 * what the cards carry, never from a list of its own.
 */
const FILTERS = `<div id="filters" class="filters" hidden>
<label>State<select id="f-state"></select></label>
<label>Identity<select id="f-who"></select></label>
<label>Agent or person<select id="f-by"></select></label>
<label>Recorded from<input type="date" id="f-from"></label>
<label>Recorded until<input type="date" id="f-to"></label>
<label>Text<input type="search" id="f-text"></label>
<label>Path<input type="search" id="f-path" placeholder="packages/code"></label>
<button type="button" id="f-clear">Clear the filters</button>
</div>
<p id="showing" class="muted" aria-live="polite" hidden></p>`;

/**
 * The page, as the text of `index.html`. `script` is the file `dist/site-verifier.js` holds: the
 * verifier, the filters and the drawing of the raw lines. With a `backLink` the page opens with
 * one link to it; without, the page opens with the link that skips to the decisions.
 */
export function renderPage(model: SiteModel, script: string, backLink?: string): string {
  const { counts } = model;
  const events = model.tails.reduce((n, tail) => n + tail.events, 0);
  const fileCount = Object.keys(model.files).length;
  const policy = [
    "default-src 'none'",
    `script-src ${cspHash(script)}`,
    `style-src ${cspHash(STYLE)}`,
  ].join('; ');
  const known = new Map(model.decisions.map((d) => [d.id, d]));
  const shown = new Set<string>();
  const decisions =
    model.decisions.length === 0
      ? '<p>No decision is recorded in the public tree.</p>'
      : model.decisions.map((d) => decisionHtml(d, known, shown)).join('\n');
  const otherNotes =
    model.otherNotes.length === 0
      ? ''
      : `<section id="other-notes">\n<h2>Other notes</h2>\n<p>Notes that belong to no decision on this page.</p>\n<ul class="notes">${model.otherNotes
          .map((note) => {
            shown.add(note.id);
            return noteHtml(note, true);
          })
          .join('')}</ul>\n</section>\n`;
  const timeline =
    model.timeline.length === 0
      ? '<p>No decision or note is recorded in the public tree.</p>'
      : `<ol class="timeline">\n${model.timeline.map(timelineHtml).join('\n')}\n</ol>`;
  const tails = model.tails
    .map(
      (tail) =>
        `<details class="tail" data-tail="${escapeHtml(tail.id)}"><summary><code>${escapeHtml(tail.id)}</code>: ${tail.events} event(s)</summary>` +
        '<pre></pre></details>',
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
${backLink === undefined ? '' : `<p><a href="${escapeHtml(backLink)}">Back</a></p>\n`}<a class="skip" href="#decisions">Skip to the decisions</a>
<h1>The record</h1>
<main>
<section id="verdict" role="status" aria-live="polite">
<p><span id="verdict-status" data-state="pending">verifying…</span></p>
<p id="verdict-summary">This page is checking the record it carries.</p>
<ul id="verdict-issues"></ul>
<noscript><p>This page verifies the record with JavaScript. Without it, nothing here has been verified, and the stored lines under Events are not drawn: the files they come from are in this page, in base64.</p></noscript>
</section>
<p>The verdict above is the sentence <code>mnema verify</code> gives a fresh clone of the repository,
computed in this browser by the same verifier (<code>@mnema/chain</code>) over the ${fileCount} file(s)
this page carries, with no network request and no key of yours. It checks the hash chain and every
checkpoint signature against the public keys carried with the files. It does not say that a key
belongs to the person a list names, and it does not check the lists below against the files: they
were written from those files by <code>mnema site</code>. Only the committed public tree is in this
page (no private tree and no machine-global tree), and all of its text is.</p>
<p id="counts">${counts.decisions} decision(s): ${counts.inForce} in force, ${counts.decisions - counts.inForce} not in force. ${counts.notes} note(s), ${events} stored event(s).</p>
<h2 id="decisions">Decisions</h2>
${FILTERS}
<div id="decision-list">
${decisions}
</div>
${otherNotes}<section id="timeline">
<h2>Timeline</h2>
<p>Each act the record holds about a decision or a note, in the order the record holds them.</p>
${timeline}
</section>
<section id="events">
<h2>Events</h2>
<p>The stored lines of each tail, exactly as the verdict read them. Opening a tail draws them from the files this page carries.</p>
${tails}
</section>
</main>
<script type="application/json" id="record-files">${inertJson(model.files)}</script>
<script>${script}</script>
</body>
</html>
`;
}
