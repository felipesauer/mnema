/**
 * THE FRONT PAGE IS DRAWN FROM THE CONSOLE — the pictures in `docs/assets/` are made by a script
 * from the same sources the console draws from, and painted in one accent.
 *
 *   - THE BANNER is the console's wordmark: `.github/the-front-page/draw.mjs` reads the rows of
 *     `THE_BLOCKS` (`src/presentation/banner.ts`) and draws each glyph as geometry. Here the
 *     script runs again in memory over the rows the console draws today, and every picture it
 *     makes is held byte for byte to the one committed — so a wordmark changed in the console and
 *     not drawn again fails here, and so does a picture edited by hand.
 *   - THE ACCENT is one constant (`.github/the-front-page/accent.mjs`): `#c4a0f5` on a dark page,
 *     `#997dbf` on a light one. Every colour in every SVG of `docs/assets/` is either neutral — a
 *     grey, whose channels lie within {@link NEUTRAL_SPREAD} of each other — or the accent of the
 *     theme the file is named for. Any other hue fails, and so does a colour written in a form
 *     this does not read (a name, `rgb()`, `hsl()`), rather than pass unread.
 *   - THE PACKAGES: each published package has its own picture, drawn by the same script into
 *     `packages/<p>/assets/`, held byte for byte here and painted in the same accent. Every word
 *     on it is a literal of the product, found here in the file the script names for it; no
 *     text on it is anything else, and none is a host's name, a count that changes, or a
 *     promise the package does not make. The id a line of output prints is drawn elided, and a
 *     text inside a box sits on the box's middle by the size of its role.
 *   - THE URL OF A PACKAGE'S PICTURE: the README of a package opens, under its title, with the
 *     block the script writes, pointing at the file on the repository's `main` branch by the
 *     address of the repository its `package.json` says, with no version in it, because a
 *     version that is not published yet is a picture that does not load. Hand-editing the
 *     address fails here.
 *   - THE BADGES: a shields.io badge in `README.md` or a package's README that sets a colour,
 *     in `color=` or in its path (`/badge/label-message-colour`), sets the light accent.
 *
 * HOW THE PICTURES ARE MADE AGAIN, from the root of a built checkout (`pnpm build`):
 *
 *     node .github/the-front-page/draw.mjs          # writes docs/assets/*.svg
 *     node .github/the-front-page/draw.mjs --check  # exits 1 when a committed one differs
 *
 * WHAT IT DOES NOT CHECK: how the pictures look. The geometry is held to its source, not to an
 * eye; a reviewer sees the picture in the pull request.
 */

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { HOSTS } from '../src/host-names.js';
import { THE_BLOCKS } from '../src/presentation/banner.js';
import { ROOT, read } from './support/published-examples.js';

/** Named by a variable, because these are scripts of the repository and not modules of the product. */
const DRAW = join(ROOT, '.github', 'the-front-page', 'draw.mjs');
const ACCENT_FILE = join(ROOT, '.github', 'the-front-page', 'accent.mjs');

type Line = readonly ({ said: string; where: string } | string)[];
const {
  drawTheFrontPage,
  drawThePackages,
  PACKAGE_PICTURES,
  SEPARATORS,
  ELIDED,
  TYPE,
  HALF_ROW,
  textOf,
  pictureBlock,
} = (await import(pathToFileURL(DRAW).href)) as {
  drawTheFrontPage: (blocks: readonly string[]) => Record<string, string>;
  drawThePackages: (blocks: readonly string[]) => Record<string, string>;
  PACKAGE_PICTURES: readonly { dir: string; lines: Readonly<Record<string, Line>> }[];
  SEPARATORS: readonly string[];
  ELIDED: string;
  TYPE: Readonly<Record<string, { size: number; centre: number }>>;
  HALF_ROW: number;
  textOf: (line: Line) => string;
  pictureBlock: (dir: string) => string;
};
const { ACCENT } = (await import(pathToFileURL(ACCENT_FILE).href)) as {
  ACCENT: { dark: string; light: string };
};

const ASSETS = 'docs/assets';

/** The most two channels of a grey may differ by, out of 255. GitHub's own greys spread by 9 to 21. */
const NEUTRAL_SPREAD = 24;

/** Every colour a file names: in a paint attribute, in a style, and any hex anywhere else. */
function coloursIn(svg: string): string[] {
  const named = [
    ...svg.matchAll(
      /(?:fill|stroke|stop-color|flood-color|lighting-color|color)\s*[=:]\s*["']?([^"';\s>{}]+)/g,
    ),
  ].map((m) => m[1] as string);
  const hexes = [...svg.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0]);
  const functions = [...svg.matchAll(/\b(?:rgba?|hsla?)\s*\(/g)].map((m) => m[0]);
  return [...named, ...hexes, ...functions];
}

/** Why a colour is not allowed in a file of that theme, or nothing when it is. */
function whyNot(colour: string, accent: readonly string[]): string | undefined {
  if (colour === 'none') return undefined;
  const hex = /^#([0-9a-fA-F]{6})$/.exec(colour)?.[1] ?? /^#([0-9a-fA-F]{3})$/.exec(colour)?.[1];
  if (hex === undefined) return `${colour}: not a hex this reads`;
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
  const channels = [0, 2, 4].map((i) => Number.parseInt(full.slice(i, i + 2), 16));
  if (Math.max(...channels) - Math.min(...channels) <= NEUTRAL_SPREAD) return undefined;
  if (accent.includes(`#${full.toLowerCase()}`)) return undefined;
  return `${colour}: a hue that is not the accent (${accent.join(' or ')})`;
}

/** The accent a file may use, by the theme its name says. */
function accentFor(file: string): string[] {
  if (file.endsWith('-dark.svg')) return [ACCENT.dark];
  if (file.endsWith('-light.svg')) return [ACCENT.light];
  return [ACCENT.dark, ACCENT.light];
}

/** Every picture a page shows: the front page's, and each package's own. */
const svgs = [
  ...readdirSync(join(ROOT, ASSETS)).map((f) => `${ASSETS}/${f}`),
  ...readdirSync(join(ROOT, 'packages')).flatMap((p) => {
    try {
      return readdirSync(join(ROOT, 'packages', p, 'assets')).map(
        (f) => `packages/${p}/assets/${f}`,
      );
    } catch {
      return [];
    }
  }),
].filter((f) => f.endsWith('.svg'));

describe('the front page is drawn from the console', () => {
  const drawn = drawTheFrontPage(THE_BLOCKS);

  it('draws the banner and the steps, dark and light', () => {
    expect(Object.keys(drawn).sort()).toEqual([
      'banner-dark.svg',
      'banner-light.svg',
      'how-it-works-dark.svg',
      'how-it-works-light.svg',
      'how-mnema-fits-dark.svg',
      'how-mnema-fits-light.svg',
    ]);
  });

  it.each(Object.keys(drawn))('%s is what the script draws from the console today', (file) => {
    expect(read(`${ASSETS}/${file}`)).toBe(drawn[file]);
  });

  it('draws every glyph of the wordmark the console has', () => {
    // A glyph the script skipped would leave the banner short of the console and the case above
    // green, so the counts are asked of the rows themselves: one filled cell per full block, two
    // strokes per double-line glyph.
    const glyphs = [...THE_BLOCKS.join('')].filter((g) => g !== ' ');
    const full = glyphs.filter((g) => g === '█').length;
    const subpaths = (kind: string): number => {
      const d = new RegExp(`data-of="${kind}"[^>]* d="([^"]*)"`).exec(
        drawn['banner-dark.svg'] ?? '',
      );
      return (d?.[1] ?? '').match(/M/g)?.length ?? 0;
    };
    expect(full).toBeGreaterThan(100);
    expect(subpaths('blocks')).toBe(full);
    expect(subpaths('lines')).toBe(2 * (glyphs.length - full));
  });
});

/** The text of every `<text>` of a picture, as a reader sees it. */
function wordsOf(svg: string): string[] {
  const texts = [...svg.matchAll(/<text\b[^>]*>([^<]*)<\/text>/g)].map((m) =>
    (m[1] as string)
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replaceAll('&quot;', '"')
      .replaceAll('&amp;', '&'),
  );
  // A text this does not read (one with a `<tspan>` inside) would pass unread.
  expect(texts.length).toBe(svg.match(/<text\b/g)?.length ?? 0);
  return texts;
}

describe('every package draws what it is, in its own words', () => {
  const drawn = drawThePackages(THE_BLOCKS);
  const manifest = (dir: string): { name: string; version: string; repository: { url: string } } =>
    JSON.parse(read(`packages/${dir}/package.json`)) as {
      name: string;
      version: string;
      repository: { url: string };
    };

  it('draws the five published packages, dark and light', () => {
    expect(Object.keys(drawn).sort()).toEqual(
      ['chain', 'code', 'context', 'core', 'stacks'].flatMap((p) => [
        `packages/${p}/assets/${p}-dark.svg`,
        `packages/${p}/assets/${p}-light.svg`,
      ]),
    );
  });

  it.each(Object.keys(drawn))('%s is what the script draws today', (path) => {
    expect(read(path)).toBe(drawn[path]);
  });

  it.each(Object.keys(drawn))('%s moves by keyframes it defines', (path) => {
    // A name with no keyframes leaves its element still, in the last frame, and the picture
    // reads as drawn: one was written before the story that names the keyframes had run.
    const svg = drawn[path] ?? '';
    const named = [...svg.matchAll(/animation-name:([^"]+)"/g)].flatMap((m) =>
      (m[1] as string).split(','),
    );
    const defined = new Set([...svg.matchAll(/@keyframes (\w+)\{/g)].map((m) => m[1]));
    expect(named.length).toBeGreaterThan(10);
    expect(named.filter((name) => !defined.has(name))).toEqual([]);
  });

  it.each(Object.keys(drawn))('%s leaves no element alone at the end of the loop', (path) => {
    // Every element there in the last frame fades out at the same moment; one that went out
    // later stayed on the page by itself, the rest of the picture already gone.
    const exits = [
      ...read(path).matchAll(/@keyframes (\w+)\{((?:[\d.]+%\{opacity:[\d.]+\})+)\}/g),
    ].map((m) => {
      const stops = [...(m[2] as string).matchAll(/([\d.]+)%\{opacity:([\d.]+)\}/g)].map(
        (s) => [Number(s[1]), Number(s[2])] as const,
      );
      let out = stops.length - 1;
      while (out > 0 && stops[out - 1]?.[1] === 0) out--;
      return { name: m[1] as string, at: stops[out]?.[0] ?? 0 };
    });
    const counts = new Map<number, number>();
    for (const { at } of exits) counts.set(at, (counts.get(at) ?? 0) + 1);
    const together = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
    expect(exits.length).toBeGreaterThan(10);
    expect(together).toBeLessThan(100);
    expect(exits.filter(({ at }) => at > together)).toEqual([]);
  });

  it('draws the digest of the stack whole, as its README states it', () => {
    const digest = /`([0-9a-f]{64})`/.exec(read('packages/stacks/README.md'))?.[1];
    for (const theme of ['dark', 'light']) {
      const words = wordsOf(read(`packages/stacks/assets/stacks-${theme}.svg`));
      expect(words.filter((w) => /^[0-9a-f]{32}$/.test(w)).join('')).toBe(digest);
    }
  });

  it('draws the output of the command line as lines of its golden, the id elided', () => {
    // The command line prints a record's id in the parentheses, a new one on every run; the
    // golden stands a placeholder there that no one ever sees. The picture draws neither: it
    // draws the line up to the id, the id as a visible `(…)`, and the rest of the line.
    const golden = read('packages/code/src/cli.writes.golden.txt').split('\n');
    const words = wordsOf(read('packages/code/assets/code-light.svg'));
    const output = words.filter((w) => /^(?:Recorded decision|Decision) /.test(w));
    expect(output).toHaveLength(2);
    for (const line of output) {
      const [before, after, ...more] = line.split(` ${ELIDED}`);
      expect(more).toEqual([]);
      expect(after).toBeDefined();
      const cut = `| ${before} (`;
      const matches = golden.filter(
        (g) => g.startsWith(cut) && /^<[a-z-]+>\)/.test(g.slice(cut.length)),
      );
      expect(matches.map((g) => g.slice(cut.length).replace(/^<[a-z-]+>\)/, ''))).toContain(after);
    }
  });

  it.each(Object.keys(drawn))('%s centres every text in its box by its role', (path) => {
    // A text inside a box sits where one rule puts it: its baseline is the middle of the box,
    // plus how far the middle of a line's ink sits above its baseline in that size, plus a whole
    // number of half rows. A column of a box with a single line sits on the middle itself. A `y`
    // set by hand lands off that lattice and fails here.
    const svg = drawn[path] ?? '';
    const num = (tag: string, name: string): number =>
      Number(new RegExp(`\\b${name}="([-\\d.]+)"`).exec(tag)?.[1] ?? Number.NaN);
    const rects = [...svg.matchAll(/<rect\b[^>]*>/g)]
      .map((m) => m[0])
      .filter((t) => /\bx="/.test(t))
      .map((t) => ({ x: num(t, 'x'), y: num(t, 'y'), w: num(t, 'width'), h: num(t, 'height') }));
    const centreOf = (size: number): number => {
      const role = Object.values(TYPE).find((r) => r.size === size);
      expect(role).toBeDefined();
      return role?.centre ?? Number.NaN;
    };
    const inBox = [...svg.matchAll(/<text\b[^>]*>/g)].flatMap((m) => {
      const t = m[0];
      const [x, y] = [num(t, 'x'), num(t, 'y')];
      const box = rects
        .filter((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h)
        .sort((a, b) => a.w * a.h - b.w * b.h)[0];
      if (box === undefined) return [];
      const off = y - (box.y + box.h / 2) - centreOf(num(t, 'font-size'));
      return [{ key: `${box.x},${box.y},${box.w},${box.h}|${x}`, half: off / HALF_ROW }];
    });
    expect(inBox.length).toBeGreaterThan(0);
    expect(inBox.filter(({ half }) => Math.abs(half - Math.round(half)) > 0.001)).toEqual([]);
    const columns = new Map<string, Set<number>>();
    for (const { key, half } of inBox)
      columns.set(key, (columns.get(key) ?? new Set()).add(Math.round(half)));
    const single = [...columns].filter(([, rows]) => rows.size === 1);
    expect(single.length).toBeGreaterThan(0);
    expect(single.filter(([, rows]) => !rows.has(0)).map(([key]) => key)).toEqual([]);
  });

  it.each(PACKAGE_PICTURES.map((p) => p.dir))(
    'packages/%s/README.md opens with exactly the block the script writes',
    (dir) => {
      const { name } = manifest(dir);
      const readme = read(`packages/${dir}/README.md`);
      expect(readme.startsWith(`<h1 align="center">${name}</h1>\n\n${pictureBlock(dir)}\n`)).toBe(
        true,
      );
      // Said here again by hand, so a script that wrote the wrong owner, branch or path would
      // not agree with itself and pass. The owner and the repository are the manifest's.
      const urls = [...readme.matchAll(/https:\/\/raw\.githubusercontent\.com\/[^"\s)]+/g)].map(
        (m) => m[0],
      );
      const base = `https://raw.githubusercontent.com/felipesauer/mnema/main/packages/${dir}/assets`;
      expect(urls).toEqual([`${base}/${dir}-dark.svg`, `${base}/${dir}-light.svg`]);
    },
  );

  // The npm page keeps `align` on a paragraph and on an image but strips it from a `div`, so the
  // centre is set on `<p>` and said here by hand, apart from the script that writes the block.
  it.each(PACKAGE_PICTURES.map((p) => p.dir))(
    'packages/%s/README.md centres its title, its picture and its badges',
    (dir) => {
      const { name } = manifest(dir);
      const readme = read(`packages/${dir}/README.md`);
      const block = pictureBlock(dir);
      expect(block.startsWith('<p align="center">\n<picture>\n')).toBe(true);
      expect(block.endsWith('</picture>\n</p>')).toBe(true);
      const head = `<h1 align="center">${name}</h1>\n\n${block}\n\n`;
      const top = readme.slice(head.length);
      expect(readme.startsWith(head)).toBe(true);
      const badges = /^<p align="center">\n([\s\S]*?)\n<\/p>\n/.exec(top);
      expect(badges, 'the line of badges is not in a centred paragraph').not.toBeNull();
      const line = badges?.[1] ?? '';
      expect(line).not.toContain('](');
      const images = [...line.matchAll(/<img alt="([^"]+)" src="https:\/\/img\.shields\.io\//g)];
      expect(images.map((m) => m[1]?.split(':')[0]?.split(' ')[0])).toEqual([
        'CI',
        'License',
        'Node',
      ]);
      expect(line).toContain(
        '<a href="https://github.com/felipesauer/mnema/actions/workflows/ci.yml"><img alt="CI"',
      );
      // The npm page does not rewrite a relative address written in raw HTML, so the licence
      // badge points at the file on `main` by the address of the repository the manifest names,
      // and no address in the line of badges is relative.
      const repo = /github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/.exec(
        manifest(dir).repository.url,
      )?.[1];
      expect(repo, 'the manifest does not name a GitHub repository').toBeDefined();
      expect(line).toContain(
        `<a href="https://github.com/${repo}/blob/main/LICENSE"><img alt="License: Apache-2.0"`,
      );
      const targets = [...line.matchAll(/\bhref="([^"]*)"/g)].map((m) => m[1] ?? '');
      expect(targets).toHaveLength(2);
      expect(targets.filter((t) => !t.startsWith('https://'))).toEqual([]);
    },
  );

  it.each(PACKAGE_PICTURES.map((p) => p.dir))(
    'packages/%s/README.md names no version in the address of an image',
    (dir) => {
      const readme = read(`packages/${dir}/README.md`);
      const images = [...readme.matchAll(/\b(?:src|srcset)="([^"]+)"/g)].map((m) => m[1] ?? '');
      expect(images.length).toBeGreaterThanOrEqual(2);
      // A version that is not published yet is a picture that does not load: no `@1.2.3`, no
      // `@v1.2.3`, in the path of any image the page shows.
      expect(images.filter((url) => /@v?\d/.test(url))).toEqual([]);
    },
  );

  const anchors = PACKAGE_PICTURES.flatMap(({ dir, lines }) =>
    Object.values(lines).flatMap((line) =>
      line.flatMap((piece) => (typeof piece === 'string' ? [] : [{ dir, ...piece }])),
    ),
  );

  it.each(anchors.map((a) => [a.dir, a.said, a.where] as const))(
    '%s says %j, as %s does',
    (_dir, literal, where) => {
      expect(read(where)).toContain(literal);
    },
  );

  it.each(PACKAGE_PICTURES.map((p) => [p.dir, p.lines] as const))(
    '%s joins its pieces with nothing but a separator or the elided id',
    (_dir, lines) => {
      const joins = Object.values(lines).flatMap((line) =>
        line.filter((piece): piece is string => typeof piece === 'string'),
      );
      expect(joins.filter((j) => !SEPARATORS.includes(j) && j !== ELIDED)).toEqual([]);
    },
  );

  it.each(PACKAGE_PICTURES.map((p) => p.dir))(
    '%s puts no text on its picture but its lines',
    (dir) => {
      const lines = PACKAGE_PICTURES.find((p) => p.dir === dir)?.lines ?? {};
      const said = new Set(Object.values(lines).map((line) => textOf(line)));
      for (const theme of ['dark', 'light']) {
        const words = wordsOf(drawn[`packages/${dir}/assets/${dir}-${theme}.svg`] ?? '');
        expect(words.length).toBeGreaterThan(5);
        expect(words.filter((w) => !said.has(w))).toEqual([]);
      }
    },
  );

  it.each(PACKAGE_PICTURES.map((p) => p.dir))(
    '%s draws no host, no count that changes and no promise the package does not make',
    (dir) => {
      const words = wordsOf(drawn[`packages/${dir}/assets/${dir}-light.svg`] ?? '').join('\n');
      const hosts = Object.entries(HOSTS).flatMap(([key, host]) => [key, host.title]);
      expect(hosts.length).toBeGreaterThan(10);
      expect(hosts.filter((h) => words.toLowerCase().includes(h.toLowerCase()))).toEqual([]);
      expect(words).not.toMatch(/\b\d+\s+(?:kinds?|hosts?|tools?|events?)\b/i);
      expect(words).not.toMatch(/tamper-proof|secure|safe|guarantee|proves|trusted/i);
    },
  );
});

// A badge sets its colour in the query (`color=` / `colorB=`, after `?`, `&` or the `;` of an
// escaped `&amp;`) or, for a static badge, as the last segment of `/badge/<label>-<msg>-<colour>`
// (where `--` is an escaped hyphen).
function* badgeColours(url: string): Generator<string> {
  for (const c of url.matchAll(/[?&;](?:color|colorB)=([^&#;]*)/g)) yield c[1] as string;
  const path = /^https:\/\/img\.shields\.io\/badge\/([^?#]*)/.exec(url)?.[1];
  if (path !== undefined) {
    const last = path.replaceAll('--', '\u0000').split('-').at(-1);
    if (last !== undefined && path.includes('-')) yield last.replaceAll('\u0000', '-');
  }
}

describe('the front page has one accent', () => {
  it('has pictures to read', () => {
    expect(svgs.length).toBeGreaterThanOrEqual(4);
  });

  it('reads the pictures of the packages too', () => {
    expect(svgs.filter((f) => f.startsWith('packages/')).length).toBe(10);
  });

  it.each(svgs)('%s uses no hue but the accent of its theme', (file) => {
    const svg = read(file);
    const accent = accentFor(file);
    const wrong = coloursIn(svg)
      .map((c) => whyNot(c, accent))
      .filter((w) => w !== undefined);
    expect(wrong).toEqual([]);
    expect(svg.toLowerCase()).toContain(accent[0]);
  });

  it('reads a hue that is not the accent as one', () => {
    expect(whyNot('#ff0000', [ACCENT.dark])).toBeDefined();
    expect(whyNot('#997dbf', [ACCENT.dark])).toBeDefined();
    expect(whyNot('red', [ACCENT.dark])).toBeDefined();
    expect(whyNot('#9198a1', [ACCENT.dark])).toBeUndefined();
    expect(coloursIn('<rect style="fill: rgb(255, 0, 0)"/>').length).toBeGreaterThan(0);
  });

  it('gives every shields.io badge that sets a colour the light accent', () => {
    const pages = [
      'README.md',
      ...readdirSync(join(ROOT, 'packages'))
        .map((p) => `packages/${p}/README.md`)
        .filter((p) => {
          try {
            read(p);
            return true;
          } catch {
            return false;
          }
        }),
    ];
    const colours = pages.flatMap((page) =>
      [...read(page).matchAll(/https:\/\/img\.shields\.io\/[^\s)"'<>]*/g)].flatMap((m) =>
        [...badgeColours(m[0])].map((c) => `${page}: ${c}`),
      ),
    );
    const light = ACCENT.light.slice(1);
    expect(colours.filter((c) => !c.endsWith(`: ${light}`))).toEqual([]);
  });
});
