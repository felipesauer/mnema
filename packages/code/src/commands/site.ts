/**
 * `mnema site --out <dir>` — the committed record as one HTML file a stranger can open.
 *
 * THE PUBLIC TREE AND NOTHING ELSE. A page published to GitHub Pages is read by whoever has the
 * link, so what goes in it is what the repository already shows everyone: the committed tree.
 * The private tree and the machine-global tree are never opened here — no path to either is
 * resolved, so there is nothing to filter out and nothing a note kept private could ride in on.
 * The record's files are taken by an allow-list (`tails/` and the committed `keys/*.pub`) and
 * not by "everything under the tree", because the tree's directory also holds the private
 * subtree and a derived cache, and a list of what to leave out is the kind that goes stale.
 *
 * IT CARRIES THE RECORD'S FILES SO THE PAGE CAN VERIFY THEM. The verdict is the chain's own,
 * computed in the reader's browser over those files (`site/browser/entry.ts`). What the page
 * lists — decisions, their history, the raw events — is written here from the same files.
 *
 * IT RECORDS NOTHING. It reads the public tree and writes one file, `index.html`, under the
 * directory the caller named; nothing else is touched.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { catalogUpcasters, transitionProse, verify } from '@mnema/chain';
import { decisionDisposition } from '@mnema/context';
import {
  type DecisionState,
  type DiscoveryEnv,
  orderedEvents,
  projectDecisions,
  resolveTrees,
} from '@mnema/core';
import { type DecisionMove, renderPage, type SiteDecision, type SiteTail } from '../site/page.js';
import { theSiteVerifier } from '../site/verifier-bundle.js';

/** What the site command needs — injected so it is testable. */
export interface SiteContext {
  /** The working directory to resolve the project from. */
  readonly cwd: string;
  /** The discovery environment (`$HOME`, `$MNEMA_HOME`). */
  readonly env: DiscoveryEnv;
}

/** The page that was written. */
export interface SiteDone {
  readonly ok: true;
  /** The file, as the caller's `--out` spelled the directory. */
  readonly path: string;
  readonly decisions: number;
  readonly inForce: number;
  readonly events: number;
  /** How many of the record's files the page carries for its own verification. */
  readonly files: number;
  /**
   * What the chain says of the public tree, so a person about to publish a record that does not
   * verify is told here and not only by the page: the page says it to its readers, and the
   * person who ran the verb is the one who can still decide.
   */
  readonly verdict: { readonly ok: boolean; readonly summary: string };
}

/** Nothing was written. */
export type SiteRefused =
  | { readonly ok: false; readonly reason: 'NO_PROJECT' }
  | { readonly ok: false; readonly reason: 'NO_RECORD'; readonly message: string }
  | { readonly ok: false; readonly reason: 'UNREADABLE'; readonly message: string }
  | { readonly ok: false; readonly reason: 'OUT_IS_A_FILE'; readonly message: string };

/** Every file under `dir`, as a path relative to `base`, in a fixed order. */
function filesUnder(base: string, dir: string): string[] {
  if (!existsSync(dir)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...filesUnder(base, path));
    else if (entry.isFile())
      found.push(
        path
          .slice(base.length + 1)
          .split('\\')
          .join('/'),
      );
  }
  return found.sort();
}

/**
 * The files the verifier needs, taken from the public tree by allow-list: every file under
 * `tails/` and each committed public key. Key halves a machine keeps to itself are not in
 * this tree, and the allow-list would not take them if they were.
 */
function recordFiles(publicRoot: string): Record<string, string> {
  const wanted = [
    ...filesUnder(publicRoot, join(publicRoot, 'tails')),
    ...filesUnder(publicRoot, join(publicRoot, 'keys')).filter((file) => file.endsWith('.pub')),
  ];
  const files: Record<string, string> = {};
  for (const file of wanted) {
    files[file] = readFileSync(join(publicRoot, file)).toString('base64');
  }
  return files;
}

/** Each tail's segment lines, verbatim — what the page lists as the raw events. */
function tailsOf(publicRoot: string, files: Readonly<Record<string, string>>): SiteTail[] {
  const tails = new Map<string, string[]>();
  for (const file of Object.keys(files)) {
    const match = /^tails\/([^/]+)\/(\d+)\.jsonl$/.exec(file);
    if (match === null) continue;
    const tail = match[1] as string;
    const text = readFileSync(join(publicRoot, file), 'utf-8');
    tails.set(tail, [...(tails.get(tail) ?? []), text]);
  }
  return [...tails.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([id, segments]) => {
      const text = segments.join('').replace(/\n+$/, '');
      return { id, events: text === '' ? 0 : text.split('\n').length, text };
    });
}

/** The decisions of the public tree and what each went through, in the order they were recorded. */
function decisionsOf(publicRoot: string): SiteDecision[] {
  const events = orderedEvents({ root: publicRoot }, catalogUpcasters());
  const moves = new Map<string, DecisionMove[]>();
  for (const event of events) {
    if (event.kind !== 'decision.transitioned') continue;
    const said = transitionProse(event.payload.fields);
    const list = moves.get(event.subject) ?? [];
    list.push({
      at: event.at,
      action: event.payload.action,
      before: event.payload.from,
      to: event.payload.to,
      who: event.who,
      ...(event.which !== undefined ? { which: event.which } : {}),
      ...(said !== '' ? { said } : {}),
    });
    moves.set(event.subject, list);
  }
  return [...projectDecisions(events).values()].map((d) => ({
    id: d.id,
    adr: d.adr,
    title: d.title,
    rationale: d.rationale,
    ...(d.alternatives !== undefined ? { alternatives: d.alternatives } : {}),
    state: d.state,
    inForce: decisionDisposition(d.state as DecisionState) === 'in-force',
    ...(d.supersedes !== undefined ? { supersedes: d.supersedes } : {}),
    ...(d.supersededBy !== undefined ? { supersededBy: d.supersededBy } : {}),
    createdAt: d.createdAt,
    ...(d.recordedBy !== undefined ? { recordedBy: d.recordedBy } : {}),
    ...(d.acceptedBy !== undefined ? { acceptedBy: d.acceptedBy } : {}),
    moves: moves.get(d.id) ?? [],
  }));
}

/** Writes `<out>/index.html` from the project's public tree. */
export function runSite(ctx: SiteContext, input: { readonly out: string }): SiteDone | SiteRefused {
  const trees = resolveTrees(ctx.cwd, ctx.env);
  const publicRoot = trees.projectPublic;
  if (publicRoot === undefined) return { ok: false, reason: 'NO_PROJECT' };
  const files = recordFiles(publicRoot);
  if (Object.keys(files).length === 0) {
    return {
      ok: false,
      reason: 'NO_RECORD',
      message: 'the public tree holds no record yet, so there is nothing to publish',
    };
  }
  let decisions: SiteDecision[];
  try {
    decisions = decisionsOf(publicRoot);
  } catch (error) {
    return {
      ok: false,
      reason: 'UNREADABLE',
      message: `the public tree cannot be read (${error instanceof Error ? error.message : String(error)}) — run \`mnema verify\``,
    };
  }
  const tails = tailsOf(publicRoot, files);
  const ruled = verify(publicRoot, catalogUpcasters());
  if (existsSync(input.out) && !statSync(input.out).isDirectory()) {
    return {
      ok: false,
      reason: 'OUT_IS_A_FILE',
      message: `${input.out} is a file, and --out names the directory the page is written under`,
    };
  }
  mkdirSync(input.out, { recursive: true });
  const path = join(input.out, 'index.html');
  writeFileSync(path, renderPage({ decisions, tails, files }, theSiteVerifier()));
  return {
    ok: true,
    path,
    decisions: decisions.length,
    inForce: decisions.filter((d) => d.inForce).length,
    events: tails.reduce((n, tail) => n + tail.events, 0),
    files: Object.keys(files).length,
    verdict: { ok: ruled.ok, summary: ruled.summary },
  };
}
