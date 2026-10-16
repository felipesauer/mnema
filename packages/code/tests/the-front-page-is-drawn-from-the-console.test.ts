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
 *   - THE FAMILY: the picture of `@mnema/code` and what stands around it, drawn into
 *     `docs/assets/`, is held to the same rules as a package's: its words are lines of the
 *     product, found in the files the script names, and nothing else.
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
  FAMILY_LINES,
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
  FAMILY_LINES: Readonly<Record<string, Line>>;
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

/**
 * Every colour a file names: in a paint attribute, in a style, and any hex anywhere else. A paint
 * that is a gradient of the same file (`url(#id)`) is read through its stops, which are colours
 * named here like any other; a reference to anything else is kept, and is not a hex this reads.
 */
function coloursIn(svg: string): string[] {
  const gradients = new Set(
    [...svg.matchAll(/<(?:linear|radial)Gradient\b[^>]*\bid="([^"]+)"/g)].map((m) => m[1]),
  );
  const named = [
    ...svg.matchAll(
      /(?:fill|stroke|stop-color|flood-color|lighting-color|color)\s*[=:]\s*["']?(url\(#[^)"']+\)|[^"';\s>{}]+)/g,
    ),
  ]
    .map((m) => m[1] as string)
    .filter((c) => !gradients.has(/^url\(#([^)]+)\)$/.exec(c)?.[1] ?? ''));
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
      'the-family-dark.svg',
      'the-family-light.svg',
    ]);
  });

  it('names the family in its text alternative, dark and light', () => {
    const alt =
      'The mnema family: @mnema/code, the command line and the MCP server over one record, with the SDK, a VS Code extension, an agent in CI, the GitHub Action, mnema site and Stacks around it';
    for (const theme of ['dark', 'light']) {
      const svg = drawn[`the-family-${theme}.svg`] ?? '';
      expect(svg).toContain(` aria-label="${alt}"`);
      expect(svg).toContain(`<title>${alt}</title>`);
    }
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

/**
 * Every picture whose words are lines of the product: each package's, and the family's, by the
 * path of each theme from the repository's root.
 */
const LINED = [
  ...PACKAGE_PICTURES.map(({ dir, lines }) => ({
    id: dir,
    lines,
    dark: `packages/${dir}/assets/${dir}-dark.svg`,
    light: `packages/${dir}/assets/${dir}-light.svg`,
  })),
  {
    id: 'family',
    lines: FAMILY_LINES,
    dark: `${ASSETS}/the-family-dark.svg`,
    light: `${ASSETS}/the-family-light.svg`,
  },
];

describe('every package, and the family, draws what it is, in its own words', () => {
  const packages = drawThePackages(THE_BLOCKS);
  const drawn: Record<string, string> = {
    ...packages,
    ...Object.fromEntries(
      Object.entries(drawTheFrontPage(THE_BLOCKS)).map(([file, svg]) => [`${ASSETS}/${file}`, svg]),
    ),
  };
  const lined = LINED.flatMap((p) => [p.dark, p.light]);
  const manifest = (dir: string): { name: string; version: string; repository: { url: string } } =>
    JSON.parse(read(`packages/${dir}/package.json`)) as {
      name: string;
      version: string;
      repository: { url: string };
    };

  it('draws the five published packages, dark and light', () => {
    expect(Object.keys(packages).sort()).toEqual(
      ['chain', 'code', 'context', 'core', 'stacks'].flatMap((p) => [
        `packages/${p}/assets/${p}-dark.svg`,
        `packages/${p}/assets/${p}-light.svg`,
      ]),
    );
  });

  it.each(Object.keys(packages))('%s is what the script draws today', (path) => {
    expect(read(path)).toBe(drawn[path]);
  });

  it.each(lined)('%s moves by keyframes it defines', (path) => {
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

  it.each(lined)('%s leaves no element alone at the end of the loop', (path) => {
    // Every element there in the last frame fades out at the same moment; one that went out
    // later stayed on the page by itself, the rest of the picture already gone.
    const exits = [
      ...(drawn[path] ?? '').matchAll(/@keyframes (\w+)\{((?:[\d.]+%\{opacity:[\d.]+\})+)\}/g),
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

  it.each(lined)('%s centres every text in its box by its role', (path) => {
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

  const anchors = LINED.flatMap(({ id, lines }) =>
    Object.values(lines).flatMap((line) =>
      line.flatMap((piece) => (typeof piece === 'string' ? [] : [{ dir: id, ...piece }])),
    ),
  );

  it.each(anchors.map((a) => [a.dir, a.said, a.where] as const))(
    '%s says %j, as %s does',
    (_dir, literal, where) => {
      expect(read(where)).toContain(literal);
    },
  );

  it.each(LINED.map((p) => [p.id, p.lines] as const))(
    '%s joins its pieces with nothing but a separator or the elided id',
    (_dir, lines) => {
      const joins = Object.values(lines).flatMap((line) =>
        line.filter((piece): piece is string => typeof piece === 'string'),
      );
      expect(joins.filter((j) => !SEPARATORS.includes(j) && j !== ELIDED)).toEqual([]);
    },
  );

  it.each(LINED)('$id puts no text on its picture but its lines', (picture) => {
    const said = new Set(Object.values(picture.lines).map((line) => textOf(line)));
    for (const path of [picture.dark, picture.light]) {
      const words = wordsOf(drawn[path] ?? '');
      expect(words.length).toBeGreaterThan(5);
      expect(words.filter((w) => !said.has(w))).toEqual([]);
    }
  });

  it.each(LINED)(
    '$id draws no host, no count that changes and no promise the package does not make',
    (picture) => {
      const words = wordsOf(drawn[picture.light] ?? '').join('\n');
      const hosts = Object.entries(HOSTS).flatMap(([key, host]) => [key, host.title]);
      expect(hosts.length).toBeGreaterThan(10);
      expect(hosts.filter((h) => words.toLowerCase().includes(h.toLowerCase()))).toEqual([]);
      expect(words).not.toMatch(/\b\d+\s+(?:kinds?|hosts?|tools?|events?)\b/i);
      expect(words).not.toMatch(/tamper-proof|secure|safe|guarantee|proves|trusted/i);
    },
  );
});

/** An element of a picture: its tag, its attributes, its text, and the attributes of each group it is in. */
type Node = {
  tag: string;
  at: Readonly<Record<string, string>>;
  text: string;
  groups: readonly Readonly<Record<string, string>>[];
};

/** The attributes written in an opening tag. */
function attributesOf(written: string): Record<string, string> {
  return Object.fromEntries(
    [...written.matchAll(/([\w:-]+)="([^"]*)"/g)].map((m) => [m[1] as string, m[2] as string]),
  );
}

/** Every shape and text of a picture, in the order it draws them. */
function nodesOf(svg: string): Node[] {
  const nodes: Node[] = [];
  const groups: Record<string, string>[] = [];
  const body = svg.slice(svg.indexOf('</defs>'));
  for (const m of body.matchAll(
    /<(\/?)(g|rect|path|ellipse|circle|text)\b([^>]*?)(\/?)>(?:([^<]*)<\/text>)?/g,
  )) {
    const [, closing, tag = '', written = '', selfClosing, text = ''] = m;
    if (tag === 'g') {
      if (closing) groups.pop();
      else if (!selfClosing) groups.push(attributesOf(written));
      continue;
    }
    nodes.push({ tag, at: attributesOf(written), text, groups: [...groups] });
  }
  return nodes;
}

/** The stops of every keyframes of a picture, by name: each offset with its declarations. */
function keyframesOf(svg: string): Map<string, { at: number; value: string }[]> {
  const out = new Map<string, { at: number; value: string }[]>();
  for (const m of svg.matchAll(/@keyframes (\w+)\{((?:[\d.]+%\{[^}]*\})+)\}/g))
    out.set(
      m[1] as string,
      [...(m[2] as string).matchAll(/([\d.]+)%\{([^}]*)\}/g)].map((s) => ({
        at: Number(s[1]),
        value: s[2] as string,
      })),
    );
  return out;
}

type Box = [number, number, number, number];

/** The points a path's data reaches, with each arc's whole circle: the box holds the path. */
function pathPoints(d: string): [number, number][] {
  const points: [number, number][] = [];
  const tokens = [...d.matchAll(/[MmLlHhVvAaZz]|-?\d*\.?\d+(?:e-?\d+)?/g)].map((m) => m[0]);
  let x = 0;
  let y = 0;
  let start: [number, number] = [0, 0];
  let command = '';
  let i = 0;
  const next = (): number => Number(tokens[i++]);
  while (i < tokens.length) {
    if (/[A-Za-z]/.test(tokens[i] as string)) command = tokens[i++] as string;
    const relative = command === command.toLowerCase();
    const ox = relative ? x : 0;
    const oy = relative ? y : 0;
    switch (command.toUpperCase()) {
      case 'M':
      case 'L':
        x = ox + next();
        y = oy + next();
        if (command.toUpperCase() === 'M') {
          start = [x, y];
          command = relative ? 'l' : 'L';
        }
        break;
      case 'H':
        x = ox + next();
        break;
      case 'V':
        y = oy + next();
        break;
      case 'A': {
        const r = next();
        next(); // ry, the same as rx in every arc drawn here
        next(); // rotation
        const large = next();
        const sweep = next();
        const [x1, y1] = [x, y];
        x = ox + next();
        y = oy + next();
        // The centre of a circular arc from its two ends (SVG 1.1, F.6.5), and its whole circle.
        const [mx, my] = [(x1 - x) / 2, (y1 - y) / 2];
        const half = Math.hypot(mx, my);
        const radius = Math.max(r, half);
        const k =
          (large === sweep ? -1 : 1) *
          Math.sqrt(Math.max(0, radius * radius - half * half) / (half * half || 1));
        const [cx, cy] = [(x1 + x) / 2 + k * my, (y1 + y) / 2 - k * mx];
        points.push([cx - radius, cy - radius], [cx + radius, cy + radius]);
        break;
      }
      case 'Z':
        [x, y] = start;
        break;
      default:
        throw new Error(`a path command this does not read: ${command}`);
    }
    points.push([x, y]);
  }
  return points;
}

/** The numbers of a `translate(…)` and a `scale(…)` written in a transform. */
function transformOf(written: string | undefined): { dx: number; dy: number; k: number } {
  const t = /translate\(\s*(-?[\d.]+)(?:px)?[\s,]+(-?[\d.]+)(?:px)?\s*\)/.exec(written ?? '');
  const s = /scale\(\s*([\d.]+)\s*\)/.exec(written ?? '');
  return { dx: Number(t?.[1] ?? 0), dy: Number(t?.[2] ?? 0), k: Number(s?.[1] ?? 1) };
}

/**
 * The box of every place a shape is ever painted, its stroke's half-width included: a dot is
 * boxed at every place its keyframes move it to.
 */
function boxesOf(node: Node, frames: Map<string, { at: number; value: string }[]>): Box[] {
  const { at } = node;
  const stroked = at.stroke !== undefined && at.stroke !== 'none';
  const half = stroked ? Number(at['stroke-width'] ?? 1) / 2 : 0;
  let box: Box;
  if (node.tag === 'rect') {
    const [x, y] = [Number(at.x ?? 0), Number(at.y ?? 0)];
    box = [x, y, x + Number(at.width), y + Number(at.height)];
  } else if (node.tag === 'ellipse' || node.tag === 'circle') {
    const [cx, cy] = [Number(at.cx ?? 0), Number(at.cy ?? 0)];
    const [rx, ry] =
      node.tag === 'circle' ? [Number(at.r), Number(at.r)] : [Number(at.rx), Number(at.ry)];
    box = [cx - rx, cy - ry, cx + rx, cy + ry];
  } else {
    const points = pathPoints(at.d ?? '');
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  }
  box = [box[0] - half, box[1] - half, box[2] + half, box[3] + half];
  // Its own transform first, then each group's from the innermost out.
  for (const written of [at.transform, ...[...node.groups].reverse().map((g) => g.transform)]) {
    const { dx, dy, k } = transformOf(written);
    box = [box[0] * k + dx, box[1] * k + dy, box[2] * k + dx, box[3] * k + dy];
  }
  const moved = node.groups
    .flatMap((g) => /animation-name:([^"]+)/.exec(g.style ?? '')?.[1]?.split(',') ?? [])
    .flatMap((name) => frames.get(name) ?? [])
    .filter((stop) => stop.value.startsWith('transform:'))
    .map((stop) => transformOf(stop.value));
  if (moved.length === 0) return [box];
  return moved.map(({ dx, dy }) => [box[0] + dx, box[1] + dy, box[2] + dx, box[3] + dy]);
}

/** Which way the record goes on each card's line, said here by hand, apart from the script. */
const RELATIONS = [
  { card: 'SDK', goes: 'both', apart: false },
  { card: 'A VS Code extension', goes: 'both', apart: false },
  { card: 'An agent in CI', goes: 'in', apart: false },
  { card: 'The Action', goes: 'out', apart: false },
  { card: 'mnema site', goes: 'out', apart: false },
  { card: 'Stacks', goes: 'out', apart: true },
] as const;

describe('the family draws which way the record goes', () => {
  const pictures = drawTheFrontPage(THE_BLOCKS);
  const themes = (['dark', 'light'] as const).map((theme) => ({
    theme,
    svg: pictures[`the-family-${theme}.svg`] ?? '',
  }));

  /** Everything the guards below read of one theme's picture. */
  function layout(svg: string) {
    const nodes = nodesOf(svg);
    const frames = keyframesOf(svg);
    const named = (n: Node): string[] =>
      [n.at.style, ...n.groups.map((g) => g.style)].flatMap(
        (s) => /animation-name:([^"]+)/.exec(s ?? '')?.[1]?.split(',') ?? [],
      );
    const rects = nodes.filter((n) => n.tag === 'rect' && n.at.width !== '880');
    const centre = (r: Node): [number, number] => [
      Number(r.at.x) + Number(r.at.width) / 2,
      Number(r.at.y) + Number(r.at.height) / 2,
    ];
    const boxOf = (r: Node): Box => [
      Number(r.at.x),
      Number(r.at.y),
      Number(r.at.x) + Number(r.at.width),
      Number(r.at.y) + Number(r.at.height),
    ];
    const pulses = rects.filter((r) => r.at.opacity === '0' && r.at.fill === 'none');
    const holding = (text: string): Node => {
      const t = nodes.find((n) => n.tag === 'text' && n.text === text);
      expect(t, `no text ${text}`).toBeDefined();
      const [x, y] = [Number(t?.at.x), Number(t?.at.y)];
      const found = rects.filter((r) => {
        const [x0, y0, x1, y1] = boxOf(r);
        return r.at.opacity !== '0' && x >= x0 && x <= x1 && y >= y0 && y <= y1;
      });
      expect(found, `the box around ${text}`).toHaveLength(1);
      return found[0] as Node;
    };
    const hub = holding('@mnema/code');
    // Each line from a card to the hub: two points, dashed, in the width of a line.
    const lines = nodes
      .filter((n) => n.tag === 'path' && n.at['stroke-width'] === '1.5' && n.at['stroke-dasharray'])
      .flatMap((n) => {
        const m = /^M(-?[\d.]+) (-?[\d.]+)L(-?[\d.]+) (-?[\d.]+)$/.exec(n.at.d ?? '');
        const [x1, y1, x2, y2] = (m ?? []).slice(1).map(Number);
        return m
          ? [
              {
                node: n,
                ends: [
                  [x1, y1],
                  [x2, y2],
                ] as [number, number][],
              },
            ]
          : [];
      });
    // The heads: each a point with two strokes back from it.
    const tips = nodes
      .filter((n) => n.tag === 'path' && /^(?:M[-\d. ]+L[-\d. ]+L[-\d. ]+)+$/.test(n.at.d ?? ''))
      .flatMap((n) =>
        [...(n.at.d ?? '').matchAll(/M[-\d. ]+L(-?[\d.]+) (-?[\d.]+)L/g)].map(
          (m) => [Number(m[1]), Number(m[2])] as [number, number],
        ),
      );
    const near = (p: [number, number], q: [number, number], within = 0.01) =>
      Math.hypot(p[0] - q[0], p[1] - q[1]) <= within;
    const distance = (p: [number, number], b: Box) =>
      Math.hypot(Math.max(b[0] - p[0], 0, p[0] - b[2]), Math.max(b[1] - p[1], 0, p[1] - b[3]));
    /** When an animation's opacity first rises above nothing, as a percentage of the loop. */
    const rises = (names: string[]): number | undefined => {
      for (const name of names) {
        const stops = (frames.get(name) ?? []).filter((s) => s.value.startsWith('opacity:'));
        const i = stops.findIndex((s) => Number(s.value.slice(8)) > 0);
        if (i > 0) return stops[i - 1]?.at;
      }
      return undefined;
    };
    const dots = nodes
      .filter((n) => n.tag === 'circle' && n.at['fill-opacity'] === undefined)
      .map((n) => {
        const names = named(n);
        const moves = names
          .flatMap((name) => frames.get(name) ?? [])
          .filter((s) => s.value.startsWith('transform:'))
          .map((s) => ({ at: s.at, ...transformOf(s.value) }));
        const opacity = names
          .flatMap((name) => frames.get(name) ?? [])
          .filter((s) => s.value.startsWith('opacity:'))
          .map((s) => ({ at: s.at, o: Number(s.value.slice(8)) }));
        return { moves, opacity, rise: rises(names) };
      });
    const cards = RELATIONS.map((relation) => {
      const card = holding(relation.card);
      const line = lines.find(({ ends }) => ends.some((e) => distance(e, boxOf(card)) <= 6));
      expect(line, `the line of ${relation.card}`).toBeDefined();
      const [a = [0, 0], b = [0, 0]] = line?.ends ?? [];
      const [atCard, atHub] =
        distance(a, boxOf(card)) <= distance(b, boxOf(card)) ? [a, b] : [b, a];
      // The dot whose way runs from one end of this line to the other.
      const dot = dots.find(
        ({ moves }) =>
          moves.some((m) => near([m.dx, m.dy], atCard)) &&
          moves.some((m) => near([m.dx, m.dy], atHub)),
      );
      // The places the dot is at while it shows, in order, each named by the end it is at.
      const where = (p: [number, number]) =>
        near(p, atCard, 0.5) ? 'card' : near(p, atHub, 0.5) ? 'hub' : 'between';
      const visible = dot?.opacity.filter((s) => s.o > 0) ?? [];
      const from = dot?.opacity[dot.opacity.findIndex((s) => s.o > 0) - 1]?.at ?? 0;
      const until =
        dot?.opacity.find((s, i) => i > 0 && s.o === 0 && (dot.opacity[i - 1]?.o ?? 0) > 0)?.at ??
        100;
      const position = (t: number): [number, number] => {
        const moves = dot?.moves ?? [];
        const j = moves.findIndex((m) => m.at >= t);
        const after = moves[Math.max(j, 0)];
        const before = moves[Math.max(j - 1, 0)];
        if (!after || !before || after.at === before.at) return [after?.dx ?? 0, after?.dy ?? 0];
        const f = (t - before.at) / (after.at - before.at);
        return [before.dx + f * (after.dx - before.dx), before.dy + f * (after.dy - before.dy)];
      };
      const way = [
        from,
        ...(dot?.moves ?? []).map((m) => m.at).filter((t) => t > from && t < until),
        until,
      ]
        .map((t) => where(position(t)))
        .filter((p, i, all) => i === 0 || p !== all[i - 1]);
      return {
        ...relation,
        box: card,
        line: line?.node,
        heads: [tips.some((t) => near(t, atCard)), tips.some((t) => near(t, atHub))],
        way: visible.length > 0 ? way : [],
        rise: dot?.rise,
      };
    });
    return { nodes, frames, hub, cards, pulses, centre, boxOf };
  }

  it.each(themes)('paints every shape of the $theme picture inside its frame', ({ svg }) => {
    // A stroke past the edge of the frame is cut off: half of it is not drawn.
    const frames = keyframesOf(svg);
    const shapes = nodesOf(svg).filter((n) => n.tag !== 'text' && n.at.width !== '880');
    expect(shapes.length).toBeGreaterThan(90);
    const outside = shapes.flatMap((n) =>
      boxesOf(n, frames)
        .filter(([x0, y0, x1, y1]) => x0 < 0 || y0 < 0 || x1 > 880 || y1 > 260)
        .map(
          (b) =>
            `${n.tag} ${(n.at.d ?? `${n.at.x},${n.at.y}`).slice(0, 24)}: ${b.map((v) => +v.toFixed(2)).join(' ')}`,
        ),
    );
    expect(outside).toEqual([]);
  });

  it.each(themes)(
    'puts the head of each line of the $theme picture where the record goes',
    ({ svg }) => {
      const { cards } = layout(svg);
      expect(cards.map(({ card, heads }) => [card, heads[0], heads[1]])).toEqual(
        cards.map(({ card, goes }) => [card, goes !== 'in', goes !== 'out']),
      );
    },
  );

  it.each(themes)(
    'runs the dot of each line of the $theme picture the way the record goes',
    ({ svg }) => {
      const { cards } = layout(svg);
      const ways = { both: ['card', 'hub', 'card'], in: ['card', 'hub'], out: ['hub', 'card'] };
      expect(cards.map(({ card, way }) => [card, way])).toEqual(
        cards.map(({ card, goes }) => [card, ways[goes]]),
      );
    },
  );

  it.each(themes)(
    'draws Stacks apart in the $theme picture, in grey and dashed',
    ({ theme, svg }) => {
      const { cards, pulses, centre } = layout(svg);
      const accent = ACCENT[theme];
      const dashes = new Set(
        cards.filter((c) => !c.apart).map((c) => c.line?.at['stroke-dasharray']),
      );
      expect(dashes.size).toBe(1);
      for (const c of cards) {
        expect(c.box.at.stroke === accent, c.card).toBe(!c.apart);
        expect(c.box.at['stroke-dasharray'] !== undefined, `${c.card} dashed`).toBe(c.apart);
        expect(c.line?.at.stroke === accent).toBe(!c.apart);
        expect(dashes.has(c.line?.at['stroke-dasharray'])).toBe(!c.apart);
        // The card lights when what goes out reaches it: in the accent, or in its own grey.
        const lit = pulses.filter((p) => {
          const [x, y] = centre(p);
          const [cx, cy] = centre(c.box);
          return Math.abs(x - cx) <= 0.5 && Math.abs(y - cy) <= 0.5;
        });
        expect(lit.map((p) => p.at.stroke)).toEqual(
          c.goes === 'in' ? [] : [c.apart ? c.box.at.stroke : accent],
        );
      }
    },
  );

  it.each(themes)(
    'rings the hub of the $theme picture, around it, as a read leaves it',
    ({ svg }) => {
      const { cards, pulses, hub, centre, boxOf } = layout(svg);
      const onCards = (p: Node) =>
        cards.some((c) => {
          const [x, y] = centre(p);
          const [cx, cy] = centre(c.box);
          return Math.abs(x - cx) <= 0.5 && Math.abs(y - cy) <= 0.5;
        });
      const rings = pulses.filter((p) => !onCards(p));
      expect(rings.length).toBeGreaterThan(0);
      const [hx0, hy0, hx1, hy1] = boxOf(hub);
      for (const ring of rings) {
        // Centred on the hub, and close around its edge.
        const [x0, y0, x1, y1] = boxOf(ring);
        const gaps = [hx0 - x0, hy0 - y0, x1 - hx1, y1 - hy1];
        expect(
          gaps.every((g) => g >= 0 && g <= 8),
          `ring at ${x0},${y0}`,
        ).toBe(true);
        const [left = 0, top = 0, right = 0, bottom = 0] = gaps;
        expect(Math.abs(left - right) + Math.abs(top - bottom)).toBeLessThanOrEqual(0.5);
      }
      // One ring for each read, as its dot leaves the hub; none for what writes, and none for
      // Stacks, which the hub installs and does not read out.
      const frames = keyframesOf(svg);
      const ringRises = rings.map((r) => {
        const stops = frames.get(/animation-name:(\w+)/.exec(r.at.style ?? '')?.[1] ?? '') ?? [];
        return stops[stops.findIndex((s) => Number(s.value.slice(8)) > 0) - 1]?.at;
      });
      expect(ringRises.sort((x = 0, y = 0) => x - y)).toEqual(
        cards
          .filter((c) => c.goes === 'out' && !c.apart)
          .map((c) => c.rise)
          .sort((x = 0, y = 0) => x - y),
      );
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
    // A gradient is read by its stops; a paint that points at no gradient of the file is not read.
    const stops = (colour: string) =>
      `<linearGradient id="g"><stop stop-color="${colour}"/></linearGradient><rect fill="url(#g)"/>`;
    expect(coloursIn(stops(ACCENT.dark)).map((c) => whyNot(c, [ACCENT.dark]))).toEqual([
      undefined,
      undefined,
    ]);
    expect(coloursIn(stops('#2da44e')).map((c) => whyNot(c, [ACCENT.dark]))).toContainEqual(
      expect.stringContaining('#2da44e'),
    );
    expect(whyNot(coloursIn('<rect fill="url(#elsewhere)"/>')[0] ?? '', [])).toBeDefined();
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
