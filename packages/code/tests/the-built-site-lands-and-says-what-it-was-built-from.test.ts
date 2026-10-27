// @reads-the-tree
/**
 * THE BUILT SITE LANDS, AND SAYS WHAT IT WAS BUILT FROM. This reads the HTML `site/` wrote (`site/dist/`),
 * not the sources the build read: a source can be right and the page wrong, and a stranger reads the page.
 *
 *   - EVERY PAGE OF `docs/` IS A PAGE, AND EVERY PAGE IS A FILE: `dist/docs/<name>/` for each tracked
 *     `docs/<name>.md`, and no page of `docs/` that is not one (no second source).
 *   - NO LINK IS BROKEN: every address on every page that points inside the site is a file of `dist/`, and
 *     every `#fragment` is an id of the page it names; every link to GitHub names a file or a directory git
 *     holds at the commit the site was built from.
 *   - NO SENTENCE IS THE SITE'S OWN: every block of prose on a page of `docs/` is found, letters and numbers
 *     only, in the file it was rendered from; every block of the landing is found in the README, the pages of
 *     `docs/` or the description of `@mnema/code`.
 *   - NO COLOUR AND NO PICTURE IS THE SITE'S OWN: the accent in the built style is the one `accent.mjs`
 *     holds, the ground is `PAGE`, the theme's own rule sits in no layer (Starlight's defaults are in one
 *     and would win), the pictures are the bytes of `docs/assets/`, and the icon is the one `icon.mjs` draws.
 *   - THE FOOTER SAYS WHAT WAS BUILT: the version of `@mnema/code` and the commit, on every page, the ones
 *     of this checkout.
 *   - THE SITE DOES NOT SAY THE DOCS DESCRIBE THE NEXT VERSION: the sentence is true on GitHub and npm and
 *     false here, so no built page holds it.
 *   - /RECORD/ IS THE PAGE `mnema site --back-link` WRITES for this commit's record, byte for byte, with no
 *     step between, and it opens with the one link back to the site's root.
 *
 * It needs the site built (`cd site && npm ci --ignore-scripts && npm run build`, after `pnpm build`). In
 * the main suite and in `pnpm test:guards` there is no build, and the cases stand down by name; the site
 * workflow sets `THE_SITE_MUST_BE_BUILT=1`, and then a missing build is the failure.
 *
 * WHAT IT DOES NOT CHECK: external links (no network here: the after-merge link check asks the network), the
 * colours Starlight paints its own chrome and code with, or how the pages look.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { copyOf, recordBackLink, themeOf } from '../../../site/build/the-pages.mjs';
import {
  addressesOf,
  blocksOfMain,
  DIST,
  head,
  htmlFiles,
  idsOf,
  isDirectory,
  isFile,
  norm,
  proseBlocks,
  ROOT,
  readText,
  SITE,
  textOf,
  tracked,
} from './support/reading-the-site.js';

const BUILT = existsSync(join(DIST, 'index.html'));
const MUST = process.env.THE_SITE_MUST_BE_BUILT === '1';
const when = BUILT ? describe : describe.skip;

const BASE = '/mnema';
const GITHUB = 'https://github.com/felipesauer/mnema';

/**
 * What the landing's test holds a block to: a short block (a heading, a label) is a few words that any
 * long source holds somewhere, so being found inside the text proves nothing for it, and it must be a
 * whole line of a source; a longer block need only be found in the text.
 */
function sourcesSay(text: string): (block: string) => boolean {
  const corpus = norm(text);
  const lines = new Set(text.split('\n').map((l) => norm(l.replace(/^\s*(?:#+|[-*|])\s*/, ''))));
  return (block) =>
    block.split(' ').length < 4 ? lines.has(norm(block)) : corpus.includes(norm(block));
}

describe('a short block of the landing is held to a whole line of a source', () => {
  const say = sourcesSay(
    '# Why mnema\n\nHello there, and welcome to the long paragraph.\n- A label\n',
  );

  it('passes a heading or a label that is a line of a source, and a long block found inside it', () => {
    expect(say('Why mnema')).toBe(true);
    expect(say('A label')).toBe(true);
    expect(say('Hello there, and welcome to the long paragraph.')).toBe(true);
  });

  it('refuses a short block that is only words inside a longer line', () => {
    expect(say('Hello.')).toBe(false);
    expect(say('Hello there')).toBe(false);
    expect(say('long paragraph')).toBe(false);
  });
});

describe('the text a reader gets from the <main> of a page is read in blocks, and nothing escapes them', () => {
  const read = (inner: string): ReturnType<typeof blocksOfMain> =>
    blocksOfMain(`<body><header>Not main</header><main>${inner}</main></body>`);

  it('reads a paragraph, a heading, a div and a button as a block each, a span as part of the block around it', () => {
    const got = read(
      '<h2>A title</h2><p>One <a href="/x">link</a> and <code>code</code>.</p><div>Loose words <span>and a span</span></div><div class="actions"><a class="sl-link-button" href="/y">Go<svg><path/></svg></a><a class="sl-link-button" href="/z">Stay</a></div>',
    );
    expect([...got.text].sort()).toEqual(
      ['A title', 'One link and code.', 'Loose words and a span', 'Go', 'Stay'].sort(),
    );
  });

  it('finds a span of its own words and a div of typed words: the kind of element does not hide them', () => {
    expect(read('<div><span>Trusted by thousands</span></div>').text).toEqual([
      'Trusted by thousands',
    ]);
    expect(read('<section><div>Typed here</div></section>').text).toEqual(['Typed here']);
  });

  it('reads the alt, the title and the aria-label as words a reader is told', () => {
    const got = read(
      '<p><img src="a.gif" alt="An alt"><a href="/" title="A title" aria-label="A label">go</a></p>',
    );
    expect(got.spoken).toEqual(['An alt', 'A title', 'A label']);
    expect(read('<img src="a.svg" alt="">').spoken).toEqual([]);
  });

  it('leaves out only: scripts, styles, svg, code blocks, heading anchors, the commit link and the verdict', () => {
    const got = read(
      '<script>var a = "x"</script><style>.a{}</style><svg><title>T</title></svg>' +
        '<div class="expressive-code"><figure><pre>code</pre></figure></div>' +
        '<h2>Why<a class="sl-anchor-link" href="#why"><span class="sr-only">Section titled</span></a></h2>' +
        '<figure><pre data-verdict>public: ok</pre><figcaption>Said at <a data-commit href="/c">abc</a></figcaption></figure>' +
        '<pre>other pre</pre>',
    );
    expect([...got.text].sort()).toEqual(['Said at', 'Why', 'other pre'].sort());
  });
});

describe('the site is built when the run says it must be', () => {
  it('has a build to read', () => {
    if (MUST) expect(BUILT, 'site/dist is not built, and this run says it must be').toBe(true);
    else expect(true).toBe(true);
  });
});

when('the built site', () => {
  const pages = (BUILT ? htmlFiles(DIST) : []).filter(
    (f) => !f.startsWith('record/') && !f.startsWith('pagefind/'),
  );
  const html = (page: string): string => readText(join(DIST, page));
  const names = tracked('docs/*.md').map((f) => f.slice(5, -3));

  it('has a page for each page of docs/, and none that is not one', () => {
    const built = pages.filter((p) => p.startsWith('docs/')).map((p) => p.split('/')[1]);
    expect([...built].sort()).toEqual(names);
    expect(names.length).toBeGreaterThan(10);
    for (const name of [
      'index.html',
      '404.html',
      'record/index.html',
      'llms.txt',
      'robots.txt',
      'sitemap-index.xml',
    ]) {
      expect(isFile(join(DIST, name)), `${name} is missing`).toBe(true);
    }
  });

  it('has no link that goes nowhere: every address inside the site is a file, every fragment an id', () => {
    const seen = { site: 0, fragment: 0, github: 0 };
    const held = tracked();
    const sha = head();
    for (const page of [...pages, 'record/index.html']) {
      const text = html(page);
      const here = `${BASE}/${page.replace(/index\.html$/, '')}`;
      for (const raw of addressesOf(text)) {
        if (/^(mailto:|data:|javascript:)/.test(raw)) continue;
        if (raw.startsWith(`${GITHUB}/blob/`)) {
          seen.github++;
          const [path = ''] = raw.slice(`${GITHUB}/blob/${sha}/`.length).split('#');
          expect(
            raw.startsWith(`${GITHUB}/blob/${sha}/`),
            `${page}: ${raw} is not at the commit of the build`,
          ).toBe(true);
          expect(
            held.includes(path) || (path.endsWith('/') && held.some((f) => f.startsWith(path))),
            `${page}: ${raw}`,
          ).toBe(true);
          continue;
        }
        if (/^https?:/.test(raw)) continue;
        const [pathPart = '', fragment] = raw.split('#');
        const url =
          pathPart === '' ? here : pathPart.startsWith('/') ? pathPart : posix.join(here, pathPart);
        const clean = (url.split('?')[0] ?? '').replace(/\/\.\//g, '/');
        expect(clean.startsWith(`${BASE}/`), `${page}: ${raw} leaves the site's base`).toBe(true);
        const target = join(DIST, clean.slice(BASE.length));
        const file = isDirectory(target) ? join(target, 'index.html') : target;
        expect(isFile(file), `${page}: ${raw} is not a file of the site`).toBe(true);
        seen.site++;
        if (fragment !== undefined && fragment !== '' && file.endsWith('.html')) {
          seen.fragment++;
          expect(
            idsOf(readText(file)).has(decodeURIComponent(fragment)),
            `${page}: ${raw} names no id`,
          ).toBe(true);
        }
      }
    }
    expect(seen.site, 'the sweep followed the links').toBeGreaterThan(500);
    expect(seen.fragment, 'the sweep followed the fragments').toBeGreaterThan(50);
    expect(seen.github, 'the sweep found the links to GitHub').toBeGreaterThan(150);
  });

  it('has no sentence of its own on a page of docs/: each block is in the file it came from', () => {
    let blocks = 0;
    for (const name of names) {
      const source = norm(readText(join(ROOT, 'docs', `${name}.md`)));
      for (const block of proseBlocks(html(`docs/${name}/index.html`))) {
        blocks++;
        expect(
          source.includes(norm(block)),
          `docs/${name}.md does not hold: ${block.slice(0, 120)}`,
        ).toBe(true);
      }
    }
    expect(blocks, 'the sweep read the prose').toBeGreaterThan(1000);
  });

  /** The README's Quick start: the command on its one line that starts with `mnema verify`, up to the `#`. */
  const verifyCommandInReadme = (): string => {
    const quick = /## Quick start\n[\s\S]*?```sh\n([\s\S]*?)\n```/.exec(
      readText(join(ROOT, 'README.md')),
    )?.[1];
    const lines = (quick ?? '').split('\n').filter((l) => /^mnema verify\b/.test(l));
    expect(lines, 'the Quick start has one line that starts with mnema verify').toHaveLength(1);
    return (lines[0] ?? '').split('#')[0]?.trim() ?? '';
  };

  const landingCorpus = (): string =>
    [
      readText(join(ROOT, 'README.md')),
      // The README's own HTML (the captions of its recordings) as a reader sees it, tags out.
      textOf(readText(join(ROOT, 'README.md'))),
      ...names.map((n) => readText(join(ROOT, 'docs', `${n}.md`))),
      (JSON.parse(readText(join(ROOT, 'packages/code/package.json'))) as { description: string })
        .description,
      // From site/copy.md, only its entries: the title and the sentence that opens the file are not a source.
      ...[...(copyOf(readText(join(SITE, 'copy.md'))) as Map<string, string>).values()],
    ].join('\n');

  it('has no sentence of its own on the landing: each block is in the README, a page of docs/, the description or an entry of site/copy.md', () => {
    const say = sourcesSay(landingCorpus());
    const landing = html('index.html');
    const hero = [
      ...landing.matchAll(/<(?:h1|p)\b(?![^>]*the-build)[^>]*>([\s\S]*?)<\/(?:h1|p)>/g),
    ].map((m) => textOf(m[1] ?? ''));
    const blocks = [...proseBlocks(landing), ...hero];
    expect(
      blocks.filter((b) => b.split(' ').length < 4).length,
      'the landing has short blocks to hold to a line',
    ).toBeGreaterThan(0);
    expect(blocks.length, 'the landing has prose').toBeGreaterThan(8);
    for (const block of blocks) {
      expect(say(block), `the landing says what no source says: ${block.slice(0, 120)}`).toBe(true);
    }
  });

  it('has no sentence of its own anywhere in the <main> of the landing: every block, every alt, title and aria-label, and nothing left over', () => {
    const say = sourcesSay(landingCorpus());
    // The command shown beside the verdict is a line of the Quick start read up to its `#`: a source, as the case below holds.
    const command = verifyCommandInReadme();
    const { text, spoken, stripped } = blocksOfMain(html('index.html'));
    expect(text.length, 'the <main> has text').toBeGreaterThan(15);
    expect(spoken.length, 'the <main> has pictures with words').toBeGreaterThan(0);
    for (const block of [...text, ...spoken]) {
      expect(
        block === command || say(block),
        `the <main> of the landing says what no source says: ${block.slice(0, 120)}`,
      ).toBe(true);
    }
    // Totality: the letters and numbers of the <main>, less the exclusions, are the letters and numbers of the blocks.
    const letters = (s: string): string => [...norm(s)].sort().join('');
    expect(letters(textOf(stripped)), 'text of the <main> that no block holds').toBe(
      letters(text.join(' ')),
    );
  });

  it('paints in the one accent and shows the bytes of the pictures: nothing drawn for the site', async () => {
    const { ACCENT } = (await import(
      pathToFileURL(join(ROOT, '.github/the-front-page/accent.mjs')).href
    )) as { ACCENT: { dark: string; light: string } };
    const astro = join(DIST, '_astro');
    const css = readdirSync(astro)
      .filter((f) => f.endsWith('.css'))
      .map((f) => readText(join(astro, f)))
      .join('\n');
    const inlined = pages.map((p) => html(p)).join('\n');
    for (const hex of [ACCENT.dark, ACCENT.light]) {
      expect(
        css.includes(hex) || inlined.includes(hex),
        `the accent ${hex} is not in the built style`,
      ).toBe(true);
    }
    // Starlight's own chrome keeps its defaults in a layer; what the front page paints is the unlayered
    // rule of each theme, and it must be the front page's own value.
    expect(
      css.includes(`:root{--sl-color-accent:${ACCENT.dark};`),
      "the dark accent is not the front page's",
    ).toBe(true);
    expect(
      /:root\[data-theme="?light"?\]\{--sl-color-accent:/.exec(css + inlined) &&
        css.includes(`{--sl-color-accent:${ACCENT.light};`),
      "the light accent is not the front page's",
    ).toBe(true);

    for (const file of [
      'banner-dark.svg',
      'banner-light.svg',
      'how-it-works-dark.svg',
      'the-family-light.svg',
    ]) {
      expect(
        readFileSync(join(DIST, 'assets', file)).equals(
          readFileSync(join(ROOT, 'docs/assets', file)),
        ),
        `${file} is not the picture of docs/assets`,
      ).toBe(true);
    }
    const hero = [
      ...html('index.html').matchAll(/src="([^"]*banner-(?:dark|light)[^"]*\.svg)"/g),
    ].map((m) => m[1] as string);
    expect(hero.length).toBeGreaterThanOrEqual(2);
    for (const src of hero) {
      const file = readFileSync(join(DIST, src.slice(BASE.length + 1)));
      const which = /banner-(dark|light)/.exec(src)?.[1];
      expect(
        file.equals(readFileSync(join(ROOT, 'docs/assets', `banner-${which}.svg`))),
        `${src} is not the banner`,
      ).toBe(true);
    }
    const { drawIcon } = (await import(
      pathToFileURL(join(ROOT, 'packages/vscode/build/icon.mjs')).href
    )) as { drawIcon: (blocks: readonly string[]) => Buffer };
    const { THE_BLOCKS } = (await import(
      pathToFileURL(join(ROOT, 'packages/code/dist/presentation/banner.js')).href
    )) as { THE_BLOCKS: readonly string[] };
    expect(
      readFileSync(join(DIST, 'favicon.png')).equals(drawIcon(THE_BLOCKS)),
      'the favicon is not the icon the extension draws',
    ).toBe(true);
  });

  it('carries the calculated theme in a rule of no layer, so Starlight does not take it back', async () => {
    const { ACCENT } = (await import(
      pathToFileURL(join(ROOT, '.github/the-front-page/accent.mjs')).href
    )) as { ACCENT: { dark: string; light: string } };
    const { PAGE } = (await import(
      pathToFileURL(join(ROOT, '.github/the-front-page/draw.mjs')).href
    )) as { PAGE: { dark: string; light: string } };
    const theme = themeOf({ ACCENT, PAGE }) as Record<'dark' | 'light', Record<string, string>>;
    const astro = join(DIST, '_astro');
    const css = readdirSync(astro)
      .filter((f) => f.endsWith('.css'))
      .map((f) => readText(join(astro, f)))
      .join('\n');
    // The minifier writes `#ffffff` as `#fff`.
    const short = (hex: string): string =>
      /^#(.)\1(.)\2(.)\3$/.test(hex) ? hex.replace(/^#(.).(.).(.)./, '#$1$2$3') : hex;
    const starts = {
      dark: ':root{--sl-color-accent:',
      light: ':root[data-theme=light]{--sl-color-accent:',
    } as const;
    for (const which of ['dark', 'light'] as const) {
      const at = css.indexOf(`${starts[which]}${short(ACCENT[which])};`);
      expect(at, `${which}: the rule of the theme is in the built style`).toBeGreaterThanOrEqual(0);
      const before = css.slice(0, at);
      const depth = (before.match(/\{/g) ?? []).length - (before.match(/\}/g) ?? []).length;
      expect(
        depth,
        `${which}: the rule sits inside a block (a layer?) and loses to Starlight's`,
      ).toBe(0);
      const rule = `${css.slice(at, css.indexOf('}', at))};`;
      expect(rule, `${which}: the ground is the page's`).toContain(
        `--sl-color-black:${short(PAGE[which])};`,
      );
      for (const name of ['text-accent', 'accent-high', 'bg-inline-code', 'gray-3']) {
        expect(rule, `${which}: ${name}`).toContain(
          `--sl-color-${name}:${short(theme[which][name] as string)};`,
        );
      }
    }
  });

  /** The text of a piece of HTML as the reader's browser reads it: the entities undone, no white space touched. */
  const unescaped = (s: string): string =>
    s
      .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCodePoint(Number.parseInt(h, 16)))
      .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&');

  it('shows on the landing the verdict of the committed record: the command of the Quick start and the bytes of a run of its own', () => {
    const landing = html('index.html');
    const figure =
      /<figure class="the-verdict[^"]*"[^>]*>([\s\S]*?)<\/figure>/.exec(landing)?.[1] ?? '';
    const command = verifyCommandInReadme();
    expect(/<code>([^<]*)<\/code>/.exec(figure)?.[1], 'the command beside the verdict').toBe(
      command,
    );
    const shown = unescaped(
      /<pre\b[^>]*data-verdict[^>]*>([\s\S]*?)<\/pre>/.exec(figure)?.[1] ?? '',
    );
    expect(shown, 'the verdict is shown').not.toBe('');
    expect(
      shown.split('\n').some((l) => l.startsWith('private:')),
      'a private tree is in the verdict',
    ).toBe(false);

    // An independent run: the record of HEAD, taken out of the repository into a directory of its own, and the binary on it.
    const dir = mkdtempSync(join(tmpdir(), 'the-verdict-landing-'));
    try {
      const tar = join(dir, 'record.tar');
      execFileSync('git', ['archive', '--format=tar', '-o', tar, 'HEAD', '.mnema'], { cwd: ROOT });
      const tree = join(dir, 'tree');
      mkdirSync(tree);
      execFileSync('tar', ['-xf', tar, '-C', tree]);
      execFileSync('git', ['init', '-q', tree]);
      const home = mkdtempSync(join(tmpdir(), 'the-verdict-landing-home-'));
      const ran = spawnSync(
        process.execPath,
        [join(ROOT, 'packages/code/dist/cli.js'), ...command.split(' ').slice(1)],
        { cwd: tree, env: { HOME: home, PATH: process.env.PATH ?? '' }, encoding: 'utf8' },
      );
      rmSync(home, { recursive: true, force: true });
      expect(ran.status, ran.stderr).toBe(0);
      expect(shown, 'the landing shows the bytes of a run of its own').toBe(ran.stdout);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    expect(
      /data-commit href="[^"]*\/commit\/([0-9a-f]{40})"/.exec(figure)?.[1],
      'the commit beside the verdict',
    ).toBe(head());
  }, 60_000);

  it('shows on the landing the recording of the repository, as the README words it, and on no other page', () => {
    const gif = join(ROOT, 'recordings/a-write-refused.gif');
    expect(
      readFileSync(join(DIST, 'recordings/a-write-refused.gif')).equals(readFileSync(gif)),
      "the recording is not the repository's",
    ).toBe(true);
    const landing = html('index.html');
    const img =
      /<img\b[^>]*src="[^"]*recordings\/a-write-refused\.gif"[^>]*>/.exec(landing)?.[0] ?? '';
    expect(img, 'the landing shows the recording').not.toBe('');
    const readme = readText(join(ROOT, 'README.md'));
    const alt = /\salt="([^"]*)"/.exec(img)?.[1] ?? '?';
    expect(readme, "the alt is the README's").toContain(
      `<img src="recordings/a-write-refused.gif" alt="${alt.replace(/&#39;/g, "'")}"`,
    );
    expect(img).toContain('loading="lazy"');
    const caption =
      /<figure class="the-recording[^"]*"[^>]*>[\s\S]*?<figcaption>([\s\S]*?)<\/figcaption>/.exec(
        landing,
      )?.[1] ?? '';
    expect(readme, "the caption is the README's").toContain(
      textOf(caption).split(' Recorded')[0] ?? '?',
    );
    for (const other of ['404.html', 'docs/install/index.html']) {
      expect(html(other), `${other} carries the proof`).not.toMatch(
        /the-proof|data-verdict|a-write-refused/,
      );
    }
  });

  it('does not say that the pages describe the next version: that is the repository, not the published version', () => {
    for (const page of pages) {
      expect(textOf(html(page)), `${page} says it`).not.toMatch(/describe the next version/i);
    }
  });

  it('says in its footer the version and the commit it was built from, on every page', () => {
    const version = (
      JSON.parse(readText(join(ROOT, 'packages/code/package.json'))) as { version: string }
    ).version;
    const sha = head();
    for (const page of pages) {
      const text = html(page);
      expect(/data-version>([^<]*)</.exec(text)?.[1], `${page}: version`).toBe(version);
      expect(
        /data-commit href="[^"]*\/commit\/([0-9a-f]{40})"/.exec(text)?.[1],
        `${page}: commit (is site/dist older than this checkout? build the site again)`,
      ).toBe(sha);
      const footer = /<p class="the-build[^"]*">([\s\S]*?)<\/p>/.exec(text)?.[1] ?? '';
      // `textOf` puts a space where a tag was, which would hide the missing one: what a reader sees is the tags
      // taken out and nothing put in their place.
      expect(
        footer.replace(/<[^>]*>/g, ''),
        `${page}: the footer reads "commit <sha>", with the space`,
      ).toMatch(/· commit [0-9a-f]{12}$/);
    }
  });

  it('serves as /record/ the page `mnema site` writes for this commit, with no step between', () => {
    const out = mkdtempSync(join(tmpdir(), 'the-record-built-'));
    try {
      const home = mkdtempSync(join(tmpdir(), 'the-record-home-'));
      execFileSync(
        process.execPath,
        [
          join(ROOT, 'packages/code/dist/cli.js'),
          'site',
          '--out',
          out,
          '--back-link',
          recordBackLink({ base: BASE }),
        ],
        { cwd: ROOT, env: { HOME: home, PATH: process.env.PATH ?? '' }, stdio: 'pipe' },
      );
      rmSync(home, { recursive: true, force: true });
      expect(
        readFileSync(join(DIST, 'record/index.html')).equals(readFileSync(join(out, 'index.html'))),
      ).toBe(true);
      expect(html('record/index.html')).toContain(`<p><a href="${BASE}/">Back</a></p>`);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it('lists in llms.txt the pages the README lists, and nothing else', () => {
    const text = readText(join(DIST, 'llms.txt'));
    const readme = readText(join(ROOT, 'README.md'));
    const docs = /## Docs\n([\s\S]*?)\n## /.exec(readme)?.[1] ?? '';
    const listed = [...docs.matchAll(/\]\(([^)#]+\.md)(?:#[^)]*)?\)/g)].map((m) => m[1] as string);
    const raw = [
      ...text.matchAll(
        /\]\(https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[0-9a-f]{40}\/([^)]+)\)/g,
      ),
    ].map((m) => m[1] as string);
    expect(listed.length).toBeGreaterThan(15);
    expect([...new Set(raw)].sort()).toEqual([...new Set(listed)].sort());
  });
});
