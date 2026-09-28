/**
 * A READ ASKED AGAIN DRAWS WHAT CHANGED ON THE PAGE — and on a window shorter than the answer,
 * nothing did.
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
 *   - WHERE THE WINDOW IS SHORTER THAN THE ANSWER, THE SECOND ANSWER LEAVES THE FIRST PAGE — at
 *     forty-two rows and at sixty. The answer is the same document and it is taller than the
 *     window, so the window after the second read is the tail of the same answer the first one
 *     left — the same rows, byte for byte — and the layout writes nothing for a frame identical to
 *     the one on the screen (`support/pty.ts`, {@link aFrameSince}). Measured by asking the layout
 *     for every frame it composed: the second answer was on the roll forty milliseconds after its
 *     keys, and the frame composed for it was the frame already drawn. The keys were never going
 *     to show either: the line was written in one piece, so the row came and went inside one
 *     frame. The bytes on the way out are the leaving itself — the row being typed landing on the
 *     roll, the frame the library draws as it unmounts, and the transcript.
 *   - AT A HUNDRED AND TWO HUNDRED THE STEP ENDED EARLY. There the window holds more than the
 *     answer, so the second read does change the page, and it drew about a tenth of a second
 *     after its keys. What put it a step or two late was a wait for a marker anywhere in the
 *     stream, which the FIRST answer had already written, so the step ended before the second one
 *     arrived — and a window with no console on it never shows that marker at all, which is why
 *     the short sizes had no number. Replayed on the code of that day with exactly that wait, the
 *     same bytes land in the same late columns; with a wait for what the step caused they land in
 *     its own.
 *
 * THE RULE WAS ALREADY WRITTEN DOWN, three files away, as a fact about the model: *two runs of the
 * same verb produce identical frames once the window has filled* (`the-screen-is-ours.test.ts`,
 * `submits`). It was a comment on a helper and nothing asserted it, so a case elsewhere could say
 * the opposite without either of them going red. These two cases assert it, one on each side of
 * the height that decides it: where the answer is taller than the window, and where it is not.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CliIo, run } from '../src/cli.js';
import { THE_FLOOR } from '../src/repl/floor.js';
import { REPL_VERB } from '../src/wiring/repl.js';
import {
  aFrameSince,
  asFarAs,
  inPty,
  leavesTheSession,
  opensAConsole,
  type Ran,
  type Step,
} from './support/pty.js';
import { type Screen, screenOf, theSettledScreen } from './support/screen.js';

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
 * The glyph the guide down the margin of the roll is drawn out of (`src/repl/region.ts`, `bar`) —
 * spelled by code point, like every other unusual byte in this repository.
 */
const THE_GUIDE = '\u2502';

/** A blank line on the roll, as the page draws it: the guide, and the prompt with nothing after. */
const A_BLANK_LINE = `${THE_GUIDE} ${PROMPT}`;

/** How wide every terminal here is: wide enough for the whole name and every rule. */
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

/** Runs the console on a pseudo-terminal of the given height, over the fixture's project. */
function drive(rows: number, steps: readonly Step[]): Promise<Ran> {
  return inPty(
    { cli: CLI, verb: REPL_VERB, project, scratch: sandbox, environment },
    { columns: COLUMNS, rows, steps },
  );
}

/** The rows of a page that are rows of the roll — the ones with the guide down their margin. */
function rowsOfTheRoll(page: Screen): readonly string[] {
  return page.rows.filter((row) => row.includes(THE_GUIDE));
}

/**
 * THE PAGE AT THIS SIZE, OR NOTHING — the replay a step asks while it waits.
 *
 * A replay that cannot find a page is not an answer, so it is `undefined` rather than a throw that
 * would end the step early.
 */
function thePageNow(bytes: string, rows: number): Screen | undefined {
  try {
    return theSettledScreen(bytes, COLUMNS, rows);
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
  rows: number,
  what: string,
  times = 1,
): (bytes: string, since: number) => boolean {
  const caused = aFrameSince(PROMPT);
  return (bytes, since) => {
    if (!caused(bytes, since)) return false;
    const page = thePageNow(bytes, rows);
    return page !== undefined && page.text.split(what).length - 1 >= times;
  };
}

/** A frame this step caused, whose roll now ENDS in `ending` — the line the step landed. */
function aRollEndingIn(rows: number, ending: string): (bytes: string, since: number) => boolean {
  const caused = aFrameSince(PROMPT);
  return (bytes, since) => {
    if (!caused(bytes, since)) return false;
    const page = thePageNow(bytes, rows);
    const last = page === undefined ? undefined : rowsOfTheRoll(page).at(-1);
    return last?.trimEnd().endsWith(ending) === true;
  };
}

/** The step that asks for the answer and waits until its end is on the page. */
function asks(rows: number, times = 1): Step {
  return {
    types: `${THE_LONGEST_READ}\r`,
    until: aPageHolding(rows, CLOSES_THE_ANSWER, times),
    what: times === 1 ? `asked ${THE_LONGEST_READ}` : `asked ${THE_LONGEST_READ} again`,
  };
}

/**
 * THE LAST ROW OF THE ROLL ON A PAGE — the last line the window shows.
 *
 * It is how a case names *the end of the first answer* without spelling a sentence the product
 * may reword: read off the page the first answer left, and looked for again later.
 */
function theLastLineOfTheRoll(page: Screen): string {
  const line = rowsOfTheRoll(page).at(-1);
  expect(line, 'no row of the roll is on this page').toBeDefined();
  expect((line as string).trim(), 'the roll ends in a row with nothing on it').not.toBe(THE_GUIDE);
  return line as string;
}

/** What a row of the roll SAYS: the text after the guide, without the page's own margin. */
function withoutTheGuide(row: string): string {
  return row.slice(row.indexOf(THE_GUIDE) + THE_GUIDE.length).trim();
}

/**
 * WHAT THE SESSION HANDED BACK — the caller's own buffer once it has left, one trimmed line each.
 *
 * It is the roll, whole and in the order it landed (`src/repl/scrolling.ts`, `theTranscript`),
 * written after the queue has drained — so it answers *did it land* with no clock in the question,
 * which is the one thing a page shorter than the answer cannot answer at all.
 */
function whatWasHandedBack(ran: Ran, rows: number): readonly string[] {
  const left = screenOf(ran.bytes, COLUMNS, rows);
  expect(left.alternate, 'the session never gave the screen back').toBe(false);
  return `${left.aboveText}\n${left.beneath}`.split('\n').map((line) => line.trim());
}

describe('a read asked again draws what changed on the page, and lands either way', () => {
  it('leaves the page as it was where the answer outgrows the window, and lands it', async () => {
    // AT THE FLOOR, which is the shortest window this console draws a page on and the one a
    // recording is most likely to be made at. The window there has fewer rows than the answer,
    // which the first assertion below reads off the page rather than assuming.
    const rows = THE_FLOOR.rows;
    const ran = await drive(rows, [
      opensAConsole(PROMPT),
      asks(rows),
      // THE SAME READ AGAIN, AND IT HAS NOTHING OF ITS OWN TO WAIT FOR — which is the subject
      // rather than a shortcut. The second answer leaves the page the first one left, and the
      // layout writes nothing for a frame identical to the one on the screen, so a step waiting
      // for a frame it caused would wait out the driver's whole budget: the red this surface was
      // once read as "stops drawing" by. So this step waits for the stream to go quiet, and
      // NOTHING IS READ AT ITS END. A read runs on the session's own queue, after its keys, so the
      // quiet can come before the answer has landed at all — a page read here could be the page
      // from before it, which would make the assertion below true for nothing.
      { types: `${THE_LONGEST_READ}\r`, until: () => true, what: 'asked the same again' },
      // A BLANK LINE, WHICH IS WHAT MAKES THE STEP ABOVE READABLE. It is submitted like any line,
      // so it waits on the same queue for the read before it to have finished, and all it lands
      // is itself — the prompt with nothing after it, because a blank line does nothing and says
      // nothing (`src/repl/gate.ts`). So the frame it draws is the page the second read left with
      // exactly one line put under it, and that frame is waited for properly.
      { types: '\r', until: aRollEndingIn(rows, A_BLANK_LINE), what: 'submitted a blank line' },
      leavesTheSession,
    ]);
    const first = theSettledScreen(asFarAs(ran, 1), COLUMNS, rows);
    const under = theSettledScreen(asFarAs(ran, 3), COLUMNS, rows);
    // THE SIDE OF THE RULE, READ OFF THE PAGE: the end of the answer is showing and the line it was
    // asked on is not, so the answer is taller than the window at this size. A shorter answer or a
    // taller floor would put this case on the other side, and it says so instead of passing there.
    expect(first.text, 'the end of the answer never reached the page').toContain(CLOSES_THE_ANSWER);
    expect(
      first.text,
      'the whole answer fits the window here, so this is the other side of the rule',
    ).not.toContain(ASKED);
    // THE PAGE THE SECOND READ LEFT IS THE PAGE THE FIRST ONE LEFT, read one line later: with the
    // blank line under it, the rows of the roll are the first page's, moved up by exactly one. A
    // second read that left anything else at the tail — its line without its answer, a line of its
    // own — would show in the rows above the blank line.
    const before = rowsOfTheRoll(first);
    const after = rowsOfTheRoll(under);
    expect(after.length, 'the window is not the height it was').toBe(before.length);
    expect(after.slice(0, -1), 'a second identical answer left another page').toEqual(
      before.slice(1),
    );
    // AND IT WAS ANSWERED, WHICH THE ROLL SAYS AND THE PAGE CANNOT: in what the session handed
    // back, the line the second read was asked on follows the last line of the first answer, and
    // the answer's closing heading is there twice.
    const handedBack = whatWasHandedBack(ran, rows);
    const asked = handedBack.flatMap((line, at) => (line === ASKED ? [at] : []));
    expect(asked.length, 'the roll does not hold both reads').toBe(2);
    expect(
      handedBack[(asked[1] as number) - 1],
      'the second read does not follow the first answer',
    ).toBe(withoutTheGuide(theLastLineOfTheRoll(first)));
    expect(
      handedBack.filter((line) => line.startsWith(CLOSES_THE_ANSWER)).length,
      'the second answer is not on the roll',
    ).toBe(2);
  }, 240_000);

  it('draws the second answer in its own step where the window holds more than it', async () => {
    const rows = TALLER_THAN_THE_ANSWER;
    const ran = await drive(rows, [
      opensAConsole(PROMPT),
      asks(rows),
      // A FRAME THIS STEP CAUSED WITH BOTH ENDINGS ON THE PAGE, which only the second answer can
      // produce. If that frame were held for a later step, this step would never end and the
      // driver would say so — which is what "in its own step" means on a device.
      asks(rows, 2),
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
    const endOfTheFirst = theLastLineOfTheRoll(first);
    const secondAsked = again.rows.findLastIndex((row) => row.includes(ASKED));
    expect(secondAsked, 'the second read is not on the page').toBeGreaterThan(0);
    expect(again.rows[secondAsked - 1], 'the second read does not follow the first answer').toBe(
      endOfTheFirst,
    );
  }, 240_000);
});
