/**
 * THE FRONT PAGE IS DRAWN FROM THE CONSOLE: the pictures in `docs/assets/` are made by a script
 * from the same sources the console draws from, and painted in one accent.
 *
 *   - THE BANNER is the console's wordmark: `.github/the-front-page/draw.mjs` reads the rows of
 *     `THE_BLOCKS` (`src/presentation/banner.ts`) and draws each glyph as geometry. Here the
 *     script runs again in memory over the rows the console draws today, and every picture it
 *     makes is held byte for byte to the one committed, so a wordmark changed in the console and
 *     not drawn again fails here, and so does a picture edited by hand.
 *   - THE ACCENT is one constant (`.github/the-front-page/accent.mjs`): `#c4a0f5` on a dark page,
 *     `#997dbf` on a light one. Every colour in every SVG of `docs/assets/` is either neutral (a
 *     grey, whose channels lie within {@link NEUTRAL_SPREAD} of each other) or the accent of the
 *     theme the file is named for. Any other hue fails, and so does a colour written in a form
 *     this does not read (a name, `rgb()`, `hsl()`), rather than pass unread.
 *   - THE PACKAGES: each published package but `@mnema/code` has its own picture, drawn by the
 *     same script into `packages/<p>/assets/` in the family's paint and motion, held byte for
 *     byte here and painted in the same accent; `@mnema/code`'s README shows the family. Every word
 *     on it is a literal of the product, found here in the file the script names for it; no
 *     text on it is anything else, and none is a host's name, a count that changes, or a
 *     promise the package does not make. The id a line of output prints is drawn elided, and a
 *     text inside a box sits on the box's middle by the size of its role.
 *   - THE FAMILY: the picture of `@mnema/code` and what stands around it, drawn into
 *     `docs/assets/`, is held to the same rules as a package's: its words are lines of the
 *     product, found in the files the script names, and nothing else.
 *   - THE BANNER, THE STEPS AND HOW MNEMA FITS: drawn in the family's paint and motion, and held to
 *     the family's guards of frame, middle, roles, keyframes, exit and arrows. Their words are said
 *     here by hand, in order, each piece a file says found in it; the banner's light is out in its
 *     last frame and moves nothing.
 *   - THE FAMILY ON THE FRONT PAGE: `README.md` holds, under "The mnema family", the block the script
 *     writes, byte for byte, at 880, by an absolute address on `main` with no version.
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
  TYPE,
  HALF_ROW,
  textOf,
  pictureBlock,
  PICTURED_PAGES,
  FAMILY_PAGE,
  FAMILY_ALT,
  FAMILY_HEADING,
  familyBlock,
  withFamilyBlock,
} = (await import(pathToFileURL(DRAW).href)) as {
  drawTheFrontPage: (blocks: readonly string[]) => Record<string, string>;
  drawThePackages: (blocks: readonly string[]) => Record<string, string>;
  PACKAGE_PICTURES: readonly { dir: string; lines: Readonly<Record<string, Line>> }[];
  FAMILY_LINES: Readonly<Record<string, Line>>;
  SEPARATORS: readonly string[];
  TYPE: Readonly<Record<string, { size: number; weight: string; centre: number }>>;
  HALF_ROW: number;
  textOf: (line: Line) => string;
  pictureBlock: (dir: string) => string;
  PICTURED_PAGES: readonly string[];
  FAMILY_PAGE: string;
  FAMILY_ALT: string;
  FAMILY_HEADING: string;
  familyBlock: () => string;
  withFamilyBlock: (readme: string, block: string) => string;
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
    const alt = FAMILY_ALT;
    for (const theme of ['dark', 'light']) {
      const svg = drawn[`the-family-${theme}.svg`] ?? '';
      expect(svg).toContain(` aria-label="${alt}"`);
      expect(svg).toContain(`<title>${alt}</title>`);
    }
  });

  it.each(Object.keys(drawn))('%s is what the script draws from the console today', (file) => {
    expect(read(`${ASSETS}/${file}`)).toBe(drawn[file]);
  });

  it.each(Object.keys(drawn).filter((file) => !file.startsWith('the-family-')))(
    '%s draws every stroke of one unit on the middle of a pixel',
    (file) => {
      expect(offTheGrid(drawn[file] ?? '').map((o) => `${file}: ${o}`)).toEqual([]);
    },
  );

  it('reads a stroke of one unit on a whole coordinate as off the grid', () => {
    const rect = (at: string) =>
      `<svg><defs></defs><rect ${at} fill="none" stroke="#997dbf"/><rect ${at} stroke="#997dbf" stroke-width="2"/></svg>`;
    expect(offTheGrid(rect('x="630" y="122" width="240" height="24"'))).toHaveLength(1);
    expect(offTheGrid(rect('x="630.5" y="122.5" width="239" height="23"'))).toEqual([]);
    expect(
      offTheGrid('<svg><defs></defs><path d="M0 48H880" stroke="#997dbf"/></svg>'),
    ).toHaveLength(1);
    expect(offTheGrid('<svg><defs></defs><path d="M0 48.5H880" stroke="#997dbf"/></svg>')).toEqual(
      [],
    );
  });

  // Each stroke below is one unit wide and off the grid, laid into a copy of a picture the script
  // draws; the guard names it, by its tag, and nothing else in the picture.
  it.each([
    ['a cubic curve', '<path d="M10.5 10.5C20 10 30 10 40.5 10.5" stroke="#997dbf"/>', 'path'],
    ['a quadratic curve', '<path d="M10.5 10.5Q20 30 40.5 10.5" stroke="#997dbf"/>', 'path'],
    ['an arc', '<path d="M10.5 10.5A5 5 0 0 1 20.5 10.5" stroke="#997dbf"/>', 'path'],
    ['a relative run across', '<path d="m0 48h880" stroke="#997dbf"/>', 'path'],
    ['a relative run down', '<path d="M10.5 10.5l0.5 0v20" stroke="#997dbf"/>', 'path'],
    ['the run that closes a path', '<path d="M10.5 10.5H40.5V20Z" stroke="#997dbf"/>', 'path'],
    ['a line', '<line x1="0" y1="48" x2="880" y2="48" stroke="#997dbf"/>', 'line'],
    ['a polyline', '<polyline points="10.5 10.5 40.5 10.5 40 30" stroke="#997dbf"/>', 'polyline'],
    [
      'a polygon',
      '<polygon points="10 10.5 40.5 10.5 40.5 30.5 10 30.5" stroke="#997dbf"/>',
      'polygon',
    ],
    [
      'a shape a group moves by half a unit',
      '<g transform="translate(0 0.5)"><path d="M0 48.5H880" stroke="#997dbf"/></g>',
      'path',
    ],
    [
      'a shape moved by its own transform',
      '<rect transform="translate(0.5 0)" x="10.5" y="10.5" width="30" height="20" fill="none" stroke="#997dbf"/>',
      'rect',
    ],
    [
      'a shape a group scales to one unit',
      '<g transform="scale(0.5)"><path d="M0 96H880" stroke="#997dbf" stroke-width="2"/></g>',
      'path',
    ],
    [
      'a shape a group rotates',
      '<g transform="rotate(90)"><path d="M0 48.5H880" stroke="#997dbf"/></g>',
      'path',
    ],
    ['a stroke painted by its group', '<g stroke="#997dbf"><path d="M0 48H880"/></g>', 'path'],
    [
      'a stroke whose width of one unit comes from its group',
      '<g stroke-width="1"><path d="M0 48H880" stroke="#997dbf" stroke-width="inherit"/></g>',
      'path',
    ],
    [
      'a width of one unit set in its style',
      '<path d="M0 48H880" stroke="#997dbf" stroke-width="2" style="stroke-width:1"/>',
      'path',
    ],
    [
      'a width this does not read',
      '<path d="M0 48H880" stroke="#997dbf" stroke-width="1px"/>',
      'path',
    ],
  ])('names %s that strokes one unit off the grid', (_, shape, tag) => {
    const copy = (drawn['how-it-works-light.svg'] ?? '').replace('</svg>', `${shape}\n</svg>`);
    const found = offTheGrid(copy);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(new RegExp(`^${tag}#\\d+ `));
  });

  it('refuses a picture whose stylesheet sets a stroke', () => {
    const copy = (drawn['how-it-works-light.svg'] ?? '').replace(
      '</style>',
      '.w{stroke-width:1}</style>',
    );
    expect(offTheGrid(copy)).toEqual(['the stylesheet sets a stroke, which this does not read']);
  });

  it('holds a stroke of one unit on the grid under a group that moves it by whole units', () => {
    const copy = (drawn['how-it-works-light.svg'] ?? '').replace(
      '</svg>',
      '<g transform="translate(3 4)"><path d="M0 48.5H880" stroke="#997dbf"/><line x1="10.5" y1="0" x2="10.5" y2="40" stroke="#997dbf"/></g><g stroke-width="2"><path d="M0 48H880" stroke="#997dbf"/></g>\n</svg>',
    );
    expect(offTheGrid(copy)).toEqual([]);
  });

  // Each change below hides a stroke of one unit off the grid, or is a construction the guard does
  // not read, in a copy of a picture the script draws; the guard refuses the picture and names the
  // construction, where it once passed it.
  const OFF = 'stroke="#997dbf"';
  it.each([
    [
      'a <use> of a shape kept in the <defs>',
      (s: string) =>
        s
          .replace('</defs>', `<path id="p" d="M0 48H880" ${OFF}/></defs>`)
          .replace('</svg>', '<use href="#p"/></svg>'),
      /^the <use> at character \d+ is an element this does not read$/,
    ],
    [
      'a <symbol>',
      (s: string) =>
        s.replace('</defs>', `<symbol id="s"><path d="M0 48H880" ${OFF}/></symbol></defs>`),
      /^the <symbol> at character \d+ is an element this does not read$/,
    ],
    [
      'an <svg> inside the picture that moves its shapes by half a unit',
      (s: string) =>
        s.replace('</svg>', `<svg x="0.5" y="0.5"><path d="M0 48.5H880" ${OFF}/></svg></svg>`),
      /^the <svg> at character \d+ is an element this does not read$/,
    ],
    [
      'a transform in the style of a shape',
      (s: string) =>
        s.replace(
          '</svg>',
          `<path d="M0 48.5H880" ${OFF} style="transform:translate(0px,0.5px)"/></svg>`,
        ),
      /^the <path> at character \d+ sets in its style what this does not read: transform:/,
    ],
    [
      'a translate in the style of a shape',
      (s: string) =>
        s.replace('</svg>', `<path d="M0 48.5H880" ${OFF} style="translate:0 0.5px"/></svg>`),
      /^the <path> at character \d+ sets in its style what this does not read: translate:/,
    ],
    [
      'a transform the stylesheet gives a class',
      (s: string) =>
        s
          .replace('</style>', '.m{transform:translate(0px,0.5px)}</style>')
          .replace('</svg>', `<path class="m" d="M0 48.5H880" ${OFF}/></svg>`),
      /^the stylesheet moves a shape outside a keyframes, which this does not read$/,
    ],
    [
      'an animation the stylesheet gives a class',
      (s: string) =>
        s
          .replace(
            '</style>',
            '@keyframes mv{0%{transform:translate(0px,0.5px)}}.m{animation-name:mv}</style>',
          )
          .replace('</svg>', `<path class="m" d="M0 48.5H880" ${OFF}/></svg>`),
      /^the stylesheet gives a shape an animation, which this does not read$/,
    ],
    [
      'the animation shorthand in the style of a shape',
      (s: string) =>
        s
          .replace('</style>', '@keyframes mv{0%{transform:translate(0px,0.5px)}}</style>')
          .replace('</svg>', `<path style="animation:mv 1s" d="M0 48.5H880" ${OFF}/></svg>`),
      /^the <path> at character \d+ sets in its style what this does not read: animation:/,
    ],
    [
      'a keyframe that moves a shape after another declaration',
      (s: string) =>
        s
          .replace(
            '</style>',
            '@keyframes mv{0%{opacity:1;transform:translate(0px,0.5px)}}</style>',
          )
          .replace('</svg>', `<path style="animation-name:mv" d="M0 48.5H880" ${OFF}/></svg>`),
      /^path#\d+ is under a transform this does not read$/,
    ],
    [
      'a keyframes written with from and to',
      (s: string) =>
        s
          .replace('</style>', '@keyframes mv{from{transform:translate(0px,0.5px)}}</style>')
          .replace('</svg>', `<path style="animation-name:mv" d="M0 48.5H880" ${OFF}/></svg>`),
      /^the stylesheet has a keyframes this does not read$/,
    ],
    [
      'a second stylesheet that sets a stroke',
      (s: string) => s.replace('</svg>', '<style>.w{stroke-width:1}</style></svg>'),
      /^the stylesheet sets a stroke, which this does not read$/,
    ],
    [
      'a stroke on the outer <svg>',
      (s: string) =>
        s.replace('<svg ', `<svg ${OFF} `).replace('</svg>', '<path d="M0 48H880"/></svg>'),
      /^the <svg> at character 0 sets stroke, which this does not read$/,
    ],
    [
      'a stroke width on the outer <svg> a group scales to one unit',
      (s: string) =>
        s
          .replace('<svg ', '<svg stroke-width="0.5" ')
          .replace(
            '</svg>',
            `<g transform="scale(2)"><path d="M0 24H440" ${OFF} stroke-width="inherit"/></g></svg>`,
          ),
      /^the <svg> at character 0 sets stroke-width, which this does not read$/,
    ],
    [
      'a stroke that does not scale with its group',
      (s: string) =>
        s.replace(
          '</svg>',
          `<g transform="scale(2)"><path d="M0 24H440" ${OFF} vector-effect="non-scaling-stroke"/></g></svg>`,
        ),
      /^the <path> at character \d+ sets vector-effect, which this does not read$/,
    ],
    [
      'a picture without a </defs>',
      (s: string) =>
        s
          .replace(/<defs>[\s\S]*?<\/defs>/, '')
          .replace('</svg>', `<path d="M0 48H880" ${OFF}/></svg>`),
      /^the picture has no <\/defs>, after which this reads$/,
    ],
    [
      'a shape before the <defs>',
      (s: string) => s.replace('<defs>', `<path d="M0 48H880" ${OFF}/><defs>`),
      /^the <path> at character \d+ comes before the <defs>, where this does not read$/,
    ],
    [
      'an attribute in single quotes',
      (s: string) => s.replace('</svg>', `<path d='M0 48H880' stroke='#997dbf'/></svg>`),
      /^the <path> at character \d+ writes an attribute this does not read/,
    ],
    [
      'a > inside an attribute',
      (s: string) => s.replace('</svg>', `<path data-x="a>b" d="M0 48H880" ${OFF}/></svg>`),
      /^the <path> at character \d+ writes an attribute this does not read/,
    ],
    [
      'a viewBox that moves the picture by half a unit',
      (s: string) =>
        s
          .replace(/viewBox="0 0 /, 'viewBox="0.5 0.5 ')
          .replace('</svg>', `<path d="M0 48.5H880" ${OFF}/></svg>`),
      /^the <svg> at character 0 has a viewBox that does not start at 0 0: 0\.5 0\.5 /,
    ],
    [
      'a group the guard does not know',
      (s: string) => s.replace('</svg>', `<a ${OFF}><path d="M0 48H880"/></a></svg>`),
      /^the <a> at character \d+ is an element this does not read$/,
    ],
  ])('refuses a picture with %s, and names it', (_, change, named) => {
    const found = offTheGrid(change(drawn['how-it-works-light.svg'] ?? ''));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(named);
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
 * path of each theme from the repository's root, with its frame, said here by hand: its width,
 * its height, where the band at its head ends (nothing under it is part of the drawing), the
 * fewest shapes it draws, and the least room left between what is drawn under the band and each
 * side of the frame (none for the family, whose lanes reach its edges).
 */
const LINED = [
  ...PACKAGE_PICTURES.map(({ dir, lines }) => ({
    id: dir,
    lines,
    dark: `packages/${dir}/assets/${dir}-dark.svg`,
    light: `packages/${dir}/assets/${dir}-light.svg`,
    frame: { w: 720, h: 240, band: 41, shapes: 12, margin: 24 },
  })),
  {
    id: 'family',
    lines: FAMILY_LINES,
    dark: `${ASSETS}/the-family-dark.svg`,
    light: `${ASSETS}/the-family-light.svg`,
    frame: { w: 880, h: 260, band: 0, shapes: 90, margin: 0 },
  },
];

/**
 * The front page's other pictures, with their frames said here by hand as `LINED` says its own: the
 * banner, the steps and how mnema fits. Each is drawn in the family's paint and motion; the banner
 * draws no text, and the other two draw cards whose text sits on their middle.
 */
const FRONT = [
  {
    id: 'banner',
    dark: `${ASSETS}/banner-dark.svg`,
    light: `${ASSETS}/banner-light.svg`,
    frame: { w: 910.73, h: 151.5, band: 0, shapes: 20, margin: 8 },
    words: false,
  },
  {
    id: 'how-it-works',
    dark: `${ASSETS}/how-it-works-dark.svg`,
    light: `${ASSETS}/how-it-works-light.svg`,
    frame: { w: 896, h: 212, band: 0, shapes: 30, margin: 8 },
    words: true,
  },
  {
    id: 'how-mnema-fits',
    dark: `${ASSETS}/how-mnema-fits-dark.svg`,
    light: `${ASSETS}/how-mnema-fits-light.svg`,
    frame: { w: 896, h: 306, band: 0, shapes: 40, margin: 8 },
    words: true,
  },
] as const;

/**
 * Every text of the steps and of how mnema fits, in the order a reader meets it, said here by hand
 * apart from the script: a picture that says one word more, one less, or another, fails. Each piece
 * a file of the repository says is found in it; the rest is the picture's own words, unchanged.
 */
const FRONT_WORDS: Readonly<
  Record<string, readonly { text: string; said?: [string, string][] }[]>
> = {
  'how-it-works': [
    { text: '1' },
    { text: 'Record', said: [['Record', 'README.md']] },
    { text: 'A decision, why it was' },
    { text: 'made, and the options' },
    { text: 'turned down.' },
    { text: 'mnema decision', said: [['mnema decision', 'README.md']] },
    { text: '2' },
    { text: 'Rule', said: [['Rule', 'README.md']] },
    { text: 'Accepted by a person,' },
    { text: 'then linked to the paths' },
    { text: 'it governs.' },
    { text: 'mnema link', said: [['mnema link', 'README.md']] },
    { text: '3' },
    { text: 'Hand over', said: [['Hand over', 'README.md']] },
    { text: 'The plugin opens every' },
    { text: 'session with it, and each' },
    { text: 'edit meets its rules.' },
    { text: 'refuses-a-write', said: [['refuses-a-write', 'recordings/a-write-refused.sh']] },
    { text: '4' },
    { text: 'Verify', said: [['Verify', 'README.md']] },
    { text: 'Every fact is signed and' },
    { text: 'hash-chained; anyone can' },
    { text: 'check it.' },
    { text: 'mnema verify', said: [['mnema verify', 'README.md']] },
  ],
  'how-mnema-fits': [
    { text: 'agent session', said: [['agent session', 'README.md']] },
    { text: 'repository', said: [['repository', 'README.md']] },
    {
      text: 'Claude Code · VS Code · Cursor CLI',
      said: [
        ['Claude Code', 'README.md'],
        ['VS Code', 'README.md'],
        ['Cursor CLI', 'README.md'],
      ],
    },
    { text: 'in force', said: [['in force', 'README.md']] },
    { text: 'ADR-2', said: [['ADR-2', 'docs/agent-hosts.md']] },
    { text: 'Keep money as integer cents', said: [['Keep money as integer cents', 'README.md']] },
    { text: 'write', said: [['write', 'README.md']] },
    { text: 'src/billing/total.ts' },
    {
      text: 'deny · refuses-a-write',
      said: [
        ['deny', 'packages/code/src/mcp/hook-reply.ts'],
        ['refuses-a-write', 'recordings/a-write-refused.sh'],
      ],
    },
    { text: 'write', said: [['write', 'README.md']] },
    { text: 'src/cart/price.ts' },
    { text: 'allowed', said: [['allowed', 'docs/cli-reference.md']] },
    { text: 'record', said: [['record', 'README.md']] },
    { text: 'ADR-3' },
    {
      text: 'signed · proposed',
      said: [
        ['signed', 'README.md'],
        ['proposed', 'README.md'],
      ],
    },
    { text: 'src/billing/total.ts' },
    {
      text: 'refuses-a-write · ADR-2',
      said: [
        ['refuses-a-write', 'recordings/a-write-refused.sh'],
        ['ADR-2', 'docs/agent-hosts.md'],
      ],
    },
    { text: 'src/cart/price.ts' },
    { text: '.mnema/', said: [['.mnema/', 'docs/how-it-works.md']] },
    { text: 'verified', said: [['verified', 'docs/how-it-works.md']] },
    { text: '1  session opens', said: [['session opens', 'README.md']] },
    { text: '2  write refused', said: [['write refused', 'README.md']] },
    { text: '3  write lands' },
    { text: '4  decision signed' },
    { text: '5  record verified' },
  ],
};

describe('the banner, the steps and how mnema fits say what they said, in their words', () => {
  const drawn = drawTheFrontPage(THE_BLOCKS);
  const worded = FRONT.filter((p) => p.words).flatMap((p) => [
    [p.id, p.dark] as const,
    [p.id, p.light] as const,
  ]);

  it.each(worded)('%s: %s puts its words on the picture, in order, and no other', (id, path) => {
    const words = wordsOf(drawn[path.slice(ASSETS.length + 1)] ?? '');
    expect(words).toEqual((FRONT_WORDS[id] ?? []).map((w) => w.text));
  });

  const anchored = Object.entries(FRONT_WORDS).flatMap(([id, words]) =>
    words.flatMap((w) =>
      (w.said ?? []).map(([literal, where]) => [id, w.text, literal, where] as const),
    ),
  );

  it.each(anchored)('%s says %j, and %j is said by %s', (_id, text, literal, where) => {
    expect(text).toContain(literal);
    expect(read(where)).toContain(literal);
  });

  it.each(['dark', 'light'])(
    'the banner (%s) rests as it is drawn: every light over it is out in the last frame, and nothing moves',
    (theme) => {
      const svg = drawn[`banner-${theme}.svg`] ?? '';
      const moving = nodesOf(svg).filter((n) =>
        [n.at.style, ...n.groups.map((g) => g.style)].some((s) => /animation-name:/.test(s ?? '')),
      );
      expect(moving.length).toBeGreaterThan(10);
      expect(moving.filter((n) => n.at.opacity !== '0').map((n) => n.at.d ?? n.at.x)).toEqual([]);
      // The wordmark itself, its blocks and its lines, is never one of them.
      expect(moving.filter((n) => n.at['data-of'] !== undefined)).toEqual([]);
      const frames = keyframesOf(svg);
      expect(
        [...frames.values()].flat().filter((stop) => !stop.value.startsWith('opacity:')),
      ).toEqual([]);
    },
  );
});

describe('every package, and the family, draws what it is, in its own words', () => {
  const packages = drawThePackages(THE_BLOCKS);
  const drawn: Record<string, string> = {
    ...packages,
    ...Object.fromEntries(
      Object.entries(drawTheFrontPage(THE_BLOCKS)).map(([file, svg]) => [`${ASSETS}/${file}`, svg]),
    ),
  };
  const lined = LINED.flatMap((p) => [p.dark, p.light]);
  // The front page's other pictures move as the family does, and leave as it does.
  const moving = [...lined, ...FRONT.flatMap((p) => [p.dark, p.light])];
  const manifest = (dir: string): { name: string; version: string; repository: { url: string } } =>
    JSON.parse(read(`packages/${dir}/package.json`)) as {
      name: string;
      version: string;
      repository: { url: string };
    };

  it('draws the four published packages but @mnema/code, dark and light', () => {
    expect(Object.keys(packages).sort()).toEqual(
      ['chain', 'context', 'core', 'stacks'].flatMap((p) => [
        `packages/${p}/assets/${p}-dark.svg`,
        `packages/${p}/assets/${p}-light.svg`,
      ]),
    );
  });

  it.each(Object.keys(packages))('%s is what the script draws today', (path) => {
    expect(read(path)).toBe(drawn[path]);
  });

  it.each(moving)('%s moves by keyframes it defines', (path) => {
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

  it.each(moving)('%s leaves no element alone at the end of the loop', (path) => {
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

  it('shows the family on the front page, under its heading, with exactly the block the script writes', () => {
    const readme = read('README.md');
    expect(readme).toContain(`${FAMILY_HEADING}\n\n${familyBlock()}\n`);
    expect(withFamilyBlock(readme, familyBlock())).toBe(readme);
    // The block is set by the heading it sits under: a page without it is refused here, not skipped.
    expect(FAMILY_HEADING).toBe('## The mnema family');
    expect(readme.split(FAMILY_HEADING)).toHaveLength(2);
  });

  it('points the front page at the family by an absolute address on main, at 880, without a version', () => {
    const readme = read('README.md');
    const block = /## The mnema family\n\n([\s\S]*?<\/div>)\n/.exec(readme)?.[1] ?? '';
    // Said here by hand, apart from the script that writes it.
    const base = 'https://raw.githubusercontent.com/felipesauer/mnema/main/docs/assets';
    expect(block).toContain(
      `<source media="(prefers-color-scheme: dark)" srcset="${base}/the-family-dark.svg">`,
    );
    const img = /<img src="([^"]+)" alt="([^"]*)" width="(\d+)">/.exec(block);
    expect([img?.[1], img?.[2]?.replaceAll('&quot;', '"'), img?.[3]]).toEqual([
      `${base}/the-family-light.svg`,
      FAMILY_ALT,
      '880',
    ]);
    expect(/@v?\d/.test(block)).toBe(false);
  });

  it('keeps the top of the front page centred, and the family centred under its heading', () => {
    const readme = read('README.md');
    expect(readme.startsWith('<div align="center">\n\n<picture>\n')).toBe(true);
    expect(readme).toContain(
      `${FAMILY_HEADING}\n\n<div align="center">\n\n<picture>\n  <source media="(prefers-color-scheme: dark)" srcset="https://`,
    );
    expect(readme).toContain('</picture>\n\n</div>\n');
  });

  it('opens the README of every published package with a picture, and @mnema/code with the family', () => {
    expect([...PICTURED_PAGES].sort()).toEqual(['chain', 'code', 'context', 'core', 'stacks']);
    expect(FAMILY_PAGE).toBe('code');
  });

  it.each(PICTURED_PAGES)(
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
      const base = 'https://raw.githubusercontent.com/felipesauer/mnema/main';
      expect(urls).toEqual(
        dir === 'code'
          ? [`${base}/docs/assets/the-family-dark.svg`, `${base}/docs/assets/the-family-light.svg`]
          : [
              `${base}/packages/${dir}/assets/${dir}-dark.svg`,
              `${base}/packages/${dir}/assets/${dir}-light.svg`,
            ],
      );
      // @mnema/code shows the family at the family's width, described as the family describes
      // itself; every other package its own picture, described by its manifest.
      const img = /<img src="[^"]+" alt="([^"]*)" width="(\d+)">/.exec(readme);
      const description = (
        JSON.parse(read(`packages/${dir}/package.json`)) as { description: string }
      ).description;
      expect([img?.[1]?.replaceAll('&quot;', '"'), img?.[2]]).toEqual(
        dir === 'code' ? [FAMILY_ALT, '880'] : [description, '720'],
      );
    },
  );

  // The npm page keeps `align` on a paragraph and on an image but strips it from a `div`, so the
  // centre is set on `<p>` and said here by hand, apart from the script that writes the block.
  it.each(PICTURED_PAGES)(
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

  it.each(PICTURED_PAGES)(
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
    '%s joins its pieces with nothing but a separator',
    (_dir, lines) => {
      const joins = Object.values(lines).flatMap((line) =>
        line.filter((piece): piece is string => typeof piece === 'string'),
      );
      expect(joins.filter((j) => !SEPARATORS.includes(j))).toEqual([]);
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
    /<(\/?)(g|rect|path|ellipse|circle|line|polyline|polygon|text)\b([^>]*?)(\/?)>(?:([^<]*)<\/text>)?/g,
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

/** A translate and a uniform scale, as one map of a point: k times the point, then moved by (dx, dy). */
type Placement = { k: number; dx: number; dy: number };

/**
 * The placement a transform writes, when it is only translates and uniform scales (in a
 * `transform` attribute, or a keyframe's `transform:`, whose numbers may carry `px`), or nothing
 * when it is anything else.
 */
function placementOf(written: string | undefined): Placement | undefined {
  const text = (written ?? '').trim();
  const calls = [...text.matchAll(/(\w+)\(([^)]*)\)/g)];
  if (text.replace(/(\w+)\(([^)]*)\)/g, '').trim() !== '') return undefined;
  let p: Placement = { k: 1, dx: 0, dy: 0 };
  for (const [, fn, args = ''] of calls.reverse()) {
    const v = args
      .split(/[\s,]+/)
      .filter(Boolean)
      .map((a) => Number(a.replace(/px$/, '')));
    if (v.length === 0 || v.length > 2 || !v.every(Number.isFinite)) return undefined;
    const [a = 0, b] = v;
    if (fn === 'translate') p = { k: p.k, dx: p.dx + a, dy: p.dy + (b ?? 0) };
    else if (fn === 'scale' && (b === undefined || b === a))
      p = { k: p.k * a, dx: p.dx * a, dy: p.dy * a };
    else return undefined;
  }
  return p;
}

/**
 * The straight runs a shape's outline is drawn along, each from one point to the next, or why it
 * cannot be read as runs: a curve or an arc, a circle or an ellipse, a number or a command this
 * does not read.
 */
function runsOf(node: Node): [number, number, number, number][] | string {
  const { at } = node;
  const num = (v: string | undefined): number => Number(v ?? 0);
  const corners = (points: number[], closed: boolean): [number, number, number, number][] => {
    const runs: [number, number, number, number][] = [];
    for (let j = 0; j + 3 < points.length; j += 2)
      runs.push(points.slice(j, j + 4) as [number, number, number, number]);
    if (closed && points.length >= 4)
      runs.push([
        points[points.length - 2] as number,
        points[points.length - 1] as number,
        points[0] as number,
        points[1] as number,
      ]);
    return runs;
  };
  if (node.tag === 'rect') {
    const [x, y, w, h] = ['x', 'y', 'width', 'height'].map((k) => num(at[k])) as Box;
    return corners([x, y, x + w, y, x + w, y + h, x, y + h], true);
  }
  if (node.tag === 'line') return [['x1', 'y1', 'x2', 'y2'].map((k) => num(at[k])) as Box];
  if (node.tag === 'polyline' || node.tag === 'polygon') {
    const points = (at.points ?? '')
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    if (points.length % 2 !== 0) return 'has points this does not read';
    return corners(points, node.tag === 'polygon');
  }
  if (node.tag !== 'path') return `is a ${node.tag}, which this cannot hold to the grid`;
  const tokens = [
    ...(at.d ?? '').matchAll(/[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?|[A-Za-z]/g),
  ].map((m) => m[0]);
  const runs: [number, number, number, number][] = [];
  const arity: Record<string, number> = {
    M: 2,
    L: 2,
    H: 1,
    V: 1,
    C: 6,
    S: 4,
    Q: 4,
    T: 2,
    A: 7,
    Z: 0,
  };
  let [x, y, sx, sy] = [0, 0, 0, 0];
  let command = '';
  let i = 0;
  while (i < tokens.length) {
    if (/[A-Za-z]/.test(tokens[i] as string)) command = tokens[i++] as string;
    const up = command.toUpperCase();
    const n = arity[up];
    if (n === undefined) return `has a path command this does not read: ${command || tokens[i]}`;
    const v = tokens.slice(i, i + n).map(Number);
    if (v.length < n || !v.every(Number.isFinite)) return 'has path data this does not read';
    i += n;
    const [ox, oy] = command === up ? [0, 0] : [x, y];
    if (up === 'Z') {
      runs.push([x, y, sx, sy]);
      [x, y] = [sx, sy];
      if (i < tokens.length && !/[A-Za-z]/.test(tokens[i] as string))
        return 'has path data this does not read';
      continue;
    }
    if (['C', 'S', 'Q', 'T', 'A'].includes(up))
      return `draws a curve (${command}), which this cannot hold to the grid`;
    const [a = 0, b = 0] = v;
    const [nx, ny] = up === 'H' ? [ox + a, y] : up === 'V' ? [x, oy + a] : [ox + a, oy + b];
    if (up === 'M') {
      [sx, sy] = [nx, ny];
      command = command === up ? 'L' : 'l';
    } else runs.push([x, y, nx, ny]);
    [x, y] = [nx, ny];
  }
  return runs;
}

/** The elements `offTheGrid` reads after the first `</defs>`: shapes, groups, text and paint. */
const READ_ELEMENTS = new Set([
  'g',
  'rect',
  'path',
  'ellipse',
  'circle',
  'line',
  'polyline',
  'polygon',
  'text',
  'defs',
  'clipPath',
  'linearGradient',
  'radialGradient',
  'stop',
  'title',
  'desc',
  'style',
]);

/** A CSS declaration that moves a shape: a transform (or its origin or box), a translate, a rotate or a scale. */
const MOVES = /(?:^|[^-\w])(?:transform(?:-\w+)?|translate|rotate|scale)\s*:/;

/**
 * What in a picture `offTheGrid` does not read, each named; empty when it reads all of it. The
 * picture must have a `</defs>`; every opening tag must write its attributes as `name="value"`, with
 * no `<` or `>` in a value; nothing but a title, a description and a stylesheet may come before the
 * first `<defs>`; every element but the outer `<svg>` must be one of `READ_ELEMENTS` (so a `<use>`,
 * a `<symbol>` and an `<svg>` inside the picture are refused); the outer `<svg>` must not set a
 * stroke, a stroke width, a transform or `vector-effect`, by attribute or in its style, and its
 * `viewBox`, when it has one, must start at 0 0; no element may set `vector-effect`,
 * `transform-origin` or `transform-box` as an attribute, nor in its style a transform, a translate,
 * a rotate, a scale, `vector-effect` or the `animation` shorthand; and the stylesheets (every
 * `<style>`) must not set a stroke, a stroke width or `vector-effect`, nor move a shape or name an
 * animation outside a keyframes, and each of their keyframes must be one this reads.
 */
function unreadIn(svg: string): string[] {
  if (!svg.includes('</defs>')) return ['the picture has no </defs>, after which this reads'];
  const out: string[] = [];
  const firstDefs = svg.indexOf('<defs');
  const rootAt = svg.indexOf('<svg');
  const tag = /<[A-Za-z][\w:-]*(?:\s+[\w:-]+="[^"<>]*")*\s*\/?>/y;
  for (const m of svg.matchAll(/<([A-Za-z][\w:-]*)/g)) {
    const name = m[1] as string;
    const where = `the <${name}> at character ${m.index}`;
    tag.lastIndex = m.index;
    const written = tag.exec(svg)?.[0];
    if (written === undefined) {
      out.push(`${where} writes an attribute this does not read: only name="value" is read`);
      continue;
    }
    const at = attributesOf(written);
    const style = at.style ?? '';
    if (m.index === rootAt) {
      for (const k of ['stroke', 'stroke-width', 'transform', 'vector-effect'])
        if (k in at || new RegExp(`(?:^|;)\\s*${k}\\s*:`).test(style))
          out.push(`${where} sets ${k}, which this does not read`);
      const box = at.viewBox
        ?.trim()
        .split(/[\s,]+/)
        .map(Number);
      if (box && (box.length !== 4 || box[0] !== 0 || box[1] !== 0))
        out.push(`${where} has a viewBox that does not start at 0 0: ${at.viewBox}`);
      continue;
    }
    if (!READ_ELEMENTS.has(name)) {
      out.push(`${where} is an element this does not read`);
      continue;
    }
    if (m.index < firstDefs && !['title', 'desc', 'style', 'defs'].includes(name))
      out.push(`${where} comes before the <defs>, where this does not read`);
    for (const k of ['vector-effect', 'transform-origin', 'transform-box'])
      if (k in at) out.push(`${where} sets ${k}, which this does not read`);
    if (MOVES.test(style) || /(?:^|;)\s*(?:vector-effect|animation)\s*:/.test(style))
      out.push(`${where} sets in its style what this does not read: ${style}`);
  }
  const sheet = [...svg.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map((s) => s[1]).join('\n');
  if (/(?:^|[^-\w])(?:stroke(?:-width)?|vector-effect)\s*:/.test(sheet))
    out.push('the stylesheet sets a stroke, which this does not read');
  const outside = sheet.replace(/@keyframes\s*[\w-]+\s*\{(?:[^{}]*\{[^}]*\})*[^{}]*\}/g, '');
  if (MOVES.test(outside))
    out.push('the stylesheet moves a shape outside a keyframes, which this does not read');
  if (/(?:^|[^-\w])(?:animation-name\s*:|animation\s*:\s*(?!none\b))/.test(outside))
    out.push('the stylesheet gives a shape an animation, which this does not read');
  if ((sheet.match(/@keyframes\b/g) ?? []).length !== keyframesOf(svg).size)
    out.push('the stylesheet has a keyframes this does not read');
  return out;
}

/**
 * Each shape whose stroke, as drawn, is one unit wide and does not lie on the middle of a pixel:
 * at a whole coordinate such a line spreads over two columns of pixels at one pixel per unit and
 * is half as strong as a border drawn on a half.
 *
 * A picture with anything `unreadIn` names is refused whole, by those names, and nothing else of it
 * is read. Otherwise the shapes after the first `</defs>` are read (text is not): a shape's stroke
 * and its width are its own or those of the nearest group that sets them, a `style` before an
 * attribute, and the width is one unit when nothing sets it. The translates and uniform scales of
 * the `transform` attributes of the shape and of its groups are applied to its points and to its
 * width, once for each place the keyframes its and its groups' `animation-name` styles name move it
 * to. A rectangle's four edges, and every run of a path (absolute or relative, the run that closes
 * it included), a line, a polyline and a polygon are read: a run across or down must lie on a half,
 * and a diagonal is named. Named too, not passed: a curve or an arc, a circle or an ellipse, any
 * other transform (a keyframe that moves a shape by anything but one `transform:` included), and a
 * width, a number or a command this does not read. Each shape is named once, by its first fault, as
 * its tag and its place among the shapes.
 */
function offTheGrid(svg: string): string[] {
  const half = (v: number) => Math.abs((((v % 1) + 1) % 1) - 0.5) < 0.001;
  const found = unreadIn(svg);
  if (found.length > 0) return found;
  const frames = keyframesOf(svg);
  const inherited = (node: Node, key: string): string | undefined => {
    for (const at of [node.at, ...[...node.groups].reverse()]) {
      const styled = new RegExp(`(?:^|;)\\s*${key}\\s*:\\s*([^;]+)`).exec(at.style ?? '')?.[1];
      const value = styled?.trim() ?? at[key];
      if (value !== undefined && value !== 'inherit') return value;
    }
    return undefined;
  };
  nodesOf(svg).forEach((node, i) => {
    if (node.tag === 'text') return;
    const name = `${node.tag}#${i}`;
    const stroke = inherited(node, 'stroke');
    if (stroke === undefined || stroke === 'none') return;
    const written = inherited(node, 'stroke-width') ?? '1';
    const width = /^\d*\.?\d+$/.test(written) ? Number(written) : Number.NaN;
    if (!Number.isFinite(width)) {
      found.push(`${name} has a stroke width this does not read: ${written}`);
      return;
    }
    // Its own transform first, then each group's from the innermost out.
    let placed: Placement | undefined = { k: 1, dx: 0, dy: 0 };
    for (const t of [node.at.transform, ...[...node.groups].reverse().map((g) => g.transform)]) {
      const p = placementOf(t);
      placed = p &&
        placed && { k: placed.k * p.k, dx: placed.dx * p.k + p.dx, dy: placed.dy * p.k + p.dy };
    }
    const moves = [node.at, ...node.groups]
      .flatMap((g) => /animation-name:([^";]+)/.exec(g.style ?? '')?.[1]?.split(',') ?? [])
      .flatMap((k) => frames.get(k) ?? [])
      .filter((stop) => MOVES.test(stop.value))
      .map((stop) =>
        /^transform:[^;]*$/.test(stop.value)
          ? placementOf(stop.value.slice('transform:'.length))
          : undefined,
      );
    const places = (moves.length === 0 ? [{ k: 1, dx: 0, dy: 0 }] : moves).map(
      (m) =>
        m &&
        placed && { k: placed.k * m.k, dx: placed.dx * m.k + m.dx, dy: placed.dy * m.k + m.dy },
    );
    if (places.some((p) => p === undefined)) {
      found.push(`${name} is under a transform this does not read`);
      return;
    }
    for (const p of places as Placement[]) {
      if (Math.abs(width * p.k - 1) > 0.001) continue;
      const runs = runsOf(node);
      if (typeof runs === 'string') {
        found.push(`${name} ${runs}`);
        return;
      }
      for (const run of runs) {
        const [x1, y1, x2, y2] = run.map((v, j) => v * p.k + (j % 2 === 0 ? p.dx : p.dy));
        const across = Math.abs((y1 as number) - (y2 as number)) < 0.001;
        const down = Math.abs((x1 as number) - (x2 as number)) < 0.001;
        const fault =
          across && down
            ? undefined
            : across
              ? !half(y1 as number) && `runs along y=${y1}`
              : down
                ? !half(x1 as number) && `runs along x=${x1}`
                : `is a diagonal from ${x1}, ${y1} to ${x2}, ${y2}`;
        if (fault) {
          found.push(`${name} ${fault}`);
          return;
        }
      }
    }
  });
  return found;
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
  const tokens = [...d.matchAll(/[MmLlHhVvCcAaZz]|-?\d*\.?\d+(?:e-?\d+)?/g)].map((m) => m[0]);
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
      case 'C':
        // A cubic curve lies inside the hull of its four points, so its two controls box it.
        for (let c = 0; c < 2; c++) points.push([ox + next(), oy + next()]);
        x = ox + next();
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
  // A straight line across, or straight down, with its ends cut square reaches no further than
  // its ends along its length: only across it does its stroke spread.
  const capped = at['stroke-linecap'] === undefined || at['stroke-linecap'] === 'butt';
  const across = capped && /^M-?[\d.]+ -?[\d.]+H-?[\d.]+$/.test(at.d ?? '');
  const down = capped && /^M-?[\d.]+ -?[\d.]+V-?[\d.]+$/.test(at.d ?? '');
  const [hx, hy] = [across ? 0 : half, down ? 0 : half];
  box = [box[0] - hx, box[1] - hy, box[2] + hx, box[3] + hy];
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

/**
 * Every arrow of each package's picture, said here by hand, apart from the script: what it runs
 * from and what its head points at, each named by a text of the thing at that end (a text a box
 * holds, the caption over a box that holds none, or a text standing alone); whether a dot runs it,
 * and whether it stands apart, in grey and dashed long. The line back from what `@mnema/context`
 * composes stands apart and is struck: it writes nothing back.
 */
const ARROWS: Readonly<
  Record<string, readonly { from: string; to: string; dot: boolean; apart?: boolean }[]>
> = {
  chain: [
    { from: 'checkpoint · Ed25519', to: 'verify', dot: true },
    { from: 'checkpoint · Ed25519', to: 'mnema_verify.py', dot: true },
  ],
  core: [
    { from: 'proposed', to: 'accepted', dot: true },
    { from: 'proposed', to: 'superseded', dot: false },
    { from: 'proposed', to: 'rejected', dot: false },
    { from: 'accepted', to: 'superseded', dot: false },
    { from: 'accept', to: 'rejected', dot: true },
    { from: 'projectDecisions', to: 'ADR-2 · Keep money as integer cents · accepted', dot: true },
  ],
  context: [
    { from: 'ADR-2 accepted', to: 'decisions', dot: true },
    {
      from: 'only READS and COMPOSES',
      to: 'src/billing/total.ts → ADR-2',
      dot: false,
      apart: true,
    },
  ],
  stacks: [{ from: 'path NUL sha256(file) LF', to: 'df9d8d71cdc13bd89b45af349e677ecf', dot: true }],
};

/** The arrows of the steps, said here by hand as `ARROWS` says a package's: each to the next step. */
const FRONT_ARROWS: Readonly<
  Record<string, readonly { from: string; to: string; dot: boolean; apart?: boolean }[]>
> = {
  'how-it-works': [
    { from: 'Record', to: 'Rule', dot: true },
    { from: 'Rule', to: 'Hand over', dot: true },
    { from: 'Hand over', to: 'Verify', dot: true },
  ],
};

/**
 * How mnema fits, said here by hand apart from the script: its two lanes, each by the things at its
 * ends and whether a head stands at each; and the packets that run them, in the order they set off,
 * each by where it leaves and where it arrives. The hub draws the wordmark and no text: an end
 * that reaches it is `mnema`.
 */
const HERO_LANES = [
  { ends: ['agent session', 'mnema'], heads: [true, true] },
  { ends: ['mnema', 'repository'], heads: [false, true] },
] as const;
const HERO_PACKETS = [
  ['mnema', 'agent session'],
  ['agent session', 'mnema'],
  ['mnema', 'agent session'],
  ['mnema', 'repository'],
  ['agent session', 'mnema'],
  ['mnema', 'repository'],
  ['agent session', 'mnema'],
  ['mnema', 'repository'],
] as const;

/** The advance of a character of the monospace face every picture writes in, as a share of its size. */
const ADVANCE = 0.6;
/**
 * The sans face the steps and how mnema fits write their prose in is not monospace: a share of its
 * size no line of theirs is wider than per character, on average (the widest measured in Chromium,
 * a digit alone, is 0.572).
 */
const SANS_ADVANCE = 0.58;

/** Everything the guards below read of one picture. */
function drawing(svg: string) {
  const nodes = nodesOf(svg);
  const frames = keyframesOf(svg);
  const named = (n: Node): string[] =>
    [n.at.style, ...n.groups.map((g) => g.style)].flatMap(
      (s) => /animation-name:([^"]+)/.exec(s ?? '')?.[1]?.split(',') ?? [],
    );
  // Every box but the page, which is the one rect with no place of its own.
  const rects = nodes.filter((n) => n.tag === 'rect' && n.at.x !== undefined);
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
  const within = ([x, y]: [number, number], [x0, y0, x1, y1]: Box) =>
    x >= x0 && x <= x1 && y >= y0 && y <= y1;
  /** The boxes there in the last frame, each once: a card and the light laid on it are one box. */
  const resting = rects
    .filter((r) => r.at.opacity !== '0' && !r.groups.some((g) => g.opacity === '0'))
    .filter((r, i, all) => all.findIndex((o) => boxOf(o).join() === boxOf(r).join()) === i);
  const texts = nodes.filter((n) => n.tag === 'text');
  const anchor = (t: Node): [number, number] => [Number(t.at.x), Number(t.at.y)];
  const holding = (text: string): Node => {
    const t = texts.find((n) => n.text === text);
    expect(t, `no text ${text}`).toBeDefined();
    const found = resting.filter((r) => t !== undefined && within(anchor(t), boxOf(r)));
    expect(found, `the box around ${text}`).toHaveLength(1);
    return found[0] as Node;
  };
  /** Where a text's ink lies, from its size, its anchor and the advance of the face. */
  const inkOf = (t: Node): Box => {
    const size = Number(t.at['font-size']);
    const advance = (t.at['font-family'] ?? '').startsWith('ui-monospace') ? ADVANCE : SANS_ADVANCE;
    const width =
      [...t.text.replaceAll('&amp;', '&').replaceAll('&quot;', '"')].length * size * advance;
    const x = Number(t.at.x) - (t.at['text-anchor'] === 'middle' ? width / 2 : 0);
    const y = Number(t.at.y);
    return [x, y - size * 0.75, x + width, y + size * 0.25];
  };
  // Each line from one thing to another: two points, dashed, in the width of a line.
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
  type Dot = (typeof dots)[number];
  /** The dot whose way runs from one point to the other. */
  const dotOn = (a: [number, number], b: [number, number]) =>
    dots.find(
      ({ moves }) =>
        moves.some((m) => near([m.dx, m.dy], a)) && moves.some((m) => near([m.dx, m.dy], b)),
    );
  /** The places a dot is at while it shows, in order, each named by the end it is at. */
  const wayOf = (
    dot: Dot | undefined,
    [a, an]: [[number, number], string],
    [b, bn]: [[number, number], string],
  ): string[] => {
    const where = (p: [number, number]) =>
      near(p, a, 0.5) ? an : near(p, b, 0.5) ? bn : 'between';
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
    return visible.length > 0 ? way : [];
  };
  /**
   * The texts that name the thing nearest a point: the texts of the nearest box there in the last
   * frame (or, for a box that holds none, the caption just over it), or a text standing alone.
   */
  const namesNear = (p: [number, number]): string[] => {
    const free = texts.filter((t) => !resting.some((r) => within(anchor(t), boxOf(r))));
    const things = [
      ...resting.map((r) => {
        const b = boxOf(r);
        const inside = texts.filter((t) => within(anchor(t), b)).map((t) => t.text);
        const over = free
          .filter((t) => {
            const [x, y] = anchor(t);
            return y >= b[1] - 20 && y <= b[1] && x >= b[0] - 1 && x <= b[2];
          })
          .map((t) => t.text);
        return { names: inside.length > 0 ? inside : over, at: distance(p, b) };
      }),
      ...free.map((t) => ({ names: [t.text], at: distance(p, inkOf(t)) })),
    ].sort((x, y) => x.at - y.at);
    return things[0]?.names ?? [];
  };
  return {
    nodes,
    frames,
    rects,
    resting,
    texts,
    inkOf,
    holding,
    lines,
    tips,
    near,
    distance,
    dots,
    dotOn,
    wayOf,
    namesNear,
    pulses,
    centre,
    boxOf,
  };
}

describe('every package, and the family, is drawn inside its frame, on its middle, in its roles', () => {
  const drawn: Record<string, string> = {
    ...drawThePackages(THE_BLOCKS),
    ...Object.fromEntries(
      Object.entries(drawTheFrontPage(THE_BLOCKS)).map(([file, svg]) => [`${ASSETS}/${file}`, svg]),
    ),
  };
  // Each package and the family, and the front page's other pictures: whether it writes words, and
  // whether it holds them in cards.
  const pictures = [
    ...LINED.map((p) => ({ ...p, words: true, cards: p.id !== 'family', front: false })),
    ...FRONT.map((p) => ({ ...p, cards: p.words, front: true })),
  ].flatMap((p) =>
    (['dark', 'light'] as const).map((theme) => ({
      path: p[theme],
      frame: p.frame,
      words: p.words,
      cards: p.cards,
      front: p.front,
      svg: drawn[p[theme]] ?? '',
    })),
  );

  it.each(pictures)('$path paints every shape inside its frame', ({ svg, frame }) => {
    // A stroke past the edge of the frame is cut off: half of it is not drawn.
    const frames = keyframesOf(svg);
    const shapes = nodesOf(svg).filter(
      (n) => n.tag !== 'text' && !(n.tag === 'rect' && n.at.x === undefined),
    );
    expect(shapes.length).toBeGreaterThan(frame.shapes);
    const outside = shapes.flatMap((n) =>
      boxesOf(n, frames)
        .filter(([x0, y0, x1, y1]) => x0 < 0 || y0 < 0 || x1 > frame.w || y1 > frame.h)
        .map(
          (b) =>
            `${n.tag} ${(n.at.d ?? `${n.at.x},${n.at.y}`).slice(0, 24)}: ${b.map((v) => +v.toFixed(2)).join(' ')}`,
        ),
    );
    expect(outside).toEqual([]);
  });

  /**
   * How far left and right what is there in the last frame under the band at the head reaches,
   * shapes and the ink of each text. The glow behind it is not counted: it is centred by itself,
   * and as wide as it is it would hide a drawing set off the middle.
   */
  const reach = (
    svg: string,
    frame: { band: number },
  ): { left: number; right: number; top: number; foot: number } => {
    const d = drawing(svg);
    const frames = keyframesOf(svg);
    const still = d.nodes.filter(
      (n) =>
        n.at.opacity !== '0' &&
        !n.groups.some((g) => g.opacity === '0') &&
        !(n.tag === 'rect' && n.at.x === undefined) &&
        !(n.at.fill ?? '').startsWith('url(#glow'),
    );
    const boxes = still
      .flatMap((n) => (n.tag === 'text' ? [d.inkOf(n)] : boxesOf(n, frames)))
      .filter((b) => b[3] > frame.band);
    expect(boxes.length).toBeGreaterThan(10);
    return {
      left: Math.min(...boxes.map((b) => b[0])),
      right: Math.max(...boxes.map((b) => b[2])),
      top: Math.min(...boxes.map((b) => b[1])),
      foot: Math.max(...boxes.map((b) => b[3])),
    };
  };

  it.each(pictures)('$path sets what it draws on the middle of its frame', ({ svg, frame }) => {
    // It spans as far from the left edge as from the right.
    const { left, right } = reach(svg, frame);
    expect(Math.abs(left + right - frame.w) / 2, `${left}..${right}`).toBeLessThanOrEqual(0.5);
  });

  it.each(pictures.filter((p) => p.frame.margin > 0))(
    '$path leaves room between what it draws and each side of its frame',
    ({ svg, frame }) => {
      const { left, right } = reach(svg, frame);
      expect(
        Math.min(left, frame.w - right),
        `${left}..${right} in 0..${frame.w}`,
      ).toBeGreaterThanOrEqual(frame.margin);
    },
  );

  it.each(pictures.filter((p) => p.front))(
    '$path sets what it draws on the middle of its frame from top to foot, the margin in from each',
    ({ svg, frame }) => {
      const { left, right, top, foot } = reach(svg, frame);
      expect(Math.abs(top + foot - frame.h) / 2, `${top}..${foot}`).toBeLessThanOrEqual(0.5);
      expect(
        Math.min(left, top, frame.w - right, frame.h - foot),
        `${left}..${right} x ${top}..${foot} in ${frame.w} x ${frame.h}`,
      ).toBeGreaterThanOrEqual(frame.margin);
    },
  );

  it.each(pictures.filter((p) => p.cards))(
    "$path sets the text of each card on the card's middle, from its top to its foot",
    ({ svg }) => {
      // The ink of what a card holds in the last frame, from the top of its first line to the foot
      // of its last, lies as far from the card's top edge as from its bottom one. A line that comes
      // and goes is not counted: the card is drawn for what it holds at rest.
      const d = drawing(svg);
      const resting = d.texts.filter(
        (t) => t.at.opacity !== '0' && !t.groups.some((g) => g.opacity === '0'),
      );
      const held = d.resting.flatMap((r) => {
        const [x0, y0, x1, y1] = d.boxOf(r);
        const inside = resting.filter((t) => {
          const [x, y] = [Number(t.at.x), Number(t.at.y)];
          return x >= x0 && x <= x1 && y >= y0 && y <= y1;
        });
        if (inside.length === 0) return [];
        const top = Math.min(...inside.map((t) => d.inkOf(t)[1]));
        const foot = Math.max(...inside.map((t) => d.inkOf(t)[3]));
        return [{ card: inside.map((t) => t.text).join(' / '), off: (top + foot - y0 - y1) / 2 }];
      });
      expect(held.length).toBeGreaterThan(0);
      expect(held.filter((h) => Math.abs(h.off) > 1)).toEqual([]);
    },
  );

  it.each(pictures.filter((p) => p.words))(
    '$path writes every text in the size and weight of a role',
    ({ svg }) => {
      const roles = new Set(Object.values(TYPE).map((r) => `${r.size}/${r.weight}`));
      const written = drawing(svg).texts.map(
        (t) => `${t.at['font-size']}/${t.at['font-weight'] ?? ''}`,
      );
      expect(written.length).toBeGreaterThan(5);
      expect(written.filter((w) => !roles.has(w))).toEqual([]);
    },
  );
});

describe('every package draws which way each of its arrows goes', () => {
  const packages = drawThePackages(THE_BLOCKS);

  it('says the arrows of every package it draws', () => {
    expect(Object.keys(ARROWS).sort()).toEqual(PACKAGE_PICTURES.map((p) => p.dir).sort());
  });

  const front = drawTheFrontPage(THE_BLOCKS);
  const cases = [
    ...PACKAGE_PICTURES.flatMap(({ dir }) =>
      (['dark', 'light'] as const).map((theme) => ({
        dir,
        theme,
        svg: packages[`packages/${dir}/assets/${dir}-${theme}.svg`] ?? '',
      })),
    ),
    // The steps draw theirs as the packages do: each from a step to the next.
    ...(['dark', 'light'] as const).map((theme) => ({
      dir: 'how-it-works',
      theme,
      svg: front[`how-it-works-${theme}.svg`] ?? '',
    })),
  ];

  it.each(cases)(
    '$dir ($theme) draws each arrow from where it runs to where it points',
    ({ dir, theme, svg }) => {
      const d = drawing(svg);
      const said = ARROWS[dir] ?? FRONT_ARROWS[dir] ?? [];
      expect(said.length).toBeGreaterThan(0);
      // No arrow on the picture that is not said here, and none said that is not on it.
      expect(d.lines).toHaveLength(said.length);
      const found = said.map((arrow) => {
        const line = d.lines.filter(({ ends }) => {
          const [a = [0, 0], b = [0, 0]] = ends;
          const [na, nb] = [d.namesNear(a), d.namesNear(b)];
          return (
            (na.includes(arrow.from) && nb.includes(arrow.to)) ||
            (na.includes(arrow.to) && nb.includes(arrow.from))
          );
        });
        expect(line, `the line from ${arrow.from} to ${arrow.to}`).toHaveLength(1);
        const [a = [0, 0], b = [0, 0]] = line[0]?.ends ?? [];
        const [tail, head] = d.namesNear(a).includes(arrow.from) ? [a, b] : [b, a];
        const dot = d.dotOn(tail, head);
        return {
          arrow: `${arrow.from} → ${arrow.to}`,
          heads: [d.tips.some((t) => d.near(t, tail)), d.tips.some((t) => d.near(t, head))],
          way: d.wayOf(dot, [tail, 'from'], [head, 'to']),
          apart:
            line[0]?.node.at['stroke-dasharray'] === '8 5' &&
            line[0]?.node.at.stroke !== ACCENT[theme],
        };
      });
      expect(found).toEqual(
        said.map((arrow) => ({
          arrow: `${arrow.from} → ${arrow.to}`,
          heads: [false, true],
          way: arrow.dot ? ['from', 'to'] : [],
          apart: arrow.apart === true,
        })),
      );
    },
  );
});

describe('how mnema fits draws which way the record goes', () => {
  const pictures = drawTheFrontPage(THE_BLOCKS);

  it.each(['dark', 'light'] as const)(
    'how mnema fits (%s) heads each lane, and runs each packet, the way the record goes',
    (theme) => {
      const d = drawing(pictures[`how-mnema-fits-${theme}.svg`] ?? '');
      const nameOf = (p: [number, number]): string => {
        const names = d.namesNear(p);
        if (names.includes('agent session')) return 'agent session';
        if (names.includes('repository')) return 'repository';
        return names.length === 0 ? 'mnema' : names.join(' / ');
      };
      expect(d.lines).toHaveLength(HERO_LANES.length);
      const lanes = d.lines
        .map(({ ends }) => {
          const [a = [0, 0], b = [0, 0]] = ends;
          const [first, second] = a[0] <= b[0] ? [a, b] : [b, a];
          return {
            ends: [first, second] as const,
            names: [nameOf(first), nameOf(second)],
            heads: [d.tips.some((t) => d.near(t, first)), d.tips.some((t) => d.near(t, second))],
          };
        })
        .sort((x, y) => x.ends[0][0] - y.ends[0][0]);
      expect(lanes.map((l) => ({ ends: l.names, heads: l.heads }))).toEqual(
        HERO_LANES.map((l) => ({ ends: [...l.ends], heads: [...l.heads] })),
      );
      const runs = (dot: (typeof d.dots)[number], p: readonly [number, number]) =>
        dot.moves.some((m) => d.near([m.dx, m.dy], [p[0], p[1]]));
      const packets = d.dots
        .map((dot) => {
          const lane = lanes.find((l) => runs(dot, l.ends[0]) && runs(dot, l.ends[1]));
          expect(lane, 'a packet off both lanes').toBeDefined();
          const [a = [0, 0], b = [0, 0]] = lane?.ends ?? [];
          return {
            rise: dot.rise ?? 0,
            way: d.wayOf(dot, [a, lane?.names[0] ?? ''], [b, lane?.names[1] ?? '']),
          };
        })
        .sort((x, y) => x.rise - y.rise);
      expect(packets.map((p) => p.way)).toEqual(HERO_PACKETS.map((p) => [...p]));
    },
  );
});

describe('the family draws which way the record goes', () => {
  const pictures = drawTheFrontPage(THE_BLOCKS);
  const themes = (['dark', 'light'] as const).map((theme) => ({
    theme,
    svg: pictures[`the-family-${theme}.svg`] ?? '',
  }));

  /** Everything the guards below read of one theme's picture: the hub, and each card around it. */
  function layout(svg: string) {
    const d = drawing(svg);
    const hub = d.holding('@mnema/code');
    const cards = RELATIONS.map((relation) => {
      const card = d.holding(relation.card);
      const line = d.lines.find(({ ends }) => ends.some((e) => d.distance(e, d.boxOf(card)) <= 6));
      expect(line, `the line of ${relation.card}`).toBeDefined();
      const [a = [0, 0], b = [0, 0]] = line?.ends ?? [];
      const [atCard, atHub] =
        d.distance(a, d.boxOf(card)) <= d.distance(b, d.boxOf(card)) ? [a, b] : [b, a];
      // The dot whose way runs from one end of this line to the other.
      const dot = d.dotOn(atCard, atHub);
      return {
        ...relation,
        box: card,
        line: line?.node,
        heads: [d.tips.some((t) => d.near(t, atCard)), d.tips.some((t) => d.near(t, atHub))],
        way: d.wayOf(dot, [atCard, 'card'], [atHub, 'hub']),
        rise: dot?.rise,
      };
    });
    return { ...d, hub, cards };
  }

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
    expect(svgs.filter((f) => f.startsWith('packages/')).length).toBe(8);
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
