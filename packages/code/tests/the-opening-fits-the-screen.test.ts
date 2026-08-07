/**
 * THE OPENING FITS THE SCREEN — how many rows the console spends before the caller has
 * typed anything, and where it leaves the caret.
 *
 * IT CAME OUT OF USE: *"the console's UX is too broken"*. Measured against the reference it
 * was drawn from rather than argued about — this console's own opening, on a real
 * pseudo-terminal, replayed onto a screen (`support/screen.ts`) — and three of the eight
 * defects that measurement found are what this file holds:
 *
 *   - THE OPENING TOOK THE SCREEN. Twenty-two of twenty-four rows on an ordinary terminal,
 *     which leaves TWO for the record a session exists to read. So the count is asserted at
 *     three sizes, and it is a count of what is DRAWN rather than of what was written: a
 *     row that scrolled away is not a row the caller has.
 *   - THE CARET OPENED THREE ROWS BELOW THE PROMPT, and corrected itself on the first
 *     keystroke. That discrepancy is the instrument: the opening and the frame after one
 *     key are compared with each other, so a caret that is wrong in the same way twice
 *     cannot pass by agreeing with itself.
 *   - THE NAME DEGRADED BY WIDTH AND NOT BY HEIGHT. Five rows of art on a terminal four
 *     rows tall is a drawing whose top is in the scrollback before the session has said
 *     anything. The threshold is the drawing's OWN height, and it is searched for here
 *     rather than written down.
 *
 * AND THE ONE ABOUT WHAT WENT: the box had a second section that named the word listing
 * the verbs, and it went — the row under the prompt says where every word is, and it says
 * it in the place that does not scroll away. What may not happen is the INFORMATION going
 * with the copy, so one case opens a session, finds the word nowhere on the page, and then
 * presses the key that lists it.
 */

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CliIo, run } from '../src/cli.js';
import { bannerFor } from '../src/presentation/banner.js';
import { renderPlain } from '../src/presentation/plain.js';
import { theSessionsOwnWords } from '../src/repl/session.js';
import { ABOUT, LEAVE, PREFIX } from '../src/session-words.js';
import { REPL_VERB } from '../src/wiring/repl.js';
import { inPty as drive, type Fixture, type Ran, type Step } from './support/pty.js';
import { screenOf } from './support/screen.js';

/** The built CLI — the same file the `mnema` bin points at. */
const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
/** `packages/code/src`, for the guard that reads the surface's own source. */
const SRC = fileURLToPath(new URL('../src', import.meta.url));

/** What the opening always says, whatever the terminal is like. */
const OPENED = 'a session over this project';
/** What the caller types in front of, as the layout writes it: trimmed at the end. */
const PROMPT = 'mnema>';
/** The caret's home: the prompt and the space after it, which is what a caller types past. */
const AFTER_THE_PROMPT = `${PROMPT} `;

/**
 * The glyphs the drawing is made of: the ink of the tall form, the box's side, and the run
 * a rule is made of.
 *
 * Named by their code points rather than typed, like every other unusual byte in this
 * repository's sources: a rule is one keystroke away from a pipe and a run from a hyphen,
 * and a character a reader cannot tell from a neighbouring one is a character an edit
 * destroys without anybody seeing it happen. A raw Ctrl-C got into the first draft of this
 * very file, which is the twenty-fourth time on this bench.
 */
const INK = '\u2588';
const FRAME = '\u2502';
const RUN = '\u2500';

/** Ctrl-C, which abandons the row being typed. Spelled as an escape, for the same reason. */
const CLEARS_THE_LINE = '\u0003';

// ---------------------------------------------------------------------------
// The fixture
// ---------------------------------------------------------------------------

let sandbox: string;
let project: string;
let environment: NodeJS.ProcessEnv;
const before = { cwd: process.cwd(), env: { ...process.env } };

beforeAll(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-opening-'));
  project = join(sandbox, 'project');
  mkdirSync(project, { recursive: true });
  process.env.HOME = join(sandbox, 'home');
  process.env.XDG_DATA_HOME = join(sandbox, 'data');
  delete process.env.MNEMA_RUN;
  // The bytes a session prints may not depend on the developer's shell.
  delete process.env.NO_COLOR;
  delete process.env.FORCE_COLOR;
  process.chdir(project);

  const io: CliIo = { out: () => undefined, err: () => undefined, fail: () => undefined };
  await run(['init'], io);
  await run(['task', 'the task the opening is counted over'], io);

  environment = {
    ...process.env,
    HOME: join(sandbox, 'home'),
    XDG_DATA_HOME: join(sandbox, 'data'),
    TERM: 'xterm-256color',
  };
  delete environment.MNEMA_RUN;
}, 180_000);

afterAll(() => {
  process.chdir(before.cwd);
  process.env = before.env;
  rmSync(sandbox, { recursive: true, force: true });
});

/** The fixture every case below drives the built binary over. */
const fixture = (): Fixture => ({
  cli: CLI,
  verb: REPL_VERB,
  project,
  scratch: sandbox,
  environment,
});

/** Runs `mnema repl` on a pseudo-terminal of a given size. */
async function inPty(options: {
  readonly columns: number;
  readonly rows: number;
  readonly steps: readonly Step[];
}): Promise<Ran> {
  return drive(fixture(), options);
}

/** The step every session begins with. */
const opens: Step = { until: (bytes) => bytes.includes(PROMPT), what: 'opened its console' };

/** The step every session ends with. */
const leaves: Step = {
  types: `${LEAVE}\r`,
  until: (bytes) => bytes.lastIndexOf(PROMPT) > bytes.indexOf(LEAVE),
  what: 'left',
};

// ---------------------------------------------------------------------------
// The name gives way by height, and the threshold is the drawing's own
// ---------------------------------------------------------------------------

/** The drawing of the name at a size, as the rows a plain renderer writes for it. */
const drawn = (columns: number, rows: number): string[] =>
  bannerFor({ columns, rows }).map(renderPlain);

/** How wide a drawing is: its widest row. */
const widthOf = (form: readonly string[]): number =>
  Math.max(...form.map((row) => [...row].length));

/**
 * A terminal with room for every form of the name, on each measurement.
 *
 * They are the OTHER axis in each case below, held still so that the one under test is the
 * only thing that moves — never a threshold, which is what is searched for.
 */
const WIDE = 200;
const ROOMY = 40;

describe('the name gives way at the height its own drawing stops fitting at', () => {
  it('is drawn and fits at that height, and is gone one row under it', () => {
    // THE THRESHOLD AS A PROPERTY, and nothing in this case knows how tall anything is. The
    // biggest form is whatever a terminal with room for everything answers with; the height
    // it gives way at is SEARCHED FOR, from the bottom, so a drawing that changes tomorrow
    // moves the case with it.
    const biggest = drawn(WIDE, ROOMY);
    const heights = Array.from({ length: ROOMY }, (_, at) => at + 1);
    const edge = heights.find((rows) => drawn(WIDE, rows).join('\n') === biggest.join('\n'));
    expect(edge, 'no height in the range draws the biggest form').toBeDefined();
    const gaveWay = edge as number;

    // AT THE EDGE: it is drawn, and it FITS — the whole of what the height rule is for.
    expect(drawn(WIDE, gaveWay)).toEqual(biggest);
    expect(
      biggest.length,
      'the drawing is taller than the terminal it was chosen for',
    ).toBeLessThanOrEqual(gaveWay);
    // ONE ROW UNDER IT: it is gone.
    expect(drawn(WIDE, gaveWay - 1)).not.toEqual(biggest);
    // AND THE THRESHOLD IS THE DRAWING'S OWN HEIGHT rather than a number anybody chose,
    // which is the same shape the width rule has (`tests/the-name-and-the-hints.test.ts`).
    expect(gaveWay).toBe(biggest.length);
    // Not vacuous: the biggest form really is more than one row, or every height above
    // would answer the same thing and the search would have found the floor.
    expect(biggest.length).toBeGreaterThan(1);
  });

  it('says the name at every height there is, including ones no terminal has', () => {
    // THE FLOOR, on this axis as on the other. A terminal too short for one row is a
    // terminal with nowhere to put a prompt, so there is no height that draws nothing.
    //
    // SAID AS THE PROMISE RATHER THAN AS THE VALUE: what a short terminal gets is a
    // DRAWING of the name — letterspaced on a wide screen, typed on a narrow one — so what
    // is asserted is that the name is in it, whichever drawing it is. The blanks come out
    // because letterspacing is spaces, which is the whole of what that form is.
    for (const rows of [4, 3, 2, 1, 0]) {
      const form = drawn(WIDE, rows);
      expect(form.length, `${rows}`).toBe(1);
      expect(form.join('').split(' ').join('').toLowerCase(), `${rows}`).toContain('mnema');
    }
    // Not vacuous: the height really is what chose those, and a taller terminal answers
    // with something else.
    expect(drawn(WIDE, ROOMY).length).toBeGreaterThan(1);
  });

  it('never answers with a form that does not fit, at any size on the grid', () => {
    // THE ADVERSARIAL QUESTION, ASKED OVER BOTH AXES AT ONCE: is there a size where the two
    // measurements disagree and something is drawn that the terminal cannot hold? The
    // answer has to be a property of every pair, including the sizes where nothing fits —
    // there the floor is answered, and the floor is the name.
    const floor = drawn(0, 0);
    let chose = 0;
    let fellToTheFloor = 0;
    for (const columns of [0, 1, 5, 8, 9, 10, 28, 29, 30, 60, WIDE]) {
      for (const rows of [0, 1, 2, 4, 5, 6, 24, ROOMY]) {
        const form = drawn(columns, rows);
        const fits = widthOf(form) <= columns && form.length <= rows;
        if (fits) {
          chose += 1;
          continue;
        }
        // The only thing that may be drawn without fitting is the floor, and it is the one
        // thing that may never be dropped.
        expect(form, `${columns}x${rows}`).toEqual(floor);
        fellToTheFloor += 1;
      }
    }
    // NOT VACUOUS IN EITHER DIRECTION: the grid really contains sizes where a form was
    // chosen and sizes where nothing fitted, so neither branch is being skipped.
    expect(chose, 'nothing fitted anywhere on the grid').toBeGreaterThan(10);
    expect(fellToTheFloor, 'everything fitted everywhere').toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// The count: how much of the screen the console spends before a caller types
// ---------------------------------------------------------------------------

/**
 * WHAT THE CONSOLE SPENDS BEFORE THE CALLER HAS TYPED ANYTHING, at three sizes — measured
 * on a real terminal, and the number this delivery exists to move.
 *
 * `was` is what the same measurement answered before it, at the commit this file was
 * written against, and it is here so the direction is asserted rather than remembered.
 * `takes` is a MEASURING STICK: it is not derived from anything, so a delivery that adds a row to the
 * opening has to come here and say so, which is the whole point of writing it down.
 *
 * The three sizes are the ordinary one (eighty by twenty-four, which is the size every
 * terminal has had since before they were on screens), a common laptop window, and a large
 * one — the last because a count that only improved where the defect was measured is a
 * count that moved a case rather than the product.
 */
const THE_SCREEN: readonly { columns: number; rows: number; takes: number; was: number }[] = [
  { columns: 80, rows: 24, takes: 18, was: 22 },
  { columns: 100, rows: 30, takes: 18, was: 22 },
  { columns: 120, rows: 40, takes: 14, was: 15 },
];

/** How many rows from the top of a screen have anything on them. */
function rowsDrawn(screen: { readonly rows: readonly string[] }): number {
  return screen.rows.map((row) => row.trim().length > 0).lastIndexOf(true) + 1;
}

describe('the console leaves the screen to the record it was opened over', () => {
  for (const { columns, rows, takes, was } of THE_SCREEN) {
    it(`spends ${takes} rows of ${rows} at ${columns} columns, and leaves ${rows - takes}`, async () => {
      const ran = await inPty({ columns, rows, steps: [opens, leaves] });
      const screen = screenOf(ran.bytes.slice(0, ran.at[0] as number), columns, rows);
      // The instrument first: there really is an opening on that screen, and a prompt.
      expect(screen.text, `${columns}x${rows}: the session never opened`).toContain(OPENED);
      expect(screen.text, `${columns}x${rows}: no prompt`).toContain(PROMPT);

      const drawnRows = rowsDrawn(screen);
      expect(drawnRows, `${columns}x${rows}: what the console spends`).toBe(takes);
      expect(rows - drawnRows, `${columns}x${rows}: what is left for the record`).toBe(
        rows - takes,
      );
      // AND IT WENT DOWN. The count before this delivery, at the same size, on the same
      // fixture — so the direction is part of the assertion rather than part of a report.
      expect(drawnRows, `${columns}x${rows}: the opening did not get smaller`).toBeLessThan(was);
    }, 180_000);
  }
});

// ---------------------------------------------------------------------------
// The caret opens where the caller is going to type
// ---------------------------------------------------------------------------

describe('the caret opens on the prompt, and the first keystroke does not move it there', () => {
  it('is on the row being typed before a key is pressed, and on the same row after one', async () => {
    // THE DEVICE THAT FOUND THE DEFECT. Measured at a hundred by thirty: the caret opened on
    // row 15 while the prompt was on row 12 — three rows below, where a terminal leaves it
    // after the last row of a frame — and the first keystroke corrected it. So the two
    // frames are compared WITH EACH OTHER: a case that only asked the opening could pass on
    // a console whose caret is wrong in the same way twice, and one that only asked the
    // frame after a key would have passed all along.
    const columns = 100;
    const rows = 30;
    const typed = 'v';
    const ran = await inPty({
      columns,
      rows,
      steps: [
        opens,
        {
          types: typed,
          until: (bytes) => bytes.includes(`${AFTER_THE_PROMPT}${typed}`),
          what: 'echoed what was typed',
        },
        { types: CLEARS_THE_LINE, until: (bytes) => bytes.length > 0, what: 'abandoned the row' },
        leaves,
      ],
    });
    const at = (step: number) =>
      screenOf(ran.bytes.slice(0, ran.at[step] as number), columns, rows);
    const opening = at(0);
    const pressed = at(1);

    const promptRow = (screen: { readonly rows: readonly string[] }): number =>
      screen.rows.map((row) => row.includes(PROMPT)).lastIndexOf(true);
    expect(promptRow(opening), 'nothing on the opening is being typed on').toBeGreaterThan(0);

    // THE PROMISE: on both frames the caret is on the row the prompt is on, and it is just
    // past the prompt — where the caller's next character goes.
    expect(opening.cursor.row, 'the caret does not open on the prompt').toBe(promptRow(opening));
    expect(opening.cursor.column, 'the caret does not open past the prompt').toBe(
      [...AFTER_THE_PROMPT].length,
    );
    expect(pressed.cursor.row, 'the caret left the row after one key').toBe(promptRow(pressed));

    // AND THE TWO FRAMES AGREE, which is the discrepancy this case is made of: they used to
    // differ by exactly the rows the input area draws over the prompt.
    expect(pressed.cursor.row - promptRow(pressed)).toBe(opening.cursor.row - promptRow(opening));
    // Not vacuous: something really is drawn over the row being typed, so a caret left at
    // the end of the frame would have landed somewhere else.
    expect(promptRow(opening)).toBeGreaterThan(0);
    expect(rowsDrawn(opening)).toBeGreaterThan(promptRow(opening));
  }, 180_000);
});

// ---------------------------------------------------------------------------
// What the box stopped saying is one keystroke away
// ---------------------------------------------------------------------------

describe('the word the box named is still there, behind the key that lists the words', () => {
  it('is nowhere on the opening, and on the screen as soon as the key is pressed', async () => {
    // WHAT THE SECOND SECTION TOOK WITH IT, asked as both halves in ONE run. The box used
    // to carry a section saying that a word lists the verbs; it was the third place this
    // console said so, and the only one a caller cannot get back to after ten reads. What
    // may not happen is the word becoming unreachable — so the same session is asked for it.
    const columns = 100;
    const rows = 40;
    const listed = theSessionsOwnWords().find((entry) => entry.word === ABOUT);
    expect(listed, `${ABOUT} is not one of the session's own words`).toBeDefined();
    const gloss = (listed as { description: string }).description;
    expect(gloss.length, 'the word has nothing to be listed with').toBeGreaterThan(3);

    const ran = await inPty({
      columns,
      rows,
      steps: [
        opens,
        {
          types: PREFIX,
          until: (bytes) => bytes.includes(gloss),
          what: 'listed the words the session answers to',
        },
        { types: CLEARS_THE_LINE, until: (bytes) => bytes.length > 0, what: 'abandoned the row' },
        leaves,
      ],
    });
    const opening = screenOf(ran.bytes.slice(0, ran.at[0] as number), columns, rows);
    const asked = screenOf(ran.bytes.slice(0, ran.at[1] as number), columns, rows);

    // The instrument first: the opening really is on the screen.
    expect(opening.text, 'the session never opened').toContain(OPENED);
    // GONE FROM THE PAGE: neither the word nor the sentence the section said about it.
    expect(opening.text, `the opening still names ${ABOUT}`).not.toContain(ABOUT);
    expect(opening.text, 'the opening still carries the section').not.toContain(gloss);
    // AND ONE KEYSTROKE AWAY: the key the hint names opens the list, and the word is in it
    // with what it does beside it.
    expect(asked.text, `${PREFIX} did not list ${ABOUT}`).toContain(ABOUT);
    expect(asked.text, `${ABOUT} was listed without what it does`).toContain(gloss);
  }, 180_000);
});

// ---------------------------------------------------------------------------
// A1: everything that chooses an arrangement by the size of the terminal
// ---------------------------------------------------------------------------

/** Every `.ts` source of the product, recursively, tests excluded. */
function sourcesOf(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sourcesOf(path));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) found.push(path);
  }
  return found;
}

/** A source with its comments taken out, so prose cannot be read as code. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

/**
 * Whether a source RULES ON a measurement of the terminal — the discriminant, and it is a
 * comparison rather than a mention.
 *
 * Twenty-two modules of this surface name a width or a height; four decide something with
 * one. What tells them apart is the comparison itself: `<= columns` is a module asking
 * whether something fits, and every other mention is a module passing a number along.
 */
function rulesOnTheSize(source: string): boolean {
  return /(<=|<|>=|>)\s*(?:request\.)?(?:columns|rows)\b/.test(withoutComments(source));
}

describe('everything that chooses a shape by the size of the terminal is one of four', () => {
  it('is these four modules, and a fifth would be accused', () => {
    // A1, BY THE DISCRIMINANT AND NOT BY A LIST FROM A HANDOFF. The rule this delivery
    // extends — *a form gives way at its own measurement, never at a number somebody chose*
    // — is applied in more than one place, so the places are FOUND rather than recalled.
    //
    // ⚠️ THE FOURTH IS THE ACHADO. The design of this delivery counted three: the name by
    // width, the panel by width, the input area by height. The palette is the fourth, and
    // it rules the same way — a row the terminal would fold is not drawn, and the threshold
    // is the row's own width.
    //
    // Each has a case that pins its threshold to the content:
    //   - `presentation/banner.ts`  — width: `the-name-and-the-hints.test.ts`; height: here.
    //   - `repl/panel.ts`           — `the-panel.test.ts`, at the width its content stops
    //                                  fitting at, and one column under it.
    //   - `repl/area.ts`            — `the-input-has-its-own-place.test.ts`, the ladder and
    //                                  the boundary that moves with the hint's own width.
    //   - `repl/palette.ts`         — `a-palette-for-the-words.test.ts`, over a grid of
    //                                  every room and every width.
    const ruling = sourcesOf(SRC)
      .filter((file) => rulesOnTheSize(readFileSync(file, 'utf-8')))
      .map((file) => file.slice(SRC.length + 1))
      .sort();
    expect(ruling).toEqual(
      [
        join('presentation', 'banner.ts'),
        join('repl', 'area.ts'),
        join('repl', 'palette.ts'),
        join('repl', 'panel.ts'),
      ].sort(),
    );
    // The scan read something, and it would accuse a fifth module: the line somebody would
    // write to add one, and the two shapes that must NOT be accused — a module that only
    // carries a size, and prose about one.
    expect(sourcesOf(SRC).length).toBeGreaterThan(50);
    expect(rulesOnTheSize('const form = widthOf(drawing) <= columns ? drawing : nothing;')).toBe(
      true,
    );
    expect(rulesOnTheSize('const area = areaFor({ rows, columns, badge: 0 });')).toBe(false);
    expect(rulesOnTheSize('/* a form gives way when it is wider than columns */')).toBe(false);
  });

  it('and the name is the only one that rules on both', () => {
    // WHAT THIS DELIVERY CHANGED, said as a property of the source: the panel rules on a
    // width, the area and the palette on what they were already ruling on, and the name is
    // the one place that had to learn a second measurement — because it is the one drawing
    // that is neither reflowed nor scrolled.
    const rulesOn = (file: string, what: 'columns' | 'rows'): boolean =>
      new RegExp(`(<=|<|>=|>)\\s*(?:request\\.)?${what}\\b`).test(
        withoutComments(readFileSync(join(SRC, file), 'utf-8')),
      );
    const banner = join('presentation', 'banner.ts');
    expect(rulesOn(banner, 'columns'), 'the name stopped ruling on the width').toBe(true);
    expect(rulesOn(banner, 'rows'), 'the name does not rule on the height').toBe(true);
    expect(rulesOn(join('repl', 'panel.ts'), 'rows'), 'the panel started ruling on height').toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// The drawing is what the page follows: nothing is drawn inside the box
// ---------------------------------------------------------------------------

describe('the box has one section in it, and the art is the only thing drawn', () => {
  it('holds no run of glyphs of its own on an ordinary terminal', async () => {
    // THE OTHER HALF OF WHAT THE SECOND SECTION TOOK: the rule that divided it from the
    // record. It measured its SIBLINGS rather than the column it looked like it divided —
    // 45 columns inside a column of 61, measured at 120 — and it went with the section
    // rather than being fixed, because one section has nothing to be divided from.
    //
    // Asked at eighty columns, where the box is STACKED and the drawing of the name is the
    // only run of glyphs inside the frame. `tests/the-page-follows-the-terminal.test.ts`
    // asks the same thing of the two-column form.
    const columns = 80;
    const rows = 24;
    const ran = await inPty({ columns, rows, steps: [opens, leaves] });
    const screen = screenOf(ran.bytes.slice(0, ran.at[0] as number), columns, rows);
    expect(screen.text, 'the session never opened').toContain(OPENED);
    // Every row of the box, which is every row between the frame's two ends.
    const inside = screen.rows.filter((row) => row.startsWith(FRAME));
    expect(inside.length, 'the box has no rows').toBeGreaterThan(3);
    for (const row of inside) {
      const middle = row.slice(1, -1);
      expect(
        [...middle].some((glyph) => glyph === RUN),
        `a run of glyphs is drawn inside the box: ${row}`,
      ).toBe(false);
    }
    // Not vacuous: the art really is inside the box, so the rows being read are the box's.
    expect(
      inside.some((row) => row.includes(INK)),
      'the mark is not inside the box',
    ).toBe(true);
  }, 180_000);
});
