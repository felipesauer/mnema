// Draws the front page's pictures: `docs/assets/banner-{dark,light}.svg`,
// `docs/assets/how-it-works-{dark,light}.svg` and the animated
// `docs/assets/how-mnema-fits-{dark,light}.svg`.
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

import { readFileSync, writeFileSync } from 'node:fs';
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
 */
function keyframes(name, property, stops) {
  const at = stops.map(([t, v]) => `${n((t / LOOP) * 100)}%{${property}:${v}}`).join('');
  return `@keyframes ${name}{${at}}`;
}

/**
 * An opacity that is 0 outside [from, to], fading over `fade` seconds at each end.
 * @param {number} from
 * @param {number} to
 * @param {number} [fade]
 * @returns {[number, string][]}
 */
function shown(from, to, fade = 0.3) {
  return [
    [0, '0'],
    [from, '0'],
    [from + fade, '1'],
    [to - fade, '1'],
    [to, '0'],
    [LOOP, '0'],
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
  };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const built = new URL('../../packages/code/dist/presentation/banner.js', import.meta.url);
  const { THE_BLOCKS } = await import(built.href);
  const check = process.argv.includes('--check');
  let differs = 0;
  for (const [file, svg] of Object.entries(drawTheFrontPage(THE_BLOCKS))) {
    const at = new URL(`../../docs/assets/${file}`, import.meta.url);
    if (check) {
      let committed = '';
      try {
        committed = readFileSync(at, 'utf8');
      } catch {}
      if (committed !== svg) {
        differs++;
        console.error(`docs/assets/${file} is not what the console draws today`);
      }
    } else {
      writeFileSync(at, svg);
      console.log(`wrote docs/assets/${file}`);
    }
  }
  if (differs > 0) process.exit(1);
}
