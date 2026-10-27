// Draws the front page's pictures, all animated in the family's paint and motion:
// `docs/assets/banner-{dark,light}.svg`, `docs/assets/how-it-works-{dark,light}.svg`,
// `docs/assets/how-mnema-fits-{dark,light}.svg` and
// `docs/assets/the-family-{dark,light}.svg`; and one animated picture per published package but
// `@mnema/code`, `packages/<p>/assets/<p>-{dark,light}.svg`, in the family's colours, glow and
// motion, with the block that opens the package's README and points at the file on the
// repository's `main` branch. `@mnema/code`'s README points at the family instead.
//
// THE BANNER IS THE CONSOLE'S WORDMARK. Its rows are read from `THE_BLOCKS`
// (`packages/code/src/presentation/banner.ts`, through the build) and each glyph is drawn as
// geometry in a cell of the terminal's proportions: a full block as a filled cell, a
// double-line box glyph as its two strokes. Geometry rather than text, because GitHub serves an
// SVG as an image and a block font cannot be counted on there. Beside it, a short chain of
// blocks. The only hue is the accent (`accent.mjs`); everything else is a grey. A faint light
// passes over the letters and the blocks and moves nothing; out of it, the banner is as drawn.
//
// From the root of a built checkout (`pnpm build`):
//
//   node .github/the-front-page/draw.mjs          writes the pictures
//   node .github/the-front-page/draw.mjs --check  writes nothing; exits 1 if one differs
//
// `packages/code/tests/the-front-page-is-drawn-from-the-console.test.ts` calls
// `drawTheFrontPage` over the rows the console draws today and holds each committed picture to
// what it returns.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { ACCENT } from './accent.mjs';

/** The greys of each theme: GitHub's own text, muted text and border. */
const NEUTRAL = Object.freeze({
  dark: { text: '#f0f6fc', muted: '#9198a1', border: '#3d444d' },
  light: { text: '#1f2328', muted: '#59636e', border: '#d1d9e0' },
});

const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans',Helvetica,Arial,sans-serif";
const MONO = "ui-monospace,SFMono-Regular,'SF Mono',Menlo,Consolas,'Liberation Mono',monospace";

/**
 * A number as the picture writes it: at most two decimals, no trailing zeros.
 * @param {number} value
 */
const n = (value) => String(Math.round(value * 100) / 100);

// ---------------------------------------------------------------------------------------------
// The wordmark

/** One terminal cell, in the proportions of a monospace font: twice as tall as it is wide. */
export const CELL = { w: 12, h: 24 };
/** A double line's two strokes: half the gap between their centres, and their width. */
export const DOUBLE = { half: 2.75, width: 1.5 };

/**
 * The strokes of a double-line box glyph in a cell at (x, y), as path data, or undefined for a
 * glyph that is not one. Each stroke runs to the cell's edge, so neighbours join.
 * @param {string} glyph
 * @param {number} x
 * @param {number} y
 * @returns {string | undefined}
 */
export function doubleLine(glyph, x, y) {
  const { w, h } = CELL;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const a = DOUBLE.half;
  const L = x;
  const R = x + w;
  const T = y;
  const B = y + h;
  /** @param {...[number, number]} points */
  const p = (...points) => `M${points.map(([px, py]) => `${n(px)} ${n(py)}`).join('L')}`;
  switch (glyph) {
    case '═':
      return p([L, cy - a], [R, cy - a]) + p([L, cy + a], [R, cy + a]);
    case '║':
      return p([cx - a, T], [cx - a, B]) + p([cx + a, T], [cx + a, B]);
    case '╔':
      return (
        p([R, cy - a], [cx - a, cy - a], [cx - a, B]) +
        p([R, cy + a], [cx + a, cy + a], [cx + a, B])
      );
    case '╗':
      return (
        p([L, cy - a], [cx + a, cy - a], [cx + a, B]) +
        p([L, cy + a], [cx - a, cy + a], [cx - a, B])
      );
    case '╚':
      return (
        p([cx - a, T], [cx - a, cy + a], [R, cy + a]) +
        p([cx + a, T], [cx + a, cy - a], [R, cy - a])
      );
    case '╝':
      return (
        p([cx + a, T], [cx + a, cy + a], [L, cy + a]) +
        p([cx - a, T], [cx - a, cy - a], [L, cy - a])
      );
    default:
      return undefined;
  }
}

/**
 * The wordmark as two paths, one for the blocks and one for the lines. One path each, so cells
 * that touch are filled as one shape and no seam shows between them at any scale.
 * @param {readonly string[]} blocks
 * @param {string} accent
 * @param {number} x0
 * @param {number} y0
 */
function wordmark(blocks, accent, x0, y0) {
  /** @type {string[]} */
  const fills = [];
  /** @type {string[]} */
  const strokes = [];
  blocks.forEach((row, r) => {
    [...row].forEach((glyph, c) => {
      const x = x0 + c * CELL.w;
      const y = y0 + r * CELL.h;
      if (glyph === ' ') return;
      if (glyph === '█') {
        // A cell reaches half a unit into a block beside it or under it, so no hairline of the
        // page shows where four corners meet; the outer edges stay on the grid.
        const w = CELL.w + ([...row][c + 1] === '█' ? 0.5 : 0);
        const h = CELL.h + ([...(blocks[r + 1] ?? '')][c] === '█' ? 0.5 : 0);
        fills.push(`M${n(x)} ${n(y)}h${w}v${h}h-${w}z`);
        return;
      }
      const line = doubleLine(glyph, x, y);
      if (line === undefined)
        throw new Error(`the wordmark has a glyph this cannot draw: ${glyph}`);
      strokes.push(line);
    });
  });
  return [
    `<path data-of="blocks" fill="${accent}" d="${fills.join('')}"/>`,
    `<path data-of="lines" fill="none" stroke="${accent}" stroke-opacity="0.55" stroke-width="${DOUBLE.width}" stroke-linejoin="miter" d="${strokes.join('')}"/>`,
  ];
}

/**
 * How far down the wordmark's ink reaches: a last row of shadow only ends at the lower stroke of
 * a double line on the middle of its cell, not at the cell's foot.
 * @param {readonly string[]} blocks
 */
export function inkFoot(blocks) {
  const shadowOnly = [...(blocks.at(-1) ?? '')].every((g) => ' ╚═╝'.includes(g));
  const height = blocks.length * CELL.h;
  return shadowOnly ? height - CELL.h / 2 + DOUBLE.half + DOUBLE.width / 2 : height;
}

// ---------------------------------------------------------------------------------------------
// The chain of blocks

const COS30 = Math.cos(Math.PI / 6);

/**
 * An isometric cube of edge `a` whose middle vertex is (x, y), its three faces shaded and its
 * edges stroked in the accent. A solid one has faces in the accent itself and no stroke: each face
 * is drawn in from its edges by the half of an edge's width, so the page parts them, on a cube
 * grown by as much, so its outline reaches as far as a stroked one's.
 * @param {number} x
 * @param {number} y
 * @param {number} a
 * @param {string} accent
 * @param {readonly number[]} shade
 * @param {boolean} [solid]
 */
function cube(x, y, a, accent, shade, solid = false) {
  const half = 1.75 / 2;
  const e = solid ? a + (2 * half) / COS30 : a;
  const dx = e * COS30;
  const top = [
    [x, y - e],
    [x + dx, y - e / 2],
    [x, y],
    [x - dx, y - e / 2],
  ];
  const left = [
    [x - dx, y - e / 2],
    [x, y],
    [x, y + e],
    [x - dx, y + e / 2],
  ];
  const right = [
    [x, y],
    [x + dx, y - e / 2],
    [x + dx, y + e / 2],
    [x, y + e],
  ];
  // A face is a rhombus whose middle is dx / 2 from each of its sides.
  const k = solid ? 1 - half / (dx / 2) : 1;
  /**
   * @param {number[][]} points
   * @param {number | undefined} opacity
   */
  const face = (points, opacity) => {
    const [mx = 0, my = 0] = [0, 1].map((j) => points.reduce((sum, p) => sum + (p[j] ?? 0), 0) / 4);
    const drawn = points.map(([px = 0, py = 0]) => [mx + (px - mx) * k, my + (py - my) * k]);
    return `<path d="M${drawn.map(([px, py]) => `${n(px ?? 0)} ${n(py ?? 0)}`).join('L')}z" fill="${accent}" fill-opacity="${opacity}"/>`;
  };
  const faces = [face(top, shade[0]), face(left, shade[1]), face(right, shade[2])];
  if (solid) return faces;
  return [
    ...faces,
    `<path d="M${n(x)} ${n(y - a)}L${n(x + dx)} ${n(y - a / 2)}L${n(x + dx)} ${n(y + a / 2)}L${n(x)} ${n(y + a)}L${n(x - dx)} ${n(y + a / 2)}L${n(x - dx)} ${n(y - a / 2)}zM${n(x - dx)} ${n(y - a / 2)}L${n(x)} ${n(y)}L${n(x + dx)} ${n(y - a / 2)}M${n(x)} ${n(y)}V${n(y + a)}" fill="none" stroke="${accent}" stroke-width="1.75" stroke-linejoin="round"/>`,
  ];
}

/**
 * Four cubes in a row, each linked to the one before it; the newest is the most solid.
 * @param {string} accent
 * @param {string} muted
 * @param {number} x0
 * @param {number} cy
 * @param {{ chain: readonly number[], newest: readonly number[], solid: boolean }} paint
 */
function chain(accent, muted, x0, cy, paint) {
  const a = 30;
  const dx = a * COS30;
  const link = 18;
  const step = 2 * dx + link;
  const shades = [paint.chain, paint.chain, paint.chain, paint.newest];
  /** @type {string[]} */
  const parts = [];
  for (let i = 0; i < shades.length; i++) {
    const x = x0 + dx + i * step;
    if (i > 0) {
      const from = x - step + dx;
      const to = x - dx;
      parts.push(
        `<path d="M${n(from + 3)} ${n(cy)}H${n(to - 3)}" stroke="${muted}" stroke-width="1.75" stroke-linecap="round"/>`,
        `<circle cx="${n(from)}" cy="${n(cy)}" r="2.5" fill="${muted}"/>`,
        `<circle cx="${n(to)}" cy="${n(cy)}" r="2.5" fill="${muted}"/>`,
      );
    }
    parts.push(...cube(x, cy, a, accent, shades[i] ?? [], i === 3 && paint.solid));
  }
  return { parts, width: shades.length * 2 * dx + (shades.length - 1) * link };
}

/** The room between what the banner, the steps and how mnema fits draw and each side of their frame. */
const FRONT_MARGIN = 8;

/** The banner's loop, in seconds: long, for a light that is barely there. */
const BANNER_LOOP = 12;
/** How many columns of the wordmark one band of the light that passes over the letters covers. */
const BAND_COLUMNS = 4;

/**
 * The banner, in the family's paint: its own page and the glow behind it, and a light that is
 * barely there. A band of light passes over the letters from left to right, then the four cubes
 * light one after the other, and all four go dark together; nothing moves. Every light is laid
 * over the drawing and is out in the last frame, so a reader who asked for less motion sees the
 * banner as it is drawn.
 * @param {readonly string[]} blocks
 * @param {'dark' | 'light'} theme
 */
function banner(blocks, theme) {
  const s = { ...scene(BANNER_LOOP, theme), paint: frontPalette(theme) };
  const accent = ACCENT[theme];
  const { muted, text } = NEUTRAL[theme];
  const columns = Math.max(...blocks.map((row) => [...row].length));
  const markWidth = columns * CELL.w;
  const gap = 56;
  // The drawing on the middle of the frame, the margin in from each side: the cubes' outer stroke
  // reaches past their row by half its width, and the last row of the wordmark is shadow only,
  // whose lowest stroke is the lower one of a double line on the middle of its cell.
  const x0 = FRONT_MARGIN;
  const y0 = FRONT_MARGIN;
  const foot = inkFoot(blocks);
  // The chain sits on the middle of the letters' faces.
  const middle = y0 + ((blocks.length - 1) * CELL.h) / 2;
  const { parts, width } = chain(accent, muted, x0 + markWidth + gap, middle, s.paint);
  // Written to a hundredth, up, so the margin on the right is never under the one on the left.
  const w = Math.ceil((x0 + markWidth + gap + width + 1.75 / 2 + FRONT_MARGIN) * 100) / 100;
  const h = y0 + foot + FRONT_MARGIN;
  const [blockPath, linePath] = wordmark(blocks, accent, x0, y0);
  const letters = /\bd="([^"]*)"/.exec(blockPath ?? '')?.[1] ?? '';
  /** @type {string[]} */
  const light = [];
  // The light over the letters: a band of columns at a time, each up and down once, the next a
  // little after, in the deepest grey of the theme over the accent, faint.
  const bands = Math.ceil(columns / BAND_COLUMNS);
  for (let k = 0; k < bands; k++) {
    const t = 0.8 + 0.15 * k;
    light.push(
      `<rect ${s.goes(
        [
          [0, '0'],
          [t, '0'],
          [t + 0.6, '1'],
          [t + 1.4, '0'],
          [s.loop, '0'],
        ],
        '0',
      )} x="${n(x0 + k * BAND_COLUMNS * CELL.w)}" y="${y0}" width="${BAND_COLUMNS * CELL.w}" height="${foot}" fill="${text}" fill-opacity="0.16" clip-path="url(#letters)"/>`,
    );
  }
  // The cubes light one after the other, faintly, and go dark together.
  const a = 30;
  const step = 2 * a * COS30 + 18;
  for (let i = 0; i < 4; i++) {
    const t = 4.2 + 0.5 * i;
    light.push(
      `<path ${s.goes(
        [
          [0, '0'],
          [t, '0'],
          [t + 0.8, '1'],
          [9.0, '1'],
          [9.8, '0'],
          [s.loop, '0'],
        ],
        '0',
      )} d="${hexagon(x0 + markWidth + gap + a * COS30 + i * step, middle, a)}" fill="${accent}" fill-opacity="${s.paint.glows}"/>`,
    );
  }
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n(w)}" height="${n(h)}" viewBox="0 0 ${n(w)} ${n(h)}" role="img" aria-label="mnema">`,
    '<title>mnema</title>',
    '<style>',
    `.a{animation-duration:${BANNER_LOOP}s;animation-iteration-count:infinite;animation-timing-function:ease-in-out}`,
    ...s.css,
    '@media (prefers-reduced-motion: reduce){.a{animation:none!important}}',
    '</style>',
    `<defs><clipPath id="letters"><path d="${letters}"/></clipPath></defs>`,
    ...s.paint.defs,
    `<rect width="${n(w)}" height="${n(h)}" fill="${PAGE[theme]}"/>`,
    `<ellipse cx="${n(w / 2)}" cy="${n(h / 2)}" rx="${n(w / 2 - 8)}" ry="${n(h / 2)}" fill="url(#glow)"/>`,
    blockPath,
    linePath,
    ...parts,
    ...light,
    '</svg>',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------------------------
// How it works

const STEPS = [
  {
    title: 'Record',
    lines: ['A decision, why it was', 'made, and the options', 'turned down.'],
    chip: 'mnema decision',
  },
  {
    title: 'Rule',
    lines: ['Accepted by a person,', 'then linked to the paths', 'it governs.'],
    chip: 'mnema link',
  },
  {
    title: 'Hand over',
    lines: ['The plugin opens every', 'session with it, and each', 'edit meets its rules.'],
    chip: 'refuses-a-write',
  },
  {
    title: 'Verify',
    lines: ['Every fact is signed and', 'hash-chained; anyone can', 'check it.'],
    chip: 'mnema verify',
  },
];

/** @param {string} text */
const escaped = (text) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/**
 * A text in the front page's sans face, in the size and weight of its role.
 * @param {Scene} s
 * @param {string} text
 * @param {number} x
 * @param {number} y
 * @param {Role} role
 * @param {{ fill?: string, anchor?: string, attrs?: string, preserve?: boolean }} [o]
 */
const sans = (s, text, x, y, role, o = {}) =>
  `<text${o.attrs ? ` ${o.attrs}` : ''} x="${n(x)}" y="${n(y)}" font-family="${SANS}" font-size="${TYPE[role].size}"${TYPE[role].weight ? ` font-weight="${TYPE[role].weight}"` : ''} fill="${o.fill ?? (role === 'caption' ? s.muted : s.text)}"${o.anchor ? ` text-anchor="${o.anchor}"` : ''}${o.preserve ? ' xml:space="preserve"' : ''}>${escaped(text)}</text>`;

/**
 * The opening of a front page picture: its frame, its title, the style that moves it, the paint,
 * its page and the glow behind what it draws.
 * @param {Scene} s
 * @param {number} w
 * @param {number} h
 * @param {string} label
 * @param {string} title
 * @param {string} glow the glow's ellipse
 */
const opening = (s, w, h, label, title, glow) => [
  `<svg xmlns="http://www.w3.org/2000/svg" width="${n(w)}" height="${n(h)}" viewBox="0 0 ${n(w)} ${n(h)}" role="img" aria-label="${label}">`,
  `<title>${title}</title>`,
  '<style>',
  `.a{animation-duration:${s.loop}s;animation-iteration-count:infinite;animation-timing-function:ease-in-out}`,
  ...s.css,
  '@media (prefers-reduced-motion: reduce){.a{animation:none!important}}',
  '</style>',
  ...s.paint.defs,
  `<rect width="${n(w)}" height="${n(h)}" fill="${PAGE[s.theme]}"/>`,
  glow,
];

/** The loop of the steps, in seconds. */
const STEPS_LOOP = 9;

/**
 * The four steps, as tonal cards in a row, and the arrow from each to the next. The number of the
 * first lights, a dot runs the arrow to the next step, whose card pulses as it arrives and whose
 * number lights; and so on to the fourth. The numbers and the arrows stay lit to the end of the
 * loop and go out together, so the last frame, the one a reader who asked for less motion sees,
 * has all of them.
 * @param {'dark' | 'light'} theme
 */
function howItWorks(theme) {
  const s = { ...scene(STEPS_LOOP, theme), paint: frontPalette(theme) };
  const size = { w: 196, h: 196 };
  const gap = 32;
  const w = STEPS.length * size.w + (STEPS.length - 1) * gap + 2 * FRONT_MARGIN;
  const h = size.h + 2 * FRONT_MARGIN;
  const top = FRONT_MARGIN;
  const mid = top + size.h / 2;
  // What a card holds sits on its middle: the number and the title on the row six half rows above
  // it, the three lines on the rows around it, the chip under them.
  const head = mid - 6 * HALF_ROW;
  /** When each step's number lights: the first at the start, each next one as the dot arrives. */
  const lights = STEPS.map((_, i) => (i === 0 ? 0.4 : 1.0 + 1.6 * (i - 1) + 1.2));
  /** @type {string[]} */
  const out = [];
  STEPS.forEach((step, i) => {
    const x = FRONT_MARGIN + i * (size.w + gap);
    const box = { x, y: top, w: size.w, h: size.h };
    const badge = { x: x + 20, y: head - 14, w: 28, h: 28 };
    const lit = lights[i] ?? 0;
    const chip = {
      x: x + 20,
      y: mid + 6 * HALF_ROW - 14,
      w: Math.ceil(widthOf([step.chip], 'code') + 2 * PAD),
      h: 28,
    };
    out.push(
      card(s, box),
      pulse(s, box, lit),
      `<rect ${flash(s, lit, 0.6)} x="${badge.x - 4}" y="${badge.y - 4}" width="${badge.w + 8}" height="${badge.h + 8}" rx="${(badge.w + 8) / 2}" fill="none" stroke="${s.accent}" stroke-width="2"/>`,
      `<rect x="${badge.x}" y="${badge.y}" width="${badge.w}" height="${badge.h}" rx="${badge.w / 2}" fill="none" stroke="${s.accent}" stroke-width="2"/>`,
      `<rect ${s.stays(lit)} x="${badge.x}" y="${badge.y}" width="${badge.w}" height="${badge.h}" rx="${badge.w / 2}" fill="${s.accent}" fill-opacity="${s.paint.badge}" stroke="${s.accent}" stroke-width="2"/>`,
      sans(s, String(i + 1), badge.x + badge.w / 2, inside(badge, 'label'), 'label', {
        anchor: 'middle',
      }),
      sans(s, step.title, x + 58, head + TYPE.heading.centre, 'heading'),
      ...step.lines.map((line, j) =>
        sans(s, line, x + 20, mid + TYPE.caption.centre + (j - 1) * 2 * HALF_ROW, 'caption'),
      ),
      `<rect x="${chip.x + 0.5}" y="${chip.y + 0.5}" width="${chip.w - 1}" height="${chip.h - 1}" rx="6" fill="${s.accent}" fill-opacity="${s.paint.tab}" stroke="${s.accent}"${s.paint.chip ? ` stroke-width="${s.paint.chip}"` : ''}/>`,
      s.sayIn([step.chip], chip.x + PAD, chip, 'code'),
    );
    if (i < STEPS.length - 1) {
      const T = 1.0 + 1.6 * i;
      const ends = along(x + size.w + 4, mid, x + size.w + gap - 4, mid);
      const runs = dot(s, ends, 'in', T);
      out.push(...connection(s, ends, 'in', T), runs.out);
    }
  });
  return [
    ...opening(
      s,
      w,
      h,
      'How mnema works: record, rule, hand over, verify',
      'How mnema works',
      // Half the family's glow: the grey lines of each card lie over it, and keep four and a half
      // to one on a dark page.
      `<ellipse cx="${w / 2}" cy="${mid}" rx="${w / 2 - FRONT_MARGIN - 20}" ry="${mid - top}" fill="url(#glow)" opacity="0.5"/>`,
    ),
    ...out,
    '</svg>',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------------------------
// How mnema fits: an agent session, mnema, the repository, animated
//
// One loop of LOOP seconds, in CSS keyframes inside the SVG, which GitHub plays in an <img>
// (it runs no script and the picture needs none). Every element that moves carries, as its own
// attributes, how it looks in the last frame of the story; a reader who asked for less motion
// gets that frame, still, and the loop opens and closes on the first one, so it restarts with no
// jump. What each frame says is what the product does: see the comment on `HERO_STORY`. It is
// drawn with the family's vocabulary (below the family's picture): tonal cards, lanes with their
// heads where the record goes, a dot for each packet, and the edge it reaches lit as it arrives.

const LOOP = 14;

/**
 * What the picture tells, in order, each line a thing the product does:
 *   - a session opens with the decisions in force, by label and title (the opening document's
 *     own words: `## Decisions in force`, then `ADR-2` and `Keep money as integer cents`);
 *   - a write under a path a rule addresses with `refuses-a-write` gets `deny` from the hook, and
 *     the refusal is itself a signed fact of the record (`recordings/a-write-refused.sh`);
 *   - a write no rule refuses lands;
 *   - a decision an agent records is signed and appended, and stays `proposed` until a person
 *     accepts it;
 *   - `mnema verify` reads the chain and says `verified`.
 */
const HERO_STORY = [
  { title: 'in force  ADR-2', detail: 'Keep money as integer cents', tone: 'muted' },
  { title: 'write  src/billing/total.ts', detail: 'deny · refuses-a-write', tone: 'accent' },
  { title: 'write  src/cart/price.ts', detail: 'allowed', tone: 'muted' },
  { title: 'record  ADR-3', detail: 'signed · proposed', tone: 'accent' },
];

const HERO_STEPS = [
  'session opens',
  'write refused',
  'write lands',
  'decision signed',
  'record verified',
];

/**
 * Keyframes for one property over the loop, from [seconds, value] stops. The first stop must
 * be at 0 and the last at LOOP, with the same value, so the loop closes on itself.
 * @param {string} name
 * @param {string} property
 * @param {[number, string][]} stops
 * @param {number} [loop]
 */
function keyframes(name, property, stops, loop = LOOP) {
  const at = stops.map(([t, v]) => `${n((t / loop) * 100)}%{${property}:${v}}`).join('');
  return `@keyframes ${name}{${at}}`;
}

/**
 * An opacity that is 0 outside [from, to], fading over `fade` seconds at each end.
 * @param {number} from
 * @param {number} to
 * @param {number} [fade]
 * @param {number} [loop]
 * @returns {[number, string][]}
 */
function shown(from, to, fade = 0.3, loop = LOOP) {
  return [
    [0, '0'],
    [from, '0'],
    [from + fade, '1'],
    [to - fade, '1'],
    [to, '0'],
    [loop, '0'],
  ];
}

/**
 * A packet that runs a lane from one end to the other over [from, to], as a dot of the family:
 * lit from just before it leaves to just after it arrives, and back at the end it left from while
 * no one sees it, so the loop closes on itself.
 * @param {Scene} s
 * @param {number} from
 * @param {number} to
 * @param {[number, number]} a where it leaves
 * @param {[number, number]} b where it arrives
 */
function packet(s, from, to, a, b) {
  const at = (/** @type {[number, number]} */ [px, py]) => `translate(${n(px)}px,${n(py)}px)`;
  const glides = s.animate('transform', [
    [0, at(a)],
    [from, at(a)],
    [to, at(b)],
    [to + 0.1, at(b)],
    [to + 0.2, at(a)],
    [s.loop, at(a)],
  ]);
  const fades = s.animate('opacity', [
    [0, '0'],
    [from - 0.05, '0'],
    [from + 0.1, '1'],
    [to - 0.1, '1'],
    [to + 0.05, '0'],
    [s.loop, '0'],
  ]);
  return `<g class="a" style="animation-name:${glides},${fades}" opacity="0"><circle r="8" fill="${s.accent}" fill-opacity="${s.paint.halo}"/><circle r="4" fill="${s.accent}"/></g>`;
}

/**
 * @param {readonly string[]} blocks
 * @param {'dark' | 'light'} theme
 */
function howMnemaFits(blocks, theme) {
  const s = { ...scene(LOOP, theme), paint: frontPalette(theme) };
  // What it draws is W wide, the margin in from each side; its foot is the steps' tabs, at 298.
  const W = 880;
  const M = FRONT_MARGIN;
  const H = 298 + M;
  const box = { top: M, h: 238, w: 260 };
  const lane = box.top + box.h / 2;
  const agentRight = M + box.w;
  const repoLeft = M + W - box.w;
  const hub = { x: M + 360, w: 160, y: 84, h: 86 };
  const session = { x: M, y: box.top, w: box.w, h: box.h };
  const repository = { x: repoLeft, y: box.top, w: box.w, h: box.h };
  /** @type {string[]} */
  const body = [];

  // The two panels, tonal cards with a title over a rule in the card's own edge, and the hub, the
  // wordmark on its card.
  const panel = (/** @type {Frame} */ c, /** @type {string} */ title) => [
    card(s, c),
    sans(s, title, c.x + 18, c.y + 26, 'label'),
    `<path d="M${c.x + 0.5} ${c.y + 40.5}H${c.x + c.w - 0.5}" stroke="${s.accent}"/>`,
  ];
  body.push(...panel(session, 'agent session'), ...panel(repository, 'repository'));
  body.push(
    sans(s, 'Claude Code · VS Code · Cursor CLI', M + box.w / 2, box.top + box.h + 24, 'caption', {
      anchor: 'middle',
    }),
    hubFrame(s, hub, ''),
  );
  const scale = 0.25;
  const markW = Math.max(...blocks.map((row) => [...row].length)) * CELL.w * scale;
  // The wordmark's ink, not its last cell, on the hub's middle, which is the lanes' line, at the
  // whole unit nearest it: a fractional place blurs the letters' edges and pales them.
  const markH = inkFoot(blocks) * scale;
  body.push(
    `<g transform="translate(${n(Math.round(hub.x + (hub.w - markW) / 2))} ${n(Math.round(hub.y + (hub.h - markH) / 2))}) scale(${scale})">`,
    ...wordmark(blocks, s.accent, 0, 0),
    '</g>',
  );

  // The two lanes: the record goes both ways between the session and mnema, and from mnema to the
  // repository only.
  /** @type {{ far: [number, number], near: [number, number] }} */
  const left = { far: [agentRight + 4, lane], near: [hub.x - 4, lane] };
  /** @type {{ far: [number, number], near: [number, number] }} */
  const right = { far: [repoLeft - 4, lane], near: [hub.x + hub.w + 4, lane] };
  const still = { attrs: /** @type {[string, string]} */ (['', '']), draws: false };
  body.push(
    ...connection(s, along(...left.far, ...left.near), 'both', 0, false, still),
    ...connection(s, along(...right.far, ...right.near), 'out', 0, false, still),
  );

  // The session's transcript: each entry appears when its packet arrives, and all of them leave
  // together at the end of the loop.
  /** @type {[number, number][]} */
  const entryTimes = [
    [1.2, 1.2],
    [2.8, 5.0],
    [6.0, 7.8],
    [9.0, 10.2],
  ];
  HERO_STORY.forEach((entry, i) => {
    const y = box.top + 68 + i * 44;
    const [first, second] = entryTimes[i] ?? [0, 0];
    const [verb = '', ...rest] = entry.title.split('  ');
    body.push(
      s.say([verb], M + 18, y, 'code', { fill: s.muted, attrs: s.stays(first) }),
      s.say([rest.join(' ')], M + 18 + (verb.length + 1) * TYPE.code.size * ADVANCE, y, 'code', {
        attrs: s.stays(first),
      }),
      s.say([entry.detail], M + 30, y + 18, 'code', {
        fill: entry.tone === 'accent' ? s.text : s.muted,
        attrs: s.stays(second),
      }),
    );
  });

  // The repository: the two files, the rule addressed at the first, and the record, its last row
  // on the transcript's last.
  const rx = repoLeft + 18;
  // The file the write lands in sits on the row of the refusal before it, across the lanes.
  const price = box.top + 130;
  body.push(
    s.say(['src/billing/total.ts'], rx, box.top + 68, 'code'),
    s.say(['refuses-a-write · ADR-2'], rx + 12, box.top + 86, 'code', { fill: s.muted }),
    `<rect ${s.passes(7.8, 8.8)} x="${n(rx - 8 + 0.5)}" y="${n(price - 16 + 0.5)}" width="${n(box.w - 20 - 1)}" height="23" rx="6" fill="${s.accent}" fill-opacity="${s.paint.highlight}" stroke="${s.accent}"/>`,
    s.say(['src/cart/price.ts'], rx, price, 'code'),
    s.say(['.mnema/'], rx, box.top + 184, 'code', { fill: s.muted }),
  );
  const a = 12;
  const cy = box.top + 214;
  const record = cubes(
    s,
    rx,
    cy,
    a,
    [undefined, undefined, undefined, 5.0, 11.0],
    10,
    s.paint.shade,
  );
  body.push(...record.out);
  for (const t of [5.0, 11.0])
    body.push(landing(s, record.at(t === 5.0 ? 3 : 4), cy, a, t, s.paint.lit));
  // mnema verify reads the chain, one cube after the other, and says so; the last light is out
  // before the end holds still, so the last frame is the one a reader who asked for less motion sees.
  for (let i = 0; i < 5; i++)
    body.push(landing(s, record.at(i), cy, a, 11.15 + i * 0.1, s.paint.lit));
  body.push(
    sans(s, 'verified', record.at(4) + record.dx + 14, cy + 4, 'label', { attrs: s.stays(12.0) }),
  );

  // The packets, each a dot that runs its lane, and the edge each lights as it arrives.
  /** @type {[number, number, [number, number], [number, number]][]} */
  const legs = [
    [0.4, 1.2, left.near, left.far],
    [2.8, 3.6, left.far, left.near],
    [4.2, 5.0, left.near, left.far],
    [4.2, 5.0, right.near, right.far],
    [6.0, 6.75, left.far, left.near],
    [7.0, 7.8, right.near, right.far],
    [9.0, 9.8, left.far, left.near],
    [10.2, 11.0, right.near, right.far],
  ];
  for (const [from, to, a0, b0] of legs) {
    body.push(packet(s, from, to, a0, b0));
    if (b0 === left.far) body.push(pulse(s, session, to));
    else if (b0 === right.far) body.push(pulse(s, repository, to));
    else body.push(ring(s, hub, to));
  }

  // The five steps, the one under way lit by a tab behind it; the last stays lit to the end.
  /** @type {[number, number | undefined][]} */
  const stepTimes = [
    [0.2, 2.6],
    [2.7, 5.8],
    [5.9, 8.8],
    [8.9, 11.5],
    [11.6, undefined],
  ];
  const stepW = W / HERO_STEPS.length;
  // The tab stays in from the frame's foot, so no edge of it is cut off at any width.
  const tab = { y: 278, h: 20 };
  HERO_STEPS.forEach((step, i) => {
    const cx = M + stepW * i + stepW / 2;
    const [from, to] = stepTimes[i] ?? [0, 0];
    const label = `${i + 1}  ${step}`;
    const tw = 2 * Math.ceil((label.length * TYPE.caption.size * 0.55 + 24) / 2);
    body.push(
      `<rect ${to === undefined ? s.stays(from) : s.passes(from, to)} x="${n(cx - tw / 2 + 0.5)}" y="${tab.y + 0.5}" width="${tw - 1}" height="${tab.h - 1}" rx="6" fill="${s.accent}" fill-opacity="${s.paint.tab}" stroke="${s.accent}"/>`,
      sans(s, label, cx, inside(tab, 'caption'), 'caption', { anchor: 'middle', preserve: true }),
    );
  });

  return [
    ...opening(
      s,
      W + 2 * M,
      H,
      'How mnema fits: a session opens with the decisions in force, a write under a refusing rule is denied, a write elsewhere lands, a recorded decision is signed into the chain, and mnema verify checks it',
      'How mnema fits between an agent session and the repository',
      `<ellipse cx="${M + W / 2}" cy="${lane}" rx="${W / 2 - 60}" ry="${lane - box.top}" fill="url(#glow)"/>`,
    ),
    ...body,
    '</svg>',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------------------------
// The packages: one animated picture per published package but `@mnema/code`, whose page shows
// the family, `packages/<p>/assets/<p>-{dark,light}.svg`
//
// The grammar of the picture above: one loop of CSS keyframes, every element that moves carrying
// the last frame as its own attributes, and the accent as the only hue. Each picture opens with
// the package's name on the left and the wordmark on the right, and draws under them with the
// family's vocabulary (below the family's picture): its glow on the middle of the frame, tonal
// cards, connections a dot runs, the pulse of a card's edge and a cube lit as it lands. What is
// drawn sits on the middle of the frame, `MARGIN` or more in from each side, and what a card
// holds at rest sits on the card's middle.
//
// EVERY WORD ON A PACKAGE'S PICTURE IS A WORD OF THE PRODUCT. A line is written as pieces, each
// the literal it puts on the picture and the file of the repository that says it (`said`),
// joined by one of `SEPARATORS`. No line draws a record's id, which the command line prints new
// on every run. The test finds every literal in its file, and finds no text on a picture that is
// not one of these lines. A text inside a box is put there by `sayIn` and by nothing else. The
// example of the front page (`ADR-2`, `Keep money as integer cents`, `src/billing/total.ts`,
// `ADR-3`) is anchored on the front page's own picture. No count that changes (kinds, hosts,
// tools) and no host's name is drawn.

/** The front page's picture, where the example every picture below repeats is told first. */
const HERO = 'docs/assets/how-mnema-fits-light.svg';

/** What may join two pieces of a line. */
export const SEPARATORS = Object.freeze([' · ', ' → ', ' ']);

/**
 * A literal of the product, and the file that says it, from the repository's root.
 * @param {string} literal
 * @param {string} where
 */
const said = (literal, where) => ({ said: literal, where });

/** @typedef {{ said: string, where: string }} Said */
/** @typedef {readonly (Said | string)[]} Line */

/**
 * What a line puts on the picture.
 * @param {Line} line
 */
export const textOf = (line) => line.map((p) => (typeof p === 'string' ? p : p.said)).join('');

const WORKFLOW = 'packages/chain/src/events/workflow.ts';
const W_PKG = 720;
const H_PKG = 240;

/**
 * The page of each theme. A package's picture carries its own, so the dark one, shown on a light
 * page, still reads; on a dark page it is the page.
 */
export const PAGE = Object.freeze({ dark: '#0d1117', light: '#ffffff' });

/**
 * One size for each role a text plays, on every package's picture: the package's name, the name
 * on a box, a grey caption beside a thing, a literal of code or of output, and a row of a list or
 * of a table. A text is drawn by its role and by nothing else. `centre` is how far below the
 * middle of a box the baseline of a line of that size goes for its ink to sit on the middle: a
 * line with no descender and one with, in the monospace face, land within a unit of it.
 */
export const TYPE = Object.freeze({
  heading: { size: 15, weight: '600', centre: 4.7 },
  label: { size: 13, weight: '600', centre: 4 },
  caption: { size: 12, weight: '', centre: 3.7 },
  code: { size: 12, weight: '', centre: 3.7 },
  value: { size: 12, weight: '', centre: 3.7 },
});

/** @typedef {keyof typeof TYPE} Role */

/** How far a text sits inside its box. */
const PAD = 14;
/** Half the distance between two rows of text inside a box. */
export const HALF_ROW = 10;
/** The baseline of the band at the foot of every package's picture. */
const FOOT = 220;
/** Where the band at the head of every package's picture, its name and the wordmark, ends. */
const BAND = 40;
/** The least room between what a package's picture draws under the band and each side of it. */
const MARGIN = 24;
/** The advance of one character of the monospace face, as a share of its size. */
const ADVANCE = 0.6;

/**
 * The width a line takes in a role.
 * @param {Line} line
 * @param {Role} role
 */
const widthOf = (line, role) => [...textOf(line)].length * TYPE[role].size * ADVANCE;

/**
 * The baseline of a line of a role inside a box, `row` half rows off its middle.
 * @param {{ y: number, h: number }} frame
 * @param {Role} role
 * @param {number} [row]
 */
const inside = (frame, role, row = 0) => frame.y + frame.h / 2 + TYPE[role].centre + row * HALF_ROW;

/**
 * The paint of one theme, and the helpers that give an element its keyframes over a package's
 * own loop. An element that `stays` is there in the last frame and carries no opacity of its
 * own; one that `passes` is not, and carries `opacity="0"`. Everything there in the last frame
 * leaves at once, at `ends` (`leaves`), so nothing is left alone on the page at the end of a loop.
 * @param {number} loop
 * @param {'dark' | 'light'} theme
 */
function scene(loop, theme) {
  const accent = ACCENT[theme];
  const { text, muted, border } = NEUTRAL[theme];
  /** @type {string[]} */
  const css = [];
  let count = 0;
  /**
   * @param {string} property
   * @param {[number, string][]} stops
   */
  const animate = (property, stops) => {
    const name = `k${count++}`;
    css.push(keyframes(name, property, stops, loop));
    return name;
  };
  const ends = loop - 0.7;
  /**
   * The stops of an element there in the last frame, closed the way every such element closes.
   * @param {[number, string][]} stops
   * @returns {[number, string][]}
   */
  const leaves = (stops) => [...stops, [ends - 0.3, '1'], [ends, '0'], [loop, '0']];
  /**
   * @param {[number, string][]} stops
   * @param {string} last the opacity of the last frame
   */
  const goes = (stops, last) =>
    `class="a" style="animation-name:${animate('opacity', stops)}"${last === '1' ? '' : ` opacity="${last}"`}`;
  /**
   * A line as a text element, in the size of its role.
   * @param {Line} line
   * @param {number} x
   * @param {number} y
   * @param {Role} role
   * @param {{ fill?: string, anchor?: string, attrs?: string }} [o]
   */
  const say = (line, x, y, role, o = {}) =>
    `<text${o.attrs ? ` ${o.attrs}` : ''} x="${n(x)}" y="${n(y)}" font-family="${MONO}" font-size="${TYPE[role].size}"${TYPE[role].weight ? ` font-weight="${TYPE[role].weight}"` : ''} fill="${o.fill ?? (role === 'caption' ? muted : text)}"${o.anchor ? ` text-anchor="${o.anchor}"` : ''}>${escaped(textOf(line))}</text>`;
  return {
    theme,
    accent,
    text,
    muted,
    border,
    paint: palette(theme),
    css,
    loop,
    ends,
    animate,
    goes,
    leaves,
    /** @param {number} from */
    stays: (from) =>
      goes(
        leaves([
          [0, '0'],
          [from, '0'],
          [from + 0.3, '1'],
        ]),
        '1',
      ),
    /** @param {number} from @param {number} to */
    passes: (from, to) => goes(shown(from, to, 0.3, loop), '0'),
    say,
    /**
     * A line inside a box, the only way a text is put in one: on the box's middle, or `row` half
     * rows above (negative) or below it.
     * @param {Line} line
     * @param {number} x
     * @param {{ y: number, h: number }} frame
     * @param {Role} role
     * @param {{ fill?: string, anchor?: string, attrs?: string }} [o]
     * @param {number} [row]
     */
    sayIn: (line, x, frame, role, o = {}, row = 0) =>
      say(line, x, inside(frame, role, row), role, o),
  };
}

/** @typedef {ReturnType<typeof scene>} Scene */

/**
 * The outline of a cube, as path data, for a glow laid over it.
 * @param {number} x
 * @param {number} cy
 * @param {number} a
 */
function hexagon(x, cy, a) {
  const dx = a * COS30;
  return `M${n(x)} ${n(cy - a)}L${n(x + dx)} ${n(cy - a / 2)}L${n(x + dx)} ${n(cy + a / 2)}L${n(x)} ${n(cy + a)}L${n(x - dx)} ${n(cy + a / 2)}L${n(x - dx)} ${n(cy - a / 2)}z`;
}

/**
 * The width of a row of `count` cubes of edge `a`, `link` apart.
 * @param {number} count
 * @param {number} a
 * @param {number} [link]
 */
const rowWidth = (count, a, link = 12) => count * 2 * a * COS30 + (count - 1) * link;

/** How strongly the three faces of a cube on a package's picture are filled: top, left, right. */
const SHADE = Object.freeze([0.3, 0.16, 0.06]);

/**
 * A row of cubes, each linked to the one before; `arrive[i]` is when cube i comes in, or
 * undefined for one that is there from the start.
 * @param {Scene} s
 * @param {number} x0
 * @param {number} cy
 * @param {number} a
 * @param {readonly (number | undefined)[]} arrive
 * @param {number} [link]
 * @param {readonly number[]} [shade]
 */
function cubes(s, x0, cy, a, arrive, link = 12, shade = SHADE) {
  const dx = a * COS30;
  const at = (/** @type {number} */ i) => x0 + dx + i * (2 * dx + link);
  /** @type {string[]} */
  const out = [];
  arrive.forEach((when, i) => {
    const x = at(i);
    /** @type {string[]} */
    const parts = [];
    if (i > 0)
      parts.push(
        `<path d="M${n(x - dx - link + 2)} ${n(cy)}H${n(x - dx - 2)}" stroke="${s.muted}" stroke-width="1.5" stroke-linecap="round"/>`,
      );
    parts.push(...cube(x, cy, a, s.accent, shade));
    if (when === undefined) out.push(...parts);
    else out.push(`<g ${s.stays(when)}>`, ...parts, '</g>');
  });
  return { out, at, dx };
}

/**
 * A card that is lit and stays lit from where its attributes say: laid on the card, the same
 * box, with the hub's heavier edge. Nothing fills it: a fill over the card's tint would take a
 * grey text inside it under four and a half to one on a dark page.
 * @param {Scene} s
 * @param {Frame} c
 * @param {string} attrs
 */
const lit = (s, c, attrs) =>
  `<rect ${attrs} x="${n(c.x + 0.5)}" y="${n(c.y + 0.5)}" width="${n(c.w - 1)}" height="${n(c.h - 1)}" rx="10" fill="none" stroke="${s.accent}" stroke-width="1.5"/>`;

/**
 * The ends of an arrow from one point to another, as `connection` and `dot` take them: the
 * record goes `in`, from the first to the second, where the head is.
 * @param {number} x1
 * @param {number} y1
 * @param {number} x2
 * @param {number} y2
 * @returns {[number, number, number, number]}
 */
const along = (x1, y1, x2, y2) => [x1, y1, x2, y2];

// @mnema/chain: the chain, and who reads it.
const CHAIN_LINES = {
  name: [said('@mnema/chain', 'packages/chain/package.json')],
  event: [said('decision.recorded', 'packages/chain/src/events/catalog.ts')],
  link: [
    said('seq', 'packages/chain/src/chain/entry.ts'),
    ' · ',
    said('prev', 'packages/chain/src/chain/entry.ts'),
    ' · ',
    said('hash', 'packages/chain/src/chain/entry.ts'),
  ],
  checkpoint: [
    said('checkpoint', 'packages/chain/README.md'),
    ' · ',
    said('Ed25519', 'packages/chain/README.md'),
  ],
  altered: [
    said('entry hash mismatch: content or link was altered', 'packages/chain/src/chain/verify.ts'),
  ],
  verify: [said('verify', 'packages/chain/README.md')],
  verified: [said('local integrity verified (T1/T2/T4)', 'packages/chain/src/chain/level.ts')],
  python: [said('mnema_verify.py', 'packages/chain/README.md')],
  VERIFIED: [said('VERIFIED', 'packages/chain/verifier/mnemaverify/verdict.py')],
};

/** @param {Scene} s */
function chainStory(s) {
  const L = CHAIN_LINES;
  const a = 16;
  const between = 34;
  // The seal of the checkpoint on the left and the two readers on the right, the whole on the
  // middle of the frame; the three blocks sit in the seal's middle.
  const seal = { x: 94, y: 100, w: 180, h: 64 };
  const reader = { x: 346, w: 280, h: 44 };
  const cy = seal.y + seal.h / 2;
  const arrive = [1.6, 2.2, 2.8];
  // The blocks stand on the seal's tint, and on a light page the tint, the glow and the faces
  // together would take the outline under three to one against the faces either side of it: there
  // the side faces are fainter, and the one on the right is the seal's own.
  const shade = s.theme === 'light' ? [SHADE[0] ?? 0, 0.06, 0] : SHADE;
  const x0 = seal.x + (seal.w - rowWidth(3, a, between)) / 2;
  const row = cubes(s, x0, cy, a, arrive, between, shade);
  /** @type {string[]} */
  const out = [];
  // An event comes in as a card, and the first block takes its place, lit as it lands.
  const event = { x: seal.x, y: 52, w: Math.ceil(widthOf(L.event, 'code') + 2 * PAD), h: 26 };
  out.push(
    `<g ${s.passes(0.2, 1.9)}>`,
    card(s, event),
    s.sayIn(L.event, event.x + PAD, event, 'code'),
    '</g>',
    ...row.out,
    ...arrive.map((t, i) => landing(s, row.at(i), cy, a, t, s.paint.lit)),
  );
  // Each link closes in the accent; the one after the altered block opens while it is altered.
  const link = (/** @type {number} */ i) =>
    `M${n(row.at(i - 1) + row.dx + 2)} ${cy}H${n(row.at(i) - row.dx - 2)}`;
  out.push(
    `<path ${s.stays(2.5)} d="${link(1)}" stroke="${s.accent}" stroke-width="2" stroke-linecap="round"/>`,
    `<path ${s.goes(
      s.leaves([
        [0, '0'],
        [3.0, '0'],
        [3.3, '1'],
        [5.2, '1'],
        [5.4, '0'],
        [7.6, '0'],
        [7.9, '1'],
      ]),
      '1',
    )} d="${link(2)}" stroke="${s.accent}" stroke-width="2" stroke-linecap="round"/>`,
    `<path ${s.passes(5.2, 7.8)} d="${link(2)}" stroke="${s.muted}" stroke-width="2" stroke-dasharray="3 4" stroke-linecap="round"/>`,
    `<path ${s.goes(
      [
        [0, '0'],
        // Each swing takes half a second, so no second holds more than two flashes.
        [5.0, '0'],
        [5.3, '0.9'],
        [5.8, '0.2'],
        [6.3, '0.9'],
        [6.8, '0.2'],
        [7.3, '0.9'],
        [7.4, '0.9'],
        [7.7, '0'],
        [s.loop, '0'],
      ],
      '0',
    )} d="${hexagon(row.at(1), cy, a)}" fill="${s.muted}"/>`,
    s.say(L.link, seal.x, seal.y + seal.h + 16, 'caption', { attrs: s.stays(2.4) }),
  );
  // The checkpoint signs over all three: the seal is the hub of this picture.
  out.push(
    hubFrame(s, seal, s.stays(3.5)),
    s.say(L.checkpoint, seal.x, seal.y - 10, 'caption', { attrs: s.stays(3.7) }),
    s.say(L.altered, W_PKG / 2, FOOT, 'code', { anchor: 'middle', attrs: s.passes(5.4, 7.6) }),
  );
  // Two readers of the same tail, each in its own words for the same verdict: a read leaves the
  // seal as a ring, and a dot runs each line to its reader's card, which lights as it lands.
  const T = 7.8;
  /** @type {[Line, Line, number][]} */
  const readers = [
    [L.verify, L.verified, cy - 28],
    [L.python, L.VERIFIED, cy + 28],
  ];
  out.push(ring(s, seal, T + 0.5));
  readers.forEach(([first, second, middle], i) => {
    const c = { x: reader.x, y: middle - reader.h / 2, w: reader.w, h: reader.h };
    const ends = along(seal.x + seal.w + 4, cy + (i === 0 ? -8 : 8), c.x - 4, middle);
    const runs = dot(s, ends, 'in', T);
    out.push(
      `<g ${s.stays(T)}>`,
      card(s, c),
      '</g>',
      ...connection(s, ends, 'in', T),
      runs.out,
      pulse(s, c, runs.last),
      s.sayIn(first, c.x + PAD, c, 'code', { attrs: s.stays(9.0 + i * 0.2) }, -1),
      s.sayIn(second, c.x + PAD, c, 'code', { attrs: s.stays(9.4 + i * 0.2) }, 1),
    );
  });
  return out;
}

// @mnema/core: the gate that judges a move before it is written.
const CORE_LINES = {
  name: [said('@mnema/core', 'packages/core/package.json')],
  proposed: [said('proposed', WORKFLOW)],
  accepted: [said('accepted', WORKFLOW)],
  rejected: [said('rejected', WORKFLOW)],
  superseded: [said('superseded', WORKFLOW)],
  request: [said('accept', WORKFLOW), ' · ', said('note', WORKFLOW)],
  again: [said('accept', WORKFLOW)],
  refused: [
    said(
      'cannot "accept" a decision in rejected',
      'packages/core/src/workflow/the-gates-refuse-in-words-and-hand-back-what-was-proved.test.ts',
    ),
  ],
  fold: [said('projectDecisions', 'packages/core/src/projections/decision.ts')],
  row: [
    said('ADR-2', HERO),
    ' · ',
    said('Keep money as integer cents', HERO),
    ' · ',
    said('accepted', WORKFLOW),
  ],
  rebuild: [said('rebuild', 'packages/core/src/projections/rebuild.ts')],
};

/** @param {Scene} s */
function coreStory(s) {
  const L = CORE_LINES;
  /** @type {string[]} */
  const out = [];
  // The states on three rows, in from the left by the margin; every move of the table is a line
  // with its head.
  const node = { w: 108, h: 28 };
  const left = MARGIN;
  const col = left + 160;
  const [top, middle, bottom] = [52, 112, 172];
  const mid = (/** @type {number} */ y) => y + node.h / 2;
  /** @type {[Line, number, number][]} */
  const nodes = [
    [L.proposed, left, middle],
    [L.accepted, col, top],
    [L.superseded, col, middle],
    [L.rejected, col, bottom],
  ];
  for (const [line, x, y] of nodes) {
    const c = { x, y, w: node.w, h: node.h };
    out.push(card(s, c), s.sayIn(line, x + PAD, c, 'label'));
  }
  // The moves the table allows, in grey; the one asked for turns to the accent, head and all,
  // a dot runs it, and the state it reaches lights. A block goes down to the chain.
  const T = 2.2;
  const turns = `class="a" style="animation-name:${s.animate('stroke', [
    [0, s.muted],
    [T + 0.2, s.muted],
    [T + 0.5, s.accent],
    [s.ends - 0.3, s.accent],
    [s.ends, s.muted],
    [s.loop, s.muted],
  ])}"`;
  for (const y of [middle, bottom])
    out.push(
      ...connection(s, along(left + node.w + 2, mid(middle), col - 3, mid(y)), 'in', T, false, {
        attrs: ['', ''],
        stroke: s.muted,
        draws: false,
      }),
    );
  const axis = col + node.w / 2;
  out.push(
    ...connection(s, along(axis, top + node.h + 3, axis, middle - 3), 'in', T, false, {
      attrs: ['', ''],
      stroke: s.muted,
      draws: false,
    }),
  );
  const taken = along(left + node.w + 2, mid(middle), col - 3, mid(top));
  const runs = dot(s, taken, 'in', T);
  out.push(
    ...connection(s, taken, 'in', T, false, { attrs: [turns, turns] }),
    runs.out,
    s.say(L.request, left, 100, 'code', { attrs: s.passes(1.8, 4.2) }),
    lit(s, { x: col, y: top, w: node.w, h: node.h }, s.stays(runs.last - 0.2)),
  );
  // The table, in from the right by the margin; the chain above it starts where it starts, and the
  // fold comes down the axis of the middle block. The block the move wrote lands as the dot arrives.
  const tableW = Math.ceil(widthOf(L.row, 'value') + 2 * PAD);
  const x0 = W_PKG - MARGIN - tableW;
  const chain = cubes(s, x0, mid(top), 12, [undefined, undefined, runs.last]);
  out.push(...chain.out, landing(s, chain.at(2), mid(top), 12, runs.last, s.paint.lit));
  // A move it does not allow: asked of `rejected`, the gate hands it back in words, and nothing
  // goes down.
  const reach = col + node.w + 3;
  const again = along(reach + 48, mid(bottom), reach, mid(bottom));
  const refused = dot(s, again, 'in', 4.0);
  out.push(
    ...connection(s, again, 'in', 4.0, false, {
      attrs: [s.passes(4.2, 6.4), s.passes(4.2, 6.4)],
    }),
    refused.out,
    s.say(L.again, reach + 56, inside({ y: bottom, h: node.h }, 'code'), 'code', {
      attrs: s.passes(4.2, 6.4),
    }),
    `<rect ${s.passes(refused.last - 0.2, 6.4)} x="${col + 0.5}" y="${bottom + 0.5}" width="${node.w - 1}" height="${node.h - 1}" rx="10" fill="none" stroke="${s.accent}" stroke-width="1.5" stroke-dasharray="4 3"/>`,
    s.say(L.refused, left, FOOT, 'code', { attrs: s.stays(4.8) }),
  );
  // The chain folded into a table, which is thrown away and folded again the same.
  const down = chain.at(1);
  const fold = along(down, mid(top) + 16, down, middle - 3);
  const folds = dot(s, fold, 'in', 6.2);
  const table = { x: x0, y: middle, w: tableW, h: node.h };
  out.push(
    ...connection(s, fold, 'in', 6.2),
    folds.out,
    s.say(L.fold, down + 12, 100, 'caption', { attrs: s.stays(6.6) }),
    `<g ${s.goes(
      s.leaves([
        [0, '0'],
        [folds.last - 0.3, '0'],
        [folds.last, '1'],
        [8.6, '1'],
        [8.9, '0'],
        [9.3, '0'],
        [9.6, '1'],
      ]),
      '1',
    )}>`,
    card(s, table),
    s.sayIn(L.row, x0 + PAD, table, 'value'),
    '</g>',
    pulse(s, table, folds.last),
    s.say(L.rebuild, x0, 160, 'caption', { attrs: s.stays(9.0) }),
  );
  return out;
}

// @mnema/context: what a session is handed when it opens.
const CONTEXT_LINES = {
  name: [said('@mnema/context', 'packages/context/package.json')],
  one: [
    said('ADR-1', 'packages/code/src/cli.writes.golden.txt'),
    ' ',
    said('superseded', WORKFLOW),
  ],
  two: [said('ADR-2', HERO), ' ', said('accepted', WORKFLOW)],
  three: [said('ADR-3', HERO), ' ', said('proposed', WORKFLOW)],
  bootstrap: [said('bootstrap', 'packages/context/src/context/bootstrap.ts')],
  decisions: [said('decisions', 'packages/context/src/context/bootstrap.ts')],
  inForce: [said('ADR-2', HERO), ' · ', said('Keep money as integer cents', HERO)],
  awaiting: [said('awaitingJudgement', 'packages/context/src/context/bootstrap.ts')],
  waits: [said('ADR-3', HERO), ' · ', said('proposed', WORKFLOW)],
  asks: [said('refusesAWriteAt', 'packages/context/src/intelligence/governance.ts')],
  path: [said('src/billing/total.ts', HERO), ' → ', said('ADR-2', HERO)],
  only: [said('only READS and COMPOSES', 'packages/context/README.md')],
};

/** @param {Scene} s */
function contextStory(s) {
  const L = CONTEXT_LINES;
  /** @type {string[]} */
  const out = [];
  // The two panels share their rows: ADR-2 and ADR-3 sit on the same line on both sides. The left
  // holds five rows, the third on its middle; the right holds four, from the left's second down,
  // and is as tall as they are, so they sit on its middle too. A row is two half rows from the
  // next. Both are in from their side by the margin.
  const panel = { y: 52, h: 124 };
  const left = { x: MARGIN, y: panel.y, w: 180, h: panel.h };
  const right = {
    x: 404,
    y: panel.y + 2 * HALF_ROW,
    w: W_PKG - MARGIN - 404,
    h: panel.h - 2 * HALF_ROW,
  };
  const [r1, r2, r3, r4, r5] = [-4, -2, 0, 2, 4];
  /** A row of the left panel, as a row of the right. */
  const across = (/** @type {number} */ row) => row - 1;
  out.push(card(s, left));
  /** @type {[Line, number][]} */
  const chain = [
    [L.one, r1],
    [L.two, r3],
    [L.three, r5],
  ];
  chain.forEach(([line, row], i) => {
    out.push(
      s.sayIn(
        line,
        left.x + PAD,
        left,
        'value',
        { fill: s.muted, attrs: s.stays(0.2 + i * 0.3) },
        row,
      ),
    );
  });
  // The pill around the one in force sits on the panel's middle, and so does its line.
  const pill = { x: left.x + 6, y: panel.y + panel.h / 2 - 13, w: 168, h: 26 };
  const axis = pill.y + pill.h / 2;
  // bootstrap lets the ones in force through, and puts what waits on a person apart: a dot runs
  // from the pill to the panel it fills, which lights as it lands.
  const T = 1.9;
  const hands = along(left.x + left.w + 10, axis, right.x - 10, axis);
  const runs = dot(s, hands, 'in', T);
  out.push(
    lit(s, pill, s.stays(T)),
    ...connection(s, hands, 'in', T),
    runs.out,
    s.say(L.bootstrap, (hands[0] + hands[2]) / 2, inside(panel, 'caption', r2), 'caption', {
      anchor: 'middle',
      attrs: s.stays(2.0),
    }),
    card(s, right),
    pulse(s, right, runs.last),
    s.sayIn(L.decisions, right.x + PAD, right, 'caption', { attrs: s.stays(2.4) }, across(r2)),
    s.sayIn(L.inForce, right.x + PAD, right, 'value', { attrs: s.stays(3.0) }, across(r3)),
    s.sayIn(L.awaiting, right.x + PAD, right, 'caption', { attrs: s.stays(4.6) }, across(r4)),
    s.sayIn(L.waits, right.x + PAD, right, 'value', { attrs: s.stays(5.0) }, across(r5)),
  );
  // Asked for a path, it names the rule that refuses a write there.
  out.push(
    s.say(L.asks, left.x, FOOT - 20, 'caption', { attrs: s.stays(6.6) }),
    s.say(L.path, left.x, FOOT, 'value', { attrs: s.stays(7.4) }),
  );
  // And it writes nothing back: the line back stands apart, in grey and struck, on the middle of
  // the foot's line, and nothing runs it.
  const lane = FOOT - 4;
  const back = along(right.x - 10, lane, left.x + 254, lane);
  const struck = (back[0] + back[2]) / 2;
  out.push(
    `<g ${s.stays(9.0)}>`,
    ...connection(s, back, 'in', 9.0, true, {
      attrs: ['', ''],
      draws: false,
    }),
    `<path d="M${struck - 7} ${lane - 8}L${struck + 7} ${lane + 8}M${struck + 7} ${lane - 8}L${struck - 7} ${lane + 8}" stroke="${s.accent}" stroke-width="2" stroke-linecap="round"/>`,
    '</g>',
    s.say(L.only, right.x, FOOT, 'code', { attrs: s.stays(9.4) }),
  );
  return out;
}

// @mnema/stacks: the contract, the validator and the digest.
const STACK_FILES = 'packages/stacks/tests/an-archive-is-read-never-unpacked.test.ts';
/** The digest of the example stack, as the package's README states it. */
export const DIGEST = 'df9d8d71cdc13bd89b45af349e677ecfcbe98949805278bd42f16e6c0498f9ed';
const STACKS_LINES = {
  name: [said('@mnema/stacks', 'packages/stacks/package.json')],
  manifest: [said('stack.json', STACK_FILES)],
  skill: [said('skills/hello/SKILL.md', STACK_FILES)],
  agent: [said('agents/greeter.md', STACK_FILES)],
  licence: [said('LICENSE', STACK_FILES)],
  mcp: [said('.mcp.json', 'packages/stacks/src/validate.ts')],
  validate: [said('validateStack', 'packages/stacks/src/index.ts')],
  refused: [said('mcp-server', 'packages/stacks/src/problem.ts')],
  line: [said('path NUL sha256(file) LF', 'packages/stacks/README.md')],
  // The digest whole, in two halves of one line each.
  digest: [said(DIGEST.slice(0, 32), 'packages/stacks/README.md')],
  digestEnd: [said(DIGEST.slice(32), 'packages/stacks/README.md')],
};

/** @param {Scene} s */
function stacksStory(s) {
  const L = STACKS_LINES;
  /** @type {string[]} */
  const out = [];
  // The directory, line by line, and under it the validator, as wide; on the right, the digest.
  // The whole sits on the middle of the frame.
  // Five rows fit the folder, a row two half rows from the next. At rest it holds four, on its
  // middle; while the server is in it, the four go up by half a row and the server is the fifth,
  // so the five sit on its middle, and they come back down as it goes.
  const x = 54;
  const folder = { x, y: 52, w: 240, h: 124 };
  const rows = [-3, -1, 1, 3];
  const [from, to] = [2.0, 4.6];
  const up = `translate(0px,${-HALF_ROW}px)`;
  const still = 'translate(0px,0px)';
  out.push(
    card(s, folder),
    `<g class="a" style="animation-name:${s.animate('transform', [
      [0, still],
      [from, still],
      [from + 0.3, up],
      [to - 0.3, up],
      [to, still],
      [s.loop, still],
    ])}">`,
  );
  [L.manifest, L.skill, L.agent, L.licence].forEach((line, i) => {
    out.push(
      s.sayIn(line, x + PAD, folder, 'value', { attrs: s.stays(0.3 + i * 0.4) }, rows[i] ?? 0),
    );
  });
  out.push('</g>', s.sayIn(L.mcp, x + PAD, folder, 'value', { attrs: s.passes(from, to) }, 4));
  // The validator bars the server, and passes the directory once it is gone.
  const gate = { x, y: 186, w: folder.w, h: 40 };
  const verdict = x + 130;
  const gy = gate.y + gate.h / 2;
  out.push(
    card(s, gate),
    s.sayIn(L.validate, x + PAD, gate, 'label', { attrs: s.stays(1.8) }),
    s.sayIn(L.refused, verdict, gate, 'code', { attrs: s.passes(2.6, to) }),
    `<path ${s.stays(4.8)} d="M${verdict} ${gy - 2}L${verdict + 6} ${gy + 4}L${verdict + 18} ${gy - 8}" fill="none" stroke="${s.accent}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
    pulse(s, gate, 4.8),
  );
  // Each file becomes a line, and the lines meet on the folder's middle and become the digest, all
  // on one axis.
  const axis = x + 482;
  const into = axis - widthOf(L.line, 'caption') / 2 - 8;
  const meet = folder.y + folder.h / 2;
  const bend = (x + folder.w + into) / 2;
  out.push(`<g ${s.stays(5.6)}>`);
  for (const row of rows) {
    const y = folder.y + folder.h / 2 + row * HALF_ROW;
    out.push(
      `<path d="M${x + folder.w + 4} ${y}C${n(bend)} ${y} ${n(bend)} ${meet} ${n(into)} ${meet}" fill="none" stroke="${s.muted}" stroke-width="1.25"/>`,
    );
  }
  // The digest's card, as wide as its two lines and a margin, centred on the axis.
  const digest = { x: axis - 130, y: 180, w: 260, h: 44 };
  const T = 6.8;
  const lands = along(axis, meet + 14, axis, digest.y - 4);
  const runs = dot(s, lands, 'in', T);
  out.push(
    '</g>',
    s.say(L.line, axis, meet + 4, 'caption', { anchor: 'middle', attrs: s.stays(6.0) }),
    `<g ${s.stays(T)}>`,
    card(s, digest),
    '</g>',
    ...connection(s, lands, 'in', T),
    runs.out,
    pulse(s, digest, runs.last),
    s.sayIn(L.digest, axis, digest, 'code', { anchor: 'middle', attrs: s.stays(runs.last) }, -1),
    s.sayIn(L.digestEnd, axis, digest, 'code', { anchor: 'middle', attrs: s.stays(runs.last) }, 1),
  );
  return out;
}

/**
 * The four published packages drawn here, besides `@mnema/code`, whose page shows the family:
 * the directory, the loop, the lines each says and the story that draws them.
 */
export const PACKAGE_PICTURES = Object.freeze([
  { dir: 'chain', loop: 11, lines: CHAIN_LINES, story: chainStory },
  { dir: 'core', loop: 11, lines: CORE_LINES, story: coreStory },
  { dir: 'context', loop: 11, lines: CONTEXT_LINES, story: contextStory },
  { dir: 'stacks', loop: 10.5, lines: STACKS_LINES, story: stacksStory },
]);

/**
 * What a package's manifest says that its picture and its README use.
 * @param {string} dir
 * @returns {{ name: string, version: string, description: string, repository?: { url?: string } }}
 */
function manifestOf(dir) {
  return JSON.parse(
    readFileSync(new URL(`../../packages/${dir}/package.json`, import.meta.url), 'utf8'),
  );
}

/** @param {string} text */
const attribute = (text) => escaped(text).replaceAll('"', '&quot;');

/**
 * One package's picture in one theme.
 * @param {(typeof PACKAGE_PICTURES)[number]} pkg
 * @param {readonly string[]} blocks
 * @param {'dark' | 'light'} theme
 */
function packagePicture(pkg, blocks, theme) {
  const s = scene(pkg.loop, theme);
  const scale = 0.2;
  const markW = Math.max(...blocks.map((row) => [...row].length)) * CELL.w * scale;
  // The glow of the family, on the middle of what is drawn under the band, and reaching neither
  // the band nor the foot of the frame.
  const glow = `<ellipse ${s.stays(0.2)} cx="${W_PKG / 2}" cy="${(BAND + H_PKG) / 2}" rx="300" ry="${(H_PKG - BAND) / 2}" fill="url(#glow)"/>`;
  // Drawn before the style is written, because drawing is what names the keyframes.
  const story = pkg.story(s);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="0 0 ${W_PKG} ${H_PKG}" role="img" aria-label="${attribute(manifestOf(pkg.dir).description)}">`,
    `<title>${escaped(textOf(pkg.lines.name))}</title>`,
    '<style>',
    `.a{animation-duration:${pkg.loop}s;animation-iteration-count:infinite;animation-timing-function:ease-in-out}`,
    ...s.css,
    '@media (prefers-reduced-motion: reduce){.a{animation:none!important}}',
    '</style>',
    ...s.paint.defs,
    `<rect width="${W_PKG}" height="${H_PKG}" fill="${PAGE[theme]}"/>`,
    glow,
    s.say(pkg.lines.name, 0, 24, 'heading'),
    `<g transform="translate(${n(W_PKG - markW)} 6) scale(${scale})">`,
    ...wordmark(blocks, s.accent, 0, 0),
    '</g>',
    `<path d="M0 ${BAND + 0.5}H${W_PKG}" stroke="${s.border}"/>`,
    ...story,
    '</svg>',
    '',
  ].join('\n');
}

/**
 * Where a package's picture is served from: the file on the repository's `main` branch, by the
 * address of the repository its manifest says. No version is in it, because the picture must
 * load before any version is published and after the next one.
 * @param {string} dir
 * @param {string} path the file's path from the repository's root
 */
export function pictureUrl(dir, path) {
  const url = manifestOf(dir).repository?.url ?? '';
  const at = /github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?$/.exec(url);
  if (at === null) throw new Error(`packages/${dir}/package.json: no GitHub repository in ${url}`);
  return `https://raw.githubusercontent.com/${at[1]}/main/${path}`;
}

/** The package whose page shows the family, which it stands in the middle of, for its picture. */
export const FAMILY_PAGE = 'code';

/** Every package whose README opens with a picture the script points at. */
export const PICTURED_PAGES = Object.freeze([...PACKAGE_PICTURES.map((p) => p.dir), FAMILY_PAGE]);

/**
 * A package's title, centred. npm keeps `align` on a heading, a paragraph and an image, and
 * strips it from a `div`, so the centre is set on these and never on a wrapper.
 * @param {string} dir
 */
export function titleLine(dir) {
  return `<h1 align="center">${manifestOf(dir).name}</h1>`;
}

/**
 * The block a package's README opens with, under its title: its own picture, described by its
 * manifest, or, for `FAMILY_PAGE`, the family, described as the family's picture describes itself.
 * @param {string} dir
 */
export function pictureBlock(dir) {
  const [file, alt, width] =
    dir === FAMILY_PAGE
      ? [
          (/** @type {string} */ theme) => `docs/assets/the-family-${theme}.svg`,
          FAMILY_ALT,
          W_FAMILY,
        ]
      : [
          (/** @type {string} */ theme) => `packages/${dir}/assets/${dir}-${theme}.svg`,
          manifestOf(dir).description,
          W_PKG,
        ];
  return [
    '<p align="center">',
    '<picture>',
    `  <source media="(prefers-color-scheme: dark)" srcset="${pictureUrl(dir, file('dark'))}">`,
    `  <img src="${pictureUrl(dir, file('light'))}" alt="${attribute(alt)}" width="${width}">`,
    '</picture>',
    '</p>',
  ].join('\n');
}

/**
 * What the front page's README holds under the heading of the family, in place of its own
 * picture: the family's, centred like the pictures above it, at the family's width, by the
 * address of the repository `@mnema/code`'s manifest names, with no version in it.
 */
export function familyBlock() {
  const file = (/** @type {string} */ theme) => `docs/assets/the-family-${theme}.svg`;
  return [
    '<div align="center">',
    '',
    '<picture>',
    `  <source media="(prefers-color-scheme: dark)" srcset="${pictureUrl(FAMILY_PAGE, file('dark'))}">`,
    `  <img src="${pictureUrl(FAMILY_PAGE, file('light'))}" alt="${attribute(FAMILY_ALT)}" width="${W_FAMILY}">`,
    '</picture>',
    '',
    '</div>',
  ].join('\n');
}

/** The heading the front page's family picture sits under. */
export const FAMILY_HEADING = '## The mnema family';

/**
 * The front page's README with the family's block in place: the one under the family's heading
 * is replaced, and a README with no such block is returned as it is, for the test to refuse.
 * @param {string} readme
 * @param {string} block
 */
export function withFamilyBlock(readme, block) {
  const at = new RegExp(`(${FAMILY_HEADING}\\n\\n)<div align="center">\\n[\\s\\S]*?\\n</div>`);
  return readme.replace(at, (_all, head) => `${head}${block}`);
}

/**
 * Every package's picture, by its path from the repository's root.
 * @param {readonly string[]} blocks
 * @returns {Record<string, string>}
 */
export function drawThePackages(blocks) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const pkg of PACKAGE_PICTURES) {
    for (const theme of /** @type {const} */ (['dark', 'light'])) {
      out[`packages/${pkg.dir}/assets/${pkg.dir}-${theme}.svg`] = packagePicture(
        pkg,
        blocks,
        theme,
      );
    }
  }
  return out;
}

/**
 * A package's README with its title and picture block in place: the first line is the title
 * (a `# name` or the centred one), and the block replaces the one there is, or is set under it.
 * @param {string} readme
 * @param {string} block
 * @param {string} title
 */
export function withPicture(readme, block, title) {
  const at = /(?:<p align="center">\n)?<picture>[\s\S]*?<\/picture>(?:\n<\/p>)?/;
  const first = readme.indexOf('\n');
  const body = `${title}${readme.slice(first)}`;
  if (at.test(body)) return body.replace(at, block);
  return `${title}\n\n${block}\n${readme.slice(first + 1)}`;
}

// ---------------------------------------------------------------------------------------------
// The family: `@mnema/code` in the middle, and what stands around it, animated
//
// The grammar of the pictures above, on the front page's width: the wordmark is the hub, the
// record its chain of cubes, and the six around it are cards joined to it by a line whose head
// says which way the record goes: into the hub for what writes, out to the card for what reads,
// both for what does both. One at a time, each card comes in and a lit dot runs its line that
// way; what a write brings is a new cube on the chain. Stacks are not part of what the record
// promises, and are drawn apart: a grey card and a grey line, dashed long.
//
// Every word is a line of the product, as on a package's picture (`said`). No status, no
// version, no count and no host is drawn; the plugin is not on it.

const W_FAMILY = 880;
const H_FAMILY = 260;

/** The words of the family's picture. */
export const FAMILY_LINES = Object.freeze({
  name: [said('@mnema/code', 'packages/code/package.json')],
  cli: [said('mnema', 'packages/code/package.json')],
  mcp: [said('MCP', 'packages/code/README.md')],
  surfaces: [said('two surfaces over one record', 'packages/code/README.md')],
  sdk: [said('SDK', 'docs/features.md')],
  sdkSays: [said('A library door to the record', 'docs/packages.md')],
  vscode: [said('A VS Code extension', 'docs/packages.md')],
  vscodeSays: [said('through the command line', 'docs/packages.md')],
  ci: [said('An agent in CI', 'packages/action/README.md')],
  ciSays: [said('mnema key restore --agent ci', 'packages/action/README.md')],
  action: [said('The Action', 'packages/action/README.md')],
  actionSays: [said('--require=signed --since', 'packages/action/README.md')],
  site: [said('mnema site', 'docs/site.md')],
  siteSays: [said('A page that verifies itself', 'README.md')],
  stacks: [said('Stacks', 'docs/glossary.md')],
  stacksSays: [said('mnema stack add', 'docs/cli-reference.md')],
});

/** The family's text alternative: on the picture itself and on every page that shows it. */
export const FAMILY_ALT =
  'The mnema family: @mnema/code, the command line and the MCP server over one record, with the SDK, a VS Code extension, an agent in CI, the GitHub Action, mnema site and Stacks around it';

/**
 * The glyph of each card, as path data in a box of 22 units: the SDK's brackets, the editor's
 * window and its panel, the loop of a run in CI, the Action's check, a page, and layers. Each is
 * centred in the box by what it draws, so all six sit on the middle of their cards.
 */
const GLYPHS = Object.freeze({
  sdk: 'M7 2H4V9L2 11L4 13V20H7M15 2H18V9L20 11L18 13V20H15',
  vscode:
    'M3 3.5H19A1.5 1.5 0 0 1 20.5 5V17A1.5 1.5 0 0 1 19 18.5H3A1.5 1.5 0 0 1 1.5 17V5A1.5 1.5 0 0 1 3 3.5ZM1.5 7.5H20.5M8 7.5V18.5',
  ci: 'M17.25 12.2A7 7 0 1 1 14.75 6.84M14.75 2.8V6.84H18.75',
  action: 'M11 2A9 9 0 1 1 11 20A9 9 0 1 1 11 2ZM6.5 11.5L9.5 14.5L15.5 8',
  site: 'M4.5 1.5H12.5L17.5 6.5V20.5H4.5ZM12.5 1.5V6.5H17.5M7.5 11H14.5M7.5 14.5H14.5',
  stacks: 'M11 2.5L20 7L11 11.5L2 7ZM2 11L11 15.5L20 11M2 15L11 19.5L20 15',
});

/**
 * The six around the hub, in the order they come in: the side and the row of each, its two
 * lines and the role of the second, and which way the record goes on its line (`in` to the
 * hub, `out` to the card, `both`). A write brings a cube to the chain; so does an adoption, which
 * the hub signs when it installs a stack.
 */
const SATELLITES = Object.freeze([
  { glyph: 'sdk', name: 'sdk', says: 'sdkSays', role: 'caption', side: 0, row: 0, flow: 'both' },
  {
    glyph: 'vscode',
    name: 'vscode',
    says: 'vscodeSays',
    role: 'caption',
    side: 0,
    row: 1,
    flow: 'both',
  },
  { glyph: 'ci', name: 'ci', says: 'ciSays', role: 'code', side: 0, row: 2, flow: 'in' },
  {
    glyph: 'action',
    name: 'action',
    says: 'actionSays',
    role: 'code',
    side: 1,
    row: 0,
    flow: 'out',
  },
  { glyph: 'site', name: 'site', says: 'siteSays', role: 'caption', side: 1, row: 1, flow: 'out' },
  {
    glyph: 'stacks',
    name: 'stacks',
    says: 'stacksSays',
    role: 'code',
    side: 1,
    row: 2,
    flow: 'out',
    apart: true,
  },
]);

/**
 * The heads of a line from (x1, y1) to (x2, y2), as path data: at its end, at its start, or both.
 * @param {number} x1
 * @param {number} y1
 * @param {number} x2
 * @param {number} y2
 * @param {{ start: boolean, end: boolean }} at
 */
function heads(x1, y1, x2, y2, at) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  /** @param {number} x @param {number} y @param {number} a */
  const head = (x, y, a) =>
    `M${n(x - 7 * Math.cos(a + 0.5))} ${n(y - 7 * Math.sin(a + 0.5))}L${n(x)} ${n(y)}L${n(x - 7 * Math.cos(a - 0.5))} ${n(y - 7 * Math.sin(a - 0.5))}`;
  return (at.end ? head(x2, y2, angle) : '') + (at.start ? head(x1, y1, angle + Math.PI) : '');
}

// ---------------------------------------------------------------------------------------------
// The family's vocabulary: what the family draws with, and every package's picture with it

/**
 * The paint of a theme beyond the accent and the greys: the glow behind the drawing and the tint
 * of a card, both in the accent alone, and how strongly a landing cube and a tab are filled. On a
 * light page they stay faint enough that the accent's own lines over them keep three to one.
 * @param {'dark' | 'light'} theme
 */
function palette(theme) {
  const accent = ACCENT[theme];
  const glow = theme === 'light' ? [0.08, 0.03] : [0.16, 0.06];
  const tint = theme === 'light' ? [0.07, 0.02] : [0.12, 0.04];
  return {
    defs: [
      '<defs>',
      `<radialGradient id="glow" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${accent}" stop-opacity="${glow[0]}"/><stop offset="0.6" stop-color="${accent}" stop-opacity="${glow[1]}"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></radialGradient>`,
      `<linearGradient id="tint" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${accent}" stop-opacity="${tint[0]}"/><stop offset="1" stop-color="${accent}" stop-opacity="${tint[1]}"/></linearGradient>`,
      '</defs>',
    ],
    // On a light page a cube lights in the accent itself: anything fainter is under three to one
    // against the glow behind it.
    lit: theme === 'light' ? '1' : '0.85',
    // A tab's edge keeps three to one against its own inside: on a light page, a fainter inside.
    tab: theme === 'light' ? '0.05' : '0.12',
    // The halo around a dot that runs a line.
    halo: '0.22',
  };
}

/**
 * The paint of the banner, the steps and how mnema fits. On a dark page it is the family's. On a
 * light page the accent itself is under three and a half to one on the page, so every surface a
 * line, a dot or an edge in the accent lies on is fainter than the family's: the glow, a card's
 * tint, the inside of a number, a tab, a halo and the faces of a cube, laid one over the other,
 * stay at about a tenth of the accent or under, where the accent keeps three to one. What is
 * solid is the accent itself, its faces parted by the page.
 * @param {'dark' | 'light'} theme
 */
function frontPalette(theme) {
  const family = palette(theme);
  if (theme === 'dark')
    return {
      ...family,
      badge: '0.22',
      highlight: '0.16',
      shade: SHADE,
      chain: [0.16, 0.08, 0.03],
      newest: [0.85, 0.55, 0.3],
      solid: false,
      chip: '',
      glows: '0.3',
    };
  const accent = ACCENT.light;
  return {
    ...family,
    defs: [
      '<defs>',
      `<radialGradient id="glow" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${accent}" stop-opacity="0.02"/><stop offset="0.6" stop-color="${accent}" stop-opacity="0.01"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></radialGradient>`,
      `<linearGradient id="tint" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${accent}" stop-opacity="0.04"/><stop offset="1" stop-color="${accent}" stop-opacity="0.01"/></linearGradient>`,
      '</defs>',
    ],
    tab: '0.03',
    // A chip's edge, a hair heavier: one unit round its small corners is under three to one.
    chip: '1.5',
    halo: '0.06',
    badge: '0.04',
    highlight: '0.04',
    shade: [0.05, 0.025, 0],
    chain: [0.04, 0.02, 0],
    // The newest cube is the accent itself, its faces parted by the page.
    newest: [1, 1, 1],
    solid: true,
    glows: '0.04',
  };
}

/** @typedef {{ x: number, y: number, w: number, h: number }} Frame */

/**
 * A tonal card: tinted inside and edged in the accent, or, for what stands apart, edged in grey,
 * dashed, with nothing inside.
 * @param {Scene} s
 * @param {Frame} c
 * @param {{ apart?: boolean, attrs?: string }} [o]
 */
const card = (s, c, o = {}) =>
  `<rect${o.attrs ? ` ${o.attrs}` : ''} x="${n(c.x + 0.5)}" y="${n(c.y + 0.5)}" width="${n(c.w - 1)}" height="${n(c.h - 1)}" rx="10" fill="${o.apart ? 'none' : 'url(#tint)'}" stroke="${o.apart ? s.muted : s.accent}"${o.apart ? ' stroke-dasharray="5 4"' : ''}/>`;

/**
 * The frame of the hub: a tonal card with a heavier edge and rounder corners.
 * @param {Scene} s
 * @param {Frame} c
 * @param {string} attrs
 */
const hubFrame = (s, c, attrs) =>
  `<rect ${attrs} x="${n(c.x + 0.5)}" y="${n(c.y + 0.5)}" width="${n(c.w - 1)}" height="${n(c.h - 1)}" rx="14" fill="url(#tint)" stroke="${s.accent}" stroke-width="1.5"/>`;

/**
 * A light that comes and goes once, rising at `t`: up in 0.15 s, gone 0.5 s later.
 * @param {Scene} s
 * @param {number} t
 * @param {number} [hold]
 */
const flash = (s, t, hold = 0.5) =>
  s.goes(
    [
      [0, '0'],
      [t, '0'],
      [t + 0.15, '1'],
      [t + 0.15 + hold, '0'],
      [s.loop, '0'],
    ],
    '0',
  );

/**
 * A ring that rises off the hub's edge as a read leaves it, at `t`.
 * @param {Scene} s
 * @param {Frame} hub
 * @param {number} t
 */
const ring = (s, hub, t) =>
  `<rect ${flash(s, t, 0.6)} x="${n(hub.x - 5.5)}" y="${n(hub.y - 5.5)}" width="${hub.w + 11}" height="${hub.h + 11}" rx="19" fill="none" stroke="${s.accent}" stroke-width="2"/>`;

/**
 * The pulse of a card's edge when what goes out reaches it, at `t`: inside the card's edge, and
 * so inside the frame; in the accent, or in its own grey, dashed, for a card that stands apart.
 * @param {Scene} s
 * @param {Frame} c
 * @param {number} t
 * @param {boolean} [apart]
 */
function pulse(s, c, t, apart = false) {
  const lights = s.goes(
    [
      [0, '0'],
      [t - 0.05, '0'],
      [t + 0.1, '1'],
      [t + 0.6, '0'],
      [s.loop, '0'],
    ],
    '0',
  );
  return apart
    ? `<rect ${lights} x="${n(c.x + 1)}" y="${n(c.y + 1)}" width="${c.w - 2}" height="${c.h - 2}" rx="9.5" fill="none" stroke="${s.muted}" stroke-width="2" stroke-dasharray="5 4"/>`
    : `<rect ${lights} x="${n(c.x + 1.5)}" y="${n(c.y + 1.5)}" width="${c.w - 3}" height="${c.h - 3}" rx="9" fill="none" stroke="${s.accent}" stroke-width="3"/>`;
}

/**
 * The glow of a cube that lands at `t`, laid over it.
 * @param {Scene} s
 * @param {number} x
 * @param {number} cy
 * @param {number} a
 * @param {number} t
 * @param {string} lit how strongly it lights, by `palette`
 */
const landing = (s, x, cy, a, t, lit) =>
  `<path ${flash(s, t)} d="${hexagon(x, cy, a)}" fill="${s.accent}" fill-opacity="${lit}"/>`;

/** @typedef {'in' | 'out' | 'both'} Flow */

/**
 * A connection from (x1, y1), the end on the far side, to (x2, y2), the end on the hub's side:
 * a dashed line, its heads where the record goes (`in` to the second end, `out` to the first,
 * `both`), and a stroke that draws the line from where the record starts, at `T`, and leaves its
 * dashes behind. Every property that moves comes back to where it opened while the element is out
 * of sight, so the loop closes on itself. What stands apart is drawn in grey, dashed long.
 *
 * The line and its heads come in after `T` unless `o.attrs` says how they move (`''` for not at
 * all); `o.stroke` paints them in another tone, the last frame's; `o.draws: false` leaves out the
 * stroke that draws the line.
 * @param {Scene} s
 * @param {[number, number, number, number]} ends
 * @param {Flow} flow
 * @param {number} T
 * @param {boolean} [apart]
 * @param {{ attrs?: [string, string], stroke?: string, draws?: boolean }} [o]
 */
function connection(s, ends, flow, T, apart = false, o = {}) {
  const [x1, y1, x2, y2] = ends;
  const tone = o.stroke ?? (apart ? s.muted : s.accent);
  const length = Math.hypot(x2 - x1, y2 - y1);
  const dash = apart
    ? `stroke="${tone}" stroke-dasharray="8 5"`
    : `stroke="${tone}" stroke-dasharray="3 5" stroke-linecap="round"`;
  const [line, head] = o.attrs ?? [s.stays(T + 0.1), s.stays(T + 0.5)];
  const out = [
    `<path${line ? ` ${line}` : ''} d="M${n(x1)} ${n(y1)}L${n(x2)} ${n(y2)}" fill="none" ${dash} stroke-width="1.5"/>`,
    `<path${head ? ` ${head}` : ''} d="${heads(x1, y1, x2, y2, { start: flow !== 'in', end: flow !== 'out' })}" fill="none" stroke="${tone}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`,
  ];
  if (o.draws === false) return out;
  const from = flow === 'out' ? [x2, y2, x1, y1] : [x1, y1, x2, y2];
  const draw = s.animate('stroke-dashoffset', [
    [0, n(length)],
    [T + 0.1, n(length)],
    [T + 0.6, '0'],
    [T + 1.05, '0'],
    [T + 1.15, n(length)],
    [s.loop, n(length)],
  ]);
  const shows = s.animate('opacity', shown(T + 0.1, T + 1.0, 0.2, s.loop));
  out.push(
    `<path class="a" style="animation-name:${draw},${shows}" opacity="0" d="M${n(from[0] ?? 0)} ${n(from[1] ?? 0)}L${n(from[2] ?? 0)} ${n(from[3] ?? 0)}" fill="none" stroke="${s.accent}" stroke-width="2" stroke-linecap="round" stroke-dasharray="${n(length)} ${n(length)}"/>`,
  );
  return out;
}

/**
 * The lit dot that runs a connection the way the record goes, from `T`: to the hub's end and back
 * for what reads and writes, one way for the rest. Its `last` is when it reaches where it goes.
 * @param {Scene} s
 * @param {[number, number, number, number]} ends as `connection` takes them
 * @param {Flow} flow
 * @param {number} T
 */
function dot(s, ends, flow, T) {
  const at = (/** @type {number} */ px, /** @type {number} */ py) =>
    `translate(${n(px)}px,${n(py)}px)`;
  const [sx, sy, hx, hy] = ends;
  /** @type {[number, string][]} */
  const move =
    flow === 'both'
      ? [
          [0, at(sx, sy)],
          [T + 0.4, at(sx, sy)],
          [T + 0.9, at(hx, hy)],
          [T + 1.4, at(sx, sy)],
          [s.loop, at(sx, sy)],
        ]
      : flow === 'in'
        ? [
            [0, at(sx, sy)],
            [T + 0.5, at(sx, sy)],
            [T + 1.2, at(hx, hy)],
            [T + 1.3, at(hx, hy)],
            [T + 1.4, at(sx, sy)],
            [s.loop, at(sx, sy)],
          ]
        : [
            [0, at(hx, hy)],
            [T + 0.5, at(hx, hy)],
            [T + 1.2, at(sx, sy)],
            [T + 1.3, at(sx, sy)],
            [T + 1.4, at(hx, hy)],
            [s.loop, at(hx, hy)],
          ];
  const last = flow === 'both' ? T + 1.4 : T + 1.2;
  const glides = s.animate('transform', move);
  const fades = s.animate('opacity', [
    [0, '0'],
    [move[1]?.[0] ?? 0, '0'],
    [(move[1]?.[0] ?? 0) + 0.12, '1'],
    [last - 0.12, '1'],
    [last + 0.05, '0'],
    [s.loop, '0'],
  ]);
  return {
    last,
    out: `<g class="a" style="animation-name:${glides},${fades}" opacity="0"><circle r="8" fill="${s.accent}" fill-opacity="${s.paint.halo}"/><circle r="4" fill="${s.accent}"/></g>`,
  };
}

/**
 * The family in one theme.
 * @param {readonly string[]} blocks
 * @param {'dark' | 'light'} theme
 */
function family(blocks, theme) {
  const s = scene(LOOP, theme);
  const L = FAMILY_LINES;
  const size = { w: 256, h: 60 };
  const hub = { x: 322, y: 10, w: 236, h: 240 };
  const mid = hub.x + hub.w / 2;
  const rows = [10, 100, 190];
  /** @type {string[]} */
  const out = [];
  const paint = s.paint;

  // Scene 0 (the hub): its card on a glow around the wordmark, the wordmark, the chain one cube
  // after the other, the two surfaces under it, and what they are.
  // The glow reaches the top of the frame and stops there: none of it is cut off.
  out.push(
    `<ellipse ${s.stays(0.2)} cx="${mid}" cy="86" rx="180" ry="86" fill="url(#glow)"/>`,
    hubFrame(s, hub, s.stays(0.2)),
    s.sayIn(L.name, mid, hub, 'label', { anchor: 'middle', attrs: s.stays(0.4) }, -9),
  );
  const scale = 0.36;
  const markW = Math.max(...blocks.map((row) => [...row].length)) * CELL.w * scale;
  out.push(
    `<g ${s.stays(0.5)}><g transform="translate(${n(mid - markW / 2)} 60) scale(${scale})">`,
    ...wordmark(blocks, s.accent, 0, 0),
    '</g></g>',
  );
  // Three cubes are there when the hub comes in; each write, and the adoption of a stack, brings
  // one more, lit as it lands.
  const a = 10;
  const link = 10;
  const cy = 140;
  const landed = [3.1, 4.7, 6.6, 11.4];
  const record = cubes(s, mid - rowWidth(7, a, link) / 2, cy, a, [0.8, 1.0, 1.2, ...landed], link);
  out.push(...record.out);
  landed.forEach((t, i) => {
    out.push(landing(s, record.at(3 + i), cy, a, t, paint.lit));
  });
  // The two surfaces, each a tab hung from a rail under the one record.
  const tab = { w: 64, h: 24, y: 172 };
  const rail = cy + a + 7;
  out.push(
    `<path ${s.stays(1.4)} d="M${n(record.at(0) - record.dx)} ${rail}H${n(record.at(6) + record.dx)}" stroke="${s.muted}" stroke-width="1.5" stroke-linecap="round"/>`,
  );
  [
    [L.cli, mid - 8 - tab.w],
    [L.mcp, mid + 8],
  ].forEach(([line, x], i) => {
    const frame = { y: tab.y, h: tab.h };
    const at = /** @type {number} */ (x) + tab.w / 2;
    out.push(
      `<g ${s.stays(1.5 + i * 0.15)}>`,
      `<path d="M${n(at)} ${tab.y - 1}V${rail}" stroke="${s.muted}" stroke-width="1.5" stroke-linecap="round"/>`,
      `<rect x="${n(/** @type {number} */ (x) + 0.5)}" y="${n(tab.y + 0.5)}" width="${tab.w - 1}" height="${tab.h - 1}" rx="6" fill="${s.accent}" fill-opacity="${paint.tab}" stroke="${s.accent}"/>`,
      s.sayIn(/** @type {Line} */ (line), at, frame, 'label', { anchor: 'middle' }),
      '</g>',
    );
  });
  out.push(s.sayIn(L.surfaces, mid, hub, 'caption', { anchor: 'middle', attrs: s.stays(1.8) }, 9));

  // Scenes 1 to 6: each card comes in with its line, and a dot runs the line the way the record
  // goes.
  SATELLITES.forEach((sat, i) => {
    const T = 2.2 + 1.6 * i;
    const x = sat.side === 0 ? 0 : W_FAMILY - size.w;
    const y = rows[sat.row] ?? 0;
    const frame = { y, h: size.h };
    const tone = sat.apart ? s.muted : s.accent;
    // The card's edge on the hub's side, and the point of the hub's edge the line reaches.
    const near = sat.side === 0 ? x + size.w + 4 : x - 4;
    const far = sat.side === 0 ? hub.x - 4 : hub.x + hub.w + 4;
    const cardY = y + size.h / 2;
    const hubY = hub.y + hub.h / 2 + (sat.row - 1) * 50;
    const box = { x, y, w: size.w, h: size.h };
    out.push(
      `<g ${s.stays(T)}>`,
      card(s, box, { apart: sat.apart === true }),
      `<path transform="translate(${x + 12} ${y + 19})" d="${GLYPHS[/** @type {keyof typeof GLYPHS} */ (sat.glyph)]}" fill="none" stroke="${tone}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`,
      s.sayIn(L[/** @type {keyof typeof L} */ (sat.name)], x + 44, frame, 'label', {}, -1),
      '</g>',
      s.sayIn(
        L[/** @type {keyof typeof L} */ (sat.says)],
        x + 44,
        frame,
        /** @type {Role} */ (sat.role),
        { attrs: s.stays(T + 0.2) },
        1,
      ),
    );
    // The line, from the card to the hub, its heads, and the dot that runs it.
    const ends = /** @type {[number, number, number, number]} */ ([near, cardY, far, hubY]);
    const flow = /** @type {Flow} */ (sat.flow);
    out.push(...connection(s, ends, flow, T, sat.apart));
    const runs = dot(s, ends, flow, T);
    out.push(runs.out);
    // A read leaves the hub as a ring, and lights the card it reaches. Stacks are not a read: the
    // hub installs them and signs the adoption, a cube on the chain; their card lights in its own
    // grey, dashed as it is.
    if (flow === 'out' && !sat.apart) out.push(ring(s, hub, T + 0.5));
    if (flow !== 'in') out.push(pulse(s, box, runs.last, sat.apart));
  });

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W_FAMILY}" height="${H_FAMILY}" viewBox="0 0 ${W_FAMILY} ${H_FAMILY}" role="img" aria-label="${attribute(FAMILY_ALT)}">`,
    `<title>${escaped(FAMILY_ALT)}</title>`,
    '<style>',
    `.a{animation-duration:${LOOP}s;animation-iteration-count:infinite;animation-timing-function:ease-in-out}`,
    ...s.css,
    '@media (prefers-reduced-motion: reduce){.a{animation:none!important}}',
    '</style>',
    ...paint.defs,
    `<rect width="${W_FAMILY}" height="${H_FAMILY}" fill="${PAGE[theme]}"/>`,
    ...out,
    '</svg>',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------------------------

/**
 * Every picture, by its file name under `docs/assets/`, drawn from the console's rows.
 * @param {readonly string[]} blocks
 * @returns {Record<string, string>}
 */
export function drawTheFrontPage(blocks) {
  return {
    'banner-dark.svg': banner(blocks, 'dark'),
    'banner-light.svg': banner(blocks, 'light'),
    'how-it-works-dark.svg': howItWorks('dark'),
    'how-it-works-light.svg': howItWorks('light'),
    'how-mnema-fits-dark.svg': howMnemaFits(blocks, 'dark'),
    'how-mnema-fits-light.svg': howMnemaFits(blocks, 'light'),
    'the-family-dark.svg': family(blocks, 'dark'),
    'the-family-light.svg': family(blocks, 'light'),
  };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const built = new URL('../../packages/code/dist/presentation/banner.js', import.meta.url);
  const { THE_BLOCKS } = await import(built.href);
  const check = process.argv.includes('--check');
  /** @param {string} path */
  const committedAt = (path) => {
    try {
      return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
    } catch {
      return '';
    }
  };
  /** @type {Record<string, string>} */
  const drawn = {};
  for (const [file, svg] of Object.entries(drawTheFrontPage(THE_BLOCKS)))
    drawn[`docs/assets/${file}`] = svg;
  Object.assign(drawn, drawThePackages(THE_BLOCKS));
  for (const dir of PICTURED_PAGES) {
    const readme = `packages/${dir}/README.md`;
    drawn[readme] = withPicture(committedAt(readme), pictureBlock(dir), titleLine(dir));
  }
  drawn['README.md'] = withFamilyBlock(committedAt('README.md'), familyBlock());
  let differs = 0;
  for (const [path, content] of Object.entries(drawn)) {
    const at = new URL(`../../${path}`, import.meta.url);
    if (check) {
      if (committedAt(path) !== content) {
        differs++;
        console.error(`${path} is not what the console draws today`);
      }
    } else if (committedAt(path) !== content) {
      mkdirSync(new URL('.', at), { recursive: true });
      writeFileSync(at, content);
      console.log(`wrote ${path}`);
    }
  }
  if (differs > 0) process.exit(1);
}
