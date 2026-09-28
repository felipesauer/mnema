/**
 * A READ ASKED AGAIN IS SEEN — by the page where its answer changes it, and by a row at the foot
 * saying so where it does not.
 *
 * THIS SURFACE WAS SAID TO STOP DRAWING, AND THEN TO DRAW LATE, and both readings came out of one
 * measurement that was true about the wire and wrong about the page. Asked for the longest answer
 * it gives twice, the console put nothing on the wire for the second one — not the keys, not the
 * answer — and a burst of bytes turned up when the session left. Counted in bytes per step at six
 * heights it looked like a curve: nothing under forty-two rows, nothing for the second read at
 * forty-two and sixty, and the second read one or two steps late at a hundred and two hundred. Read
 * as a curve it said a frame was being held, and that the height decided for how long.
 *
 * IT WAS THREE THINGS, AND NONE OF THEM IS A HELD FRAME:
 *
 *   - UNDER THE FLOOR THERE IS NO CONSOLE TO DRAW. Twenty-four and thirty rows are under it
 *     (`src/repl/floor.ts`), so the page is the screen that says so, and what a verb answers goes
 *     on the roll without being shown until the window grows or the session hands the roll back
 *     (`a-floor-under-the-window.test.ts`).
 *   - WHERE THE WINDOW IS SHORTER THAN THE ANSWER, THE SECOND ANSWER LEFT THE FIRST PAGE — at
 *     forty-two rows and at sixty. The answer is the same document and it is taller than the
 *     window, so the window after the second read is the tail of the same answer the first one
 *     left — the same rows, byte for byte — and the layout writes nothing for a frame identical to
 *     the one on the screen (`support/pty.ts`, {@link aFrameSince}). Measured by asking the layout
 *     for every frame it composed: the second answer was on the roll forty milliseconds after its
 *     keys, and the frame composed for it was the frame already drawn.
 *   - AT A HUNDRED AND TWO HUNDRED THE STEP ENDED EARLY. There the window holds more than the
 *     answer, so the second read does change the page, and it drew about a tenth of a second
 *     after its keys. What put it a step or two late was a wait for a marker anywhere in the
 *     stream, which the FIRST answer had already written, so the step ended before the second one
 *     arrived. Replayed on the code of that day with exactly that wait, the same bytes land in the
 *     same late columns; with a wait for what the step caused they land in its own.
 *
 * THE SECOND OF THOSE WAS PINNED HERE AS THE RULE, AND IT IS THE HALF THAT MOVED. The first case of
 * this file said the page a second identical read left IS the page the first one left, with nothing
 * drawn — asserted by a blank line under it, because the read itself had no frame to wait for. It
 * was true, and it was a defect: an answer that lands without a byte of the screen moving is an
 * answer a reader decides never came. So the console says so now. When an answer ends and the
 * window shows exactly what it showed when the answer began, the frame after it has ONE ROW MORE AT
 * THE FOOT saying that, and the window gives the row up from its top (`src/repl/console.ts`,
 * `judged`; `src/repl/session.ts`, `alreadyOnThePage`). The premise that fell is *a second identical
 * answer draws no frame*. What the layout does with a frame identical to the one on the screen did
 * not change — it still writes nothing — but the frame after that answer is not identical any more,
 * and it is what the first case below now waits for and asserts.
 *
 * AND THE ROW IS THE WHOLE OF THE CHANGE. On the other side of the height it is never drawn, because
 * there the answer moves the page by itself; a different read moves it too; a reader who has walked
 * back is never told, because for them the end of the answer is not on the page at all; and an
 * answer with a pasted line already waiting behind it raises nothing, because nothing would be left
 * to take the row down before the next answer changed the page under it.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CliIo, run } from '../src/cli.js';
import { fact } from '../src/presentation/detail.js';
import { renderPlain, widthOf } from '../src/presentation/plain.js';
import { openConsole } from '../src/repl/console.js';
import { THE_FLOOR } from '../src/repl/floor.js';
import { alreadyOnThePage } from '../src/repl/session.js';
import { REPL_VERB } from '../src/wiring/repl.js';
import { ENDS_THE_INPUT, fakeTerminal, hooksNothing, until } from './support/console.js';
import {
  aFrameSince,
  aPageWithout,
  asFarAs,
  inPty,
  leavesTheSession,
  opensAConsole,
  type Ran,
  type Step,
} from './support/pty.js';
import { promptRow, type Screen, screenOf, theSettledScreen } from './support/screen.js';

/** The built CLI — the same file the `mnema` bin points at. */
const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

/** What the caller types in front of, as the layout writes it: trimmed at the end. */
const PROMPT = 'mnema>';

/**
 * THE LONGEST ANSWER THIS SESSION GIVES — a read of the record, and the same document every time
 * it is asked over a record that did not move.
 *
 * The sameness is the fixture. A verb whose answer changed between two asks would change the page
 * whatever the height, and the rule these cases are about would have nothing to decide.
 */
const THE_LONGEST_READ = 'brief';

/** The line a read was asked on, as the roll holds it: the prompt and the word. */
const ASKED = `${PROMPT} ${THE_LONGEST_READ}`;

/** The heading that closes the answer — on the page whenever its end is. */
const CLOSES_THE_ANSWER = '## Patterns adopted';

/**
 * A READ WHOSE ANSWER IS NOT THAT DOCUMENT — the most recent records, a handful of rows — and the
 * words its answer begins with, which nothing else on the page says.
 */
const A_DIFFERENT_READ = 'search';
const THE_DIFFERENT_ANSWER = 'record(s):';

/**
 * THE ROW THIS FILE IS ABOUT, in the words the session composes for it — read off the product
 * rather than retyped, so a reworded row moves these cases with it instead of leaving them
 * asserting a sentence nobody draws.
 */
const THE_ROW = renderPlain(alreadyOnThePage());

/**
 * The glyph the guide down the margin of the roll is drawn out of (`src/repl/region.ts`, `bar`) —
 * spelled by code point, like every other unusual byte in this repository.
 */
const THE_GUIDE = '│';

/** The keys that move the window, as a terminal sends them. */
const PAGE_UP = '\u001b[5~';
const TO_THE_TAIL = '\u001b[F';

/** The key that erases the character before the caret, as a terminal sends it. */
const ERASE = '\u007f';

/** How wide the terminal is where the window holds more than the answer. */
const COLUMNS = 100;

/**
 * A WINDOW TALLER THAN THE ANSWER — tall enough that the second read's line and the end of the
 * first answer are both on the page. It is a SIZE and not a threshold: which side of the rule a
 * window is on is read off the page in the case, never assumed from this number.
 */
const TALLER_THAN_THE_ANSWER = 100;

// ---------------------------------------------------------------------------
// The fixture
// ---------------------------------------------------------------------------

let sandbox: string;
let project: string;
let environment: NodeJS.ProcessEnv;
const before = { cwd: process.cwd(), env: { ...process.env } };

beforeAll(async () => {
  // ITS OWN SANDBOX, and a home inside it: a session opened where this case stands would be
  // measuring a project it is also changing, and the key root lives under `HOME`.
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-asked-again-'));
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
  await run(['task', 'the task the answer is read over'], io);

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

/** Runs the console on a pseudo-terminal of the given size, over the fixture's project. */
function drive(columns: number, rows: number, steps: readonly Step[]): Promise<Ran> {
  return inPty(
    { cli: CLI, verb: REPL_VERB, project, scratch: sandbox, environment },
    { columns, rows, steps },
  );
}

/** The rows of a page that are rows of the roll — the ones with the guide down their margin. */
function rowsOfTheRoll(page: Screen): readonly string[] {
  return page.rows.filter((row) => row.includes(THE_GUIDE));
}

/** How many times `what` is on a page. */
function timesOn(page: Screen, what: string): number {
  return page.text.split(what).length - 1;
}

/**
 * THE PAGE AT THIS SIZE, OR NOTHING — the replay a step asks while it waits.
 *
 * A replay that cannot find a page is not an answer, so it is `undefined` rather than a throw that
 * would end the step early.
 */
function thePageNow(bytes: string, columns: number, rows: number): Screen | undefined {
  try {
    return theSettledScreen(bytes, columns, rows);
  } catch {
    return undefined;
  }
}

/**
 * A FRAME THIS STEP CAUSED, WHOSE PAGE HOLDS `what` AT LEAST `times` TIMES — the question each
 * case then asks, asked of the same object while the step waits.
 *
 * THE PAGE AND NOT THE WIRE, which is the whole of what this file corrects. What arrived is
 * cumulative and says nothing about which of two identical answers is showing; a replay at the
 * size says what a reader is looking at.
 */
function aPageHolding(
  columns: number,
  rows: number,
  what: string,
  times = 1,
): (bytes: string, since: number) => boolean {
  const caused = aFrameSince(PROMPT);
  return (bytes, since) => {
    if (!caused(bytes, since)) return false;
    const page = thePageNow(bytes, columns, rows);
    return page !== undefined && timesOn(page, what) >= times;
  };
}

/** The step that asks for the answer and waits until its end is on the page. */
function asks(columns: number, rows: number, times = 1): Step {
  return {
    types: `${THE_LONGEST_READ}\r`,
    until: aPageHolding(columns, rows, CLOSES_THE_ANSWER, times),
    what: times === 1 ? `asked ${THE_LONGEST_READ}` : `asked ${THE_LONGEST_READ} again`,
  };
}

/**
 * THE STEP THAT ASKS THE SAME READ AGAIN WHERE ITS ANSWER OUTGROWS THE WINDOW, and waits for the
 * row that says so.
 *
 * IT USED TO HAVE NOTHING OF ITS OWN TO WAIT FOR, and that was the subject rather than a shortcut:
 * the second answer left the page the first one left, the layout writes nothing for a frame
 * identical to the one on the screen, and a step waiting for a frame it caused waited out the
 * driver's whole budget. So it waited for the stream to go quiet and read nothing at its end. It
 * has a frame of its own now, and the frame is the row — which the console raises only once the
 * answer has ENDED, so a page holding it is a page the whole answer is already on.
 */
function asksAgainAndIsTold(columns: number, rows: number): Step {
  return {
    types: `${THE_LONGEST_READ}\r`,
    until: aPageHolding(columns, rows, THE_ROW),
    what: `asked ${THE_LONGEST_READ} again and was told it landed`,
  };
}

/** A step that presses a key and waits for the frame it caused. */
function presses(what: string, keys: string): Step {
  return { types: keys, until: aFrameSince(PROMPT), what };
}

/**
 * WHAT THE SESSION HANDED BACK — the caller's own buffer once it has left, one trimmed line each.
 *
 * It is the roll, whole and in the order it landed (`src/repl/scrolling.ts`, `theTranscript`),
 * written after the queue has drained — so it answers *did it land* with no clock in the question,
 * which is the one thing a page shorter than the answer cannot answer at all.
 */
function whatWasHandedBack(ran: Ran, columns: number, rows: number): readonly string[] {
  const left = screenOf(ran.bytes, columns, rows);
  expect(left.alternate, 'the session never gave the screen back').toBe(false);
  return `${left.aboveText}\n${left.beneath}`.split('\n').map((line) => line.trim());
}

/**
 * THE SIDE OF THE RULE, READ OFF THE PAGE: the end of the answer is showing and the line it was
 * asked on is not, so the answer is taller than the window at this size. A shorter answer or a
 * taller floor would put a case on the other side, and it says so instead of passing there.
 */
function outgrowsTheWindow(page: Screen): void {
  expect(page.text, 'the end of the answer never reached the page').toContain(CLOSES_THE_ANSWER);
  expect(
    page.text,
    'the whole answer fits the window here, so this is the other side',
  ).not.toContain(ASKED);
}

/**
 * THE SAME ROLL, LESS WHAT THE ROW TOOK FROM ITS TOP — the window after the row went up, read
 * against the window before it.
 *
 * A SUFFIX AND NOT A SLICE OF ONE, because the answer FOLDS here: its widest lines are wider than
 * the floor has inside its margin, so a line of the roll can be two rows of the page, and a window
 * one row shorter gives up the whole line at its top — one row or two. What it may never do is
 * lose a row at its FOOT, which is where the end of the answer is: a row drawn at the foot of the
 * area and not counted by it makes the frame a row taller than the screen, and the row a frame
 * like that loses is the last one of the window.
 */
function theSameRollLessItsTop(
  shorter: readonly string[],
  whole: readonly string[],
  what: string,
): void {
  expect(shorter.length, `${what}: the window is not shorter than it was`).toBeLessThan(
    whole.length,
  );
  expect(shorter, `${what}: the window is not the same tail`).toEqual(
    whole.slice(whole.length - shorter.length),
  );
}

describe('a read asked again is seen, on the page or on a row saying the page did not move', () => {
  it('says so on a row at the foot where the answer outgrows the window, over the same roll', async () => {
    // AT THE FLOOR, which is the shortest window this console draws a page on, the narrowest, and
    // the one a recording is most likely to be made at. The window there has fewer rows than the
    // answer, which the first assertion below reads off the page rather than assuming.
    const { columns, rows } = THE_FLOOR;
    const ran = await drive(columns, rows, [
      opensAConsole(PROMPT),
      asks(columns, rows),
      asksAgainAndIsTold(columns, rows),
      leavesTheSession,
    ]);
    const first = theSettledScreen(asFarAs(ran, 1), columns, rows);
    const again = theSettledScreen(asFarAs(ran, 2), columns, rows);
    outgrowsTheWindow(first);
    expect(first.text, 'the row was on the page before any answer left it as it was').not.toContain(
      THE_ROW,
    );
    // THE ROW, ONCE, AT THE FOOT: under every row of the roll and over the row being typed — the
    // top of the input area, which is where it is drawn (`src/repl/region.ts`, `Present`).
    expect(timesOn(again, THE_ROW), 'the row is not on the page exactly once').toBe(1);
    const at = again.rows.findIndex((row) => row.includes(THE_ROW));
    const lastOfTheRoll = again.rows.findLastIndex((row) => row.includes(THE_GUIDE));
    expect(at, 'the row is not under the window').toBeGreaterThan(lastOfTheRoll);
    expect(at, 'the row is not over the row being typed').toBeLessThan(promptRow(again, PROMPT));
    // AND THE ROLL IS THE SAME ROLL: the second answer's end is the end the first one left, and all
    // that moved is the row the window gave up at its top for the row at the foot. This is the
    // assertion the first case used to make with a blank line under the page — the page after it,
    // less its last row, was the page before less its first — made now about the frame the answer
    // itself drew.
    theSameRollLessItsTop(rowsOfTheRoll(again), rowsOfTheRoll(first), 'after the second read');
    // AND IT WAS ANSWERED, WHICH THE ROLL SAYS AND THE PAGE CANNOT: in what the session handed
    // back, both reads and both answers are there, in order.
    const handedBack = whatWasHandedBack(ran, columns, rows);
    expect(
      handedBack.filter((line) => line === ASKED).length,
      'the roll does not hold both reads',
    ).toBe(2);
    expect(
      handedBack.filter((line) => line.startsWith(CLOSES_THE_ANSWER)).length,
      'the second answer is not on the roll',
    ).toBe(2);
    // AND THE ROW IS NOT IN IT. It is the frame's and never the roll's: it says something about the
    // page as it was drawn, and the caller's own buffer is what the session SAID.
    expect(
      handedBack.some((line) => line.includes(THE_ROW)),
      'the row leaked into the transcript',
    ).toBe(false);
  }, 240_000);

  it('takes the row down with the next key that is not a scroll, and puts it back for the next answer like it', async () => {
    // THE MOMENT THE ROW COMES DOWN, and the two things that must NOT take it down. It stands
    // until the next key that is not a scroll (`src/repl/console.ts`, `key`): a reader who takes
    // its advice and scrolls back keeps it, and the first key of the next line takes it — so the
    // next answer is judged on a page without it and raises it again if it too left the page.
    const { columns, rows } = THE_FLOOR;
    const ran = await drive(columns, rows, [
      opensAConsole(PROMPT),
      asks(columns, rows),
      asksAgainAndIsTold(columns, rows),
      presses('walked a page back', PAGE_UP),
      presses('went back to the tail', TO_THE_TAIL),
      // A LETTER IS THE FIRST KEY OF A LINE, and it is answered at once — a key is not a line and
      // does not wait on the session's queue — so the frame it causes is the page without the row.
      {
        types: 'x',
        until: aPageWithout(PROMPT, columns, rows, THE_ROW),
        what: 'typed the first letter of a line',
      },
      presses('erased it', ERASE),
      // THE THIRD COPY, TYPED AND SUBMITTED AS TWO STEPS, which is what makes the row's coming back
      // a frame of its own: the row is already down while the word is typed, and what the Return
      // produces once the answer has ended is the row going up again.
      presses(`typed ${THE_LONGEST_READ}`, THE_LONGEST_READ),
      { types: '\r', until: aPageHolding(columns, rows, THE_ROW), what: 'asked it a third time' },
      leavesTheSession,
    ]);
    const told = theSettledScreen(asFarAs(ran, 2), columns, rows);
    const walked = theSettledScreen(asFarAs(ran, 3), columns, rows);
    const back = theSettledScreen(asFarAs(ran, 4), columns, rows);
    const typed = theSettledScreen(asFarAs(ran, 5), columns, rows);
    const third = theSettledScreen(asFarAs(ran, 8), columns, rows);
    outgrowsTheWindow(told);
    expect(told.text, 'the second read raised no row').toContain(THE_ROW);
    // SCROLLING IS DOING WHAT THE ROW SAYS, AND IT LEAVES THE ROW. The walk really moved the window
    // — the end of the answer went off the page — and the row stayed through it and back.
    expect(walked.text, 'PgUp did not walk the window back').not.toContain(CLOSES_THE_ANSWER);
    expect(walked.text, 'walking back took the row down').toContain(THE_ROW);
    expect(back.rows, 'End did not come back to the page the row was raised on').toEqual(told.rows);
    // THE FIRST KEY OF A LINE TAKES IT DOWN, and the window has its row back: the same tail, whole.
    expect(typed.text, 'a letter left the row up').not.toContain(THE_ROW);
    theSameRollLessItsTop(rowsOfTheRoll(told), rowsOfTheRoll(typed), 'with the row taken down');
    // AND THE NEXT ANSWER THAT LEAVES THE PAGE AS IT WAS PUTS IT BACK, over the same roll again —
    // which is the promise a moment chosen any later would break: a third copy of the same
    // document drawing nothing, exactly as the second one used to.
    expect(timesOn(third, THE_ROW), 'the third read raised no row').toBe(1);
    expect(rowsOfTheRoll(third), 'the third read left another page').toEqual(rowsOfTheRoll(told));
  }, 240_000);

  it('draws the second answer in its own step, and no row, where the window holds more than it', async () => {
    const rows = TALLER_THAN_THE_ANSWER;
    const ran = await drive(COLUMNS, rows, [
      opensAConsole(PROMPT),
      asks(COLUMNS, rows),
      // A FRAME THIS STEP CAUSED WITH BOTH ENDINGS ON THE PAGE, which only the second answer can
      // produce. If that frame were held for a later step, this step would never end and the
      // driver would say so — which is what "in its own step" means on a device.
      asks(COLUMNS, rows, 2),
      leavesTheSession,
    ]);
    const first = theSettledScreen(asFarAs(ran, 1), COLUMNS, rows);
    const again = theSettledScreen(asFarAs(ran, 2), COLUMNS, rows);
    // THE OTHER SIDE OF THE RULE, READ OFF THE PAGE: the line the first read was asked on is still
    // showing under its answer, so the window holds more than the answer.
    expect(first.text, 'the answer is taller than the window here').toContain(ASKED);
    // SO THE SECOND READ CHANGES THE PAGE, and what it shows is the line it was asked on right
    // under the end of the first answer.
    expect(again.rows, 'the second answer left the page as it was').not.toEqual(first.rows);
    const endOfTheFirst = rowsOfTheRoll(first).at(-1);
    const secondAsked = again.rows.findLastIndex((row) => row.includes(ASKED));
    expect(secondAsked, 'the second read is not on the page').toBeGreaterThan(0);
    expect(again.rows[secondAsked - 1], 'the second read does not follow the first answer').toBe(
      endOfTheFirst,
    );
    // AND THERE IS NO ROW, because a page that moved is an answer a reader saw land: the row is for
    // the page that did not, and nowhere else.
    expect(again.text, 'a row said the page did not move, on a page that moved').not.toContain(
      THE_ROW,
    );
  }, 240_000);

  it('draws no row when a different read changes the page', async () => {
    // THE SAME HEIGHT AS THE FIRST CASE, AND A DIFFERENT ANSWER: what decides the row is the page,
    // not the height and not the verb.
    const { columns, rows } = THE_FLOOR;
    const ran = await drive(columns, rows, [
      opensAConsole(PROMPT),
      asks(columns, rows),
      {
        types: `${A_DIFFERENT_READ}\r`,
        until: aPageHolding(columns, rows, THE_DIFFERENT_ANSWER),
        what: `asked ${A_DIFFERENT_READ}`,
      },
      leavesTheSession,
    ]);
    const first = theSettledScreen(asFarAs(ran, 1), columns, rows);
    const other = theSettledScreen(asFarAs(ran, 2), columns, rows);
    outgrowsTheWindow(first);
    expect(other.text, 'the different read is not on the page').toContain(
      `${PROMPT} ${A_DIFFERENT_READ}`,
    );
    expect(other.text, 'a row said the page did not move, on a page that moved').not.toContain(
      THE_ROW,
    );
  }, 240_000);

  it('says nothing to a reader who has walked back, whose page no answer moves', async () => {
    // A READER WHO HAS WALKED BACK SEES NO ANSWER MOVE THE PAGE — that is the promise the roll
    // keeps (`src/repl/scrolling.ts`, `landedIn`) — and for them the end of the answer is not on
    // the page at all, so a row saying *its end was already on the page* would be false. The
    // answer is typed and submitted as two steps because each half changes the row being typed,
    // which is a frame; the page above the row does not move either way.
    const { columns, rows } = THE_FLOOR;
    const ran = await drive(columns, rows, [
      opensAConsole(PROMPT),
      asks(columns, rows),
      presses('walked a page back', PAGE_UP),
      presses(`typed ${A_DIFFERENT_READ} while walked back`, A_DIFFERENT_READ),
      presses(`submitted ${A_DIFFERENT_READ} while walked back`, '\r'),
      // AND BACK TO THE TAIL, which is what says the answer landed at all: End moves the window and
      // leaves the row as it was (`src/repl/console.ts`, `key`), so a row raised while the reader
      // was walked back would still be on this page.
      {
        types: TO_THE_TAIL,
        until: aPageHolding(columns, rows, THE_DIFFERENT_ANSWER),
        what: 'went back to the tail',
      },
      leavesTheSession,
    ]);
    const walked = theSettledScreen(asFarAs(ran, 2), columns, rows);
    const submitted = theSettledScreen(asFarAs(ran, 4), columns, rows);
    const tail = theSettledScreen(asFarAs(ran, 5), columns, rows);
    expect(walked.text, 'PgUp did not walk the window back').not.toContain(CLOSES_THE_ANSWER);
    expect(
      rowsOfTheRoll(submitted),
      'an answer moved the page of a reader who had walked back',
    ).toEqual(rowsOfTheRoll(walked));
    expect(tail.text, 'the answer never landed').toContain(THE_DIFFERENT_ANSWER);
    expect(
      submitted.text,
      'a reader who had walked back was told the end was on the page',
    ).not.toContain(THE_ROW);
    expect(
      tail.text,
      'a reader who had walked back was told the end was on the page',
    ).not.toContain(THE_ROW);
  }, 240_000);

  it('draws no row for an answer a line already waiting behind it goes on to change', async () => {
    // TWO LINES IN ONE WRITE, WHICH IS A PASTE: the same read again, whose answer leaves the page as
    // it was, and a different read behind it, whose answer does not. The second line's keys are
    // answered before the first answer has ended, so a row the first one raised would have nothing
    // left to take it down — and it would stand over the different read's answer, saying the end
    // was already on a page that has just changed (`src/repl/console.ts`, `judged`).
    const { columns, rows } = THE_FLOOR;
    const ran = await drive(columns, rows, [
      opensAConsole(PROMPT),
      asks(columns, rows),
      {
        types: `${THE_LONGEST_READ}\r${A_DIFFERENT_READ}\r`,
        until: aPageHolding(columns, rows, THE_DIFFERENT_ANSWER),
        what: `pasted ${THE_LONGEST_READ} and ${A_DIFFERENT_READ}`,
      },
      leavesTheSession,
    ]);
    const pasted = theSettledScreen(asFarAs(ran, 2), columns, rows);
    expect(pasted.text, 'the read behind it is not on the page').toContain(
      `${PROMPT} ${A_DIFFERENT_READ}`,
    );
    expect(
      pasted.text,
      'a row said the page did not move, over the answer that moved it',
    ).not.toContain(THE_ROW);
    // AND BOTH LINES WERE ANSWERED, in the order they were pasted: the transcript is the roll.
    const handedBack = whatWasHandedBack(ran, columns, rows);
    expect(
      handedBack.filter((line) => line === ASKED).length,
      'the pasted read was not answered',
    ).toBe(2);
    expect(
      handedBack.lastIndexOf(ASKED),
      'the pasted lines were answered out of order',
    ).toBeLessThan(handedBack.indexOf(`${PROMPT} ${A_DIFFERENT_READ}`));
  }, 240_000);

  it('says nothing to a reader who has walked back, with the answer over before the next key', async () => {
    // THE SAME PROMISE AS THE CASE ABOVE IT, IN PROCESS, AND FOR ONE REASON: ORDER. On a device the
    // key that goes back to the tail is written once the stream has been quiet, and an answer that
    // is still running then is answered AFTER the key — at the tail, where the row is judged on a
    // page that moved and says nothing whatever the rule. Here the answer is the case's own, so the
    // key is pressed only once it has returned and everything queued behind it has run
    // (`src/repl/console.ts`, `judged`), and a row raised for the reader who had walked back would
    // be on the page the key draws.
    const { columns, rows } = THE_FLOOR;
    const terminal = fakeTerminal({ columns, rows });
    let answered = false;
    const page = openConsole({
      stdin: terminal.stdin,
      stdout: terminal.stdout,
      prompt: `${PROMPT} `,
      renderingAt: () => renderPlain,
      tips: { text: '', width: 0 },
      unmoved: { text: THE_ROW, width: widthOf(alreadyOnThePage()) },
      picking: fact('nothing to pick'),
      badge: () => ({ text: '', width: 0 }),
      openingFor: () => ({ panel: undefined, lines: [], rows: 0, above: 0 }),
      saw: () => undefined,
      happened: () => [],
      complete: () => [[], ''],
      answer: async (line) => {
        for (let at = 0; at < 3; at += 1) page.land(`${line} answered ${at}`);
        answered = true;
        return 'go on';
      },
      leaving: hooksNothing,
    });
    const thePage = (): Screen | undefined => thePageNow(terminal.bytes(), columns, rows);
    // A ROLL TWICE AS TALL AS THE WINDOW, every line of it different, so a walk back has somewhere
    // to go and the page it lands on says where it is.
    for (let at = 0; at < rows * 2; at += 1) page.land(`said ${at}`);
    await until(() => thePage()?.text.includes(`said ${rows * 2 - 1}`) === true, 'drew the roll');
    terminal.type(PAGE_UP);
    await until(() => thePage()?.text.includes(`said ${rows * 2 - 1}`) === false, 'walked back');
    const walked = thePage() as Screen;
    terminal.type('asked\r');
    await until(() => answered, 'answered the line');
    terminal.type(TO_THE_TAIL);
    await until(() => thePage()?.text.includes('asked answered 2') === true, 'went to the tail');
    const tail = thePage() as Screen;
    expect(walked.text, 'the walk back left the row on the page').not.toContain(THE_ROW);
    expect(
      tail.text,
      'a reader who had walked back was told the end was on the page',
    ).not.toContain(THE_ROW);
    terminal.type(ENDS_THE_INPUT);
    await page.closed;
  }, 60_000);
});
