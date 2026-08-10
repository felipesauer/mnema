/**
 * THE INPUT SITS AT THE FOOT OF THE TERMINAL — asked of a screen, because it is a claim
 * about where a row is and only a screen has rows.
 *
 * The row being typed used to land wherever the opening happened to end: on a window forty
 * rows tall the box and the input took eighteen of them and the other twenty-two were empty,
 * under the prompt, doing nothing. What fixes it is not a place the input is moved to — it is
 * blank rows written BEFORE the opening (`repl/page.ts`), so the flow ends on the last row the
 * layout leaves and the input is at the foot when the session opens and stays there by
 * construction once the content scrolls.
 *
 * ⚠️ IT WAS WRITTEN DOWN THAT THIS COULD NOT BE DONE WITHOUT TAKING THE SCREEN, and this file
 * is what falsified it. The study that designed this console left the anchoring open on the
 * argument that the reference does it by switching to the alternate screen and that there was
 * no cheap third way with this library. The reasoning assumed anchoring meant filling the rows
 * AFTER the input, which makes the region the layout redraws as tall as the viewport — the one
 * condition under which the library writes the erase that takes the caller's history with it.
 * Filling BEFORE it costs a newline per row and nothing else, which is why the case below that
 * matters most is not about the foot at all: it is the one that says the redrawn region did
 * not grow.
 *
 * FOUR THINGS ARE ASKED HERE, and three of them are asked of a real pseudo-terminal:
 *
 *   - THE ARITHMETIC, over the bytes the page is turned with. It is the only place an
 *     off-by-one in the safe direction is visible: one blank row too many leaves the SCREEN
 *     identical (the library's own newline scrolls it back into the same place) and shows up
 *     as one more row of the caller's history carried away.
 *   - THE FOOT, on a screen, at three sizes and after an answer longer than the screen.
 *   - THE THREE CALLERS: the page that opens, the word that clears, and a caller who resized
 *     their window. One that did not anchor would be the defect that only shows up later.
 *   - THE REGION DID NOT GROW, from both ends: it is the same size on a tall terminal as on a
 *     short one, and the erase is still absent at the height where one row fewer IS it.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CliIo, run } from '../src/cli.js';
import { renderPlain } from '../src/presentation/plain.js';
import { BELOW_THE_VIEWPORT } from '../src/repl/area.js';
import { carriedIntoTheScrollback, type ThePage } from '../src/repl/page.js';
import { tips } from '../src/repl/session.js';
import { CLEAR, LEAVE } from '../src/session-words.js';
import { VERSION } from '../src/version.js';
import { REPL_VERB } from '../src/wiring/repl.js';
import { ESC } from './support/console.js';
import { inPty as drive, type Fixture, opensAConsole, type Ran, type Step } from './support/pty.js';
import { screenOf } from './support/screen.js';

/** The built CLI — the same file the `mnema` bin points at. */
const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

/** What the caller types in front of, as the layout writes it: trimmed at the end. */
const PROMPT = 'mnema>';

/** The box's top-left corner, named by its code point rather than typed. */
const TOP_LEFT = '╭';

/** What the opening always says, whatever the terminal is like. */
const OPENED = 'a session over this project';

/** What every record of this fixture is called, and what a `search` for it names. */
const NAMED = 'foot';

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
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-foot-'));
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
  // ENOUGH RECORDS FOR AN ANSWER TALLER THAN A SCREEN, and each title short enough that no
  // row of the answer folds at any width these cases drive: a folded row is a row the count
  // does not have, and the case that asks whether a page turned over an answer keeps all of
  // it would then be measuring the fold instead.
  for (const which of ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight']) {
    await shell('task', `${NAMED} ${which}`);
  }

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

// ---------------------------------------------------------------------------
// The pty, and the two rows every case below is about
// ---------------------------------------------------------------------------

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

/**
 * The step a session that has something HALF-TYPED on it ends with.
 *
 * ⚠️ The word that leaves is typed INTO the row, so a case that left a keystroke on it asks
 * the session to run `v/exit` — which is not a word, and the session stays up until the
 * driver gives up thirty seconds later with *"never came back"*. The row is abandoned first.
 */
const leavesAfterTyping: Step = { ...leaves, types: `${ABANDONS_THE_LINE}${LEAVE}\r` };

/** How many times `what` occurs in `text`. */
const times = (text: string, what: string): number => text.split(what).length - 1;

/**
 * THE STEP THAT ASKS FOR AN ANSWER LONGER THAN THE OPENING LEFT ROOM FOR, and what says
 * it came: the LAST of the records is named.
 *
 * `over` is how many times it has been named ALREADY, and it is not bookkeeping for its
 * own sake — a page turned after the answer writes the whole of the flow again, so every
 * record on it is named a second time, and a later step that waited for a FIRST occurrence
 * would be approved by bytes that arrived before it was even taken.
 */
const asks = (over: number): Step => ({
  types: `search ${NAMED}\r`,
  until: (bytes) => times(bytes, `${NAMED} eight`) > over,
  what: 'answered with the records',
});

/** A screen, as the two instruments below read it. */
type Page = { readonly rows: readonly string[] };

/**
 * THE FIRST ROW OF THE SCREEN WITH ANYTHING ON IT — where the page begins.
 *
 * It was 0 on every terminal until this delivery, which is why nothing had to ask: the page
 * was drawn from the top. What is above it now is the leftover, and how much of it there is
 * is what the anchoring IS.
 */
function firstDrawnRow(page: Page): number {
  return page.rows.map((row) => row.trim().length > 0).indexOf(true);
}

/** The last row of the screen with anything on it — the last row of the input area. */
function lastDrawnRow(page: Page): number {
  return page.rows.map((row) => row.trim().length > 0).lastIndexOf(true);
}

/**
 * ACCUSES A SCREEN WHOSE LAST DRAWN ROW IS NOT THE LAST ONE THE LAYOUT LEAVES.
 *
 * THE ROW UNDER THE AREA IS NOT OURS, and that is the whole of why this is not simply the
 * bottom row: the library writes a newline after the last row of every frame it draws, so
 * there is always exactly one row below the region with its own cursor on it. It is the same
 * row the area's arithmetic keeps to be redrawn in PART ({@link BELOW_THE_VIEWPORT}), read
 * from where it is written rather than restated as a margin.
 *
 * The message names both numbers, because a red here is a page one row out and the count
 * alone says nothing about which way.
 */
function endsAtTheFoot(page: Page, rows: number, what: string): void {
  const last = lastDrawnRow(page);
  expect(rows - 1 - last, `${what}: the input is ${rows - 1 - last} rows off the foot`).toBe(
    BELOW_THE_VIEWPORT,
  );
  // AND WHAT IS UNDER IT IS NOTHING, which is the other half: a row of the caller's own
  // output left below the area would satisfy the count above and be a page opened over
  // somebody else's.
  for (const row of page.rows.slice(last + 1)) {
    expect(row.trim(), `${what}: something is drawn under the input`).toBe('');
  }
}

/** The row the caller is typing on, which is the one the area is arranged around. */
function promptRow(page: Page): number {
  return page.rows.map((row) => row.includes(PROMPT)).lastIndexOf(true);
}

// ---------------------------------------------------------------------------
// The arithmetic, over the bytes the page is turned with
// ---------------------------------------------------------------------------

/**
 * THE BYTES THIS PAGE WAS TURNED WITH BEFORE THERE WAS AN ANCHOR: the cursor on the last
 * row, a page's worth of blank rows, and back to the top.
 *
 * Written out here rather than imported, because it is what the case below is comparing
 * AGAINST — a page that does not fit has to be answered with exactly these bytes and no
 * others, and a helper that asked the product what they were could not say so.
 */
const theOldPage = (rows: number): string => `${ESC}[${rows};1H${'\n'.repeat(rows)}${ESC}[H`;

/** How many blank rows the bytes of a turned page leave the cursor under the top. */
function blankRowsIn(bytes: string, rows: number): number {
  const after = bytes.slice(theOldPage(rows).length);
  expect(bytes.startsWith(theOldPage(rows)), 'the page is not carried away first').toBe(true);
  expect(
    [...after].every((byte) => byte === '\n'),
    `only blank rows follow: ${after}`,
  ).toBe(true);
  return after.length;
}

describe('the blank rows are what is left over, and they are written before the opening', () => {
  it('leaves the cursor one row under the top for every row the page does not use', () => {
    // THE SUBTRACTION, and it is the only place an off-by-one in the SAFE direction can be
    // caught. One row too many is invisible on a screen: the layout's own newline scrolls
    // the page back into exactly the same place, and what it costs is one row of the
    // caller's history carried away for nothing.
    const page: ThePage = { rows: 30, opening: 17, said: 0, area: 5 };
    expect(blankRowsIn(carriedIntoTheScrollback(page), page.rows)).toBe(
      30 - 17 - 5 - BELOW_THE_VIEWPORT,
    );
    // Not a coincidence of one arrangement: every number in it moves the answer one for one.
    expect(blankRowsIn(carriedIntoTheScrollback({ ...page, rows: 31 }), 31)).toBe(
      31 - 17 - 5 - BELOW_THE_VIEWPORT,
    );
    expect(blankRowsIn(carriedIntoTheScrollback({ ...page, opening: 18 }), 30)).toBe(
      30 - 18 - 5 - BELOW_THE_VIEWPORT,
    );
    expect(blankRowsIn(carriedIntoTheScrollback({ ...page, area: 6 }), 30)).toBe(
      30 - 17 - 6 - BELOW_THE_VIEWPORT,
    );
    // INCLUDING WHAT THE SESSION HAS ALREADY SAID, which is the number a page turned for a
    // resize has and the other two callers do not: the flow is the opening AND the answers
    // under it, so a page placed as though there were none would be placed off the top.
    expect(blankRowsIn(carriedIntoTheScrollback({ ...page, said: 4 }), 30)).toBe(
      30 - 17 - 4 - 5 - BELOW_THE_VIEWPORT,
    );
  });

  it('answers a page that does not fit with byte for byte what it always answered', () => {
    // R-c, AND IT IS NOT A NEW BRANCH: nothing fits into a negative number of rows, so a
    // terminal with no room over the flow gets the page it got before there was an anchor.
    for (const rows of [3, 5, 22]) {
      expect(carriedIntoTheScrollback({ rows, opening: 17, said: 0, area: 5 })).toBe(
        theOldPage(rows),
      );
    }
    // Including the exact boundary, where the leftover is nothing rather than negative.
    expect(carriedIntoTheScrollback({ rows: 23, opening: 17, said: 0, area: 5 })).toBe(
      theOldPage(23),
    );
    // And a terminal that reported no height at all is still answered with nothing.
    expect(carriedIntoTheScrollback({ rows: 0, opening: 0, said: 0, area: 0 })).toBe('');
    // Not vacuous: one row more than the boundary really does write a blank row, so the
    // cases above are the absence of one rather than a function that never writes any.
    expect(carriedIntoTheScrollback({ rows: 24, opening: 17, said: 0, area: 5 })).toBe(
      `${theOldPage(24)}\n`,
    );
  });
});

// ---------------------------------------------------------------------------
// The foot, on a real screen
// ---------------------------------------------------------------------------

describe('the input ends on the last row the layout leaves, at every size', () => {
  // Three sizes: the one every terminal has had since before they were on screens, a common
  // laptop window, and a large one — the last because a page anchored only where the defect
  // was measured is a page that moved a case rather than the product.
  for (const [columns, rows] of [
    [80, 24],
    [100, 30],
    [120, 40],
  ] as const) {
    it(`opens at the foot of ${columns}x${rows}`, async () => {
      const ran = await inPty({ columns, rows, steps: [opens, leaves] });
      const screen = screenOf(ran.bytes.slice(0, ran.at[0] as number), columns, rows);
      expect(screen.text, `${columns}x${rows}: the session never opened`).toContain(OPENED);
      endsAtTheFoot(screen, rows, `${columns}x${rows}`);
      // THE LAST ROW IS THE HINT, which is the last row of the input area: the count above
      // would hold just as well for an answer that happened to end there.
      expect(
        screen.rows[lastDrawnRow(screen)],
        `${columns}x${rows}: the last row is not the area's`,
      ).toContain(renderPlain(tips()).trim());
      // AND THE PAGE REALLY WAS PUSHED DOWN, which is what changed: it began on the first row
      // of the screen at every size before this, so a product that anchored nothing would
      // pass every count above on a terminal it exactly fills and fail here.
      expect(
        firstDrawnRow(screen),
        `${columns}x${rows}: the page still begins on the first row`,
      ).toBeGreaterThan(0);
      // AND NOTHING OF IT IS CUT. The rows above are empty because the page was carried
      // away, not because its top went with it: the first drawn row is the box's top edge,
      // and the box's top edge is the one line of the opening that names the build.
      expect(
        screen.rows[firstDrawnRow(screen)],
        `${columns}x${rows}: the page opened cut`,
      ).toContain(`v${VERSION}`);
      expect(screen.rows[firstDrawnRow(screen)], `${columns}x${rows}`).toContain(TOP_LEFT);
    }, 240_000);
  }

  it('stays there when the answer is taller than the screen', async () => {
    // THE OTHER HALF OF THE PROMISE, and it is the half that holds by construction: the area
    // is the end of the flow, so once the flow is longer than the screen the terminal itself
    // keeps it at the bottom. The case is here because "by construction" is an argument, and
    // an answer that scrolled the page while the frame stayed where it was would be the same
    // defect upside down.
    const columns = 100;
    const rows = 30;
    const ran = await inPty({ columns, rows, steps: [opens, asks(0), leaves] });
    const opening = screenOf(ran.bytes.slice(0, ran.at[0] as number), columns, rows);
    const answered = screenOf(ran.bytes.slice(0, ran.at[1] as number), columns, rows);
    endsAtTheFoot(opening, rows, 'opened');
    endsAtTheFoot(answered, rows, 'answered');
    // THE ANSWER REALLY WAS TALLER THAN THE SCREEN: the box the page opened with is not on
    // it any more, so what is being asserted is a page the terminal scrolled rather than one
    // that happened to fit.
    expect(answered.text, 'the answer never came').toContain(`${NAMED} eight`);
    expect(answered.text, 'the answer fitted on the page').not.toContain(TOP_LEFT);
    expect(firstDrawnRow(answered), 'the page did not fill the screen').toBe(0);
  }, 240_000);
});

// ---------------------------------------------------------------------------
// The three callers of the page
// ---------------------------------------------------------------------------

describe('all three callers of the page leave the input at the foot', () => {
  it('opens there, follows a resize there, and clears there', async () => {
    // A3, ON A SCREEN. The bytes that turn a page are one function with three callers, and
    // one of the three failing to anchor is the defect that shows up a week later. They are
    // asked in ONE run, in the order a caller would reach them.
    const rows = 40;
    const wide = 120;
    // NARROWED, NOT SHORTENED, and the width is chosen so nothing folds: the answer's rows
    // are landed folded to the width the session STARTED at, so a narrower window would
    // make each of them two rows — and the case below asks whether all of the page survived
    // a page turn, which a fold would answer for it.
    const narrow = 110;
    const ran = await inPty({
      columns: wide,
      rows,
      steps: [
        opens,
        asks(0),
        {
          resize: { columns: narrow, rows },
          until: (bytes) => times(bytes, TOP_LEFT) > 1,
          what: 'drew the page again at the new width',
        },
        {
          types: `${CLEAR}\r`,
          until: (bytes) => times(bytes, TOP_LEFT) > 2,
          what: 'gave back a clean page',
        },
        leaves,
      ],
    });
    const opened = screenOf(ran.bytes.slice(0, ran.at[0] as number), wide, rows);
    const resized = screenOf(ran.bytes.slice(0, ran.at[2] as number), narrow, rows);
    const cleared = screenOf(ran.bytes.slice(0, ran.at[3] as number), narrow, rows);

    endsAtTheFoot(opened, rows, 'the page that opened');
    endsAtTheFoot(resized, rows, 'the page that followed the terminal');
    endsAtTheFoot(cleared, rows, 'the page that was cleared');

    // AND ALL THREE ARE REALLY PAGES OF THEIR OWN, or one screen is being asserted three
    // times: the first has nothing said on it, the second has the answer and a box at the
    // new width, and the third has the box and nothing said.
    expect(opened.text, 'nothing was drawn when it opened').toContain(OPENED);
    expect(opened.text, 'the caller had already searched when it opened').not.toContain(
      `${NAMED} eight`,
    );
    expect(resized.text, 'what the caller had read went with the old page').toContain(
      `${NAMED} eight`,
    );
    expect(cleared.text, 'the answer survived a clean page').not.toContain(`${NAMED} eight`);
    expect(cleared.text, 'the clean page has no box on it').toContain(OPENED);

    // WHAT THE RESIZE MAY NOT COST, and it is the case that pins the count of what has been
    // SAID: the page is turned over an answer that is already on it, so a placement that
    // counted the opening and the area alone would push the whole of the flow off the top by
    // as many rows as the session had said. The box's top edge is the row that goes first.
    expect(
      resized.rows[firstDrawnRow(resized)],
      'the page turned for a resize opened cut',
    ).toContain(`v${VERSION}`);
    // And it really was anchored rather than merely fitting: there are blank rows above it.
    for (const [screen, what] of [
      [resized, 'the resized page'],
      [cleared, 'the cleared page'],
    ] as const) {
      expect(firstDrawnRow(screen), `${what} begins on the first row`).toBeGreaterThan(0);
    }
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

describe('the blank rows go into the flow, and never into the region that is redrawn', () => {
  it('redraws the same number of rows on a tall terminal as on a short one', async () => {
    // ⛔ THE GUARD THIS WHOLE DELIVERY RESTS ON. The rows a taller terminal spends are blank
    // rows of the FLOW, so the region the layout redraws is the input area and nothing else —
    // the same size at forty rows as at twenty-four. A page anchored by padding INSIDE the
    // frame instead would make the two differ by the sixteen rows between them, and would
    // walk the region into the height at which this library erases the caller's history.
    const columns = WIDE_ENOUGH_FOR_THE_HINT;
    const typed = 'v';
    const redrawn = new Map<number, number>();
    const anchored = new Map<number, number>();
    for (const rows of [24, 40]) {
      const ran = await inPty({
        columns,
        rows,
        steps: [
          opens,
          { types: typed, until: (bytes) => bytes.includes(`${PROMPT} ${typed}`), what: 'echoed' },
          // AND THE ROW IS ABANDONED BEFORE THE WORD THAT LEAVES, because there is a keystroke
          // on it: this is the one case here that types something and does not run it.
          leavesAfterTyping,
        ],
      });
      const frame = ran.bytes.slice(ran.at[0] as number, ran.at[1] as number);
      redrawn.set(rows, times(frame, TAKES_A_ROW_BACK));
      anchored.set(
        rows,
        firstDrawnRow(screenOf(ran.bytes.slice(0, ran.at[1] as number), columns, rows)),
      );
    }
    // THE PROMISE: one keystroke takes back the same rows on both.
    expect(redrawn.get(24), 'the region grew with the terminal').toBe(redrawn.get(40));
    // NOT VACUOUS IN EITHER DIRECTION. There really is a redraw to count, it is a handful of
    // rows rather than a screen, and the two terminals really were anchored at different
    // heights — which is the thing that would have made the numbers differ.
    expect(redrawn.get(24) ?? 0, 'nothing was redrawn at all').toBeGreaterThan(1);
    expect(redrawn.get(24) ?? 0, 'the region is as tall as the shorter screen').toBeLessThan(24);
    expect(anchored.get(40) ?? 0, 'the taller terminal was not anchored lower').toBeGreaterThan(
      anchored.get(24) ?? 0,
    );
  }, 240_000);

  it('⚠️ leaves the erase where it was: absent at two rows, and the library’s own at one', async () => {
    // THE BOUNDARY, BRACKETED, and it is the LIBRARY'S rather than this product's: on a
    // terminal shorter than the region it redraws, the layout redraws the whole screen and
    // the sequence it uses for that carries, inside it, the one this product refuses to
    // write. Nothing of ours writes it (guarded over the source in `the-console-on-ink.test.ts`).
    // Pinned in BOTH directions so the blank rows cannot have moved it: one row more than
    // the boundary and the erase is gone, and at the boundary it is still there.
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
    // layout redraws (`repl/area.ts`, `above`), and the region moved down the screen by
    // however many blank rows the page has above it — so a caret placed against the top of
    // the page rather than against the region would now be off by exactly that many.
    const columns = WIDE_ENOUGH_FOR_THE_HINT;
    const rows = 40;
    const ran = await inPty({ columns, rows, steps: [opens, leaves] });
    const screen = screenOf(ran.bytes.slice(0, ran.at[0] as number), columns, rows);
    expect(screen.cursor.row, 'the caret is not on the row being typed').toBe(promptRow(screen));
    // Not vacuous: the row being typed is a long way down a page that starts a long way
    // down, so a caret left at the top or at the end of the frame would be somewhere else.
    expect(promptRow(screen)).toBeGreaterThan(firstDrawnRow(screen));
    expect(firstDrawnRow(screen)).toBeGreaterThan(0);
  }, 240_000);
});
