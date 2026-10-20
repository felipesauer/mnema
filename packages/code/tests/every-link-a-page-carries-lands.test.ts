/**
 * EVERY LINK A PAGE CARRIES LANDS: a relative path on a file or directory the repository
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
 *   - every relative destination (an inline link or image, a reference definition, an HTML
 *     `href` or `src`) resolves to a path `git ls-files` holds, or to a directory of one;
 *   - every anchor names a heading of the page it points at, slugged the way GitHub renders a
 *     heading ({@link slugOf}), or an `<a name>`/`<a id>` on it; an anchor alone is asked of
 *     the page it sits on;
 *   - a line anchor (`#L12`, `#L12-L20`) on a file that is not a page is asked of that file's
 *     length, because that is what GitHub makes of it;
 *   - a destination with a scheme (`https:`, `mailto:`) or none at all but `//` is left out
 *     by construction: whether it answers is a question for the network. The exception is the
 *     repository's own address on `main` (`github.com/<owner>/<repo>/blob|tree/main/<path>`
 *     and `raw.githubusercontent.com/<owner>/<repo>/main/<path>`, the owner and the repository
 *     the manifest names): it is read as the path it names, so it lands, anchor and line
 *     anchor included, exactly as a relative link would, and `blob` and `raw` ask for a file
 *     and `tree` for a directory.
 *
 * THE PACKAGE PAGES CARRY NO RELATIVE LINK AT ALL. A registry resolves a relative link of a
 * package's page against the repository root, not against the package's directory, and lands
 * it somewhere else or nowhere. So the five published packages' pages say every destination by
 * the address of the repository on `main`, and {@link relativeOnPackagePages} accuses any
 * other.
 *
 * WHAT IT DOES NOT CHECK:
 *   - the external links, above;
 *   - how a registry renders a package's page: it resolves the page's relative links against
 *     the repository, which is what is checked here, and that is read rather than measured;
 *   - a heading GitHub would derive from raw HTML other than an `<a name>` or `<a id>`;
 *   - a link whose destination holds a parenthesis, which the reading here stops at.
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

/** Every destination the prose of a page carries: inline, image, reference, HTML. */
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
 * Two spaces around a dropped dash make two hyphens, which is why `A`, an em dash and `B` make
 * `a--b`.
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

/** What a sweep needs from the repository: the disk for the real one, a map for a case's own. */
interface Corpus {
  readonly pages: readonly string[];
  readonly tracked: ReadonlySet<string>;
  readonly read: (path: string) => string;
  /** `<owner>/<repo>` of the repository, as the manifest names it. */
  readonly repo: string;
  /** Whether a page may name this repository only on `main` (a package's page, not the changelog). */
  readonly onMainOnly: (page: string) => boolean;
  /** The tracked files alone, apart from the directories in `tracked`. */
  readonly files: ReadonlySet<string>;
}

/**
 * The repository path a destination names when it is the repository's own address on `main`,
 * with the kind of path the address claims, or `null`. `rest` is the anchor, if any.
 */
function ownAddress(
  dest: string,
  repo: string,
): { path: string; rest: string; kind: 'blob' | 'tree' | 'raw' } | null {
  const escaped = repo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const github = new RegExp(`^https://github\\.com/${escaped}/(blob|tree)/main/([^#?]*)(.*)$`).exec(
    dest,
  );
  if (github !== null) {
    return {
      path: github[2] as string,
      rest: github[3] as string,
      kind: github[1] as 'blob' | 'tree',
    };
  }
  const raw = new RegExp(
    `^https://raw\\.githubusercontent\\.com/${escaped}/main/([^#?]*)(.*)$`,
  ).exec(dest);
  return raw === null ? null : { path: raw[1] as string, rest: raw[2] as string, kind: 'raw' };
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
    for (const { at, dest: written } of destinationsOf(corpus.read(page))) {
      const key = `${page} → ${written}`;
      const own = ownAddress(written, corpus.repo);
      if (
        own === null &&
        corpus.onMainOnly(page) &&
        new RegExp(`^https://github\\.com/${corpus.repo}/(?:blob|tree)/(?!main/)`).test(written)
      ) {
        found.push({ key, why: `${page}:${at}: an address of this repository not on main` });
        continue;
      }
      if (own === null && (/^[a-z][a-z0-9+.-]*:/i.test(written) || written.startsWith('//'))) {
        continue;
      }
      if (own !== null) {
        const named = own.path.replace(/\/$/, '');
        if (!corpus.tracked.has(named)) {
          found.push({ key, why: `${page}:${at}: no tracked path ${named}` });
          continue;
        }
        if (own.kind === 'tree' ? corpus.files.has(named) : !corpus.files.has(named)) {
          const wants = own.kind === 'tree' ? 'a directory' : 'a file';
          found.push({ key, why: `${page}:${at}: ${own.kind} wants ${wants}, ${named} is not` });
          continue;
        }
      }
      const dest = own === null ? written : `/${own.path}${own.rest}`;
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
// The guard
// ---------------------------------------------------------------------------

const trackedFiles = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);

/** The five packages a registry publishes; the three private ones have no page there. */
const PUBLISHED = ['chain', 'core', 'context', 'stacks', 'code'] as const;

const repoOf = (dir: string): string => {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'packages', dir, 'package.json'), 'utf8'));
  const repo = /github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/.exec(manifest.repository.url)?.[1];
  if (repo === undefined) throw new Error(`packages/${dir} names no GitHub repository`);
  return repo;
};

const corpus: Corpus = {
  pages: trackedPages(),
  tracked: trackedAndTheirDirectories(trackedFiles),
  files: new Set(trackedFiles),
  repo: repoOf('code'),
  onMainOnly: (page) => PUBLISHED.some((dir) => page === `packages/${dir}/README.md`),
  read: (path) => readFileSync(join(ROOT, path), 'utf8'),
};

/**
 * Every destination of a package's page that is neither a full address nor an anchor on the
 * page itself: a registry resolves such a destination against the repository root.
 */
function relativeOnPackagePages(
  read: (path: string) => string,
  pages: readonly string[],
): string[] {
  return pages.flatMap((page) =>
    destinationsOf(read(page))
      .filter(({ dest }) => !dest.startsWith('#') && !/^https:\/\//.test(dest))
      .map(({ at, dest }) => `${page}:${at}: ${dest}`),
  );
}

describe('every link a page carries lands', () => {
  it.each(PUBLISHED)('says every destination of packages/%s/README.md by a full address', (dir) => {
    const page = `packages/${dir}/README.md`;
    expect(relativeOnPackagePages(corpus.read, [page])).toEqual([]);
    expect(repoOf(dir)).toBe(corpus.repo);
    // NON-VACUITY. The page does carry addresses of the repository, and they are asked.
    const own = destinationsOf(corpus.read(page)).filter(
      ({ dest }) => ownAddress(dest, corpus.repo) !== null,
    );
    expect(own.length).toBeGreaterThan(0);
  });

  it('lands every relative link on a tracked path, and every anchor on a heading', () => {
    const found = unlanded(corpus);
    expect(found.map((one) => one.why)).toEqual([]);
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
        'README.md → #what-it-proves--and-what-it-does-not',
        'docs/install.md → ../plugin/README.md#in-vs-code-and-cursor',
        'docs/cli-reference.md → ../plugin/README.md#in-vs-code-and-cursor',
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
      files: new Set(Object.keys(all)),
      repo: 'owner/repo',
      onMainOnly: (page) => page === 'docs/c.md',
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

  it('reads the repository own address on main as the path it names', () => {
    const own = 'https://github.com/owner/repo';
    const good = at({
      'docs/c.md': `[a](${own}/blob/main/docs/b.md#the-other-one) [d](${own}/tree/main/docs/img) ![i](https://raw.githubusercontent.com/owner/repo/main/docs/img/logo.png)`,
    });
    expect(unlanded(good)).toEqual([]);
    const broken = at({
      'docs/c.md': [
        `[gone](${own}/blob/main/docs/d.md) [head](${own}/blob/main/docs/b.md#the-other)`,
        `[dir as file](${own}/blob/main/docs/img) [file as dir](${own}/tree/main/docs/b.md)`,
        `![raw dir](https://raw.githubusercontent.com/owner/repo/main/docs/img)`,
        `[elsewhere](https://github.com/other/repo/blob/main/nothing.md)`,
        `[branch](${own}/blob/master/docs/b.md)`,
      ].join('\n'),
    });
    expect(unlanded(broken).map((one) => one.why)).toEqual([
      'docs/c.md:1: no tracked path docs/d.md',
      'docs/c.md:1: docs/b.md has no heading #the-other',
      'docs/c.md:2: blob wants a file, docs/img is not',
      'docs/c.md:2: tree wants a directory, docs/b.md is not',
      'docs/c.md:3: raw wants a file, docs/img is not',
      'docs/c.md:5: an address of this repository not on main',
    ]);
  });

  it('accuses a relative destination on a package page, and only that', () => {
    const pages: Record<string, string> = {
      'p/README.md': [
        '[a](./x.md) [b](../y.md) [c](z/) ![i](pic.svg) <a href="w.md">w</a>',
        '[ok](https://github.com/owner/repo/blob/main/x.md) [here](#top)',
        '[ref]: ./r.md',
      ].join('\n'),
    };
    expect(relativeOnPackagePages((path) => pages[path] ?? '', ['p/README.md'])).toEqual([
      'p/README.md:1: ./x.md',
      'p/README.md:1: ../y.md',
      'p/README.md:1: z/',
      'p/README.md:1: pic.svg',
      'p/README.md:1: w.md',
      'p/README.md:3: ./r.md',
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
