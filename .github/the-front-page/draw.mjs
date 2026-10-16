// Draws the front page's pictures: `docs/assets/banner-{dark,light}.svg`,
// `docs/assets/how-it-works-{dark,light}.svg`, the animated
// `docs/assets/how-mnema-fits-{dark,light}.svg` and the animated
// `docs/assets/the-family-{dark,light}.svg`; and one animated picture per published package,
// `packages/<p>/assets/<p>-{dark,light}.svg`, with the block that opens the package's README and
// points at the copy of the picture inside that version's tarball.
//
// THE BANNER IS THE CONSOLE'S WORDMARK. Its rows are read from `THE_BLOCKS`
// (`packages/code/src/presentation/banner.ts`, through the build) and each glyph is drawn as
// geometry in a cell of the terminal's proportions: a full block as a filled cell, a
// double-line box glyph as its two strokes. Geometry rather than text, because GitHub serves an
// SVG as an image and a block font cannot be counted on there. Beside it, a short chain of
// blocks. The only hue is the accent (`accent.mjs`); everything else is a grey.
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
const CELL = { w: 12, h: 24 };
/** A double line's two strokes: half the gap between their centres, and their width. */
const DOUBLE = { half: 2.75, width: 1.5 };

/**
 * The strokes of a double-line box glyph in a cell at (x, y), as path data, or undefined for a
 * glyph that is not one. Each stroke runs to the cell's edge, so neighbours join.
 * @param {string} glyph
 * @param {number} x
 * @param {number} y
 * @returns {string | undefined}
 */
function doubleLine(glyph, x, y) {
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

// ---------------------------------------------------------------------------------------------
// The chain of blocks

const COS30 = Math.cos(Math.PI / 6);

/**
 * An isometric cube of edge `a` whose middle vertex is (x, y), its three faces shaded.
 * @param {number} x
 * @param {number} y
 * @param {number} a
 * @param {string} accent
 * @param {readonly number[]} shade
 */
function cube(x, y, a, accent, shade) {
  const dx = a * COS30;
  const top = [
    [x, y - a],
    [x + dx, y - a / 2],
    [x, y],
    [x - dx, y - a / 2],
  ];
  const left = [
    [x - dx, y - a / 2],
    [x, y],
    [x, y + a],
    [x - dx, y + a / 2],
  ];
  const right = [
    [x, y],
    [x + dx, y - a / 2],
    [x + dx, y + a / 2],
    [x, y + a],
  ];
  /**
   * @param {number[][]} points
   * @param {number | undefined} opacity
   */
  const face = (points, opacity) =>
    `<path d="M${points.map(([px, py]) => `${n(px ?? 0)} ${n(py ?? 0)}`).join('L')}z" fill="${accent}" fill-opacity="${opacity}"/>`;
  return [
    face(top, shade[0]),
    face(left, shade[1]),
    face(right, shade[2]),
    `<path d="M${n(x)} ${n(y - a)}L${n(x + dx)} ${n(y - a / 2)}L${n(x + dx)} ${n(y + a / 2)}L${n(x)} ${n(y + a)}L${n(x - dx)} ${n(y + a / 2)}L${n(x - dx)} ${n(y - a / 2)}zM${n(x - dx)} ${n(y - a / 2)}L${n(x)} ${n(y)}L${n(x + dx)} ${n(y - a / 2)}M${n(x)} ${n(y)}V${n(y + a)}" fill="none" stroke="${accent}" stroke-width="1.75" stroke-linejoin="round"/>`,
  ];
}

/**
 * Four cubes in a row, each linked to the one before it; the newest is the most solid.
 * @param {string} accent
 * @param {string} muted
 * @param {number} x0
 * @param {number} cy
 */
function chain(accent, muted, x0, cy) {
  const a = 30;
  const dx = a * COS30;
  const link = 18;
  const step = 2 * dx + link;
  const shades = [
    [0.16, 0.08, 0.03],
    [0.16, 0.08, 0.03],
    [0.16, 0.08, 0.03],
    [0.85, 0.55, 0.3],
  ];
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
    parts.push(...cube(x, cy, a, accent, shades[i] ?? []));
  }
  return { parts, width: shades.length * 2 * dx + (shades.length - 1) * link };
}

/**
 * @param {readonly string[]} blocks
 * @param {'dark' | 'light'} theme
 */
function banner(blocks, theme) {
  const accent = ACCENT[theme];
  const { muted } = NEUTRAL[theme];
  const columns = Math.max(...blocks.map((row) => [...row].length));
  const markWidth = columns * CELL.w;
  const markHeight = blocks.length * CELL.h;
  const gap = 56;
  // The chain sits on the middle of the letters' faces: the last row is shadow only.
  const middle = ((blocks.length - 1) * CELL.h) / 2;
  const { parts, width } = chain(accent, muted, markWidth + gap, middle);
  const pad = 4;
  const w = markWidth + gap + width + pad;
  const h = markHeight;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n(w)}" height="${n(h)}" viewBox="0 0 ${n(w)} ${n(h)}" role="img" aria-label="mnema">`,
    '<title>mnema</title>',
    ...wordmark(blocks, accent, 0, 0),
    ...parts,
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

/** @param {'dark' | 'light'} theme */
function howItWorks(theme) {
  const accent = ACCENT[theme];
  const { text, muted, border } = NEUTRAL[theme];
  const card = { w: 196, h: 196 };
  const gap = 32;
  const w = STEPS.length * card.w + (STEPS.length - 1) * gap;
  const h = card.h + 2;
  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="How mnema works: record, rule, hand over, verify">`,
    '<title>How mnema works</title>',
  ];
  STEPS.forEach((step, i) => {
    const x = i * (card.w + gap);
    const y = 1;
    out.push(
      `<rect x="${x + 0.5}" y="${y}" width="${card.w - 1}" height="${card.h}" rx="12" fill="none" stroke="${border}"/>`,
      `<circle cx="${x + 34}" cy="${y + 36}" r="14" fill="none" stroke="${accent}" stroke-width="2"/>`,
      `<text x="${x + 34}" y="${y + 41}" font-family="${SANS}" font-size="14" font-weight="700" fill="${accent}" text-anchor="middle">${i + 1}</text>`,
      `<text x="${x + 58}" y="${y + 42}" font-family="${SANS}" font-size="17" font-weight="600" fill="${text}">${escaped(step.title)}</text>`,
    );
    step.lines.forEach((line, j) => {
      out.push(
        `<text x="${x + 20}" y="${y + 82 + j * 20}" font-family="${SANS}" font-size="13" fill="${muted}">${escaped(line)}</text>`,
      );
    });
    const chipWidth = step.chip.length * 7.3 + 20;
    out.push(
      `<rect x="${x + 20}" y="${y + 148}" width="${n(chipWidth)}" height="28" rx="6" fill="${accent}" fill-opacity="0.12" stroke="${accent}" stroke-opacity="0.6"/>`,
      `<text x="${x + 30}" y="${y + 166.5}" font-family="${MONO}" font-size="12" fill="${text}">${escaped(step.chip)}</text>`,
    );
    if (i < STEPS.length - 1) {
      const ax = x + card.w + gap / 2;
      const ay = y + card.h / 2;
      out.push(
        `<path d="M${ax - 8} ${ay}H${ax + 6}M${ax + 1} ${ay - 5}L${ax + 6} ${ay}L${ax + 1} ${ay + 5}" fill="none" stroke="${muted}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
      );
    }
  });
  out.push('</svg>', '');
  return out.join('\n');
}

// ---------------------------------------------------------------------------------------------
// How mnema fits: an agent session, mnema, the repository — animated
//
// One loop of LOOP seconds, in CSS keyframes inside the SVG, which GitHub plays in an <img>
// (it runs no script and the picture needs none). Every element that moves carries, as its own
// attributes, how it looks in the last frame of the story; a reader who asked for less motion
// gets that frame, still, and the loop opens and closes on the first one, so it restarts with no
// jump. What each frame says is what the product does: see the comment on `HERO_STORY`.

const LOOP = 14;

/**
 * What the picture tells, in order, each line a thing the product does:
 *   - a session opens with the decisions in force, by label and title (the opening document's
 *     own words: `## Decisions in force`, `ADR-2 — Keep money as integer cents`);
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
 * A packet's travel along the lane: hidden, then from x `a` to x `b` over [from, to].
 * @param {number} from
 * @param {number} to
 * @param {number} a
 * @param {number} b
 * @returns {{ move: [number, string][], fade: [number, string][] }}
 */
function travel(from, to, a, b) {
  return {
    move: [
      [0, `translateX(${a}px)`],
      [from, `translateX(${a}px)`],
      [to, `translateX(${b}px)`],
      [LOOP, `translateX(${b}px)`],
    ],
    fade: [
      [0, '0'],
      [from - 0.05, '0'],
      [from + 0.1, '1'],
      [to - 0.1, '1'],
      [to + 0.05, '0'],
      [LOOP, '0'],
    ],
  };
}

/**
 * @param {readonly string[]} blocks
 * @param {'dark' | 'light'} theme
 */
function howMnemaFits(blocks, theme) {
  const accent = ACCENT[theme];
  const { text, muted, border } = NEUTRAL[theme];
  const W = 880;
  const H = 302;
  const box = { top: 8, h: 238, w: 260 };
  const lane = 127;
  const agentRight = box.w;
  const repoLeft = W - box.w;
  const hub = { x: 360, w: 160, y: 84, h: 86 };
  /** @type {string[]} */
  const css = [];
  /** @type {string[]} */
  const body = [];
  let count = 0;
  /**
   * Gives an element a name and the keyframes that move it.
   * @param {string} property
   * @param {[number, string][]} stops
   */
  const animate = (property, stops) => {
    const name = `k${count++}`;
    css.push(keyframes(name, property, stops));
    return name;
  };
  /** @param {string[]} names */
  const style = (names) => `style="animation-name:${names.join(',')}"`;

  // The two panels and the hub.
  const panel = (/** @type {number} */ x, /** @type {string} */ title) => [
    `<rect x="${x + 0.5}" y="${box.top + 0.5}" width="${box.w - 1}" height="${box.h}" rx="12" fill="none" stroke="${border}"/>`,
    `<text x="${x + 18}" y="${box.top + 26}" font-family="${SANS}" font-size="14" font-weight="600" fill="${text}">${title}</text>`,
    `<path d="M${x + 0.5} ${box.top + 40.5}H${x + box.w - 0.5}" stroke="${border}"/>`,
  ];
  body.push(...panel(0, 'agent session'), ...panel(repoLeft, 'repository'));
  body.push(
    `<text x="${box.w / 2}" y="${box.top + box.h + 24}" font-family="${SANS}" font-size="12" fill="${muted}" text-anchor="middle">Claude Code · VS Code · Cursor CLI</text>`,
    `<path d="M${agentRight + 4} ${lane}H${hub.x - 4}M${hub.x + hub.w + 4} ${lane}H${repoLeft - 4}" stroke="${border}" stroke-width="1.5" stroke-dasharray="3 5" stroke-linecap="round"/>`,
    `<rect x="${hub.x + 0.5}" y="${hub.y + 0.5}" width="${hub.w - 1}" height="${hub.h}" rx="12" fill="none" stroke="${border}"/>`,
  );
  const scale = 0.25;
  const markW = Math.max(...blocks.map((row) => [...row].length)) * CELL.w * scale;
  const markH = blocks.length * CELL.h * scale;
  body.push(
    `<g transform="translate(${n(hub.x + (hub.w - markW) / 2)} ${n(hub.y + (hub.h - markH) / 2)}) scale(${scale})">`,
    ...wordmark(blocks, accent, 0, 0),
    '</g>',
  );
  const pulse = (/** @type {number} */ at) => [
    [at - 0.05, '0'],
    [at + 0.15, '1'],
    [at + 0.6, '0'],
  ];
  const hubPulse = animate('opacity', [
    [0, '0'],
    .../** @type {[number, string][]} */ (pulse(3.6)),
    .../** @type {[number, string][]} */ (pulse(6.75)),
    .../** @type {[number, string][]} */ (pulse(9.8)),
    [LOOP, '0'],
  ]);
  body.push(
    `<rect class="a" ${style([hubPulse])} opacity="0" x="${hub.x + 0.5}" y="${hub.y + 0.5}" width="${hub.w - 1}" height="${hub.h}" rx="12" fill="${accent}" fill-opacity="0.08" stroke="${accent}" stroke-width="1.5"/>`,
  );

  // The session's transcript: each entry appears when its packet arrives, and all of them leave
  // together at the end of the loop.
  const ends = LOOP - 0.7;
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
    const a = animate('opacity', shown(first, ends));
    const b = animate('opacity', shown(second, ends));
    const [verb, ...rest] = entry.title.split('  ');
    body.push(
      `<text class="a" ${style([a])} x="18" y="${y}" font-family="${MONO}" font-size="11.5"><tspan fill="${muted}">${escaped(verb ?? '')}</tspan><tspan fill="${text}" dx="7">${escaped(rest.join(' '))}</tspan></text>`,
      `<text class="a" ${style([b])} x="30" y="${y + 18}" font-family="${MONO}" font-size="11.5" fill="${entry.tone === 'accent' ? accent : muted}">${escaped(entry.detail)}</text>`,
    );
  });

  // The repository: the two files, the rule addressed at the first, and the record.
  const rx = repoLeft + 18;
  const pricePulse = animate('opacity', shown(7.8, 8.8));
  body.push(
    `<text x="${rx}" y="${box.top + 68}" font-family="${MONO}" font-size="11.5" fill="${text}">src/billing/total.ts</text>`,
    `<text x="${rx + 12}" y="${box.top + 86}" font-family="${MONO}" font-size="10.5" fill="${muted}">refuses-a-write · ADR-2</text>`,
    `<rect class="a" ${style([pricePulse])} opacity="0" x="${rx - 8}" y="${box.top + 98}" width="${box.w - 20}" height="24" rx="6" fill="${accent}" fill-opacity="0.16" stroke="${accent}" stroke-opacity="0.7"/>`,
    `<text x="${rx}" y="${box.top + 114}" font-family="${MONO}" font-size="11.5" fill="${text}">src/cart/price.ts</text>`,
    `<text x="${rx}" y="${box.top + 152}" font-family="${MONO}" font-size="11.5" fill="${muted}">.mnema/</text>`,
  );
  const a = 12;
  const dx = a * COS30;
  const link = 10;
  const cy = box.top + 186;
  const cubeAt = (/** @type {number} */ i) => rx + dx + i * (2 * dx + link);
  const arrivals = [undefined, undefined, undefined, 5.0, 11.0];
  for (let i = 0; i < 5; i++) {
    const x = cubeAt(i);
    const arrives = arrivals[i];
    const glow = animate('opacity', [
      [0, '0'],
      [11.6 + i * 0.22, '0'],
      [11.8 + i * 0.22, '1'],
      [12.3 + i * 0.22, '0'],
      [LOOP, '0'],
    ]);
    /** @type {string[]} */
    const parts = [];
    if (i > 0) {
      parts.push(
        `<path d="M${n(x - 2 * dx - link + dx + 2)} ${cy}H${n(x - dx - 2)}" stroke="${muted}" stroke-width="1.5" stroke-linecap="round"/>`,
      );
    }
    parts.push(...cube(x, cy, a, accent, [0.3, 0.16, 0.06]));
    parts.push(
      `<path class="a" ${style([glow])} opacity="0" d="M${n(x)} ${n(cy - a)}L${n(x + dx)} ${n(cy - a / 2)}L${n(x + dx)} ${n(cy + a / 2)}L${n(x)} ${n(cy + a)}L${n(x - dx)} ${n(cy + a / 2)}L${n(x - dx)} ${n(cy - a / 2)}z" fill="${accent}" fill-opacity="0.85"/>`,
    );
    if (arrives === undefined) body.push(...parts);
    else {
      const enter = animate('opacity', shown(arrives, ends, 0.4));
      body.push(`<g class="a" ${style([enter])}>`, ...parts, '</g>');
    }
  }
  const verified = animate('opacity', shown(12.8, ends));
  body.push(
    `<text class="a" ${style([verified])} x="${n(cubeAt(4) + dx + 14)}" y="${cy + 4}" font-family="${SANS}" font-size="13" font-weight="600" fill="${accent}">verified</text>`,
  );

  // The packets, each a dot that runs along the lane.
  const legs = [
    travel(0.4, 1.2, hub.x - 6, agentRight + 6),
    travel(2.8, 3.6, agentRight + 6, hub.x - 6),
    travel(4.2, 5.0, hub.x - 6, agentRight + 6),
    travel(4.2, 5.0, hub.x + hub.w + 6, repoLeft - 6),
    travel(6.0, 6.75, agentRight + 6, hub.x - 6),
    travel(7.0, 7.8, hub.x + hub.w + 6, repoLeft - 6),
    travel(9.0, 9.8, agentRight + 6, hub.x - 6),
    travel(10.2, 11.0, hub.x + hub.w + 6, repoLeft - 6),
  ];
  for (const leg of legs) {
    const move = animate('transform', leg.move);
    const fade = animate('opacity', leg.fade);
    body.push(
      `<g class="a" ${style([move, fade])} opacity="0"><circle cx="0" cy="${lane}" r="9" fill="${accent}" fill-opacity="0.22"/><circle cx="0" cy="${lane}" r="4.5" fill="${accent}"/></g>`,
    );
  }

  // The five steps, the one under way lit.
  /** @type {[number, number][]} */
  const stepTimes = [
    [0.2, 2.6],
    [2.7, 5.8],
    [5.9, 8.8],
    [8.9, 11.5],
    [11.6, 13.3],
  ];
  const stepW = W / HERO_STEPS.length;
  HERO_STEPS.forEach((step, i) => {
    const cx = stepW * i + stepW / 2;
    const [from, to] = stepTimes[i] ?? [0, 0];
    const lit = animate('opacity', shown(from, to));
    // The grey label steps aside while the lit one stands in its place, so the two never overlap.
    const unlit = animate(
      'opacity',
      shown(from, to).map(([t, v]) => /** @type {[number, string]} */ ([t, v === '1' ? '0' : '1'])),
    );
    const label = `${i + 1}  ${step}`;
    body.push(
      `<text class="a" ${style([unlit])} x="${n(cx)}" y="${H - 6}" font-family="${SANS}" font-size="12" fill="${muted}" text-anchor="middle" xml:space="preserve">${escaped(label)}</text>`,
      `<text class="a" ${style([lit])} opacity="0" x="${n(cx)}" y="${H - 6}" font-family="${SANS}" font-size="12" font-weight="600" fill="${accent}" text-anchor="middle" xml:space="preserve">${escaped(label)}</text>`,
    );
  });

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="How mnema fits: a session opens with the decisions in force, a write under a refusing rule is denied, a write elsewhere lands, a recorded decision is signed into the chain, and mnema verify checks it">`,
    '<title>How mnema fits between an agent session and the repository</title>',
    '<style>',
    `.a{animation-duration:${LOOP}s;animation-iteration-count:infinite;animation-timing-function:ease-in-out}`,
    ...css,
    '@media (prefers-reduced-motion: reduce){.a{animation:none!important}}',
    '</style>',
    ...body,
    '</svg>',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------------------------
// The packages: one animated picture per published package, `packages/<p>/assets/<p>-{dark,light}.svg`
//
// The grammar of the picture above: one loop of CSS keyframes, every element that moves carrying
// the last frame as its own attributes, and the accent as the only hue. Each picture opens with
// the package's name on the left and the wordmark on the right.
//
// EVERY WORD ON A PACKAGE'S PICTURE IS A WORD OF THE PRODUCT. A line is written as pieces, each
// the literal it puts on the picture and the file of the repository that says it (`said`),
// joined by one of `SEPARATORS`, or `ELIDED` where a line of output prints a record's id. The
// test finds every literal in its file, and finds no text on a picture that is not one of these
// lines. A text inside a box is put there by `sayIn` and by nothing else. The example of the
// front page (`ADR-2`, `Keep money as integer cents`, `src/billing/total.ts`, `ADR-3`) is
// anchored on the front page's own picture. No count that changes (kinds, hosts, tools) and no host's name is drawn.

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
const PAGE = Object.freeze({ dark: '#0d1117', light: '#ffffff' });

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
/**
 * What stands for a record's id in a line of output: the command line prints a new one on every
 * run, so the picture draws none.
 */
export const ELIDED = '(…)';
/** The baseline of the band at the foot of every package's picture. */
const FOOT = 220;
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
    accent,
    text,
    muted,
    border,
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

/**
 * A row of cubes, each linked to the one before; `arrive[i]` is when cube i comes in, or
 * undefined for one that is there from the start.
 * @param {Scene} s
 * @param {number} x0
 * @param {number} cy
 * @param {number} a
 * @param {readonly (number | undefined)[]} arrive
 * @param {number} [link]
 */
function cubes(s, x0, cy, a, arrive, link = 12) {
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
    parts.push(...cube(x, cy, a, s.accent, [0.3, 0.16, 0.06]));
    if (when === undefined) out.push(...parts);
    else out.push(`<g ${s.stays(when)}>`, ...parts, '</g>');
  });
  return { out, at, dx };
}

/**
 * A rounded box in the muted grey, or lit in the accent.
 * @param {Scene} s
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {string} [attrs] given, the box is lit and moves by them
 */
const box = (s, x, y, w, h, attrs) =>
  attrs === undefined
    ? `<rect x="${n(x + 0.5)}" y="${n(y + 0.5)}" width="${n(w - 1)}" height="${n(h - 1)}" rx="8" fill="none" stroke="${s.muted}"/>`
    : `<rect ${attrs} x="${n(x + 0.5)}" y="${n(y + 0.5)}" width="${n(w - 1)}" height="${n(h - 1)}" rx="8" fill="${s.accent}" fill-opacity="0.1" stroke="${s.accent}" stroke-width="1.5"/>`;

/**
 * An arrow from (x1, y1) to (x2, y2), its head at the second, in the muted grey or the colour
 * given.
 * @param {Scene} s
 * @param {number} x1
 * @param {number} y1
 * @param {number} x2
 * @param {number} y2
 * @param {string} [attrs]
 * @param {string} [stroke]
 */
function arrow(s, x1, y1, x2, y2, attrs, stroke = s.muted) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const head = (/** @type {number} */ turn) =>
    `${n(x2 - 7 * Math.cos(angle + turn))} ${n(y2 - 7 * Math.sin(angle + turn))}`;
  return `<path${attrs ? ` ${attrs}` : ''} d="M${n(x1)} ${n(y1)}L${n(x2)} ${n(y2)}M${head(0.5)}L${n(x2)} ${n(y2)}L${head(-0.5)}" fill="none" stroke="${stroke}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`;
}

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
  // The seal of the checkpoint, flush with the left edge, and the three blocks in its middle.
  const seal = { x: 0, y: 100, w: 180, h: 64 };
  const cy = seal.y + seal.h / 2;
  const row = cubes(
    s,
    seal.x + (seal.w - rowWidth(3, a, between)) / 2,
    cy,
    a,
    [1.6, 2.2, 2.8],
    between,
  );
  /** @type {string[]} */
  const out = [];
  // An event comes in as a card, and the first block takes its place.
  const card = { y: 52, h: 26 };
  out.push(
    `<g ${s.passes(0.2, 1.9)}>`,
    `<rect x="0.5" y="${card.y + 0.5}" width="${Math.ceil(widthOf(L.event, 'code') + 2 * PAD) - 1}" height="${card.h - 1}" rx="6" fill="${s.accent}" fill-opacity="0.12" stroke="${s.accent}"/>`,
    s.sayIn(L.event, PAD, card, 'code'),
    '</g>',
    ...row.out,
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
  // The checkpoint signs over all three.
  out.push(
    `<rect ${s.stays(3.5)} x="${n(seal.x + 0.5)}" y="${n(seal.y + 0.5)}" width="${seal.w - 1}" height="${seal.h - 1}" rx="10" fill="${s.accent}" fill-opacity="0.06" stroke="${s.accent}" stroke-width="1.5"/>`,
    s.say(L.checkpoint, seal.x, seal.y - 10, 'caption', { attrs: s.stays(3.7) }),
    s.say(L.altered, 0, FOOT, 'code', { attrs: s.passes(5.4, 7.6) }),
  );
  // Two readers of the same tail, each in its own words for the same verdict; each arrow points
  // at the middle of its reader's two lines.
  const rx = 420;
  const right = seal.x + seal.w;
  out.push(
    arrow(s, right + 8, cy - 8, rx - 14, 106, s.stays(8.8)),
    arrow(s, right + 8, cy + 8, rx - 14, 156, s.stays(8.8)),
    s.say(L.verify, rx, 100, 'code', { attrs: s.stays(9.0) }),
    s.say(L.verified, rx, 120, 'code', { attrs: s.stays(9.4) }),
    s.say(L.python, rx, 150, 'code', { attrs: s.stays(9.2) }),
    s.say(L.VERIFIED, rx, 170, 'code', { attrs: s.stays(9.6) }),
  );
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
  // The states on three rows; every move of the table is an arrow with its head.
  const node = { w: 108, h: 28 };
  const col = 160;
  const [top, middle, bottom] = [52, 112, 172];
  const mid = (/** @type {number} */ y) => y + node.h / 2;
  /** @type {[Line, number, number][]} */
  const nodes = [
    [L.proposed, 0, middle],
    [L.accepted, col, top],
    [L.superseded, col, middle],
    [L.rejected, col, bottom],
  ];
  for (const [line, x, y] of nodes) {
    out.push(box(s, x, y, node.w, node.h), s.sayIn(line, x + PAD, { y, h: node.h }, 'label'));
  }
  // A move the table allows: the edge lights, head and all, then the state, and a block goes
  // down to the chain. The edge is one arrow whose stroke turns to the accent.
  const lit = `class="a" style="animation-name:${s.animate('stroke', [
    [0, s.muted],
    [2.4, s.muted],
    [2.7, s.accent],
    [s.ends - 0.3, s.accent],
    [s.ends, s.muted],
    [s.loop, s.muted],
  ])}"`;
  for (const y of [middle, bottom]) out.push(arrow(s, node.w + 2, mid(middle), col - 3, mid(y)));
  out.push(arrow(s, node.w + 2, mid(middle), col - 3, mid(top), lit, s.accent));
  const axis = col + node.w / 2;
  out.push(arrow(s, axis, top + node.h + 3, axis, middle - 3));
  out.push(
    s.say(L.request, 0, 100, 'code', { attrs: s.passes(1.8, 4.2) }),
    box(s, col, top, node.w, node.h, s.stays(2.8)),
  );
  // The table, flush with the right edge; the chain above it starts where it starts, and the fold
  // comes down the axis of the middle block.
  const tableW = Math.ceil(widthOf(L.row, 'value') + 2 * PAD);
  const x0 = W_PKG - tableW;
  const chain = cubes(s, x0, mid(top), 12, [undefined, undefined, 3.4]);
  out.push(...chain.out);
  // A move it does not allow: asked of `rejected`, the gate hands it back in words, and nothing
  // goes down.
  const reach = col + node.w + 3;
  out.push(
    arrow(s, reach + 48, mid(bottom), reach, mid(bottom), s.passes(4.2, 6.4), s.accent),
    s.say(L.again, reach + 56, inside({ y: bottom, h: node.h }, 'code'), 'code', {
      attrs: s.passes(4.2, 6.4),
    }),
    `<rect ${s.passes(4.4, 6.4)} x="${col + 0.5}" y="${bottom + 0.5}" width="${node.w - 1}" height="${node.h - 1}" rx="8" fill="none" stroke="${s.accent}" stroke-width="1.5" stroke-dasharray="4 3"/>`,
    s.say(L.refused, 0, FOOT, 'code', { attrs: s.stays(4.8) }),
  );
  // The chain folded into a table, which is thrown away and folded again the same.
  const down = chain.at(1);
  out.push(
    arrow(s, down, mid(top) + 16, down, middle - 3, s.stays(6.6)),
    s.say(L.fold, down + 12, 100, 'caption', { attrs: s.stays(6.6) }),
    `<g ${s.goes(
      s.leaves([
        [0, '0'],
        [7.0, '0'],
        [7.3, '1'],
        [8.6, '1'],
        [8.9, '0'],
        [9.3, '0'],
        [9.6, '1'],
      ]),
      '1',
    )}>`,
    box(s, x0, middle, tableW, node.h),
    s.sayIn(L.row, x0 + PAD, { y: middle, h: node.h }, 'value'),
    '</g>',
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
  // The two panels share their rows: ADR-2 and ADR-3 sit on the same line on both sides.
  // Five rows, the third on the panel's middle; a row is two half rows from the next.
  const panel = { y: 52, h: 124 };
  const [r1, r2, r3, r4, r5] = [-4, -2, 0, 2, 4];
  out.push(box(s, 0, panel.y, 180, panel.h));
  /** @type {[Line, number][]} */
  const chain = [
    [L.one, r1],
    [L.two, r3],
    [L.three, r5],
  ];
  chain.forEach(([line, row], i) => {
    out.push(
      s.sayIn(line, PAD, panel, 'value', { fill: s.muted, attrs: s.stays(0.2 + i * 0.3) }, row),
    );
  });
  // The pill around the one in force sits on the panel's middle, and so does its line.
  const pill = { y: panel.y + panel.h / 2 - 13, h: 26 };
  const axis = pill.y + pill.h / 2;
  out.push(box(s, 6, pill.y, 168, pill.h, s.stays(2.6)));
  // bootstrap lets the ones in force through, and puts what waits on a person apart.
  out.push(
    arrow(s, 190, axis, 394, axis, s.stays(2.0)),
    s.say(L.bootstrap, 292, inside(panel, 'caption', r2), 'caption', {
      anchor: 'middle',
      attrs: s.stays(2.0),
    }),
    box(s, 404, panel.y, W_PKG - 404, panel.h),
    s.sayIn(L.decisions, 404 + PAD, panel, 'caption', { attrs: s.stays(2.4) }, r2),
    s.sayIn(L.inForce, 404 + PAD, panel, 'value', { attrs: s.stays(3.0) }, r3),
    s.sayIn(L.awaiting, 404 + PAD, panel, 'caption', { attrs: s.stays(4.6) }, r4),
    s.sayIn(L.waits, 404 + PAD, panel, 'value', { attrs: s.stays(5.0) }, r5),
  );
  // Asked for a path, it names the rule that refuses a write there.
  out.push(
    s.say(L.asks, 0, FOOT - 20, 'caption', { attrs: s.stays(6.6) }),
    s.say(L.path, 0, FOOT, 'value', { attrs: s.stays(7.4) }),
  );
  // And it writes nothing back: the struck arrow runs on the middle of the foot's line.
  const lane = FOOT - 4;
  out.push(
    `<g ${s.stays(9.0)}>`,
    `<path d="M394 ${lane}H254" stroke="${s.muted}" stroke-width="1.5" stroke-dasharray="3 5" stroke-linecap="round"/>`,
    `<path d="M260 ${lane - 6}L254 ${lane}L260 ${lane + 6}" fill="none" stroke="${s.muted}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`,
    `<path d="M317 ${lane - 8}L331 ${lane + 8}M331 ${lane - 8}L317 ${lane + 8}" stroke="${s.accent}" stroke-width="2" stroke-linecap="round"/>`,
    '</g>',
    s.say(L.only, 404, FOOT, 'code', { attrs: s.stays(9.4) }),
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
  // The directory, line by line, and under it the validator, as wide.
  // Five rows, the third on the folder's middle; a row is two half rows from the next.
  const folder = { w: 240, y: 52, h: 124 };
  const rows = [-4, -2, 0, 2];
  out.push(box(s, 0, folder.y, folder.w, folder.h));
  [L.manifest, L.skill, L.agent, L.licence].forEach((line, i) => {
    out.push(s.sayIn(line, PAD, folder, 'value', { attrs: s.stays(0.3 + i * 0.4) }, rows[i] ?? 0));
  });
  out.push(s.sayIn(L.mcp, PAD, folder, 'value', { attrs: s.passes(2.0, 4.6) }, 4));
  // The validator bars the server, and passes the directory once it is gone.
  const gate = { y: 186, h: 40 };
  const verdict = 130;
  const gy = gate.y + gate.h / 2;
  out.push(
    box(s, 0, gate.y, folder.w, gate.h),
    s.sayIn(L.validate, PAD, gate, 'label', { attrs: s.stays(1.8) }),
    s.sayIn(L.refused, verdict, gate, 'code', { attrs: s.passes(2.6, 4.6) }),
    `<path ${s.stays(4.8)} d="M${verdict} ${gy - 2}L${verdict + 6} ${gy + 4}L${verdict + 18} ${gy - 8}" fill="none" stroke="${s.accent}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
  );
  // Each file becomes a line, and the lines become the digest, all on one axis.
  const axis = 482;
  const into = axis - widthOf(L.line, 'caption') / 2 - 8;
  const meet = 106;
  const bend = (folder.w + into) / 2;
  out.push(`<g ${s.stays(5.6)}>`);
  for (const row of rows) {
    const y = folder.y + folder.h / 2 + row * HALF_ROW;
    out.push(
      `<path d="M${folder.w + 4} ${y}C${n(bend)} ${y} ${n(bend)} ${meet} ${n(into)} ${meet}" fill="none" stroke="${s.muted}" stroke-width="1.25"/>`,
    );
  }
  out.push(
    '</g>',
    s.say(L.line, axis, meet + 4, 'caption', { anchor: 'middle', attrs: s.stays(6.0) }),
    arrow(s, axis, meet + 14, axis, FOOT - 36, s.stays(7.0)),
    s.say(L.digest, axis, FOOT - 20, 'code', { anchor: 'middle', attrs: s.stays(7.6) }),
    s.say(L.digestEnd, axis, FOOT, 'code', { anchor: 'middle', attrs: s.stays(7.6) }),
  );
  return out;
}

// @mnema/code: the command line, the MCP server and the plugin, one record behind all three.
const GOLDEN_WRITES = 'packages/code/src/cli.writes.golden.txt';
const GOLDEN_READS = 'packages/code/src/cli.reads.golden.txt';
const CODE_LINES = {
  name: [said('@mnema/code', 'packages/code/package.json')],
  cli: [said('mnema', 'packages/code/package.json')],
  mcp: [said('MCP', 'packages/code/README.md')],
  plugin: [said('plugin', 'packages/code/README.md')],
  record: [said('record_decision', 'packages/code/src/mcp/server.ts')],
  // The two lines of output are lines of the golden, cut before the id the command line prints
  // and with the id elided: it is a new one on every run.
  recorded: [said('Recorded decision ADR-1', GOLDEN_WRITES), ' ', ELIDED],
  accept: [said('mnema decision move accept', GOLDEN_WRITES)],
  accepted: [
    said('Decision ADR-1', GOLDEN_WRITES),
    ' ',
    ELIDED,
    ' → ',
    said('accepted', GOLDEN_WRITES),
  ],
  hooks: [
    said('SessionStart', 'plugin/hooks/hooks.json'),
    ' · ',
    said('PreToolUse', 'plugin/hooks/hooks.json'),
  ],
  deny: [
    said('deny', 'packages/code/src/host-hook.ts'),
    ' · ',
    said('refuses-a-write', 'packages/chain/src/events/catalog.ts'),
  ],
  verify: [said('mnema verify', GOLDEN_READS)],
  verified: [said('local integrity verified (T1/T2/T4)', GOLDEN_READS)],
};

/** @param {Scene} s */
function codeStory(s) {
  const L = CODE_LINES;
  /** @type {string[]} */
  const out = [];
  // Each door is a box with its name and what goes through it; a dashed line runs from each
  // door's edge to the one record, flush with the right edge.
  const door = { w: 424, h: 44 };
  const [cli, mcp, hooks] = [56, 116, 176];
  const tx = 80;
  const cy = mcp + door.h / 2;
  const a = 13;
  const record = cubes(s, W_PKG - rowWidth(4, a) - 1, cy, a, [undefined, undefined, 3.6, 5.4]);
  /** @type {[Line, number][]} */
  const doors = [
    [L.cli, cli],
    [L.mcp, mcp],
    [L.plugin, hooks],
  ];
  // A door's name sits on its middle; what goes through it, two lines, half a row above and
  // below it.
  const at = (/** @type {number} */ y) => ({ y, h: door.h });
  for (const [line, y] of doors) {
    out.push(
      box(s, 0, y, door.w, door.h),
      s.sayIn(line, PAD, at(y), 'label'),
      `<path d="M${door.w + 4} ${y + door.h / 2}L${n(record.at(0) - record.dx - 6)} ${cy}" stroke="${s.muted}" stroke-width="1.5" stroke-dasharray="3 5" stroke-linecap="round"/>`,
    );
  }
  out.push(...record.out);
  // An agent records through the MCP server.
  out.push(
    box(s, 0, mcp, door.w, door.h, s.stays(2.0)),
    s.sayIn(L.record, tx, at(mcp), 'code', { attrs: s.stays(2.2) }, -1),
    s.sayIn(L.recorded, tx, at(mcp), 'code', { attrs: s.stays(3.0) }, 1),
  );
  // A person accepts at the command line.
  out.push(
    box(s, 0, cli, door.w, door.h, s.stays(4.0)),
    s.sayIn(L.accept, tx, at(cli), 'code', { attrs: s.passes(4.2, 8.4) }, -1),
    s.sayIn(L.accepted, tx, at(cli), 'code', { attrs: s.passes(4.8, 8.4) }, 1),
  );
  // Through the plugin's hooks the session opens with the rule, and a write under it is denied.
  out.push(
    box(s, 0, hooks, door.w, door.h, s.stays(6.0)),
    s.sayIn(L.hooks, tx, at(hooks), 'code', { attrs: s.stays(6.2) }, -1),
    s.sayIn(L.deny, tx, at(hooks), 'code', { attrs: s.stays(7.0) }, 1),
  );
  // The command line verifies the record; the seal lights the blocks one after the other, and
  // they go out with the rest of the picture.
  out.push(
    s.sayIn(L.verify, tx, at(cli), 'code', { attrs: s.stays(8.6) }, -1),
    s.sayIn(L.verified, tx, at(cli), 'code', { attrs: s.stays(9.4) }, 1),
  );
  for (let i = 0; i < 4; i++) {
    out.push(
      `<path ${s.stays(9.0 + i * 0.2)} d="${hexagon(record.at(i), cy, a)}" fill="${s.accent}"/>`,
    );
  }
  return out;
}

/**
 * The five published packages: the directory, the loop, the lines each says and the story that
 * draws them.
 */
export const PACKAGE_PICTURES = Object.freeze([
  { dir: 'chain', loop: 11, lines: CHAIN_LINES, story: chainStory },
  { dir: 'core', loop: 11, lines: CORE_LINES, story: coreStory },
  { dir: 'context', loop: 11, lines: CONTEXT_LINES, story: contextStory },
  { dir: 'stacks', loop: 10.5, lines: STACKS_LINES, story: stacksStory },
  { dir: 'code', loop: 11, lines: CODE_LINES, story: codeStory },
]);

/**
 * What a package's manifest says that its picture and its README use.
 * @param {string} dir
 * @returns {{ name: string, version: string, description: string }}
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
    `<rect width="${W_PKG}" height="${H_PKG}" fill="${PAGE[theme]}"/>`,
    s.say(pkg.lines.name, 0, 24, 'heading'),
    `<g transform="translate(${n(W_PKG - markW)} 6) scale(${scale})">`,
    ...wordmark(blocks, s.accent, 0, 0),
    '</g>',
    `<path d="M0 40.5H${W_PKG}" stroke="${s.border}"/>`,
    ...story,
    '</svg>',
    '',
  ].join('\n');
}

/**
 * Where a published package's picture is served from: the copy inside the tarball of that very
 * version, so the page of a version shows the picture that version carries.
 * @param {string} name
 * @param {string} version
 * @param {string} file
 */
export const pictureUrl = (name, version, file) =>
  `https://cdn.jsdelivr.net/npm/${name}@${version}/assets/${file}`;

/**
 * The block a package's README opens with, under its title, for the version its manifest says.
 * @param {string} dir
 */
export function pictureBlock(dir) {
  const { name, version, description } = manifestOf(dir);
  return [
    '<picture>',
    `  <source media="(prefers-color-scheme: dark)" srcset="${pictureUrl(name, version, `${dir}-dark.svg`)}">`,
    `  <img src="${pictureUrl(name, version, `${dir}-light.svg`)}" alt="${attribute(description)}" width="720">`,
    '</picture>',
  ].join('\n');
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
 * A package's README with its picture block in place: replacing the one there is, or set under
 * the title where there is none.
 * @param {string} readme
 * @param {string} block
 */
export function withPicture(readme, block) {
  const at = /<picture>[\s\S]*?<\/picture>/;
  if (at.test(readme)) return readme.replace(at, block);
  const title = readme.indexOf('\n');
  return `${readme.slice(0, title + 1)}\n${block}\n${readme.slice(title + 1)}`;
}

// ---------------------------------------------------------------------------------------------
// The family: `@mnema/code` in the middle, and what stands around it — animated
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
  sdk: [said('SDK', 'packages/sdk/README.md')],
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

const FAMILY_ALT =
  'The mnema family: @mnema/code, the command line and the MCP server over one record, with the SDK, a VS Code extension, an agent in CI, the GitHub Action, mnema site and Stacks around it';

/**
 * The glyph of each card, as path data in a box of 22 units: the SDK's brackets, the editor's
 * window and its panel, the loop of a run in CI, the Action's check, a page, and layers.
 */
const GLYPHS = Object.freeze({
  sdk: 'M7 2H4V9L2 11L4 13V20H7M15 2H18V9L20 11L18 13V20H15',
  vscode:
    'M3 3.5H19A1.5 1.5 0 0 1 20.5 5V17A1.5 1.5 0 0 1 19 18.5H3A1.5 1.5 0 0 1 1.5 17V5A1.5 1.5 0 0 1 3 3.5ZM1.5 7.5H20.5M8 7.5V18.5',
  ci: 'M18 11A7 7 0 1 1 15.5 5.64M15.5 1.6V5.64H19.5',
  action: 'M11 2A9 9 0 1 1 11 20A9 9 0 1 1 11 2ZM6.5 11.5L9.5 14.5L15.5 8',
  site: 'M5 1.5H13L18 6.5V20.5H5ZM13 1.5V6.5H18M8 11H15M8 14.5H15',
  stacks: 'M11 3L20 7.5L11 12L2 7.5ZM2 11.5L11 16L20 11.5M2 15.5L11 20L20 15.5',
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

/**
 * The family in one theme.
 * @param {readonly string[]} blocks
 * @param {'dark' | 'light'} theme
 */
function family(blocks, theme) {
  const s = scene(LOOP, theme);
  const L = FAMILY_LINES;
  const card = { w: 256, h: 60 };
  const hub = { x: 322, y: 10, w: 236, h: 240 };
  const mid = hub.x + hub.w / 2;
  const rows = [10, 100, 190];
  /** @type {string[]} */
  const out = [];
  // The glow and the tint of the cards, in the accent alone. On a light page they stay faint
  // enough that the accent's own lines over them keep three to one.
  const glow = theme === 'light' ? [0.08, 0.03] : [0.16, 0.06];
  const tint = theme === 'light' ? [0.07, 0.02] : [0.12, 0.04];
  const defs = [
    '<defs>',
    `<radialGradient id="glow" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${s.accent}" stop-opacity="${glow[0]}"/><stop offset="0.6" stop-color="${s.accent}" stop-opacity="${glow[1]}"/><stop offset="1" stop-color="${s.accent}" stop-opacity="0"/></radialGradient>`,
    `<linearGradient id="tint" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${s.accent}" stop-opacity="${tint[0]}"/><stop offset="1" stop-color="${s.accent}" stop-opacity="${tint[1]}"/></linearGradient>`,
    '</defs>',
  ];

  // Scene 0: the hub — its card on a glow around the wordmark, the wordmark, the chain one cube
  // after the other, the two surfaces under it, and what they are.
  out.push(
    `<ellipse ${s.stays(0.2)} cx="${mid}" cy="86" rx="180" ry="120" fill="url(#glow)"/>`,
    `<rect ${s.stays(0.2)} x="${n(hub.x + 0.5)}" y="${n(hub.y + 0.5)}" width="${n(hub.w - 1)}" height="${n(hub.h - 1)}" rx="14" fill="url(#tint)" stroke="${s.accent}" stroke-width="1.5"/>`,
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
    out.push(
      `<path ${s.goes(
        [
          [0, '0'],
          [t, '0'],
          [t + 0.15, '1'],
          [t + 0.65, '0'],
          [LOOP, '0'],
        ],
        '0',
      )} d="${hexagon(record.at(3 + i), cy, a)}" fill="${s.accent}" fill-opacity="0.85"/>`,
    );
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
      `<rect x="${n(/** @type {number} */ (x) + 0.5)}" y="${n(tab.y + 0.5)}" width="${tab.w - 1}" height="${tab.h - 1}" rx="6" fill="${s.accent}" fill-opacity="0.12" stroke="${s.accent}"/>`,
      s.sayIn(/** @type {Line} */ (line), at, frame, 'label', { anchor: 'middle' }),
      '</g>',
    );
  });
  out.push(s.sayIn(L.surfaces, mid, hub, 'caption', { anchor: 'middle', attrs: s.stays(1.8) }, 9));

  // A ring that rises off the hub as a read leaves it.
  /** @param {number} t */
  const ring = (t) =>
    `<rect ${s.goes(
      [
        [0, '0'],
        [t, '0'],
        [t + 0.15, '1'],
        [t + 0.75, '0'],
        [LOOP, '0'],
      ],
      '0',
    )} x="${n(hub.x - 5.5)}" y="${n(hub.y - 5.5)}" width="${hub.w + 11}" height="${hub.h + 11}" rx="19" fill="none" stroke="${s.accent}" stroke-width="2"/>`;

  // Scenes 1 to 6: each card comes in with its line, and a dot runs the line the way the record
  // goes.
  SATELLITES.forEach((sat, i) => {
    const T = 2.2 + 1.6 * i;
    const x = sat.side === 0 ? 0 : W_FAMILY - card.w;
    const y = rows[sat.row] ?? 0;
    const frame = { y, h: card.h };
    const tone = sat.apart ? s.muted : s.accent;
    // The card's edge on the hub's side, and the point of the hub's edge the line reaches.
    const near = sat.side === 0 ? x + card.w + 4 : x - 4;
    const far = sat.side === 0 ? hub.x - 4 : hub.x + hub.w + 4;
    const cardY = y + card.h / 2;
    const hubY = hub.y + hub.h / 2 + (sat.row - 1) * 50;
    out.push(
      `<g ${s.stays(T)}>`,
      `<rect x="${n(x + 0.5)}" y="${n(y + 0.5)}" width="${card.w - 1}" height="${card.h - 1}" rx="10" fill="${sat.apart ? 'none' : 'url(#tint)'}" stroke="${tone}"${sat.apart ? ' stroke-dasharray="5 4"' : ''}/>`,
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
    // The line, from the card to the hub, and its heads.
    const [x1, y1, x2, y2] = [near, cardY, far, hubY];
    const length = Math.hypot(x2 - x1, y2 - y1);
    const dash = sat.apart
      ? `stroke="${s.muted}" stroke-dasharray="8 5"`
      : `stroke="${s.accent}" stroke-dasharray="3 5" stroke-linecap="round"`;
    out.push(
      `<path ${s.stays(T + 0.1)} d="M${n(x1)} ${n(y1)}L${n(x2)} ${n(y2)}" fill="none" ${dash} stroke-width="1.5"/>`,
      `<path ${s.stays(T + 0.5)} d="${heads(x1, y1, x2, y2, { start: sat.flow !== 'in', end: sat.flow !== 'out' })}" fill="none" stroke="${tone}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`,
    );
    // The line draws itself from where the record starts, and leaves its dashes behind. Every
    // property that moves comes back to where it opened while the element is out of sight, so the
    // loop closes on itself.
    const from = sat.flow === 'out' ? [x2, y2, x1, y1] : [x1, y1, x2, y2];
    const draw = s.animate('stroke-dashoffset', [
      [0, n(length)],
      [T + 0.1, n(length)],
      [T + 0.6, '0'],
      [T + 1.05, '0'],
      [T + 1.15, n(length)],
      [LOOP, n(length)],
    ]);
    const shows = s.animate('opacity', shown(T + 0.1, T + 1.0, 0.2, LOOP));
    out.push(
      `<path class="a" style="animation-name:${draw},${shows}" opacity="0" d="M${n(from[0] ?? 0)} ${n(from[1] ?? 0)}L${n(from[2] ?? 0)} ${n(from[3] ?? 0)}" fill="none" stroke="${s.accent}" stroke-width="2" stroke-linecap="round" stroke-dasharray="${n(length)} ${n(length)}"/>`,
    );
    // The dot: to the hub and back for what reads and writes, one way for the rest.
    const at = (/** @type {number} */ px, /** @type {number} */ py) =>
      `translate(${n(px)}px,${n(py)}px)`;
    const [sx, sy, hx, hy] = [x1, y1, x2, y2];
    /** @type {[number, string][]} */
    const move =
      sat.flow === 'both'
        ? [
            [0, at(sx, sy)],
            [T + 0.4, at(sx, sy)],
            [T + 0.9, at(hx, hy)],
            [T + 1.4, at(sx, sy)],
            [LOOP, at(sx, sy)],
          ]
        : sat.flow === 'in'
          ? [
              [0, at(sx, sy)],
              [T + 0.5, at(sx, sy)],
              [T + 1.2, at(hx, hy)],
              [T + 1.3, at(hx, hy)],
              [T + 1.4, at(sx, sy)],
              [LOOP, at(sx, sy)],
            ]
          : [
              [0, at(hx, hy)],
              [T + 0.5, at(hx, hy)],
              [T + 1.2, at(sx, sy)],
              [T + 1.3, at(sx, sy)],
              [T + 1.4, at(hx, hy)],
              [LOOP, at(hx, hy)],
            ];
    const last = sat.flow === 'both' ? T + 1.4 : T + 1.2;
    const glides = s.animate('transform', move);
    const fades = s.animate('opacity', [
      [0, '0'],
      [move[1]?.[0] ?? 0, '0'],
      [(move[1]?.[0] ?? 0) + 0.12, '1'],
      [last - 0.12, '1'],
      [last + 0.05, '0'],
      [LOOP, '0'],
    ]);
    out.push(
      `<g class="a" style="animation-name:${glides},${fades}" opacity="0"><circle r="8" fill="${s.accent}" fill-opacity="0.22"/><circle r="4" fill="${s.accent}"/></g>`,
    );
    // A read leaves the hub as a ring, and lights the card it reaches.
    if (sat.flow === 'out') out.push(ring(T + 0.5));
    if (sat.flow !== 'in') {
      out.push(
        `<rect ${s.goes(
          [
            [0, '0'],
            [last - 0.05, '0'],
            [last + 0.1, '1'],
            [last + 0.6, '0'],
            [LOOP, '0'],
          ],
          '0',
        )} x="${n(x + 0.5)}" y="${n(y + 0.5)}" width="${card.w - 1}" height="${card.h - 1}" rx="10" fill="none" stroke="${s.accent}" stroke-width="3"/>`,
      );
    }
  });

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W_FAMILY}" height="${H_FAMILY}" viewBox="0 0 ${W_FAMILY} ${H_FAMILY}" role="img" aria-label="${attribute(FAMILY_ALT)}">`,
    `<title>${escaped(FAMILY_ALT)}</title>`,
    '<style>',
    `.a{animation-duration:${LOOP}s;animation-iteration-count:infinite;animation-timing-function:ease-in-out}`,
    ...s.css,
    '@media (prefers-reduced-motion: reduce){.a{animation:none!important}}',
    '</style>',
    ...defs,
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
  for (const { dir } of PACKAGE_PICTURES) {
    const readme = `packages/${dir}/README.md`;
    drawn[readme] = withPicture(committedAt(readme), pictureBlock(dir));
  }
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
