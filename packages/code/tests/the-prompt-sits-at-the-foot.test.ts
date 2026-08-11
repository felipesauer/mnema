/**
 * THE INPUT SITS AT THE FOOT OF THE TERMINAL — asked of a screen, because it is a claim
 * about where a row is and only a screen has rows.
 *
 * The row being typed used to land wherever the opening happened to end: on a window forty
 * rows tall the box and the input took eighteen of them and the other twenty-two were empty,
 * under the prompt, doing nothing. What fixes it is not a place the input is moved to — it is
 * rows with nothing on them BETWEEN the flow and the area (`repl/page.ts`), so the area ends on
 * the last row the layout leaves and the input is at the foot when the session opens and stays
 * there by construction once the content scrolls.
 *
 * ⚠️ THEY WENT OVER THE OPENING, THEN UNDER IT AS LINES OF THE FLOW, AND THEY ARE PART OF THE
 * FRAME NOW — and this file is where none of those three differences is asserted: everything here
 * is about the last row, and the last row is the same in all of them. Which is why it stayed
 * green through both moves, and it is the WITNESS this delivery leaned on rather than a case it
 * had to teach.
 * Where the emptiness ends up is asked in `the-gap-goes-under-the-box.test.ts`, which is also
 * where the arithmetic and the guard on the redrawn region went — they moved with the rows they
 * are about. What this file lost to that move is its old instrument: how far down the page BEGAN
 * used to be how the anchoring was read, and the box is on the first row at every size now, so
 * the non-vacuity of every case below is the GAP instead (`support/screen.ts`, `theGapOn`).
 *
 * ⚠️ AND IT WAS WRITTEN DOWN THAT THIS COULD NOT BE DONE WITHOUT TAKING THE SCREEN, and this file
 * is what falsified it. The study that designed this console left the anchoring open on the
 * argument that the reference does it by switching to the alternate screen and that there was
 * no cheap third way with this library. The reasoning assumed anchoring meant filling the rows
 * AFTER the input, which makes the region the layout redraws as tall as the viewport — the one
 * condition under which the library writes the erase that takes the caller's history with it.
 * Filling above it costs a newline per row and nothing else, whichever side of the opening the
 * rows go.
 *
 * THREE THINGS ARE ASKED HERE, all of them of a real pseudo-terminal:
 *
 *   - THE FOOT, on a screen, at three sizes and after an answer longer than the screen.
 *   - THE THREE CALLERS: the page that opens, the word that clears, and a caller who resized
 *     their window. One that did not anchor would be the defect that only shows up later.
 *   - THE CARET, which is placed at an offset INTO the region that moved down the page.
 *
 * ⚠️ AND A CALLER WHO ONLY CHANGED THE HEIGHT WAS HALF A PROMISE, WHICH IS CLOSED — and the note
 * stays because what it got WRONG is the interesting half. It was written here that a shorter
 * window leaves the input above the foot because *the layout redraws its region where it already
 * is*, and that closing it would take an absolute re-anchor of the kind a page turn writes
 * (`repl/page.ts`, `carriedIntoTheScrollback`). WHAT FALSIFIED IT IS THE ARITHMETIC: the shortfall
 * was IDENTICAL, row for row, to what the window lost — six, four and ten rows at three pairs —
 * and a terminal that shrinks anchors its content at the FOOT, so the rows that leave go off the
 * top into the scrollback and nothing tells the program. The flow this console thought was on the
 * screen was too long by exactly that, the leftover under it too short by exactly that, and the
 * region drawn that many rows high. So it is one subtraction and no re-anchor at all
 * (`repl/console.ts`, `whatTheWindowTook`), and no page is turned for a height any more than
 * before. Five pairs are swept below, one session each, and the ⛔ case that asserted the hole
 * with its number is the first of them — inverted and renamed rather than silenced.
 *
 * AND THE ANSWER TURNED OUT TO BE NO BYTES AT ALL, which is worth reading as the real shape of the
 * defect: with the flow told what it lost, the frame asked for is the frame already on the screen,
 * and a library writes nothing for a frame that did not change. A shorter window used to cost 668,
 * 620 and 576 bytes at those three pairs — a wrong frame written over a right one — and costs
 * nought.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CliIo, run } from '../src/cli.js';
import { bannerFor } from '../src/presentation/banner.js';
import { renderPlain } from '../src/presentation/plain.js';
import { tips } from '../src/repl/session.js';
import { CLEAR, LEAVE } from '../src/session-words.js';
import { VERSION } from '../src/version.js';
import { REPL_VERB } from '../src/wiring/repl.js';
import { ESC } from './support/console.js';
import { inPty as drive, type Fixture, opensAConsole, type Ran, type Step } from './support/pty.js';
import {
  endsAtTheFoot,
  firstDrawnRow,
  lastDrawnRow,
  promptRow,
  screenOf,
  theGapOn,
} from './support/screen.js';

/** The built CLI — the same file the `mnema` bin points at. */
const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

/** What the caller types in front of, as the layout writes it: trimmed at the end. */
const PROMPT = 'mnema>';

/**
 * The first row of the drawing of the name a terminal this wide gets, as the layout writes it —
 * the row that goes first when a page is pushed up.
 *
 * ⚠️ IT WAS THE BOX'S TOP-LEFT CORNER, one constant and one glyph. The frame is gone, so what the
 * top of the opening IS has to be asked of the module that draws it, at the width the screen was
 * replayed at — which also means a fifth form of the art moves this instrument with it.
 */
function theFirstRowOfTheMark(columns: number): string {
  const art = bannerFor({ columns, rows: 0, needs: () => 0 }).map(renderPlain);
  const first = art[0];
  expect(first, 'the name is drawn with no rows at all').toBeDefined();
  return first as string;
}

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

/** How many times `what` occurs in `text`. */
const times = (text: string, what: string): number => text.split(what).length - 1;

/**
 * How long to leave the console alone after a resize for it to have followed the size: two and a
 * half times the tenth of a second it waits after the last change (`repl/console.ts`,
 * `AFTER_THE_LAST_CHANGE`), which is the wait it takes before it decides anything at all.
 *
 * The ratio is not what makes it enough — the MUTATION is. With the half of the resize guard that
 * this delivery removed put back, the sweep below counts a page per height.
 */
const LONGER_THAN_SETTLING = 250;

/**
 * ONE HEIGHT OF A SWEEP: the window becomes this size, and the console is then left alone for
 * longer than it waits before following one.
 *
 * ⚠️ THE WAIT IS THE INSTRUMENT AND NOT A CONVENIENCE. What the cases below assert is partly an
 * ABSENCE — no page carried into the scrollback for a height — and an absence has no byte to wait
 * for: a step that ended on the next frame would be a step the amortiser had not run out on, so
 * the sweep would be one decision rather than five and a console that turned a page for every
 * height would answer exactly like one that turns none.
 */
const heightBecomes = (columns: number, rows: number): Step => ({
  resize: { columns, rows },
  does: () => new Promise((resolve) => setTimeout(resolve, LONGER_THAN_SETTLING)),
  until: () => true,
  what: `waited out ${columns}x${rows}`,
});

/**
 * HOW MANY PAGES A SESSION HAS CARRIED INTO THE SCROLLBACK — the cursor put on the last row of the
 * device BY NUMBER, which is what every row written after it scrolls off the top.
 *
 * It is written once per page by one function and by nothing else (`repl/page.ts`,
 * `carriedIntoTheScrollback`), at whatever height the page was turned at — so a count over the
 * sequence with the height left open is a count of this product's pages and of nothing the layout
 * does. Counting what is ON the page instead would answer for the library, which rewrites what it
 * is keeping whenever its region will not fit.
 */
const carriedPages = (bytes: string): number =>
  (bytes.match(new RegExp(`${ESC}\\[\\d+;1H`, 'g')) ?? []).length;

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
      // AND THE INPUT REALLY WAS ANCHORED rather than merely fitting: there are rows with
      // nothing on them between the flow and it. ⚠️ THIS USED TO BE *the page no longer begins
      // on the first row*, and the emptiness moving under the box is what falsified it — the box
      // is on the first row at every size now, on an anchored page and on an unanchored one
      // alike, so the leftover is read where the leftover is (`support/screen.ts`, `theGapOn`).
      expect(
        theGapOn(screen, PROMPT),
        `${columns}x${rows}: nothing was left over, so nothing was anchored`,
      ).toBeGreaterThan(0);
      // AND NOTHING OF THE PAGE IS CUT. The first row is the first row of the MARK and the build
      // is named somewhere on the page — so what is on the screen is the whole opening rather than
      // a drawing whose top went into the scrollback.
      //
      // ⚠️ BOTH USED TO BE ROW ZERO, because the box's top border carried the version: one row
      // answered *the page starts at the top* and *the page is not cut* at once. The version is
      // beside the mark now, so the two questions are two rows and are asked separately.
      expect(firstDrawnRow(screen), `${columns}x${rows}: the page does not start at the top`).toBe(
        0,
      );
      expect(screen.rows[0], `${columns}x${rows}`).toContain(theFirstRowOfTheMark(columns));
      expect(
        screen.rows.slice(0, promptRow(screen, PROMPT)).join('\n'),
        `${columns}x${rows}: the page opened cut`,
      ).toContain(`v${VERSION}`);
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
    // THE ANSWER REALLY WAS TALLER THAN THE SCREEN: the mark the page opened with is not on
    // it any more, so what is being asserted is a page the terminal scrolled rather than one
    // that happened to fit.
    expect(answered.text, 'the answer never came').toContain(`${NAMED} eight`);
    expect(answered.text, 'the answer fitted on the page').not.toContain(
      theFirstRowOfTheMark(columns),
    );
    // AND THE EMPTINESS WENT WITH IT, which is what "by construction" means here — though not for
    // the reason written here before. ⚠️ IT SAID *the leftover is rows of the flow, so an answer
    // long enough to fill the page pushes them off the top*: the leftover is part of the frame
    // now (`repl/page.ts`), so nothing pushes it anywhere. What happens instead is the same
    // ending by the other road: the leftover is what is left after the flow, so a flow longer
    // than the screen leaves nothing over and the emptiness is not drawn at all. What is left is
    // not nothing — an answer has a blank line of its own in it, and the instrument answers about
    // the last run of empty rows there is — so what is asserted is that the RUN the page opened
    // with is not on the screen any more.
    expect(theGapOn(answered, PROMPT), 'the page did not fill the screen').toBeLessThan(
      theGapOn(opening, PROMPT),
    );
    expect(theGapOn(answered, PROMPT), 'a whole leftover survived the answer').toBeLessThan(3);
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
    // WIDENED, NOT SHORTENED, and the two widths are chosen for two reasons.
    //
    // NOTHING FOLDS: the answer's rows are landed folded to the width the session STARTED at, so
    // a NARROWER window would make each of them two rows — and the case below asks whether all of
    // the page survived a page turn, which a fold would answer for it. Growing cannot fold
    // anything.
    //
    // ⚠️ AND THE PAIR HAS TO CROSS THE THRESHOLD, which is what this delivery changed. It went
    // from a hundred and twenty to a hundred and TEN, and any two widths differed while the box
    // was drawn corner to corner; nothing is drawn to an edge now, so both of those put the text
    // beside the mark and the console would have written nothing at all — measured, as a step
    // that waited forever. A hundred has no room beside the mark and a hundred and twenty has, so
    // the resize is a page and the direction is still the safe one.
    const opensAt = 100;
    const widened = 120;
    const ran = await inPty({
      columns: opensAt,
      rows,
      steps: [
        opens,
        asks(0),
        {
          resize: { columns: widened, rows },
          until: (bytes) => times(bytes, OPENED) > 1,
          what: 'drew the page again at the new width',
        },
        {
          types: `${CLEAR}\r`,
          until: (bytes) => times(bytes, OPENED) > 2,
          what: 'gave back a clean page',
        },
        leaves,
      ],
    });
    const opened = screenOf(ran.bytes.slice(0, ran.at[0] as number), opensAt, rows);
    const resized = screenOf(ran.bytes.slice(0, ran.at[2] as number), widened, rows);
    const cleared = screenOf(ran.bytes.slice(0, ran.at[3] as number), widened, rows);

    endsAtTheFoot(opened, rows, 'the page that opened');
    endsAtTheFoot(resized, rows, 'the page that followed the terminal');
    endsAtTheFoot(cleared, rows, 'the page that was cleared');

    // AND ALL THREE ARE REALLY PAGES OF THEIR OWN, or one screen is being asserted three
    // times: the first has nothing said on it, the second has the answer and the opening at the
    // new width, and the third has the opening and nothing said.
    expect(opened.text, 'nothing was drawn when it opened').toContain(OPENED);
    expect(opened.text, 'the caller had already searched when it opened').not.toContain(
      `${NAMED} eight`,
    );
    expect(resized.text, 'what the caller had read went with the old page').toContain(
      `${NAMED} eight`,
    );
    expect(cleared.text, 'the answer survived a clean page').not.toContain(`${NAMED} eight`);
    expect(cleared.text, 'the clean page has no opening on it').toContain(OPENED);

    // WHAT THE RESIZE MAY NOT COST, and it is the case that pins the count of what has been
    // SAID: the page is turned over an answer that is already on it, so a placement that
    // counted the opening and the area alone would push the whole of the flow off the top by
    // as many rows as the session had said. The first row of the MARK is the row that goes first.
    //
    // ⚠️ IT ASKED FOR THE BUILD ON ROW ZERO, because row zero was the box's top border and the
    // border carried the version. The version is beside the mark now, so the row that goes first
    // and the row that names the build are two rows.
    expect(resized.rows[0], 'the page turned for a resize opened cut').toContain(
      theFirstRowOfTheMark(widened),
    );
    // And both really were anchored rather than merely fitting: there are rows with nothing on
    // them between what the page says and the input.
    for (const [screen, what] of [
      [resized, 'the resized page'],
      [cleared, 'the cleared page'],
    ] as const) {
      expect(theGapOn(screen, PROMPT), `${what} has nothing left over`).toBeGreaterThan(0);
    }
  }, 240_000);

  it('⚠️ stays at the foot up five heights of a TALLER window, with no page turned', async () => {
    // ⚠️ THIS CASE IS THE INVERSE OF THE ONE IT REPLACES AND IT IS RENAMED RATHER THAN EDITED. It
    // was `follows a window that only changed HEIGHT, both ways`, and it waited for the page to be
    // TURNED for a height: it was the achado of the delivery that put the input here, on the
    // premise that *a page is a drawing AND a placement* — the rows under the flow are what the
    // height leaves over, so a page placed at one height was misplaced at another whatever was
    // drawn on it. Measured then: at a hundred by thirty dragged to forty not one byte was
    // written, and the input stayed eleven rows above the foot.
    //
    // WHAT FALSIFIED IT is where those rows went. They are part of the region the layout redraws
    // now (`repl/page.ts`, `theGap`) and the frame is rebuilt on the signal itself, before the
    // page is even asked about (`repl/console.ts`, `resized`) — so the leftover follows the height
    // AT ONCE and the input is back at the foot with nothing carried into the scrollback. THIS
    // CASE IS WHAT PAYS FOR THE REMOVAL, which is why it sweeps rather than asserts one pair: what
    // it costs to turn a page for every height is twelve pages of the caller's history for one
    // drag of a window edge (`tests/the-page-follows-the-terminal.test.ts`).
    //
    // TALLER ONLY, AND THE OTHER DIRECTION IS THE CASE BELOW — which is a hole rather than a
    // promise, and says so.
    const columns = 100;
    const heights = [24, 28, 34, 40, 48] as const;
    const [from, ...taller] = heights;
    const ran = await inPty({
      columns,
      rows: from,
      steps: [opens, ...taller.map((rows) => heightBecomes(columns, rows)), leaves],
    });
    // ONE PAGE FOR THE WHOLE SWEEP, and it is the one that opened: four heights, four decisions,
    // no screen of the caller's carried away.
    expect(carriedPages(ran.bytes), 'a height carried a page into the scrollback').toBe(1);
    let before = { rows: from as number, gap: 0 };
    for (const [at, rows] of heights.entries()) {
      const screen = screenOf(ran.bytes.slice(0, ran.at[at] as number), columns, rows);
      const gap = theGapOn(screen, PROMPT);
      // THE INPUT IS ON THE LAST ROW THE LAYOUT LEAVES, at every height of the sweep.
      endsAtTheFoot(screen, rows, `${columns}x${rows}`);
      // AND THE PAGE IS WHOLE: the first row of the mark is the first row of the screen, so this
      // is not a page whose top went into the scrollback and read as anchored.
      expect(screen.rows[0], `${columns}x${rows}: the page opened cut`).toContain(
        theFirstRowOfTheMark(columns),
      );
      // AND THE LEFTOVER IS THE ONE THE NEW HEIGHT CALLS FOR, which is the mechanism rather than
      // the symptom: the rows with nothing on them grew by exactly the rows the window did, so
      // the page really was placed against the terminal it is on and not against the one it
      // opened on. It is asked of every step, because a leftover that followed only the first
      // would be a console that recomposed once.
      if (at > 0) {
        expect(gap - before.gap, `${columns}x${rows}: the leftover did not follow the height`).toBe(
          rows - before.rows,
        );
      }
      expect(gap, `${columns}x${rows}: nothing was left over`).toBeGreaterThan(0);
      before = { rows, gap };
    }
    // AND THE DRAWING NEVER MOVED, which is what makes the count of pages above the answer to
    // *a height that moves no glyph costs nothing* rather than to *a height costs nothing*: at a
    // hundred columns every height of this sweep opens with the same form, so a page turned here
    // could only have been turned for the placement.
    expect(times(ran.bytes, OPENED), 'the opening was written again for a height').toBe(1);
  }, 240_000);

  /**
   * ONE PAIR OF HEIGHTS THE CALLER'S WINDOW SHRANK BETWEEN, and what the model says happens to it.
   *
   * ⚠️ THE PAIRS ARE ONE SESSION EACH, and that is a finding of the delivery before this rather
   * than a preference: a sweep of several heights inside ONE session accumulates whatever the
   * previous step got wrong, and it MISREAD a step — it read a pair as off the foot where a session
   * of its own found it AT the foot. A pair is a session.
   *
   * WHAT `predicts` IS FOR is that the answer is not "nought" three times over. The subtraction is
   * `flow − (before − now)` held at nought from below (`repl/console.ts`, `whatTheWindowTook`), so
   * the leftover under the flow — `rows − flow − area − 1` — comes out three different ways, and a
   * case that only asked for the foot would be green for a console that got there by accident.
   */
  interface Shortened {
    /** The height the session opened at. */
    readonly tall: number;
    /** The height the caller's window became. */
    readonly short: number;
    /**
     * WHAT THE MODEL SAYS THE PAGE DOES, as one of exactly three things:
     *
     *   - `the leftover is unchanged` — the window lost FEWER rows than the flow had on the
     *     screen. Both `rows` and `flow` fall by the same number, so the subtraction that makes
     *     them fall together leaves the leftover EXACTLY as it was. That is the strongest of the
     *     three: it is the arithmetic, not the outcome.
     *   - `the flow is gone` — the window lost at least the whole flow. The subtraction holds at
     *     nought, so the page is a leftover and an area and nothing above them.
     *   - `the page is turned` — the height gave the DRAWING away, so the page follows it and is
     *     written again from the top, which re-anchors everything by construction. Nothing here is
     *     this delivery's; it is the rule the delivery before it left standing.
     */
    readonly predicts: 'the leftover is unchanged' | 'the flow is gone' | 'the page is turned';
    /** How many pages the whole session carries into the scrollback, the opening included. */
    readonly pages: number;
  }

  /**
   * THE FIVE PAIRS, and they are five rather than one because the three answers above have to be
   * told apart: three where the flow outlasts the loss, one where it does not, and one where the
   * drawing gives way. All five were measured before they were written down.
   */
  const SHORTENED: readonly Shortened[] = [
    { tall: 40, short: 30, predicts: 'the leftover is unchanged', pages: 1 },
    { tall: 34, short: 30, predicts: 'the leftover is unchanged', pages: 1 },
    { tall: 30, short: 24, predicts: 'the leftover is unchanged', pages: 1 },
    { tall: 48, short: 24, predicts: 'the flow is gone', pages: 1 },
    { tall: 30, short: 20, predicts: 'the page is turned', pages: 2 },
  ];

  for (const pair of SHORTENED) {
    it(`⚠️ comes back to the foot when the window is made SHORTER, ${pair.tall} to ${pair.short}`, async () => {
      // ⚠️ THIS CASE IS THE INVERSE OF THE ONE IT REPLACES AND IT IS RENAMED RATHER THAN EDITED. It
      // was `⛔ leaves the input above the foot when the window is made SHORTER, by the rows it
      // lost`, and it asserted the shortfall AS A NUMBER — ten rows at a hundred by forty made
      // thirty — so that closing the hole would go red instead of unnoticed. It did.
      //
      // WHAT THE HOLE WAS, and it is not what the case it replaces said. That one read the bytes
      // and blamed the redraw: *the layout redraws its region relative to where it already is*, no
      // absolute position anywhere in the stream, so only a page turn could re-anchor it. WHAT
      // FALSIFIED THAT is the arithmetic sitting in plain sight — the shortfall was IDENTICAL to
      // what the window lost, in every pair where it appeared (ten, four and six rows). A terminal
      // that shrinks anchors its content at the foot: the rows that leave go off the TOP, into the
      // caller's scrollback, and nothing tells the program. So the flow this console believed was
      // on the screen was too long by exactly the loss, the leftover under it too short by exactly
      // the loss, and the region drawn exactly that many rows high. One subtraction, no re-anchor,
      // and no page turned for a height (`repl/console.ts`, `whatTheWindowTook`).
      //
      // AND THE FRAME'S OWN CAP COULD NOT HAVE DONE IT, which is why it is a second subtraction:
      // it limits the flow by what the FRAME left room for, and the frame FITTED — the screen it
      // fitted on is what stopped existing.
      const columns = 100;
      const { tall, short } = pair;
      const ran = await inPty({
        columns,
        rows: tall,
        steps: [opens, heightBecomes(columns, short), leaves],
      });
      const opened = screenOf(ran.bytes.slice(0, ran.at[0] as number), columns, tall);
      const shrunk = screenOf(ran.bytes.slice(0, ran.at[1] as number), columns, short);
      const where = `${columns}x${tall} made ${short}`;
      // THE PAGE THE SESSION OPENED WITH WAS AT THE FOOT, or the pair says nothing about what a
      // resize did: a case whose BEFORE was already wrong would read its own fixture.
      endsAtTheFoot(opened, tall, `${where}, before`);
      // AND THE INPUT IS AT THE FOOT OF THE SHORTER WINDOW. This is the observable that inverted.
      endsAtTheFoot(shrunk, short, where);
      // AND WHAT IT COST IN PAGES IS WHAT THE DRAWING COSTS AND NOTHING MORE — one for the page
      // that opened, and a second only where the height gave the mark away.
      expect(carriedPages(ran.bytes), `${where}: pages carried into the scrollback`).toBe(
        pair.pages,
      );
      // AND THE REASON IS THE MODEL'S, read off the leftover rather than off the foot: three
      // different answers, so a console that reached the foot by another road cannot pass all
      // three.
      switch (pair.predicts) {
        case 'the leftover is unchanged': {
          // THE PREDICTION, AND IT IS THE ARITHMETIC ITSELF: the height fell by the loss and the
          // flow on the screen fell by the same loss, so `rows − flow − area − 1` is untouched.
          expect(theGapOn(shrunk, PROMPT), `${where}: the leftover did not stay what it was`).toBe(
            theGapOn(opened, PROMPT),
          );
          // AND THE FLOW REALLY DID OUTLAST THE LOSS, which is what makes this pair the case it
          // claims to be: there is still something of the flow above the leftover.
          expect(firstDrawnRow(shrunk), `${where}: nothing of the flow survived`).toBe(0);
          // AND IT COST THE CALLER NOT ONE BYTE, which is the sharpest thing this delivery has to
          // say and it is not a saving — it is the DEFECT, named. The frame the layout is asked for
          // after the subtraction is the frame already on the screen, because a terminal that
          // anchored its content at the foot left the region at the foot and both sides of
          // `rows − flow − area − 1` fell by the same number. A library writes nothing for a frame
          // that did not change. So the shortfall was never a redraw that failed to happen: it was
          // a WRONG frame written over a right one — 668, 620 and 576 bytes at these three pairs,
          // measured, and nought now.
          expect(
            (ran.at[1] as number) - (ran.at[0] as number),
            `${where}: a shorter window was answered with bytes`,
          ).toBe(0);
          break;
        }
        case 'the flow is gone': {
          // THE OTHER END OF THE SUBTRACTION: it is held at nought, so the page is the leftover
          // and the area and nothing above them — the first thing drawn is where the run of
          // nothing ends.
          expect(firstDrawnRow(shrunk), `${where}: something of the flow is still there`).toBe(
            theGapOn(shrunk, PROMPT),
          );
          // AND THE LOSS REALLY WAS BIGGER THAN THE FLOW, or this is the case above in disguise:
          // the leftover a flow of nothing leaves is bigger than the one it had.
          expect(
            theGapOn(shrunk, PROMPT),
            `${where}: the leftover is the one an unclamped flow leaves`,
          ).toBeLessThan(theGapOn(opened, PROMPT));
          break;
        }
        case 'the page is turned': {
          // NOTHING OF THIS IS THE SUBTRACTION'S. The page was written again from the top, which
          // re-anchors it by construction — the bytes that carry a page away put the cursor on the
          // last row of the device BY NUMBER — so the page begins on the first row of the screen.
          expect(
            firstDrawnRow(shrunk),
            `${where}: the page turned and did not start at the top`,
          ).toBe(0);
          // AND IT REALLY WAS THE DRAWING THAT GAVE WAY, which is the one thing that may turn a
          // page: the opening is in the stream twice, and the form the taller window drew is not on
          // the screen any more. ⚠️ IT ASKED FOR THE FIRST ROW OF THE MARK ON ROW ZERO, which is
          // the assertion this pair cannot make: the mark it names is the one an unconstrained page
          // draws, and a window this short is exactly a window that does not get it.
          expect(times(ran.bytes, OPENED), `${where}: the opening was not written again`).toBe(2);
          expect(shrunk.text, `${where}: the drawing did not give way`).not.toContain(
            theFirstRowOfTheMark(columns),
          );
          break;
        }
        default:
          // NOT AN UNREACHABLE BRANCH TO SATISFY A COMPILER. A type error in a `.test.ts` leaves
          // both the build and the suite green, so exhaustiveness here is a RUNTIME question: a
          // sixth pair with a fourth prediction would assert nothing at all and pass.
          throw new Error(`${where}: nothing is asserted for ${String(pair.predicts)}`);
      }
    }, 240_000);
  }

  it('⚠️ comes back to the foot of a shorter window once the session has printed', async () => {
    // A13, AND IT IS THE STATE OF THE FIXTURE THAT MAKES IT A DIFFERENT CASE. A page that has just
    // opened is the least representative instant of a session — the flow is the opening and nothing
    // else — and this series has already lost a whole hole by measuring there. What an ANSWER
    // changes here is which side of the subtraction bites: the flow is twenty-eight rows on the
    // taller window instead of sixteen, so the loss is nowhere near it and the clamp at nought
    // cannot be what puts the input at the foot.
    const columns = 100;
    const tall = 40;
    const short = 30;
    const ran = await inPty({
      columns,
      rows: tall,
      steps: [opens, asks(0), heightBecomes(columns, short), leaves],
    });
    const answered = screenOf(ran.bytes.slice(0, ran.at[1] as number), columns, tall);
    const shrunk = screenOf(ran.bytes.slice(0, ran.at[2] as number), columns, short);
    // THE SESSION REALLY HAD PRINTED, or this is the case above with more waiting in it.
    expect(answered.text, 'the caller never asked anything').toContain(`${NAMED} eight`);
    endsAtTheFoot(answered, tall, 'answered');
    endsAtTheFoot(shrunk, short, 'answered, then made shorter');
    expect(carriedPages(ran.bytes), 'a shorter window carried a page into the scrollback').toBe(1);
    // AND THE LEFTOVER IS UNCHANGED, which is the model's prediction wherever the flow outlasts
    // the loss — the same assertion the first three pairs make, on a page with an answer on it.
    expect(theGapOn(shrunk, PROMPT), 'the leftover did not stay what it was').toBe(
      theGapOn(answered, PROMPT),
    );
    // AND THE CLAMP IS NOT WHAT DID IT: the leftover here is SMALLER than the loss, so a flow held
    // at nought would have left far more room than this and the foot would have been reached by
    // the other road.
    expect(theGapOn(shrunk, PROMPT), 'the leftover is as big as the loss').toBeLessThan(
      tall - short,
    );
  }, 240_000);
});
