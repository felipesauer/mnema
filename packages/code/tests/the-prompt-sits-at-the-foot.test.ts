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
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CliIo, run } from '../src/cli.js';
import { renderPlain } from '../src/presentation/plain.js';
import { tips } from '../src/repl/session.js';
import { CLEAR, LEAVE } from '../src/session-words.js';
import { VERSION } from '../src/version.js';
import { REPL_VERB } from '../src/wiring/repl.js';
import { inPty as drive, type Fixture, opensAConsole, type Ran, type Step } from './support/pty.js';
import {
  endsAtTheFoot,
  firstDrawnRow,
  lastDrawnRow,
  screenOf,
  theGapOn,
} from './support/screen.js';

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
      // AND NOTHING OF THE PAGE IS CUT. The first row is the box's top edge, which is the one
      // line of the opening that names the build — so what is on the screen is the whole page
      // rather than a drawing whose top went into the scrollback.
      expect(firstDrawnRow(screen), `${columns}x${rows}: the page does not start at the top`).toBe(
        0,
      );
      expect(screen.rows[0], `${columns}x${rows}: the page opened cut`).toContain(`v${VERSION}`);
      expect(screen.rows[0], `${columns}x${rows}`).toContain(TOP_LEFT);
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
    expect(resized.rows[0], 'the page turned for a resize opened cut').toContain(`v${VERSION}`);
    // And both really were anchored rather than merely fitting: there are rows with nothing on
    // them between what the page says and the input.
    for (const [screen, what] of [
      [resized, 'the resized page'],
      [cleared, 'the cleared page'],
    ] as const) {
      expect(theGapOn(screen, PROMPT), `${what} has nothing left over`).toBeGreaterThan(0);
    }
  }, 240_000);

  it('⚠️ follows a window that only changed HEIGHT, both ways', async () => {
    // THE ACHADO OF THIS DELIVERY, and it is the geometry where the promise was not kept. The
    // page is turned for a resize only when the OPENING the terminal would get differs from
    // the one on the screen, and a window made taller by rows no glyph depends on is the same
    // opening — so nothing was written at all. Measured, before the guard was widened: at a
    // hundred by thirty dragged to forty the byte stream was IDENTICAL on either side of the
    // resize, and the input stayed eleven rows above the foot.
    //
    // BOTH WAYS IN ONE RUN, because the two directions are different mechanisms as far as the
    // terminal is concerned — growing leaves rows over and shrinking takes them away — and a
    // guard that only noticed one of them would be half a fix.
    const columns = 100;
    const short = 30;
    const tall = 40;
    const ran = await inPty({
      columns,
      rows: short,
      steps: [
        opens,
        {
          resize: { columns, rows: tall },
          until: (bytes) => times(bytes, TOP_LEFT) > 1,
          what: 'drew the page again at the new height',
        },
        {
          resize: { columns, rows: short },
          until: (bytes) => times(bytes, TOP_LEFT) > 2,
          what: 'drew the page again back at the old height',
        },
        leaves,
      ],
    });
    const grown = screenOf(ran.bytes.slice(0, ran.at[1] as number), columns, tall);
    const shrunk = screenOf(ran.bytes.slice(0, ran.at[2] as number), columns, short);
    endsAtTheFoot(grown, tall, 'the page that followed a taller window');
    endsAtTheFoot(shrunk, short, 'the page that followed a shorter window');
    // AND NOTHING A PANEL CAN SEE MOVED, which is what makes this the placement rather than
    // the drawing: the width never changed, and the drawing on the taller screen is the one
    // that was on the shorter — so a guard that only compared openings would have refused
    // both of these, and did.
    for (const [screen, what] of [
      [grown, 'the taller page'],
      [shrunk, 'the shorter page'],
    ] as const) {
      expect(screen.rows[0], `${what} opened cut`).toContain(`v${VERSION}`);
      expect(theGapOn(screen, PROMPT), `${what} has nothing left over`).toBeGreaterThan(0);
    }
    // Not vacuous: the two pages really were placed at different heights, so this is not one
    // screen read twice at two sizes. The taller window has ten more rows and no more to draw
    // on them, so its leftover is ten rows longer.
    expect(
      theGapOn(grown, PROMPT),
      'the taller window was left over no more than the shorter one',
    ).toBe(theGapOn(shrunk, PROMPT) + (tall - short));
  }, 240_000);
});
