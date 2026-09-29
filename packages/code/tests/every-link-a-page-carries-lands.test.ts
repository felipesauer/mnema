/**
 * EVERY LINK A PAGE CARRIES LANDS — a relative path on a file or directory the repository
 * tracks, and an anchor on a heading the page it names has.
 *
 * WHAT WAS UNCHECKED. Nothing asked whether `[the plugin's page](plugin/README.md#in-vs-code-
 * and-cursor)` still lands anywhere. A heading renamed or a file moved leaves a page pointing
 * at nothing, in silence, and the reader is the one who finds out. The guard with a link in
 * its name, `the-link-cannot-come-back`, is about an attribution footer in a commit.
 *
 * WHAT IS CHECKED, AND NOTHING ASKS THE NETWORK. Every tracked Markdown page
 * ({@link trackedPages}, the reach and never a list), read outside its fenced blocks
 * ({@link linesOf}, the one reading of what is fenced), its code spans and its HTML comments:
 *   - every relative destination — an inline link or image, a reference definition, an HTML
 *     `href` or `src` — resolves to a path `git ls-files` holds, or to a directory of one;
 *   - every anchor names a heading of the page it points at, slugged the way GitHub renders a
 *     heading ({@link slugOf}), or an `<a name>`/`<a id>` on it; an anchor alone is asked of
 *     the page it sits on;
 *   - a line anchor (`#L12`, `#L12-L20`) on a file that is not a page is asked of that file's
 *     length, because that is what GitHub makes of it;
 *   - a destination with a scheme (`https:`, `mailto:`) or none at all but `//` is left out
 *     by construction: whether it answers is a question for the network.
 *
 * WHAT IT DOES NOT CHECK:
 *   - the external links, above;
 *   - how a registry renders a package's page — it resolves the page's relative links against
 *     the repository, which is what is checked here, and that is read rather than measured;
 *   - a heading GitHub would derive from raw HTML other than an `<a name>` or `<a id>`;
 *   - a link whose destination holds a parenthesis, which the reading here stops at.
 *
 * AND WHAT IT FOUND WHEN IT LANDED: five links that do not resolve, every one of them in a
 * round's measurement pages, which stay as they were measured — {@link AS_MEASURED} holds
 * each, with its reason, reconciled in both directions.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from './support/published-examples.js';
import { linesOf, trackedPages } from './support/reading-a-shell-line.js';

// ---------------------------------------------------------------------------
// The reading
// ---------------------------------------------------------------------------

/** One destination a page carries, and the line it is on. */
interface Destination {
  readonly at: number;
  readonly dest: string;
}

/** A run of text kept in place with every character but the line breaks made a space. */
const blank = (text: string): string => text.replace(/[^\n]/g, ' ');

/**
 * What a page renders: every line outside a fence, with the fenced ones emptied so line
 * numbers stay the page's, and its HTML comments blanked the same way. Headings are read here,
 * because a code span in a heading is part of the heading.
 */
function renderedOf(markdown: string): string {
  const lines = markdown.split('\n').map(() => '');
  for (const { at, fence, source } of linesOf(markdown)) {
    if (fence === null) lines[at - 1] = source;
  }
  return lines.join('\n').replace(/<!--[\s\S]*?-->/g, blank);
}

/** What a page renders, with its code spans blanked too: a link inside one is not a link. */
function proseOf(markdown: string): string {
  return renderedOf(markdown).replace(/(`+)(?!`)(?:[^\n`]|`(?!\1)|\n(?!\s*\n))*?\1(?!`)/g, blank);
}

/** The line a character offset falls on, one-based. */
function lineAt(text: string, offset: number): number {
  return text.slice(0, offset).split('\n').length;
}

/** Every destination the prose of a page carries — inline, image, reference, HTML. */
function destinationsOf(markdown: string): Destination[] {
  const prose = proseOf(markdown);
  const found: Destination[] = [];
  const shapes = [
    // `[text](dest "title")` and `![alt](dest)`, with one level of brackets in the text.
    /!?\[(?:[^[\]\\]|\\.|\[(?:[^[\]\\]|\\.)*\])*\]\(\s*<?([^)\s>]+)>?(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g,
    // `[label]: dest`, a reference definition, at the start of its line.
    /^ {0,3}\[[^\]]+\]:\s*<?([^\s>]+)>?/gm,
    // `href="dest"` and `src="dest"` in raw HTML.
    /\b(?:href|src)="([^"]+)"/g,
  ];
  for (const shape of shapes) {
    for (const match of prose.matchAll(shape)) {
      found.push({ at: lineAt(prose, match.index), dest: match[1] as string });
    }
  }
  return found.sort((a, b) => a.at - b.at);
}

/** What GitHub renders a heading's text as, before it is slugged. */
function headingText(raw: string): string {
  return raw
    .replace(/\s+#+\s*$/, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/`/g, '')
    .replace(/\*/g, '')
    .replace(/(^|[^\p{L}\p{N}])__?(.+?)__?(?=[^\p{L}\p{N}]|$)/gu, '$1$2')
    .trim();
}

/**
 * A heading's anchor, the way GitHub makes it: lower case, every character that is not a
 * letter, a mark, a number, a connector, a hyphen or a space dropped, and each space a hyphen.
 * Two spaces around a dropped dash make two hyphens, which is why `A — B` is `a--b`.
 */
function slugOf(heading: string): string {
  return headingText(heading)
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, '')
    .replace(/ /g, '-');
}

/**
 * Every anchor a page has: its headings, ATX and setext, outside fences, each repeated one
 * numbered `-1`, `-2` onwards as GitHub numbers them; and every `<a name>` or `<a id>`.
 */
function anchorsOf(markdown: string): Set<string> {
  const anchors = new Set<string>();
  const seen = new Map<string, number>();
  const lines = renderedOf(markdown).split('\n');
  const add = (heading: string): void => {
    const slug = slugOf(heading);
    const times = seen.get(slug) ?? 0;
    seen.set(slug, times + 1);
    anchors.add(times === 0 ? slug : `${slug}-${times}`);
  };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] as string;
    const atx = /^ {0,3}#{1,6}\s+(.*)$/.exec(line);
    if (atx !== null) {
      add(atx[1] as string);
      continue;
    }
    const under = lines[i + 1];
    if (
      under !== undefined &&
      /^ {0,3}(=+|-+)\s*$/.test(under) &&
      line.trim() !== '' &&
      !/^\s*([-*+>|]|\d+[.)])/.test(line)
    ) {
      add(line);
    }
  }
  for (const match of markdown.matchAll(/<a\s+(?:name|id)="([^"]+)"/g))
    anchors.add(match[1] as string);
  return anchors;
}

/** What a sweep needs from the repository — the disk for the real one, a map for a case's own. */
interface Corpus {
  readonly pages: readonly string[];
  readonly tracked: ReadonlySet<string>;
  readonly read: (path: string) => string;
}

/** Every path the repository tracks, and every directory one of them sits in. */
function trackedAndTheirDirectories(files: readonly string[]): Set<string> {
  const tracked = new Set<string>(files);
  for (const file of files) {
    for (let dir = dirname(file); dir !== '.' && !tracked.has(dir); dir = dirname(dir)) {
      tracked.add(dir);
    }
  }
  return tracked;
}

/** Every link of the corpus that does not land, as `page → dest` with why. */
function unlanded(corpus: Corpus): { key: string; why: string }[] {
  const anchorsCache = new Map<string, Set<string>>();
  const anchorsIn = (page: string): Set<string> => {
    let anchors = anchorsCache.get(page);
    if (anchors === undefined) {
      anchors = anchorsOf(corpus.read(page));
      anchorsCache.set(page, anchors);
    }
    return anchors;
  };
  const found: { key: string; why: string }[] = [];
  for (const page of corpus.pages) {
    for (const { at, dest } of destinationsOf(corpus.read(page))) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(dest) || dest.startsWith('//')) continue;
      const key = `${page} → ${dest}`;
      const hash = dest.indexOf('#');
      const path = (hash < 0 ? dest : dest.slice(0, hash)).replace(/\?.*$/, '');
      const anchor = hash < 0 ? '' : decodeURIComponent(dest.slice(hash + 1));
      let target = page;
      if (path !== '') {
        const decoded = decodeURIComponent(path);
        target = normalize(
          decoded.startsWith('/') ? decoded.slice(1) : join(dirname(page), decoded),
        ).replace(/\/$/, '');
        if (!corpus.tracked.has(target)) {
          found.push({ key, why: `${page}:${at}: no tracked path ${target}` });
          continue;
        }
      }
      if (anchor === '') continue;
      if (target.endsWith('.md')) {
        if (!anchorsIn(target).has(anchor)) {
          found.push({ key, why: `${page}:${at}: ${target} has no heading #${anchor}` });
        }
        continue;
      }
      const lines = /^L(\d+)(?:-L(\d+))?$/.exec(anchor);
      if (lines === null) {
        found.push({ key, why: `${page}:${at}: #${anchor} on ${target}, which is not a page` });
        continue;
      }
      const last = Number(lines[2] ?? lines[1]);
      const text = corpus.read(target);
      const length = text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
      if (last > length) found.push({ key, why: `${page}:${at}: ${target} has ${length} lines` });
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// The links that stay as they are
// ---------------------------------------------------------------------------

/** What a round's measurement pages are, said once: the reason every entry below shares. */
const MEASURED =
  'A page of a measurement round that has already run, which stays as it was measured, the ' +
  'way `the-shell-a-page-publishes-is-the-shell-that-runs.test.ts` leaves a wrong command on ' +
  'the same round’s page. ';

/**
 * The links that do not land and stay as they are, each with its reason. Reconciled in both
 * directions: a link that starts landing, or leaves its page, has to leave this table too.
 */
const AS_MEASURED: Readonly<Record<string, string>> = {
  'measurements/p1/round-3/arms.md → ../mcp-tool-channel/': `${MEASURED}The measurement it means is \`measurements/mcp-tool-channel/\`, one directory further up than the link climbs.`,
  'measurements/p1/round-3/arms.md → ../switch-cost/': `${MEASURED}The measurement it means is \`measurements/switch-cost/\`, one directory further up than the link climbs.`,
  'measurements/p1/round-3/reading.md → ../mcp-tool-channel/': `${MEASURED}The measurement it means is \`measurements/mcp-tool-channel/\`, one directory further up than the link climbs.`,
  'measurements/p1/round-4/sieve.md → reading.md': `${MEASURED}The sieve names the file the round's comparison would be read in, and the round stopped at its sieve, so that file was never written; the sieve says of itself that it may not be edited once a sieve cell exists.`,
  'measurements/p1/threshold.md → ../threshold.md': `${MEASURED}The link sits in a passage written to be quoted in a round's own page, one directory down, where it lands; here it climbs one directory too many.`,
};

// ---------------------------------------------------------------------------
// The guard
// ---------------------------------------------------------------------------

const corpus: Corpus = {
  pages: trackedPages(),
  tracked: trackedAndTheirDirectories(
    execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
      .split('\0')
      .filter(Boolean),
  ),
  read: (path) => readFileSync(join(ROOT, path), 'utf8'),
};

describe('every link a page carries lands', () => {
  it('lands every relative link on a tracked path, and every anchor on a heading', () => {
    const found = unlanded(corpus).filter((one) => !(one.key in AS_MEASURED));
    expect(found.map((one) => one.why)).toEqual([]);
  });

  it('keeps the links that stay as measured, and no link that stopped needing it', () => {
    const keys = [...new Set(unlanded(corpus).map((one) => one.key))].sort();
    expect(keys).toEqual(Object.keys(AS_MEASURED).sort());
    // Each says what it means where it stands, beyond the reason every entry shares.
    expect(Object.values(AS_MEASURED).filter((why) => why.length - MEASURED.length < 60)).toEqual(
      [],
    );
  });

  it('reaches the pages, and asks the anchors a reader follows', () => {
    // NON-VACUITY. A sweep that read no page, or a reading that lost the anchors, leaves the
    // first case holding over nothing. These three are links a reader of the front page and of
    // the command line's manual follows today.
    expect(corpus.pages.length).toBeGreaterThan(40);
    const asked = corpus.pages.flatMap((page) =>
      destinationsOf(corpus.read(page))
        .filter((one) => one.dest.includes('#'))
        .map((one) => `${page} → ${one.dest}`),
    );
    expect(asked).toEqual(
      expect.arrayContaining([
        'README.md → #what-lives-where',
        'README.md → plugin/README.md#in-vs-code-and-cursor',
        'packages/code/README.md → ../../plugin/README.md#in-vs-code-and-cursor',
      ]),
    );
    expect(anchorsOf(corpus.read('plugin/README.md')).has('in-vs-code-and-cursor')).toBe(true);
  });
});

describe('the reading, on pages of its own', () => {
  const pages: Record<string, string> = {
    'docs/a.md': [
      '# A page',
      '',
      '## What lives where',
      '',
      'Text with [a sibling](b.md), [a heading here](#what-lives-where), and',
      '[a heading there](b.md#the-other-one), ![an image](img/logo.png),',
      '[a directory](img/), <a href="b.md">html</a> and [a line](code.ts#L2).',
      '',
      '[ref]: ./b.md',
      '',
      'Out of reach: [the web](https://example.test/x#y), [mail](mailto:a@b.test),',
      '`[in a span](gone.md)`, <!-- [in a comment](gone.md) -->.',
      '',
      '```sh',
      '[in a fence](gone.md)',
      '```',
    ].join('\n'),
    'docs/b.md': '# B\n\nThe other one\n-------------\n',
    'docs/code.ts': 'one\ntwo\n',
    'docs/img/logo.png': '',
  };
  const tracked = trackedAndTheirDirectories(Object.keys(pages));
  const at = (extra: Record<string, string>): Corpus => {
    const all = { ...pages, ...extra };
    return {
      pages: Object.keys(all).filter((path) => path.endsWith('.md')),
      tracked: trackedAndTheirDirectories(Object.keys(all)),
      read: (path) => all[path] ?? '',
    };
  };

  it('lands what lands, and leaves out what is outside', () => {
    expect(tracked.has('docs/img')).toBe(true);
    expect(unlanded(at({}))).toEqual([]);
  });

  it('accuses a missing path, a missing heading, an anchor on a file, and a line past the end', () => {
    const broken = at({
      'docs/c.md': [
        '[gone](d.md) [renamed](b.md#the-other) [anchored](code.ts#top) [long](code.ts#L2-L9)',
        '[up](../docs/a.md#a-page) [root](/docs/b.md#b)',
      ].join('\n'),
    });
    expect(unlanded(broken).map((one) => one.why)).toEqual([
      'docs/c.md:1: no tracked path docs/d.md',
      'docs/c.md:1: docs/b.md has no heading #the-other',
      'docs/c.md:1: #top on docs/code.ts, which is not a page',
      'docs/c.md:1: docs/code.ts has 2 lines',
    ]);
  });

  it('slugs a heading the way GitHub does', () => {
    expect(slugOf('What lives where')).toBe('what-lives-where');
    expect(slugOf('In VS Code and Cursor')).toBe('in-vs-code-and-cursor');
    expect(slugOf('8. The external witness (T3)')).toBe('8-the-external-witness-t3');
    expect(slugOf('A — B')).toBe('a--b');
    expect(slugOf('`mcp_asked` against `mcp_pushed`, separated')).toBe(
      'mcp_asked-against-mcp_pushed-separated',
    );
    expect(slugOf('What this document does **not** promise')).toBe(
      'what-this-document-does-not-promise',
    );
    expect(slugOf('The [plugin](x.md) &amp; its _hooks_ ##')).toBe('the-plugin--its-hooks');
    expect([...anchorsOf('## Same\n\n## Same\n\nSame\n===\n')]).toEqual([
      'same',
      'same-1',
      'same-2',
    ]);
  });
});
