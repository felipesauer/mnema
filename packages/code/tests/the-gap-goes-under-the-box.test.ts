/**
 * THE EMPTINESS GOES UNDER THE BOX — and the anchor follows the area, which changes height
 * while a session is running.
 *
 * The input sits on the last row the layout leaves, and what puts it there is as many rows with
 * nothing on them as the page has to spare (`repl/page.ts`). ⚠️ THEY WENT OVER THE OPENING, and
 * that was written down as *the blank rows go BEFORE the opening, so what the session says fills
 * the page downwards*. Both halves of the sentence were true and the page was still wrong:
 * measured on a real terminal at a hundred and twenty by forty, it opened with TWENTY-ONE empty
 * rows at the top and the box shoved down against the input, so the first thing a reader looks at
 * was the last thing on the screen. What was falsified is not the anchoring but the DIRECTION,
 * and the rows go under the flow now.
 *
 * THE SECOND HALF IS THE ONE THAT WAS MISSING ALTOGETHER, and it is a defect this file is the
 * first to ask about: the area is not one height. The palette opens on a keystroke and shuts on
 * the next one, and the badge and the hint come and go with the width of a window. Growing needs
 * nothing — a frame that will not fit scrolls the screen, and the terminal puts the area back at
 * the foot by itself. SHRINKING un-scrolls nothing: measured at a hundred and twenty by forty, a
 * palette opened and shut left the input twenty-one rows above the foot with a hole under it.
 *
 * FIVE THINGS ARE ASKED HERE, and the last three of them are asked of a real pseudo-terminal:
 *
 *   - THE ARITHMETIC, which is one subtraction with two callers — a page that counts its own
 *     flow, and a frame that knows where the flow ENDS because the area was anchored against it.
 *   - THE BYTES A PAGE IS TURNED WITH, which no longer place it: the leftover cannot be written
 *     there, because the opening is drawn after them and nothing written there can land under it.
 *   - THE ORDER ON THE SCREEN: the box, then the emptiness, then the input.
 *   - THE PALETTE, OPENED AND SHUT, which is the defect above and the case this file is for.
 *   - ⛔ AND THAT THE REGION THE LAYOUT REDRAWS DID NOT GROW, from both ends. The rows are lines
 *     of the FLOW; in the region instead, they would walk it into the height at which this
 *     library gives up on redrawing part of a screen and writes the erase that takes the
 *     caller's history with it.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CliIo, run } from '../src/cli.js';
import { BELOW_THE_VIEWPORT } from '../src/repl/area.js';
import {
  blankRows,
  carriedIntoTheScrollback,
  type ThePage,
  theFlowAbove,
  theGap,
} from '../src/repl/page.js';
import { LEAVE } from '../src/session-words.js';
import { VERSION } from '../src/version.js';
import { REPL_VERB } from '../src/wiring/repl.js';
import { ESC } from './support/console.js';
import {
  aFrameAfter,
  inPty as drive,
  type Fixture,
  opensAConsole,
  type Ran,
  type Step,
} from './support/pty.js';
import {
  endsAtTheFoot,
  firstDrawnRow,
  promptRow,
  type Screen,
  screenOf,
  theGapOn,
} from './support/screen.js';

/** The built CLI — the same file the `mnema` bin points at. */
const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

/** What the caller types in front of, as the layout writes it: trimmed at the end. */
const PROMPT = 'mnema>';

/** The box's top-left corner, named by its code point rather than typed. */
const TOP_LEFT = '╭';

/** The box's bottom-left corner — the last row of the opening's own drawing. */
const BOTTOM_LEFT = '╰';

/** What the opening always says, whatever the terminal is like. */
const OPENED = 'a session over this project';

/** A word only the palette shows, so a screen can be asked whether the list is open. */
const ONLY_THE_LIST_SAYS = 'start the page over';

/**
 * HOW MANY ROWS OF THE INPUT AREA ARE DRAWN ABOVE THE ROW BEING TYPED, in its tallest form: the
 * badge in the corner, and the rule under it (`repl/area.ts`, `aboveIn`).
 *
 * It is here so that a case can say *nothing of the page is left above the input* without saying
 * a row number: the first drawn row of a screen whose flow has entirely scrolled away is the
 * area's own first row, which is this many above the prompt.
 */
const ABOVE_THE_TYPED_ROW = 2;

// ---------------------------------------------------------------------------
// The arithmetic: one subtraction, two callers
// ---------------------------------------------------------------------------

describe('the gap is what the flow does not fill', () => {
  it('answers one row fewer for every row the flow, the area or the screen takes', () => {
    // THE SUBTRACTION, and it is the only place an off-by-one in the SAFE direction can be
    // caught. One row too many is invisible on a screen — the layout's own newline scrolls the
    // page back into exactly the same place — and what it costs is one row of the caller's
    // history carried away for nothing.
    const page: ThePage = { rows: 30, flow: 17, area: 5 };
    expect(theGap(page)).toBe(30 - 17 - 5 - BELOW_THE_VIEWPORT);
    // Not a coincidence of one arrangement: every number in it moves the answer one for one.
    expect(theGap({ ...page, rows: 31 })).toBe(31 - 17 - 5 - BELOW_THE_VIEWPORT);
    expect(theGap({ ...page, flow: 21 })).toBe(30 - 21 - 5 - BELOW_THE_VIEWPORT);
    expect(theGap({ ...page, area: 6 })).toBe(30 - 17 - 6 - BELOW_THE_VIEWPORT);
  });

  it('gives a page that already fills the screen nothing at all', () => {
    // AND IT IS NOT A NEW BRANCH: nothing fits into a negative number of rows, so a terminal
    // with no room over the flow gets what it got before there was an anchor, which is none.
    for (const rows of [3, 5, 22]) expect(theGap({ rows, flow: 17, area: 5 })).toBe(0);
    // Including the exact boundary, where the leftover is nothing rather than negative.
    expect(theGap({ rows: 23, flow: 17, area: 5 })).toBe(0);
    // And a terminal that reported no height at all is answered with nothing either.
    expect(theGap({ rows: 0, flow: 0, area: 0 })).toBe(0);
    // Not vacuous: one row over the boundary really is one row of leftover, so the answers
    // above are the absence of a gap rather than a function that never finds one.
    expect(theGap({ rows: 24, flow: 17, area: 5 })).toBe(1);
  });

  it('⚠️ cancels the height for the caller that knows where the flow ENDS', () => {
    // THE SECOND CALLER, and this is what makes it the same subtraction rather than a second
    // one: a frame whose area gave rows back does not count its flow, it knows the flow ends
    // where the area was anchored against it. Handed that, what is left over is the difference
    // between the two areas — and the WINDOW cancels, which is what keeps a caller who resized
    // in the same breath from being answered with rows they did not ask for.
    for (const rows of [24, 40, 120]) {
      expect(theGap({ rows, flow: theFlowAbove(rows, 25), area: 5 })).toBe(20);
      expect(theGap({ rows, flow: theFlowAbove(rows, 6), area: 5 })).toBe(1);
      // AND GROWING ASKS FOR NOTHING, which is the other half of why this is asked on every
      // frame: the terminal scrolls a frame that will not fit and puts the area back itself.
      expect(theGap({ rows, flow: theFlowAbove(rows, 5), area: 25 })).toBe(0);
      // And an area that did not move asks for nothing, which is every other frame there is.
      expect(theGap({ rows, flow: theFlowAbove(rows, 5), area: 5 })).toBe(0);
    }
  });

  it('hands the layout that many lines with nothing on them', () => {
    expect(blankRows(3)).toEqual(['', '', '']);
    expect(blankRows(0)).toEqual([]);
    // ⛔ THEY ARE LINES AND NOT BYTES, which is what keeps them out of the region: there is
    // nothing in one that moves a cursor, erases a row or scrolls a screen. What makes a row of
    // them is the layout drawing a line with nothing on it (`repl/region.ts`).
    expect(blankRows(40).join('')).toBe('');
  });

  it('⚠️ carries the page away and no longer places it, byte for byte', () => {
    // THE GUARD THAT THE LEFTOVER LEFT THESE BYTES. It used to end with them, and that is what
    // put the emptiness at the top of the screen: the opening is the LAYOUT's to draw and it is
    // drawn after these bytes, so a row written here can only ever land above the box. What is
    // left is the cursor on the last row, a page's worth of rows that scroll, and back to the
    // top — and nothing else at any height.
    for (const rows of [3, 24, 40]) {
      expect(carriedIntoTheScrollback(rows)).toBe(`${ESC}[${rows};1H${'\n'.repeat(rows)}${ESC}[H`);
    }
    // A terminal that reported no height gets nothing rather than a guess.
    expect(carriedIntoTheScrollback(0)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// The fixture
// ---------------------------------------------------------------------------

let sandbox: string;
let project: string;
let environment: NodeJS.ProcessEnv;
const before = { cwd: process.cwd(), env: { ...process.env } };

/** `mnema <argv>` at the shell, in this process. */
async function shell(...argv: string[]): Promise<void> {
  const io: CliIo = { out: () => undefined, err: () => undefined, fail: () => undefined };
  await run(argv, io);
}

beforeAll(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-gap-'));
  project = join(sandbox, 'project');
  mkdirSync(project, { recursive: true });
  process.env.HOME = join(sandbox, 'home');
  process.env.XDG_DATA_HOME = join(sandbox, 'data');
  delete process.env.MNEMA_RUN;
  // The bytes a session prints may not depend on the developer's shell.
  delete process.env.NO_COLOR;
  delete process.env.FORCE_COLOR;
  process.chdir(project);
  await shell('init');
  environment = {
    ...process.env,
    HOME: join(sandbox, 'home'),
    XDG_DATA_HOME: join(sandbox, 'data'),
    TERM: 'xterm-256color',
  };
  delete environment.MNEMA_RUN;
}, 240_000);

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
const opens: Step = opensAConsole(PROMPT);

/** The step every session ends with. */
const leaves: Step = {
  types: `${LEAVE}\r`,
  until: (bytes) => bytes.lastIndexOf(PROMPT) > bytes.indexOf(LEAVE),
  what: 'left',
};

/** What abandons the row being typed, spelled by its code point rather than typed. */
const ABANDONS_THE_LINE = '\u0003';

/** What takes the last key back off the row being typed. */
const RUBS_OUT = '\u007f';

/** The key that opens the palette, which is also the one the hint names. */
const LISTS_THE_WORDS = '/';

/** Opens the list of words, which is the area at its tallest. */
const opensTheList: Step = { types: LISTS_THE_WORDS, until: aFrameAfter(PROMPT), what: 'listed' };

/** Shuts it again, by taking back the key that opened it. */
const shutsTheList: Step = { types: RUBS_OUT, until: aFrameAfter(PROMPT), what: 'shut the list' };

/** How many times `what` occurs in `text`. */
const times = (text: string, what: string): number => text.split(what).length - 1;

/** Which row the box's last one is, and −1 when the box is not on the screen at all. */
function boxEndsOn(screen: Screen): number {
  return screen.rows.findIndex((row) => row.includes(BOTTOM_LEFT));
}

/** How many rows above the row being typed have nothing at all on them. */
function emptyRowsAbove(screen: Screen): number {
  return screen.rows.slice(0, promptRow(screen, PROMPT)).filter((row) => row.trim().length === 0)
    .length;
}

// ---------------------------------------------------------------------------
// The order on the screen: the box, the emptiness, the input
// ---------------------------------------------------------------------------

describe('the box opens at the top and the emptiness goes under it', () => {
  // Three sizes: the one every terminal has had since before they were on screens, a common
  // laptop window, and a large one — the last because a page whose emptiness only moved where
  // the defect was photographed is a page that moved a case rather than the product.
  for (const [columns, rows] of [
    [80, 24],
    [100, 30],
    [120, 40],
  ] as const) {
    it(`opens with the box on the first row of ${columns}x${rows}`, async () => {
      const ran = await inPty({ columns, rows, steps: [opens, leaves] });
      const screen = screenOf(ran.bytes.slice(0, ran.at[0] as number), columns, rows);
      expect(screen.text, `${columns}x${rows}: the session never opened`).toContain(OPENED);
      // NOTHING IS ABOVE THE BOX, which is the inversion: the page began as far down the screen
      // as the leftover was long, and it begins at the top now.
      expect(firstDrawnRow(screen), `${columns}x${rows}: the page does not begin at the top`).toBe(
        0,
      );
      expect(screen.rows[0], `${columns}x${rows}: the first row is not the box's`).toContain(
        TOP_LEFT,
      );
      // AND THE EMPTINESS IS UNDER IT: it begins below the box's last row and it ends where the
      // input area begins, which is what makes it the leftover rather than a gap in the drawing.
      const gap = theGapOn(screen, PROMPT);
      expect(
        gap,
        `${columns}x${rows}: nothing was left over, so nothing was anchored`,
      ).toBeGreaterThan(0);
      const emptyFrom = screen.rows.findIndex((row) => row.trim().length === 0);
      expect(emptyFrom, `${columns}x${rows}: the emptiness is above the box`).toBeGreaterThan(
        boxEndsOn(screen),
      );
      // AND IT IS ONE RUN AND NOT SEVERAL: everything above the input with nothing on it is the
      // run that touches the input. A page with emptiness anywhere else is a page placed twice.
      expect(emptyRowsAbove(screen), `${columns}x${rows}: the emptiness is in two places`).toBe(
        gap,
      );
      // And the input is still on the last row the layout leaves, which is the promise the
      // direction of these rows may not cost (`the-prompt-sits-at-the-foot.test.ts`).
      endsAtTheFoot(screen, rows, `${columns}x${rows}`);
    }, 240_000);
  }

  it('⚠️ lands what the session says UNDER the emptiness, and takes it off the top', async () => {
    // WHAT "THE EMPTINESS GOES BY ITSELF" REALLY IS, measured rather than claimed. The rows are
    // the flow's and the flow is written once, so a line the session says cannot be put INTO
    // them — it lands under them, and the whole page moves up by one. So the emptiness is not
    // filled in: it leaves the screen from the TOP, one row per row said, and a page long enough
    // to fill the screen has none (`the-prompt-sits-at-the-foot.test.ts` reads that end of it).
    //
    // WHAT IT COSTS IS NAMED HERE because it is the other side of the trade this delivery made:
    // an anchored page fills the screen by construction, so the FIRST row the session says
    // carries the box's top row into the scrollback even though a third of the screen is empty.
    const columns = 120;
    const rows = 40;
    const typed = 'verify';
    const ran = await inPty({
      columns,
      rows,
      steps: [
        opens,
        { types: typed, until: (bytes) => bytes.includes(`${PROMPT} ${typed}`), what: 'echoed' },
        // ABANDONED RATHER THAN RUN, because what this case needs is exactly ONE line landed:
        // the row being typed is landed as it stands and nothing answers it.
        { types: ABANDONS_THE_LINE, until: aFrameAfter(PROMPT), what: 'abandoned the line' },
        leaves,
      ],
    });
    const opened = screenOf(ran.bytes.slice(0, ran.at[0] as number), columns, rows);
    const said = screenOf(ran.bytes.slice(0, ran.at[2] as number), columns, rows);
    // THE LINE REALLY LANDED, and it landed under the emptiness: what is directly above the
    // input is what the session said, so the run that was there is not there any more.
    expect(said.text, 'the abandoned line never landed').toContain(`${PROMPT} ${typed}`);
    expect(theGapOn(opened, PROMPT), 'the page opened with nothing left over').toBeGreaterThan(0);
    // THE LINE IS BELOW THE EMPTINESS, which is the direction: the rows are the flow's and the
    // flow is written once, so the row it landed on is under the last of them.
    const landedOn = said.rows.findIndex((row) => row.includes(`${PROMPT} ${typed}`));
    const emptyFrom = said.rows.findIndex((row) => row.trim().length === 0);
    expect(landedOn, 'the line landed above the emptiness').toBeGreaterThan(emptyFrom);
    // AND THE EMPTINESS IS STILL AS LONG AS IT WAS, one row further up: it was not filled in, the
    // page moved. This is what "it goes by itself" costs and what it means.
    expect(theGapOn(said, PROMPT), 'the emptiness was filled in rather than moved').toBe(
      theGapOn(opened, PROMPT),
    );
    expect(boxEndsOn(said), 'the page did not move up by the row it said').toBe(
      boxEndsOn(opened) - 1,
    );
    // And the input is where it was through all of it.
    endsAtTheFoot(opened, rows, 'the page that opened');
    endsAtTheFoot(said, rows, 'the page with a line on it');
  }, 240_000);
});

// ---------------------------------------------------------------------------
// The anchor follows the area, which changes height under a session
// ---------------------------------------------------------------------------

describe('the anchor follows the area and not only the page', () => {
  it('⚠️ opens the list of words and shuts it, and the input comes back to the foot', async () => {
    // THE CASE THIS FILE IS FOR. The area is anchored once, when the page is placed, and its
    // HEIGHT changes on a keystroke: the palette is as many rows as there are words to show.
    // Growing is answered by the terminal, which scrolls a frame that will not fit and leaves
    // the area at the foot. Shrinking is answered by nobody — measured, before this: the list
    // shut and the input stayed twenty-one rows above the foot, with an empty hole under it, on
    // a page nothing was wrong with a keystroke earlier.
    const columns = 120;
    const rows = 40;
    const ran = await inPty({
      columns,
      rows,
      steps: [opens, opensTheList, shutsTheList, leaves],
    });
    const opened = screenOf(ran.bytes.slice(0, ran.at[0] as number), columns, rows);
    const listed = screenOf(ran.bytes.slice(0, ran.at[1] as number), columns, rows);
    const shut = screenOf(ran.bytes.slice(0, ran.at[2] as number), columns, rows);
    // THE LIST REALLY OPENED AND REALLY SHUT, or the three screens are one screen read thrice.
    expect(listed.text, 'the list never opened').toContain(ONLY_THE_LIST_SAYS);
    expect(shut.text, 'the list is still open').not.toContain(ONLY_THE_LIST_SAYS);
    expect(opened.text, 'the list was open before a key was pressed').not.toContain(
      ONLY_THE_LIST_SAYS,
    );
    // AND ALL THREE END ON THE LAST ROW THE LAYOUT LEAVES — the one it grew into, and the one it
    // came back from, which is the half that was missing.
    endsAtTheFoot(opened, rows, 'the page that opened');
    endsAtTheFoot(listed, rows, 'the page with the list open');
    endsAtTheFoot(shut, rows, 'the page after the list was shut');
  }, 240_000);

  it('⚠️ costs the rows it gives back, and asks for them once per shutting', async () => {
    // WHAT S-b2 COSTS, ASSERTED RATHER THAN CLAIMED, because it is the price of the fix and not
    // a detail: a list twenty rows tall pushes twenty rows of the page into the scrollback when
    // it opens — which it did before this delivery too — and the rows that come back when it
    // shuts are EMPTY ones, because the flow is written once and what went up cannot be pulled
    // down. So a caller who opens and shuts the list twice has spent the box.
    //
    // The alternative is reemitting the whole page on every keystroke that opens a list, which
    // is linear in what the session has said (measured at about 33 ms over 200 lines) and
    // flickers. This is the trade, and this is the number.
    const columns = 120;
    const rows = 40;
    const ran = await inPty({
      columns,
      rows,
      steps: [opens, opensTheList, shutsTheList, opensTheList, shutsTheList, leaves],
    });
    const opened = screenOf(ran.bytes.slice(0, ran.at[0] as number), columns, rows);
    const twice = screenOf(ran.bytes.slice(0, ran.at[4] as number), columns, rows);
    endsAtTheFoot(twice, rows, 'the page after the list was shut twice');
    // THE BOX IS GONE, and every row above the input has nothing on it: that is the cost, in
    // full, at this geometry. What the page opened with was a box and a leftover.
    expect(boxEndsOn(opened), 'the page opened without a box').toBeGreaterThan(0);
    expect(boxEndsOn(twice), 'the box survived two openings of the list').toBe(-1);
    // AND NOTHING OF THE FLOW IS LEFT ABOVE THE INPUT: the first row with anything on it is the
    // area's own, so everything over it is a row the page was placed with.
    expect(firstDrawnRow(twice), 'something of the page survived two openings').toBe(
      promptRow(twice, PROMPT) - ABOVE_THE_TYPED_ROW,
    );
    expect(emptyRowsAbove(twice), 'the emptiness above the input is in two places').toBe(
      theGapOn(twice, PROMPT),
    );
    // AND NOT ONE ROW MORE THAN THAT: the rows the shutting asks for are exactly the ones the
    // opening took, so a page cannot be pushed past its own screen by a list that came and went.
    // The screen is as tall as it was, and the area is still the whole of what is drawn on it.
    expect(twice.rows.length, 'the screen changed size').toBe(rows);
  }, 240_000);
});

// ---------------------------------------------------------------------------
// ⛔ And the region the layout redraws did not grow
// ---------------------------------------------------------------------------

/**
 * WHAT THE LAYOUT WRITES TO TAKE BACK A ROW IT REDREW: erase the row it is on, and move up.
 *
 * Counting the erases in one frame is how many rows the library thinks it owns — which is
 * the number this delivery may not move, because the region reaching the height of the
 * viewport is the condition under which the same library erases the caller's history.
 */
const TAKES_A_ROW_BACK = `${ESC}[2K`;

/** ⛔ The sequence that erases the caller's history. It is not ours to write. */
const ERASES_THE_HISTORY = `${ESC}[3J`;

/**
 * THE HEIGHT AT WHICH THE LAYOUT STOPS REDRAWING PART OF THE PAGE — measured, and measured
 * again here because this delivery is the one that could have moved it.
 *
 * One row, at a width with room for the hint on a single row: the region is then the row
 * being typed and the hint under it, and a viewport of one row is shorter than that. Two rows
 * is the first height at which the library redraws the rows it owns and nothing else, which
 * is what makes this a bracket rather than a number.
 */
const TOO_SHORT_TO_REDRAW_IN_PART = 1;

/** The width the number above was taken at: one with room for the hint on a single row. */
const WIDE_ENOUGH_FOR_THE_HINT = 100;

describe('the rows with nothing on them go into the flow, never into the region redrawn', () => {
  it('redraws the same number of rows on a tall terminal as on a short one', async () => {
    // ⛔ THE GUARD THIS WHOLE DELIVERY RESTS ON. The rows a taller terminal spends are rows of
    // the FLOW, so the region the layout redraws is the input area and nothing else — the same
    // size at forty rows as at twenty-four. A page anchored by padding INSIDE the frame instead
    // would make the two differ by the sixteen rows between them, and would walk the region into
    // the height at which this library erases the caller's history.
    const columns = WIDE_ENOUGH_FOR_THE_HINT;
    const typed = 'v';
    const redrawn = new Map<number, number>();
    const leftOver = new Map<number, number>();
    for (const rows of [24, 40]) {
      const ran = await inPty({
        columns,
        rows,
        steps: [
          opens,
          { types: typed, until: (bytes) => bytes.includes(`${PROMPT} ${typed}`), what: 'echoed' },
          // AND THE ROW IS ABANDONED BEFORE THE WORD THAT LEAVES, because there is a keystroke
          // on it: the word that leaves is typed INTO the row, and `v/exit` is not a word.
          { ...leaves, types: `${ABANDONS_THE_LINE}${LEAVE}\r` },
        ],
      });
      const frame = ran.bytes.slice(ran.at[0] as number, ran.at[1] as number);
      redrawn.set(rows, times(frame, TAKES_A_ROW_BACK));
      leftOver.set(
        rows,
        theGapOn(screenOf(ran.bytes.slice(0, ran.at[1] as number), columns, rows), PROMPT),
      );
    }
    // THE PROMISE: one keystroke takes back the same rows on both.
    expect(redrawn.get(24), 'the region grew with the terminal').toBe(redrawn.get(40));
    // NOT VACUOUS IN EITHER DIRECTION. There really is a redraw to count, it is a handful of
    // rows rather than a screen, and the two terminals really were left with different amounts
    // over — which is the thing that would have made the numbers differ.
    expect(redrawn.get(24) ?? 0, 'nothing was redrawn at all').toBeGreaterThan(1);
    expect(redrawn.get(24) ?? 0, 'the region is as tall as the shorter screen').toBeLessThan(24);
    expect(leftOver.get(40) ?? 0, 'the taller terminal had no more room to spare').toBeGreaterThan(
      leftOver.get(24) ?? 0,
    );
  }, 240_000);

  it('⚠️ leaves the erase where it was: absent at two rows, and the library’s own at one', async () => {
    // THE BOUNDARY, BRACKETED, and it is the LIBRARY'S rather than this product's: on a
    // terminal shorter than the region it redraws, the layout redraws the whole screen and
    // the sequence it uses for that carries, inside it, the one this product refuses to
    // write. Nothing of ours writes it (guarded over the source in `the-console-on-ink.test.ts`).
    // Pinned in BOTH directions so the rows with nothing on them cannot have moved it: one row
    // more than the boundary and the erase is gone, and at the boundary it is still there.
    const short = await inPty({
      columns: WIDE_ENOUGH_FOR_THE_HINT,
      rows: TOO_SHORT_TO_REDRAW_IN_PART,
      steps: [opens, leaves],
    });
    expect(short.bytes, 'the library no longer erases the history at the boundary').toContain(
      ERASES_THE_HISTORY,
    );
    const over = await inPty({
      columns: WIDE_ENOUGH_FOR_THE_HINT,
      rows: TOO_SHORT_TO_REDRAW_IN_PART + 1,
      steps: [opens, leaves],
    });
    expect(over.bytes, 'one row over the boundary saw the erase').not.toContain(ERASES_THE_HISTORY);
    // Both sessions really opened, so the difference between them is the height alone.
    for (const ran of [short, over]) expect(ran.bytes).toContain(PROMPT);
  }, 240_000);

  it('puts the caret on the row being typed, wherever on the screen that row is', async () => {
    // WHAT THE ANCHOR MAY NOT COST. The caret is placed at an offset INTO the region the
    // layout redraws (`repl/area.ts`, `above`), and the region is as far down the screen as the
    // flow and its leftover reach — so a caret placed against the top of the page rather than
    // against the region would be off by exactly that many rows.
    const columns = WIDE_ENOUGH_FOR_THE_HINT;
    const rows = 40;
    const ran = await inPty({ columns, rows, steps: [opens, leaves] });
    const screen = screenOf(ran.bytes.slice(0, ran.at[0] as number), columns, rows);
    expect(screen.cursor.row, 'the caret is not on the row being typed').toBe(
      promptRow(screen, PROMPT),
    );
    // Not vacuous: the row being typed is a long way down a page whose emptiness is a long run,
    // so a caret left at the top of the page or at the end of the frame would be somewhere else.
    expect(promptRow(screen, PROMPT)).toBeGreaterThan(firstDrawnRow(screen));
    expect(theGapOn(screen, PROMPT)).toBeGreaterThan(0);
    // And the version really was drawn at the top, so the page is the whole page.
    expect(screen.rows[0]).toContain(`v${VERSION}`);
  }, 240_000);
});
