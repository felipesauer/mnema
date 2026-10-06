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
import { THE_BLOCKS } from '../src/presentation/banner.js';
import { ROOT, read } from './support/published-examples.js';

/** Named by a variable, because these are scripts of the repository and not modules of the product. */
const DRAW = join(ROOT, '.github', 'the-front-page', 'draw.mjs');
const ACCENT_FILE = join(ROOT, '.github', 'the-front-page', 'accent.mjs');

const { drawTheFrontPage } = (await import(pathToFileURL(DRAW).href)) as {
  drawTheFrontPage: (blocks: readonly string[]) => Record<string, string>;
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
      /(?:fill|stroke|stop-color|flood-color|lighting-color|color)\s*[=:]\s*["']?([^"';\s>]+)/g,
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

const svgs = readdirSync(join(ROOT, ASSETS)).filter((f) => f.endsWith('.svg'));

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

  it.each(svgs)('%s uses no hue but the accent of its theme', (file) => {
    const svg = read(`${ASSETS}/${file}`);
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
