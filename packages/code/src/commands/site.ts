/**
 * `mnema site [--out <dir>]`: the committed record as one HTML file a stranger can open.
 *
 * THE PUBLIC TREE AND NOTHING ELSE. A page published to GitHub Pages is read by whoever has the
 * link, so what goes in it is what the repository already shows everyone: the committed tree.
 * The private tree and the machine-global tree are never opened here: no path to either is
 * resolved, so there is nothing to filter out and nothing a note kept private could ride in on.
 * The record's files are taken by an allow-list (`tails/` and the committed `keys/*.pub`) and
 * not by "everything under the tree", because the tree's directory also holds the private
 * subtree and a derived cache, and a list of what to leave out is the kind that goes stale.
 *
 * IT CARRIES THE RECORD'S FILES SO THE PAGE CAN VERIFY THEM. The verdict is the chain's own,
 * computed in the reader's browser over those files (`site/browser/entry.ts`). What the page
 * lists (decisions, their notes and addresses, the timeline) is written here from the same
 * files, by `pageModel`, and the page's script derives them again from the files it verified and
 * names each difference (`site/browser/check.ts`); the raw events are not written again, the
 * browser draws them from the files the page carries. How many stored lines each tail holds is
 * counted by the function the page counts with (`tailsOfFiles`), over the files it carries.
 *
 * IT RECORDS NOTHING. It reads the public tree and writes one file, `index.html`, under the
 * directory the caller named, or under `<record>/site/` when none is named. That directory sits
 * inside the record's own folder, so before it is created the record's `.gitignore` is made to
 * carry `/site/` (`ensureTree`, which also adds the `.gitattributes` a tree made before it lacks):
 * a `git add .mnema` after the page would otherwise publish it. Nothing else is touched. A
 * directory the caller names INSIDE the record and outside `site/` is refused (`OUT_IN_THE_RECORD`):
 * the folder whose contents are the proof receives nothing derived, bar the one the record's own
 * `.gitignore` hides.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { catalogUpcasters, ensureTree, verify } from '@mnema/chain';
import { type DiscoveryEnv, orderedEvents, realOfMaybeMissing, resolveTrees } from '@mnema/core';
import { tailsOfFiles } from '../site/browser/tails.js';
import { pageModel } from '../site/model.js';
import { renderPage } from '../site/page.js';
import { theSiteVerifier } from '../site/verifier-bundle.js';

/** What the site command needs: injected so it is testable. */
export interface SiteContext {
  /** The working directory to resolve the project from. */
  readonly cwd: string;
  /** The discovery environment (`$HOME`, `$MNEMA_HOME`). */
  readonly env: DiscoveryEnv;
}

/** The page that was written. */
export interface SiteDone {
  readonly ok: true;
  /** The file: as the caller's `--out` spelled the directory, or relative to the cwd for the default. */
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
  | { readonly ok: false; readonly reason: 'OUT_IS_A_FILE'; readonly message: string }
  | { readonly ok: false; readonly reason: 'OUT_IN_THE_RECORD'; readonly message: string }
  | { readonly ok: false; readonly reason: 'BAD_BACK_LINK'; readonly message: string };

/**
 * Whether `--back-link` may be put in the page: an http(s) address with `//` after the scheme, or a
 * path on the same site (one `/` first, or relative with no scheme). Refused: a protocol-relative
 * `//host` (it leaves the site), a backslash anywhere (a browser reads it as `/`), `https:` with no
 * `//`, and white space or a control character (a browser drops those before it reads a scheme, so
 * `java<tab>script:` would pass a test of the scheme and still run).
 */
export function isAcceptableBackLink(link: string): boolean {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: refusing control characters is the point
  if (link === '' || /[\s\u0000-\u001f\u007f\\]/.test(link)) return false;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(link)?.[1];
  if (scheme !== undefined) return /^https?$/i.test(scheme) && /^[^:]+:\/\/[^/]/.test(link);
  return !link.startsWith('//');
}

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

/** Whether `inner` is `outer` or below it, both already resolved. */
function isWithin(inner: string, outer: string): boolean {
  const rel = relative(outer, inner);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * Writes `<out>/index.html` from the project's public tree; with no `out`, under
 * `<record>/site/`.
 */
export function runSite(
  ctx: SiteContext,
  input: { readonly out?: string; readonly backLink?: string },
): SiteDone | SiteRefused {
  if (input.backLink !== undefined && !isAcceptableBackLink(input.backLink)) {
    return {
      ok: false,
      reason: 'BAD_BACK_LINK',
      message:
        '--back-link takes an http:// or https:// address, or a path on the same site (not //host, no backslash, no spaces)',
    };
  }
  const trees = resolveTrees(ctx.cwd, ctx.env);
  const publicRoot = trees.projectPublic;
  if (publicRoot === undefined) return { ok: false, reason: 'NO_PROJECT' };
  // The default is the record's own `site/`, not `<cwd>/.mnema/site`: the cwd may be a folder below
  // the project, and the record is where discovery found it.
  const out = input.out ?? join(publicRoot, 'site');
  // Asked as the file system resolves it, so a link, a `..` or a spelling of the record from
  // elsewhere cannot put the page in the proof's folder: the nearest ancestor that exists is
  // resolved (`realOfMaybeMissing`), and a plain `resolve` would walk past a link.
  // Every write below goes to `target`, the directory as the cwd resolves it, never to the bare
  // spelling: a relative one would otherwise be read from the process's own folder.
  const target = resolve(ctx.cwd, out);
  const realOut = realOfMaybeMissing(target);
  const realRecord = realOfMaybeMissing(publicRoot);
  const inRecord = isWithin(realOut, realRecord);
  const inSite = isWithin(realOut, join(realRecord, 'site'));
  if (inRecord && !inSite) {
    return {
      ok: false,
      reason: 'OUT_IN_THE_RECORD',
      message: `${out} is inside the record, and the record's folder holds only what is proof: leave --out off to write under ${join(relative(ctx.cwd, publicRoot) || '.', 'site')} (git ignores it), or name a directory outside the record`,
    };
  }
  const files = recordFiles(publicRoot);
  if (Object.keys(files).length === 0) {
    return {
      ok: false,
      reason: 'NO_RECORD',
      message: 'the public tree holds no record yet, so there is nothing to publish',
    };
  }
  let page: ReturnType<typeof pageModel>;
  try {
    page = pageModel(orderedEvents({ root: publicRoot }, catalogUpcasters()));
  } catch (error) {
    return {
      ok: false,
      reason: 'UNREADABLE',
      message: `the public tree cannot be read (${error instanceof Error ? error.message : String(error)}): run \`mnema verify\``,
    };
  }
  const tails = tailsOfFiles(files);
  const ruled = verify(publicRoot, catalogUpcasters());
  if (existsSync(target) && !statSync(target).isDirectory()) {
    return {
      ok: false,
      reason: 'OUT_IS_A_FILE',
      message: `${out} is a file, and --out names the directory the page is written under`,
    };
  }
  // The record's `.gitignore` carries `/site/` BEFORE the first byte of the page exists.
  if (inSite) ensureTree({ root: publicRoot });
  mkdirSync(target, { recursive: true });
  const written = join(target, 'index.html');
  writeFileSync(written, renderPage({ ...page, tails, files }, theSiteVerifier(), input.backLink));
  return {
    ok: true,
    path: input.out === undefined ? relative(ctx.cwd, written) : join(input.out, 'index.html'),
    decisions: page.counts.decisions,
    inForce: page.counts.inForce,
    events: tails.reduce((n, tail) => n + tail.events, 0),
    files: Object.keys(files).length,
    verdict: { ok: ruled.ok, summary: ruled.summary },
  };
}
