/**
 * THE PAGE FOLLOWS THE TERMINAL — which ARRANGEMENT the opening has room for is a function of
 * the width, so a window the caller narrowed past the threshold has the wrong page on it.
 *
 * ⚠️ THE REASON USED TO BE THE FRAME, and it was written here in as many words: *the box is
 * drawn corner to corner, so the corner moves when the caller's window does*. THE FRAME IS
 * GONE — the console this was measured against draws none — and what that took away is a
 * regression rather than a rule: nothing is drawn to an edge, so a window one column narrower
 * changes no glyph and the page is not turned at all. What is left is the half that was always
 * underneath, which `panel.ts` had already written down as the question — *is what would be
 * drawn what is drawn?* — and which the frame made impossible for the value to keep, because
 * every width was a width the box folded at. Two cases of this file INVERTED on that, and they
 * are named where they are.
 *
 * IT IS A REGRESSION AND IT HAS A NAME. While the drawing was as wide as its own content, a
 * session opened at a hundred and twenty columns and narrowed to eighty still fitted; corner to
 * corner it did not, and eight rows of frame got folded in half by the terminal. That was
 * reported from real use — "it does not become responsive when the terminal changes size" — and
 * reproduced before it was fixed. The frame's departure closes that particular hole by
 * construction; what a resize still has to answer for is the FORM, and that is what is asked
 * here.
 *
 * WHAT THE FIX IS, said as the four things this file asks:
 *
 *   - THE PAGE, AGAIN, at the new size. Not a special redraw: the same function the word
 *     that clears already used, with the opening recomposed and everything the session has
 *     said landed under it. So a caller who resizes loses nothing they had read, which is
 *     asked here by a mark only the CALLER can put on a page — the echo of what they
 *     typed, never a sentence of the panel's, which is on every page there is.
 *   - EITHER MEASUREMENT, AND ONLY THROUGH THE DRAWING. ⚠️ THIS SAID `WIDTH ONLY — a window made
 *     taller moves no glyph of a drawing measured in columns`, and the drawing stopped being
 *     measured in columns alone: the name gives way by HEIGHT as well
 *     (`presentation/banner.ts`), so a window made shorter can open with a different mark.
 *     ⚠️ AND THEN IT SAID A HEIGHT TURNED A PAGE ON ITS OWN, on the premise that *a page is a
 *     drawing AND a placement* — the rows under the flow are what the height leaves over, so a
 *     page placed at one height was stale at another whatever was drawn on it. WHAT FALSIFIED IT
 *     is where those rows went: they are drawn WITH the frame now (`repl/page.ts`, `theGap`), and
 *     the frame is rebuilt on the signal itself. So a height reaches the page only through the
 *     DRAWING, and what a height that moves no glyph costs is nothing — measured as twelve pages
 *     against nought over a drag of twelve steps. The case is inverted and renamed below; what it
 *     counts is unchanged — pages, not redraws.
 *   - ONCE THE SIZE HAS SETTLED. One drag of a window corner is dozens of sizes, and a
 *     page reemitted on each of them would put a drag's worth of pages in the scrollback.
 *     Proved by COUNTING, because "it is debounced" is not observable and "there is one
 *     opening on the page after thirty changes" is.
 *   - AND NOTHING IS READ TO DO IT. That half is asked where the instrument for it already
 *     lives, `tests/the-name-and-the-hints.test.ts`, which counts the reads of the record:
 *     three width changes read what no width change reads.
 *
 * THE DELTAS OF THE OPENING are here too, and they are here rather than in
 * `the-panel.test.ts` because they came out of the same reading of the same reference: the
 * version beside the name, a rule between the two sections of the text column, and the mark's
 * own column centred. ⚠️ THE SECOND OF THEM WENT with the section it divided
 * (`.refactor/decisions/estudo-o-console-do-mnema.md`, D-b), and ⚠️ THE THIRD WENT WITH THE
 * FRAME: the place moved out of the mark's column, so there is one group in it and nothing to
 * centre. Both are inverted rather than deleted. What is left is measured against the DRAWING
 * and against the one constant the arithmetic exports, so no number in this file can drift away
 * from what is on the screen.
 */

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CliIo, run } from '../src/cli.js';
import { bannerFor } from '../src/presentation/banner.js';
import { renderPlain } from '../src/presentation/plain.js';
import { BETWEEN_COLUMNS } from '../src/repl/panel.js';
import { openSession } from '../src/repl/session.js';
import { LEAVE } from '../src/session-words.js';
import { VERSION } from '../src/version.js';
import { REPL_VERB } from '../src/wiring/repl.js';
import { ESC, fakeTerminal, hooksNothing, until, withoutLayout } from './support/console.js';
import {
  arrivedSince,
  carriedPages,
  inPty as drive,
  type Fixture,
  FRAME_IS_DRAWN,
  opensAConsole,
  type Ran,
  type Step,
} from './support/pty.js';
import { endsAtTheFoot, screenOf, theGapOn } from './support/screen.js';

/** The built CLI — the same file the `mnema` bin points at. */
const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
/** `packages/code/src`, for the guards that read the surface's own source. */
const SRC = fileURLToPath(new URL('../src', import.meta.url));
/** This package's manifest — the packaging fact the version is held against. */
const MANIFEST = fileURLToPath(new URL('../package.json', import.meta.url));

/**
 * The horizontal run the input area's two rules are drawn out of.
 *
 * Named by its code point rather than typed, like every other unusual byte in this
 * repository's sources: a run is one keystroke away from a hyphen.
 *
 * ⚠️ THERE WERE FIVE OF THEM AND FOUR WERE THE BOX'S: two corners, a third for the row ends,
 * and the vertical its sides ran down. The frame is gone, so the only glyph this file still has
 * anything to say about is the one the rules are made of — and what it says is that the panel
 * draws NONE of them (*nothing on the panel is a run of glyphs*).
 */
const RUN = '\u2500';

/** What the opening always says, whatever the terminal is like. */
const OPENED = 'a session over this project';
/** What the caller types in front of, as the layout writes it: trimmed at the end. */
const PROMPT = 'mnema>';
/** What the record says about a tree that is intact. */
const VERIFIED = 'local integrity verified';
/**
 * The first words of the one sentence the session lands UNDER the panel — what bounds the
 * opening's rows from below now that no bottom edge does (`session.ts`, `whatItRefuses`).
 */
const UNDER_THE_PANEL = 'It runs the';

/**
 * A verb the caller ran, as the page shows it: the prompt and the word they typed.
 *
 * THE ECHO AND NOT THE ANSWER, and that is the whole reason this is the mark. The panel
 * says what the record is, so `verify`'s own verdict is on an opened page as well as an
 * answered one — looking for it after a redraw would be looking at the drawing. Only a
 * caller can put this on a page.
 */
const SAID = `${PROMPT} verify`;

/**
 * WHERE THE TEXT COLUMN BEGINS on a terminal this wide: past the mark, and past the gap.
 *
 * BOTH HALVES ARE ASKED OF THE PRODUCT. The mark is asked of the module that draws it and the
 * gap is the very constant the arithmetic chooses the form by (`panel.ts`,
 * {@link BETWEEN_COLUMNS}) — so this is the elo as well as the instrument: a gap the drawing
 * spent and the arithmetic did not count would put every column read below in the wrong place.
 *
 * ⚠️ IT WAS READ OFF THE FRAME, by finding the columns a rule ran down on every row and cutting
 * between them. Two constants of this file went with that — the gap inside the border and the
 * gap beside the rule — because a cut made at a border needed correcting by whatever padding sat
 * on each side of it.
 */
function whereTheTextBegins(columns: number): number {
  const art = drawnAcross(columns);
  return Math.max(...art.map((row) => [...row].length)) + BETWEEN_COLUMNS;
}

/** Ctrl-C, which abandons the row being typed. Spelled as an escape, for the same reason. */
const CLEARS_THE_LINE = '\u0003';

// ---------------------------------------------------------------------------
// The fixture
// ---------------------------------------------------------------------------

let sandbox: string;
let project: string;
/** A project whose path is wider than the drawing of the name. See the fixture. */
let aLongerPath: string;
let environment: NodeJS.ProcessEnv;
const before = { cwd: process.cwd(), env: { ...process.env } };

/** `mnema <argv>` at the shell, in this process, and every line it wrote. */
async function shell(...argv: string[]): Promise<string[]> {
  const said: string[] = [];
  await run(argv, {
    out: (line) => said.push(line),
    err: (line) => said.push(line),
    fail: () => undefined,
  });
  return said;
}

beforeAll(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-follows-'));
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
  await shell('task', 'the task the page is opened over');

  // A SECOND PROJECT, WHOSE PATH IS LONGER THAN THE DRAWING OF THE NAME — founded for one
  // case, and named for the reason it exists.
  //
  // ⚠️ THE CASE THAT NEEDS IT USED TO RUN ON THE PROJECT ABOVE, and what falsified that is
  // the ART: a sandbox path is about forty-nine columns and the biggest drawing used to be
  // seventy, so the path was decisively the narrower group and the centring was observable.
  // The drawing is fifty columns now — ONE column wider than the path — and the case's own
  // guard against vacuity went red saying so. A case whose non-vacuity depends on the length
  // of a temporary directory decides nothing, so the difference is MADE here rather than
  // hoped for.
  aLongerPath = join(sandbox, 'a-project-whose-path-is-wider-than-the-drawing-of-the-name');
  mkdirSync(aLongerPath, { recursive: true });
  process.chdir(aLongerPath);
  await shell('init');
  process.chdir(project);

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

// ---------------------------------------------------------------------------
// A real pty whose size can be changed from outside it
// ---------------------------------------------------------------------------

/** How many times `what` occurs in `text`. */
const times = (text: string, what: string): number => text.split(what).length - 1;

/** Where this file's sessions are opened, and what they are opened with. */
const fixture = (): Fixture => ({
  cli: CLI,
  verb: REPL_VERB,
  project,
  scratch: sandbox,
  environment,
});

/**
 * Runs `mnema repl` on a pseudo-terminal of a given size, resizing it between steps.
 *
 * ⚠️ IT WAS A DRIVER OF THIS FILE'S OWN — the same `script`, a runner naming its device, and a
 * settling loop written out again — and what took it out is the thing this delivery had to
 * assert. An ABSENCE is waited OUT rather than waited for: a page that is not turned has no byte
 * to wait for, so a step has to be able to DO something (a wait longer than the console's own
 * amortiser) before its question is asked at all. The shared instrument has that
 * (`support/pty.ts`, `Step.does`) and the copy did not, and teaching the copy would have been
 * the second idea of *wait until the session settled* that file's own header is about.
 */
async function inPty(options: {
  readonly columns: number;
  readonly rows: number;
  readonly steps: readonly Step[];
}): Promise<Ran> {
  return drive(fixture(), options);
}

/** The step every session begins with: the console is open when its first frame is drawn. */
const opens: Step = opensAConsole(PROMPT);

/** The step every session ends with. */
const leaves: Step = {
  types: `${LEAVE}\r`,
  until: (bytes) => bytes.lastIndexOf(PROMPT) > bytes.indexOf(LEAVE),
  what: 'left',
};

/**
 * THE ROWS OF THE OPENING on a screen: from the first row with anything on it down to the
 * sentence the session lands under the panel.
 *
 * ⚠️ IT WAS `boxRowsOf` AND IT FILTERED BY THE FRAME — any row carrying a corner or a side. What
 * bounds the panel now is what is above it and what is below it: a screen whose page was carried
 * into the scrollback, and the one sentence that is landed rather than arranged (`session.ts`,
 * `whatItRefuses`).
 */
function openingRowsOf(screen: { readonly rows: readonly string[] }): string[] {
  return openingIn(screen.rows);
}

/**
 * The same question over the rows of a byte STREAM rather than of a screen.
 *
 * ONE FUNCTION AND TWO CALLERS, because it is one answer: a screen is what an emulator made of
 * the bytes, and where the opening begins and ends is the same on both. Two readings would be
 * two ideas of which rows the panel wrote.
 */
function openingIn(rows: readonly string[]): string[] {
  const first = rows.findIndex((row) => row.trim().length > 0);
  const under = rows.findIndex((row) => row.includes(UNDER_THE_PANEL));
  return first < 0 || under <= first ? [] : rows.slice(first, under);
}

// ---------------------------------------------------------------------------
// The box takes the width the terminal has NOW
// ---------------------------------------------------------------------------

describe('the page is drawn again at the width the caller left their window at', () => {
  it('follows the terminal down to 74 and back up to 120', async () => {
    // THE REGRESSION, in one case and in both directions. Opened at a hundred and twenty, the
    // text sits beside the mark; narrowed to seventy-four there is no room for it, so the page
    // this terminal would get is not the one on the screen and the console draws it again.
    //
    // ⚠️ IT WENT DOWN TO 74 AND BACK UP TO 100, and 100 was a width the FRAME made different
    // from 74 — every width was, because the box was drawn to the corner. It is not any more:
    // both of them put the text under the mark, so a step from one to the other would have been
    // a step this case waited forever for. It comes back to the width it started at, which is
    // the one width certain to differ from the middle of the drag.
    //
    // ⚠️ AND IT MEASURED THE FRAME: every row of the box had to end on the last column of the
    // new terminal. Nothing is drawn to an edge, so what is asked is what the width really
    // decides — which arrangement is on the screen, read off the drawing.
    const rows = 40;
    const ran = await inPty({
      columns: 120,
      rows,
      steps: [
        opens,
        {
          resize: { columns: 74, rows },
          until: (bytes) => times(bytes, OPENED) > 1,
          what: 'drew the opening again after shrinking',
        },
        {
          resize: { columns: 120, rows },
          until: (bytes) => times(bytes, OPENED) > 2,
          what: 'drew the opening again after growing',
        },
        leaves,
      ],
    });

    for (const [step, columns, beside] of [
      [1, 74, false],
      [2, 120, true],
    ] as const) {
      const screen = screenOf(ran.bytes.slice(0, ran.at[step] as number), columns, rows);
      const opening = openingRowsOf(screen);
      expect(opening.length, `${columns}: no opening`).toBeGreaterThan(3);
      expect(screen.text, `${columns}: no panel`).toContain(OPENED);
      // WHICH ARRANGEMENT, read the way the panel's own file reads it: the row that says what
      // the session is begins with a row of the ART when the text is beside the mark, and at the
      // left edge of the screen when it is under it.
      const title = opening.find((row) => row.includes(OPENED)) as string;
      const art = drawnAcross(columns).filter((row) => row.trim().length > 0);
      expect(
        art.some((row) => title.startsWith(row)),
        `${columns}: the text is ${beside ? 'not ' : ''}beside the mark`,
      ).toBe(beside);
      // AND NO ROW OF IT IS WIDER THAN THE TERMINAL, which is the invariant the form was chosen
      // for and the one the folded frame used to break (`panel.ts`, `panelRows`).
      for (const row of opening) {
        expect(
          [...row.replace(/ +$/, '')].length,
          `${columns}: a row of the opening is wider than the terminal: ${row}`,
        ).toBeLessThanOrEqual(columns);
      }
    }
  }, 180_000);

  it('keeps what the session already said, by the one mark only the caller puts there', async () => {
    // WHAT A RESIZE MAY NOT COST. A clean page is asked for and takes what was said with
    // it; a resize is not asked for, and taking the answers away would make changing the
    // size of a window a way to lose what you were reading. The mark is the ECHO — the
    // panel's own sentences are on every page there is, so only a line the caller typed
    // can tell a kept page from a fresh one.
    const rows = 40;
    const ran = await inPty({
      columns: 120,
      rows,
      steps: [
        opens,
        // ⚠️ AND IT WAITS FOR WHAT THE VERB SAID, not for the sentence anywhere in the
        // stream: the PANEL prints the record's verdict on every page there is, so a
        // predicate over the whole stream was satisfied by the opening and this step could
        // end before the echo existed (`support/pty.ts`, `arrivedSince`).
        { types: 'verify\r', until: arrivedSince(VERIFIED), what: 'answered' },
        {
          // NARROWED PAST THE THRESHOLD, because that is what turns a page now: seventy-four
          // columns has no room for the text beside the mark and a hundred and twenty does.
          resize: { columns: 74, rows },
          until: (bytes) => times(bytes, OPENED) > 1,
          what: 'drew the opening again',
        },
        leaves,
      ],
    });
    const answered = screenOf(ran.bytes.slice(0, ran.at[1] as number), 120, rows);
    const resized = screenOf(ran.bytes.slice(0, ran.at[2] as number), 74, rows);
    // The caller really did type a verb, or the assertion below is about nothing.
    expect(answered.text, 'the caller never typed a verb').toContain(SAID);
    expect(resized.text, 'what the caller had said went with the old page').toContain(SAID);
    // And it is the page AGAIN rather than the old page left alone: the opening is there, in the
    // arrangement the NEW width has room for.
    //
    // ⚠️ ITS TITLE MAY NOT BE ON THE SCREEN, and it was until the emptiness moved under the panel.
    // What the session said was landed FOLDED to the width it was said at, so a narrower window
    // turns some of those lines into two rows and the flow is placed a row or two low — which
    // the terminal absorbs by scrolling, exactly as `repl/page.ts` says it does. So what is
    // asserted is the arrangement rather than any one row of it; that the opening was drawn a
    // second time at all is what this step waited for.
    const opening = openingRowsOf(resized);
    expect(opening.length, 'no opening after the resize').toBeGreaterThan(0);
    for (const row of opening) {
      expect([...row.replace(/ +$/, '')].length).toBeLessThanOrEqual(74);
    }
  }, 180_000);
});

// ---------------------------------------------------------------------------
// Only the width, and only once the size has settled
// ---------------------------------------------------------------------------

/** A console opened on a terminal this test can resize, and everything it drew. */
async function opened(columns: number): Promise<{
  readonly terminal: ReturnType<typeof fakeTerminal>;
  readonly close: () => Promise<void>;
}> {
  const terminal = fakeTerminal({ columns, rows: TALL });
  const io: CliIo = { out: () => undefined, err: () => undefined, fail: () => undefined };
  const closed = openSession({
    io,
    render: renderPlain,
    self: REPL_VERB,
    input: terminal.stdin,
    output: terminal.stdout,
    interactive: true,
    leaving: hooksNothing,
  });
  await until(() => terminal.bytes().includes(OPENED), 'opened');
  return {
    terminal,
    close: async () => {
      terminal.type(CLEARS_THE_LINE);
      terminal.type(`${LEAVE}\r`);
      await closed;
    },
  };
}

/** How long to wait for a settled resize to have been drawn, and then some. */
const LONGER_THAN_SETTLING = 500;

/** How tall the terminals in this half of the file are. */
const TALL = 40;

/**
 * THE BYTES THAT CARRY A PAGE INTO THE SCROLLBACK — the cursor put on the last row, which
 * is what every row written after it scrolls off the top (`repl/page.ts`).
 *
 * COUNTING THIS AND NOT THE BOX is the instrument, and it is the second one this case had:
 * counting the drawings said `2` whether the page was reemitted once or thirty times,
 * because thirty store updates in one tick are one frame to a layout library that renders
 * on a schedule. The COST of a drag is not how many boxes the library drew, it is how many
 * screens went up into the caller's scrollback — and that is written straight to the
 * device, once per page, by this product and by nothing else.
 */
const CARRIES_THE_PAGE = `${ESC}[${TALL};1H`;

/**
 * ⚠️ AND THE READING ITSELF LEFT THIS FILE. It was written out here and once more in
 * `tests/the-prompt-sits-at-the-foot.test.ts`, and this delivery gave three more cases a use for
 * it — so it is the instrument's now (`support/pty.ts`, {@link carriedPages}), which is also where
 * the second thing that carries a page is written down: the door answering the library.
 */
/**
 * The LAST row on the page that says what the session is — the arrangement most recently drawn.
 *
 * THE LAST AND NOT THE COUNT, and that is the whole point of it: the library rewrites the region
 * it keeps when a width changes, so how MANY openings are in the bytes answers for the library
 * too. Which one is last answers for the drawing, and the drawing is what a resize is meant to
 * move.
 */
function lastTitle(bytes: string): string {
  const row = rowsOf(bytes)
    .filter((line) => line.includes(OPENED))
    .at(-1);
  expect(row, 'nothing on the page says what the session is').toBeDefined();
  return row as string;
}

describe('the page follows the drawing, and once per drag', () => {
  it('turns NO page for a height that moves no glyph, and one for a height that does', async () => {
    // ⚠️ THIS CASE HAS BEEN INVERTED TWICE AND RENAMED BOTH TIMES, AND THIS IS THE SECOND. It was
    // `turns the page for a height that moves no glyph, and for one that does`, and before that
    // `draws nothing when a height moves no glyph, and turns the page when one does`. THE PREMISE
    // THAT FELL THIS TIME is the one the previous name was built on: *a page is a drawing AND a
    // placement*, so a height alone made the page on the screen stale — the rows under the flow
    // are how many the height leaves over, and a page placed at one height is misplaced at
    // another whatever is drawn on it. It was measured on a real device: at a hundred by thirty
    // dragged to forty, not one byte was written and the input stayed ELEVEN rows above the foot.
    //
    // WHAT FALSIFIED IT is where those rows went. They are drawn WITH the area now
    // (`repl/page.ts`, `theGap`) and the frame is rebuilt the instant the signal arrives, before
    // the guard is ever asked (`repl/console.ts`, `resized`) — so the input is back at the foot
    // with no page turned at all, which is the property `tests/the-prompt-sits-at-the-foot.test.ts`
    // sweeps up and down. What the second half COST is a page per step of a drag: twelve steps of
    // two rows are twelve screens of the caller's carried into the scrollback and twelve openings
    // written over them, measured on the binary, against two for the same drag along the width.
    //
    // WHAT IS ASSERTED NOW IS THE PAIR THE OTHER WAY ROUND: a height that moves no glyph costs
    // nothing, and a height that gives the drawing away still turns a page — so this is the guard
    // being narrowed to the DRAWING rather than switched off.
    const { terminal, close } = await opened(200);
    const pages = () => carriedPages(terminal.bytes());
    expect(pages(), 'the page was never opened').toBe(1);
    // AND A DRAG THAT ENDS WHERE IT STARTED COSTS NOTHING, which was true of the guard before this
    // delivery and is still true: it never became "a resize event happened".
    //
    // ⚠️ IT USED TO BE THE LAST HALF OF THIS CASE AND IT IS THE FIRST NOW, and the excursion is
    // five rows rather than fourteen. Neither is about this guard: what a count of pages carried
    // away can no longer separate is a page TURNED from the library ASKING to start the page over
    // ({@link carriedPages}), and the geometry this case had walked into by the end of it asks on
    // any shrink at all. Measured — every drag delivered in ONE tick subtracts the whole
    // difference from the flow on the screen (`repl/console.ts`, `whatTheWindowTook`), so a page
    // dragged up to sixty and back to forty-four believes it has nothing above the region and the
    // region is then forty-three rows of a forty-four-row screen. So the half that needs exact
    // teeth is asked FIRST, on a page whose flow is the one it opened with, where the region is
    // thirty-one and an excursion to thirty-five is on this side of the frontier. What happens on
    // the other side of it is the subject of the section below, at every geometry of the frontier.
    terminal.resize(200, 35);
    terminal.resize(200, 40);
    await new Promise((resolve) => setTimeout(resolve, LONGER_THAN_SETTLING));
    expect(pages(), 'a drag back to the height on the screen turned a page').toBe(1);
    // ⚠️ THE HEIGHTS IT USED WERE THIRTY, TWENTY AND TEN, and an earlier delivery falsified the
    // premise under them: the name gave way when the DRAWING was taller than the terminal, so
    // nothing but a four-row window could move a glyph. It gives way when the PAGE stops fitting
    // now, and every one of those three crosses a threshold. What is used instead is derived
    // rather than picked: the biggest drawing there is is already on the screen at forty rows, so
    // no TALLER terminal can change it — heights above the one the session opened at are heights
    // the DRAWING cannot depend on, whatever the arithmetic under it says. The drag still ends
    // somewhere other than where it began, which is what keeps the count from being answered by a
    // console that only ever compares a height with itself.
    const drawnBefore = terminal.bytes().length;
    for (const rows of [50, 60, 44]) terminal.resize(200, rows);
    await new Promise((resolve) => setTimeout(resolve, LONGER_THAN_SETTLING));
    expect(pages(), 'a height that moves no glyph turned a page').toBe(1);
    // AND THE HEIGHT REALLY REACHED THE SESSION, which is the non-vacuity this half needs: a
    // console that had stopped watching the device would answer the count above just as well.
    // The frame is rebuilt on the signal itself, so bytes were written — and no page was carried.
    expect(terminal.bytes().length, 'nothing at all was drawn for the new height').toBeGreaterThan(
      drawnBefore,
    );
    // AND THE ARRANGEMENT ON THE PAGE IS THE ONE THAT WAS THERE, read off the drawing rather than
    // off a count: the width never moved, so a page rewritten in a different arrangement would be
    // the guard answering about something other than the drawing.
    expect(
      besideTheMark(lastTitle(terminal.bytes()), 200).trim(),
      'the arrangement moved',
    ).toContain(OPENED);
    // ⚠️ AND HERE IS A HALF THAT WAS INVERTED BY THE DELIVERY BEFORE THIS ONE. It read
    // `terminal.resize(199)` and asserted another page, on the sentence *the width still does
    // it* — and it did, because the box was drawn corner to corner and one column narrower was
    // one column of frame moved. Nothing is drawn to an edge now, so a hundred and ninety-nine
    // columns is the same drawing as two hundred and the console writes nothing at all. The
    // assertion is turned over rather than dropped, because *a width that moves no glyph costs
    // nothing* is the rule `panel.ts` states and this is the only place it can be observed.
    terminal.resize(199);
    await new Promise((resolve) => setTimeout(resolve, LONGER_THAN_SETTLING));
    expect(pages(), 'a width that moves no glyph turned a page').toBe(1);

    // AND A WIDTH THAT DOES MOVE ONE STILL DOES IT, which is the half that had to survive: at
    // seventy-four columns the text has no room beside the mark, so the arrangement is a
    // different one and the page is turned.
    terminal.resize(74);
    await new Promise((resolve) => setTimeout(resolve, LONGER_THAN_SETTLING));
    expect(pages(), 'a width that changes the arrangement did not turn the page').toBe(2);
    // And it is the ARRANGEMENT that changed, which is the reason claimed: at seventy-four
    // columns the text is under the mark, so nothing is beside it.
    expect(
      besideTheMark(lastTitle(terminal.bytes()), 74).trim(),
      'the text is still beside the mark',
    ).toBe('');

    // AND THE TEETH FOR THE OTHER MEASUREMENT: a height the drawing DOES depend on.
    //
    // ⚠️ IT USED TO BE ONE ROW SHORTER THAN THE MARK IS TALL, derived from the drawing on
    // the premise that the drawing was what the height was measured against. This delivery
    // falsified that — what a height is measured against is the whole PAGE, so the drawing
    // gives way long before a window is shorter than it — and a case that kept the old
    // derivation would still be green while asserting the wrong reason. What is derived now
    // is the drawing itself: the widest form is what a tall terminal draws, and the height
    // is walked down until something else is.
    const widest = drawnAcross(74).reduce((most, row) => (row.length > most.length ? row : most));
    expect(terminal.bytes(), 'the widest form was not on the wide terminal').toContain(widest);
    const before = terminal.bytes().length;
    const pagesBefore = pages();
    terminal.resize(74, 4);
    await new Promise((resolve) => setTimeout(resolve, LONGER_THAN_SETTLING));
    // ⚠️ THE COUNT USED TO BE EXACT HERE — `toBe(3)` — and it cannot be any more, for the reason
    // {@link carriedPages} carries: four rows is far under the height at which the library gives up
    // on redrawing part of the page, so the door answers its asks with the very bytes a turn writes.
    // Measured, three where the turn is one. What is asserted is that the count MOVED and, under
    // it, the turn's own observable — a shorter mark on the page — which the asks cannot produce.
    expect(pages(), 'a height that gives the mark away did not turn the page').toBeGreaterThan(
      pagesBefore,
    );
    // ⛔ AND NOT ONE ROW OF THE CALLER'S HISTORY WAS ERASED to get there, on a stream that is not
    // even a device: the door is on the pipe rather than on a terminal, so it answers here too.
    expect(times(terminal.bytes(), ERASES_THE_HISTORY), 'the history was erased').toBe(0);
    expect(times(terminal.bytes(), REDRAWS_EVERYTHING), 'the screen was erased').toBe(0);
    // And it is a SHORTER mark that was drawn, so the page turned for the reason claimed.
    // Read from the LAST opening on the page rather than from everything written after the
    // resize: on a terminal this short the library writes out everything it is keeping,
    // which is every page so far — the old drawing included.
    //
    // ⚠️ THE LAST OPENING WAS FOUND BY THE LAST CORNER. It is found by the row that says what
    // the session is, which is written once per page exactly as the corner was.
    const said = terminal.bytes();
    expect(before, 'nothing was written before the resize').toBeGreaterThan(0);
    expect(
      said.slice(said.lastIndexOf(OPENED)),
      'the widest form survived a terminal too short for its page',
    ).not.toContain(widest);
    await close();
  }, 120_000);

  it('turns one page for a drag of thirty sizes, not thirty', async () => {
    // THE COUNT, because "it waits for the size to settle" is not observable and this is.
    // A drag delivers a size per step; the page is turned for the one the caller stopped
    // at, and every other step costs the caller nothing.
    //
    // ⚠️ THIS CASE COUNTED THE DRAWINGS ON ITS FIRST DRAFT and could not go red: with the
    // waiting taken out, thirty pages were turned and the layout still drew ONE box,
    // because thirty store updates inside one tick are a single frame to a library that
    // renders on a schedule. What a drag costs is what went into the SCROLLBACK, and that
    // is written to the device once per page by this product itself.
    // ⚠️ AND THE DRAG USED TO BE THIRTY SINGLE COLUMNS, which turned a page because the frame
    // was drawn to the corner. A one-column step moves no glyph now, so the drag has to END
    // somewhere the drawing really differs or the whole case would be about a page nobody turns:
    // thirty steps of four columns, from two hundred down to eighty, which crosses the width the
    // text stops fitting beside the mark at.
    const { terminal, close } = await opened(200);
    const dragged = 30;
    const step = 4;
    for (let at = 1; at <= dragged; at++) terminal.resize(200 - at * step);
    await new Promise((resolve) => setTimeout(resolve, LONGER_THAN_SETTLING));
    // One for the page that opened, one for the size the drag ended on.
    expect(times(terminal.bytes(), CARRIES_THE_PAGE), 'a page per step of the drag').toBe(2);
    // And it really is the size the drag ENDED on, rather than the one it started from: at eighty
    // columns the text is under the mark, and at two hundred it was beside it.
    const ended = 200 - dragged * step;
    const last = stripped(withoutLayout(terminal.bytes()))
      .split('\n')
      .filter((row) => row.includes(OPENED))
      .at(-1) as string;
    const art = drawnAcross(ended).filter((row) => row.trim().length > 0);
    expect(
      art.some((row) => last.startsWith(row)),
      'the last page was not drawn at the width the drag ended on',
    ).toBe(false);
    expect(
      [...last.replace(/ +$/, '')].length,
      'the last page is wider than the drag ended',
    ).toBeLessThanOrEqual(ended);
    await close();
  }, 120_000);

  it('answers a new width with the art that fits it', async () => {
    // THE ELO between the device and the drawing, after the fact: the width a session was
    // opened at reaches the art (asserted in `the-name-and-the-hints.test.ts`), and so does
    // the width it was RESIZED to. Nothing but the recomposition can make this move.
    //
    // ⚠️ IT LOOKED FOR ONE GLYPH, and the name has a fourth drawing which is not inked with
    // it: a terminal two hundred columns wide holds no full block at all now. What the art
    // IS is asked of the module that draws it, so a fifth form moves this case with it.
    const { terminal, close } = await opened(200);
    const widest = drawnAcross(200).reduce((most, row) => (row.length > most.length ? row : most));
    expect(terminal.bytes(), 'the widest form was never drawn').toContain(widest);
    const wide = terminal.bytes().length;
    terminal.resize(20);
    await new Promise((resolve) => setTimeout(resolve, LONGER_THAN_SETTLING));
    const narrow = terminal.bytes().slice(wide);
    expect(narrow, 'the drawing did not give way to a narrower form').not.toContain(widest);
    expect(narrow).toContain('M N E M A');
    await close();
  }, 120_000);
});

// ---------------------------------------------------------------------------
// A drag of a real window, one edge at a time
// ---------------------------------------------------------------------------

/**
 * ONE STEP OF A DRAG: the caller's window becomes this size, and the console is then left alone
 * for longer than it waits before following a size.
 *
 * ⚠️ THE WAIT IS THE INSTRUMENT RATHER THAN A CONVENIENCE, and without it the case below cannot
 * go red. What is asserted is an ABSENCE — no page carried into the scrollback — and an absence
 * cannot be waited FOR: a step that ended on the next frame would be a step the console's own
 * amortiser had not run out on, so twelve steps would coalesce into ONE decision and a console
 * that turned a page per step would answer exactly like one that turns none. Each step is spaced
 * by longer than `AFTER_THE_LAST_CHANGE` (`repl/console.ts`), which is what makes the count below
 * the count of a real drag: twelve decisions rather than one. It is what the mutation shows — with
 * the height half of the guard put back, this is a page per step.
 */
const dragged = (columns: number, rows: number): Step => ({
  resize: { columns, rows },
  does: () => new Promise((resolve) => setTimeout(resolve, BETWEEN_STEPS_OF_A_DRAG)),
  until: () => true,
  what: `waited out ${columns}x${rows}`,
});

/**
 * How long one step of a drag is left alone: two and a half times the tenth of a second the
 * console waits after the last change (`repl/console.ts`, `AFTER_THE_LAST_CHANGE`).
 *
 * IT IS THE SMALLEST NUMBER THAT KEEPS THE CASES HONEST, and that is a cost rather than a
 * preference: a drag of twelve steps is twelve waits, in three cases, and pty time in this suite is
 * shared with a hundred and eighty other files — the machine under load is what turns a settling
 * wait into a red somewhere else. What says it is enough is not the ratio but the MUTATION: with
 * the half of the guard put back, these cases count a page per step.
 */
const BETWEEN_STEPS_OF_A_DRAG = 250;

/** How many steps a drag of a window edge is taken to be here, and how big each one is. */
const STEPS = 12;

describe('a drag of the window edge costs the caller what the drawing costs, and nothing else', () => {
  it('carries no page away for a drag of twelve heights, and writes the opening once', async () => {
    // THE COMPLAINT THIS DELIVERY CAME FROM, in a pty and as a count. It was reported from use
    // with a screenshot — *every time I keep changing the size of the terminal it renders the
    // mnema layout again, all misaligned; it is as though it just pushed mnema upwards* — and the
    // shape of it is that a drag of one edge cost a page per step: twelve steps of two rows, from
    // a hundred by twenty-four, measured at TWELVE pages carried into the caller's scrollback with
    // an opening rewritten over each of them. Along the width the same drag cost TWO.
    //
    // WHAT IS COUNTED IS WHAT WENT INTO THE SCROLLBACK ({@link carriedPages}) — the bytes this
    // product writes once per page and nothing else writes at all — and, beside it, how many times
    // the opening is in the stream. The second is the symptom a reader sees (thirteen wordmarks
    // stacked in their history) and it answers for the LAYOUT as well as for this product: the
    // library writes out what it is keeping when its region will not fit, so the count is the one
    // that was measured rather than a promise. Growing is where it is measured for that reason.
    const columns = 100;
    const from = 24;
    const heights = Array.from({ length: STEPS }, (_, at) => from + (at + 1) * 2);
    const to = heights.at(-1) as number;
    const ran = await inPty({
      columns,
      rows: from,
      steps: [opens, ...heights.map((rows) => dragged(columns, rows)), leaves],
    });
    // ONE PAGE, AND IT IS THE ONE THAT OPENED. Twelve decisions were taken and none of them was
    // a page: the drawing never moved, because at a hundred columns no height between
    // twenty-four and forty-eight changes which form there is room for.
    expect(carriedPages(ran.bytes), 'a page was carried away for a height').toBe(1);
    expect(times(ran.bytes, OPENED), 'the opening was written again for a height').toBe(1);
    // AND THE DRAG REALLY HAPPENED, in two directions of evidence: the device answered with each
    // size it was asked for (`support/pty.ts`, `resizedTo`, which reads it back or throws), and
    // the page that is on the screen at the end is the page the LAST height calls for — the input
    // on the last row the layout leaves, with the emptiness the new height left over above it. A
    // console that had stopped watching the device would answer the counts above and fail this.
    const screen = screenOf(ran.bytes.slice(0, ran.at[STEPS] as number), columns, to);
    expect(screen.text, 'the session never opened').toContain(OPENED);
    endsAtTheFoot(screen, to, `${columns}x${to}, dragged`);
    expect(
      theGapOn(screen, PROMPT),
      'nothing was left over at the height it ended on',
    ).toBeGreaterThan(0);
  }, 240_000);

  it('carries the page away for a drag of twelve widths, because the drawing gives way', async () => {
    // THE HALF THAT HAD TO SURVIVE, and it is asked of the same drag along the other edge: the
    // guard was narrowed to the drawing, so a drag that makes the drawing give way must still
    // cost a page at the point it does. Twelve steps of eight columns, from a hundred to a hundred
    // and ninety-six at twenty-four rows: measured, ONE page turned inside the drag and one page
    // was the one that opened.
    //
    // THE BRACKET RATHER THAN THE NUMBER, and the reason is that how many arrangements a range of
    // widths passes through is the panel's arithmetic rather than this case's subject: at least
    // one page inside the drag, or the surviving half went slack, and fewer than one per STEP, or
    // the amortiser did. What the page was turned FOR is asserted off the drawing below.
    const rows = 24;
    const from = 100;
    const widths = Array.from({ length: STEPS }, (_, at) => from + (at + 1) * 8);
    const to = widths.at(-1) as number;
    const ran = await inPty({
      columns: from,
      rows,
      steps: [opens, ...widths.map((columns) => dragged(columns, rows)), leaves],
    });
    const turned = carriedPages(ran.bytes) - 1;
    expect(turned, 'a drag that gave the drawing away turned no page').toBeGreaterThanOrEqual(1);
    expect(turned, 'a page per step of the drag').toBeLessThan(STEPS);
    // AND IT IS THE DRAWING THAT DID IT: at a hundred columns there is no room for the text beside
    // the mark and at a hundred and ninety-six there is, so the arrangement on the page at the end
    // of the drag is not the arrangement it started in.
    const screen = screenOf(ran.bytes.slice(0, ran.at[STEPS] as number), to, rows);
    const title = openingRowsOf(screen).find((row) => row.includes(OPENED));
    expect(title, 'nothing on the page says what the session is').toBeDefined();
    const art = drawnAcross(to).filter((row) => row.trim().length > 0);
    expect(
      art.some((row) => (title as string).startsWith(row)),
      'the text is not beside the mark at the width the drag ended on',
    ).toBe(true);
  }, 240_000);

  it('carries no page away for the same drag once the session has said something', async () => {
    // A13, AND IT IS THE STATE OF THE FIXTURE RATHER THAN THE SIZE OF IT. A page that has just
    // opened is the least representative instant of a session: the flow is the opening and nothing
    // else, so every count taken on it is taken where the page has the most room it will ever
    // have. This series has already lost a hole that way. So the same drag is measured after the
    // caller has asked something and read the answer.
    //
    // AND IT IS THE ANSWER THAT MAKES IT DIFFERENT, not the keystroke: what a verb said is part of
    // the flow, so the page a drag is decided against is a taller page than the one that opened —
    // which is exactly the page a turn would have carried into the scrollback.
    const columns = 100;
    const from = 24;
    const heights = Array.from({ length: STEPS }, (_, at) => from + (at + 1) * 2);
    const to = heights.at(-1) as number;
    const ran = await inPty({
      columns,
      rows: from,
      steps: [
        opens,
        { types: 'verify\r', until: arrivedSince(VERIFIED), what: 'answered' },
        ...heights.map((rows) => dragged(columns, rows)),
        leaves,
      ],
    });
    expect(carriedPages(ran.bytes), 'a page was carried away for a height').toBe(1);
    expect(times(ran.bytes, OPENED), 'the opening was written again for a height').toBe(1);
    // AND THE SESSION REALLY HAD SAID SOMETHING BEFORE THE DRAG, which is the whole point of this
    // case: the echo of the verb is the one mark only a caller can put on a page, and it is on the
    // page at the end of the drag as well — nothing the drag did took it away.
    const screen = screenOf(ran.bytes.slice(0, ran.at[STEPS + 1] as number), columns, to);
    expect(screen.text, 'the caller never typed a verb').toContain(SAID);
    endsAtTheFoot(screen, to, `${columns}x${to}, dragged over an answer`);
  }, 240_000);
});

// ---------------------------------------------------------------------------
// A window made SHORTER asks for the erase, and the caller's history survives it
// ---------------------------------------------------------------------------

/**
 * ⛔ THE SEQUENCE THAT ERASES THE CALLER'S HISTORY above the screen — the lines a scroll put
 * there, which nothing brings back.
 *
 * It is the one sequence this product refuses, and the refusal is not taste: the history above
 * the session belongs to the caller, and a product that reads a record has no business deleting
 * the log of what they were doing before they opened it (`repl/page.ts`). The RULE is owned by
 * `tests/a-page-that-opens-clean.test.ts`, which measures the boundary at which the library
 * reaches for it by HEIGHT; what this file adds is the other way to reach the same path, which is
 * a height the caller RESIZED to.
 *
 * ⚠️ AND *REFUSES TO WRITE* WAS THE WHOLE PROMISE AND IT WAS NOT ENOUGH — which is the premise
 * the section below used to assert as a hole and now asserts as a property. Nothing of this
 * surface ever wrote it; the LIBRARY did, out of its own memory of the frame it last drew, and no
 * frame this surface composes can stop it. It is answered on the way out now
 * (`repl/page.ts`, `theEraseAsAScroll`), so what this constant measures is an absence in the
 * bytes a real terminal received rather than an absence in our sources.
 */
const ERASES_THE_HISTORY = `${ESC}[3J`;

/** What the library writes when it gives up on redrawing PART of the page and redraws all of it. */
const REDRAWS_EVERYTHING = `${ESC}[2J`;

/**
 * THE WHOLE OF WHAT THE LIBRARY WRITES TO START THE PAGE OVER: erase the screen, erase the
 * history above it, and back to the top — one contiguous sequence, assembled by the library's
 * own escape module and written in one call.
 *
 * ⚠️ IT WAS HERE SO THE ERASE COULD BE ATTRIBUTED — an erase counted on its own said a byte was
 * written, and an erase that arrived INSIDE this said who wrote it. There is nothing to attribute
 * any more, because there is nothing to count: what it names is now an ABSENCE, and the absence is
 * of the whole sequence rather than of either half. It is still what makes the two erases
 * inseparable on this path — they are one write, so a decision about the screen erase alone was
 * never available — which is why the door answers both (`repl/page.ts`, `theEraseAsAScroll`).
 */
const CLEARS_THE_TERMINAL = `${REDRAWS_EVERYTHING}${ERASES_THE_HISTORY}${ESC}[H`;

/** What the library writes to take back one row it redrew. One per row it thinks it owns. */
const TAKES_A_ROW_BACK = `${ESC}[2K`;

/**
 * HOW MANY ROWS THE LIBRARY THOUGHT IT OWNED on the frame before this slice — read off the
 * erases the FIRST frame of the slice opens with, and off nothing else.
 *
 * IT IS THE LIBRARY'S OWN MEMORY AND NOT OUR ARITHMETIC, which is the whole reason it is read
 * out of the bytes instead of computed: every frame begins by taking back the rows the frame
 * before it wrote, one {@link TAKES_A_ROW_BACK} per row of what it last held (`ink`,
 * `log-update`), so the count is the number the library is about to compare against the
 * viewport. The line the trailing newline adds is taken off, because the library counts the
 * rows of what it wrote and this counts the erases of it.
 *
 * WHERE A FRAME ENDS IS THE INSTRUMENT'S (`support/pty.ts`, {@link FRAME_IS_DRAWN}) rather than
 * spelled here: a second idea of which bytes belong to which frame is a count that quietly
 * measures two of them.
 */
function theRegionBefore(slice: string): number {
  return times(slice.split(FRAME_IS_DRAWN)[0] ?? '', TAKES_A_ROW_BACK) - 1;
}

/** One key pressed, and the frame it caused. The row it lands on is abandoned before leaving. */
const echoes = (what: string): Step => ({
  types: what,
  until: arrivedSince(what),
  what: `echoed ${what}`,
});

/**
 * The step this section ends with: the row being typed is abandoned first, because there is a
 * keystroke on it and `v/exit` is not a word.
 */
const abandonsAndLeaves: Step = { ...leaves, types: `${CLEARS_THE_LINE}${LEAVE}\r` };

/** What one shrink of the window wrote, and what the library was holding when it happened. */
interface Shrunk {
  /** How many rows the library thought it owned on the frame before the resize. */
  readonly region: number;
  /** ⛔ How many times the caller's history was erased — nought, at every geometry there is. */
  readonly erases: number;
  /** How many times the whole screen was erased with it. Nought, for the same reason. */
  readonly redraws: number;
  /** ⛔ How many times the library's own sequence reached the terminal whole. */
  readonly sequences: number;
  /**
   * HOW MANY TIMES THE OPENING WAS WRITTEN AGAIN OVER THE PAGE — which is the library's own
   * signature of having ASKED to start the page over, and it survives the door untouched.
   *
   * It is the replay of what the library keeps (`ink`, `fullStaticOutput`), written immediately
   * after the sequence the door translated. So it is the reading that says the frontier has not
   * moved: the library goes on giving up at exactly the heights it gave up at before, and what
   * changed is only what its giving up COSTS the caller.
   */
  readonly openings: number;
  /**
   * HOW MANY PAGES WERE CARRIED INTO THE SCROLLBACK while the window was being made shorter —
   * which is what the door wrote in place of the erase.
   *
   * THE SAME BYTES A PAGE TURN WRITES, and that is not a confusion to resolve: the door answers
   * the library's request to empty the page with this product's own way of emptying one
   * (`repl/page.ts`, `carriedIntoTheScrollback`), so it is the same operation and therefore the
   * same bytes. What distinguishes them is who asked, and nothing here needs to know.
   */
  readonly pages: number;
}

/**
 * Opens a session at `from` rows, presses one key, and makes the window `to` rows — reading
 * what the library was holding before the resize and what it wrote for it.
 *
 * THE KEY IS THE INSTRUMENT AND NOT AN ACTION. The opening frame erases nothing, because there
 * was no frame before it; the frame a keystroke causes opens by taking back the rows of the one
 * before it, which is the only place the library says how tall it thinks its region is. Typing
 * moves no row of the page, so the number it reveals is the page's own.
 */
async function shrunkTo(from: number, to: number, prints = false): Promise<Shrunk> {
  const columns = 100;
  const steps: Step[] = [opens];
  if (prints) steps.push({ types: 'verify\r', until: arrivedSince(VERIFIED), what: 'answered' });
  steps.push(echoes('v'), dragged(columns, to), abandonsAndLeaves);
  const ran = await inPty({ columns, rows: from, steps });
  const base = prints ? 1 : 0;
  const key = ran.at[base] as number;
  const before = ran.at[base + 1] as number;
  const during = ran.bytes.slice(before, ran.at[base + 2] as number);
  return {
    region: theRegionBefore(ran.bytes.slice(key, before)),
    // ⛔ THE TWO ERASES AND THE SEQUENCE ARE COUNTED OVER THE WHOLE RUN and not over the step,
    // which is the one reading that cannot be raced: the promise is that neither ever reaches this
    // terminal, and a count cut at a step boundary would be a promise about a slice.
    erases: times(ran.bytes, ERASES_THE_HISTORY),
    redraws: times(ran.bytes, REDRAWS_EVERYTHING),
    sequences: times(ran.bytes, CLEARS_THE_TERMINAL),
    openings: times(during, OPENED),
    pages: carriedPages(during),
  };
}

/**
 * ⚠️ A HOLE THAT IS NOW A PROPERTY, AND THE CASES ARE INVERTED AND RENAMED RATHER THAN DELETED.
 * They were `⛔ a window made SHORTER reaches the erase, and the caller's history goes with it`,
 * and they asserted the erase HAPPENING, with the rule that predicted which windows produced it —
 * declared as a hole so that closing it would go red instead of unnoticed. It did.
 *
 * WHAT THE DEFECT WAS. The region the layout redraws is the emptiness under the flow and the
 * input area (`repl/page.ts`, `theGap`), so on a page with room to spare it is nearly as tall as
 * the screen — one row short of it, which is the boundary this surface keeps at every height.
 * The library decides whether to redraw the WHOLE screen by comparing the height of the frame it
 * LAST drew against the viewport the caller has NOW, so a window the caller makes shorter turns
 * a frame that was legal when it was written into a frame that is over the boundary, and the
 * sequence it starts over with carried the erase inside it.
 *
 * AND NOTHING THIS SURFACE COMPOSES COULD AVOID IT, which is why the fix is not in a frame. The
 * comparison is against a frame that is already on the screen, so it is decided before anything of
 * ours runs on the new size: the library keeps its own watch on the device and renders first. The
 * only frame that escapes the comparison is one exactly as tall as the viewport, which is the whole
 * screen — the bargain the alternate screen makes, refused for the reason `repl/page.ts` gives.
 *
 * SO WHAT CHANGED IS THE PIPE AND NOT THE PAGE. The bytes the library decided on still have to
 * leave through a stream this surface owns, and there they are translated: the screen erase into
 * the scroll this product empties a page with, the erase of the caller's history into nothing
 * (`repl/console.ts`, `theWayOut`). The RULE below is unchanged and is still asserted — it is what
 * says which windows ASK — and every count of an erase is now a nought.
 */
describe('a window made SHORTER asks for the erase, and the caller’s history survives it', () => {
  /**
   * THE PAIRS, and the last column is the RULE rather than an outcome: the library gives up on
   * redrawing part of the page exactly when the region it last drew is as tall as the window the
   * caller now has. Measured on the binary over twenty-six pairs, including growing, one-row steps
   * and sequences, with no exception — the boundary from forty rows is at twenty-three, which is
   * the region a page that has just opened leaves.
   *
   * ⚠️ THE COLUMN WAS CALLED `erases` AND IT IS CALLED `asks` NOW, which is the whole difference
   * this delivery makes: the same windows reach the same path in the library, and what comes out
   * of the pipe is a scroll instead of an erase. The rows either side of the frontier are kept —
   * twenty-four is under it and twenty-three is exactly on it — because a table with only one side
   * of a boundary on it is a table that cannot tell a frontier from a floor.
   */
  const SHRUNK: readonly {
    readonly from: number;
    readonly to: number;
    readonly asks: boolean;
  }[] = [
    { from: 40, to: 24, asks: false },
    { from: 40, to: 23, asks: true },
    { from: 40, to: 22, asks: true },
    { from: 40, to: 20, asks: true },
    { from: 40, to: 16, asks: true },
    { from: 40, to: 12, asks: true },
    { from: 40, to: 8, asks: true },
    { from: 48, to: 24, asks: true },
    { from: 30, to: 5, asks: true },
  ];

  it('lets none of it out, on every pair whose new window is no taller than the region last drawn', async () => {
    for (const pair of SHRUNK) {
      const ran = await shrunkTo(pair.from, pair.to);
      const at = `${pair.from} to ${pair.to}`;
      // THE RULE, ASKED OF THE LIBRARY'S OWN MEMORY. It is asserted first because it is the
      // premise the row of the table rests on: a pair whose region came out other than measured
      // is a pair that is no longer about the boundary.
      expect(
        ran.region >= pair.to,
        `${at}: the region the library last drew was ${ran.region} rows`,
      ).toBe(pair.asks);
      // ⛔ AND THE BYTES A REAL TERMINAL RECEIVED. This is the assertion that inverted: it read
      // `.toBe(pair.erases)` and it reads nought at every geometry now, on the side of the
      // frontier that asks and on the side that does not.
      expect(ran.erases, `${at}: the history was erased ${ran.erases} times`).toBe(0);
      expect(ran.redraws, `${at}: the screen was erased ${ran.redraws} times`).toBe(0);
      expect(ran.sequences, `${at}: the library's own sequence reached the terminal`).toBe(0);
      // AND THE FRONTIER HAS NOT MOVED, which is what says the nought above is a door and not a
      // library that stopped asking: the replay of everything the library was keeping is its own
      // signature of the full redraw, and it is there on exactly the pairs the rule predicts.
      expect(ran.openings > 0, `${at}: the library did not replay the page it was keeping`).toBe(
        pair.asks,
      );
      // AND WHAT WENT OUT IN PLACE OF THE ERASE IS A PAGE CARRIED INTO THE SCROLLBACK, once per
      // ask — so the count of the answer equals the count of the question.
      expect(
        ran.pages,
        `${at}: the erase was answered ${ran.pages} times for ${ran.openings}`,
      ).toBe(ran.openings);
      expect(ran.pages > 0, `${at}: nothing was written in place of the erase`).toBe(pair.asks);
    }
  }, 600_000);

  it('⛔ and ONE row no longer takes it, once a shrink has carried the flow off the top', async () => {
    // THE SHARPEST FORM OF THE DEFECT, and it is a SEQUENCE rather than a size: a window made
    // much shorter carries the flow into the scrollback, so what is left on the page is the
    // emptiness — and a window made tall again is then almost all region, because the flow the
    // terminal took is not on the screen to be subtracted (`repl/console.ts`,
    // `whatTheWindowTook`). From there ONE row is a shrink past the boundary.
    //
    // ⚠️ AND IT IS INVERTED AND RENAMED: it was `⛔ and ONE row is enough, once a shrink has
    // carried the flow off the top`, and it asserted the erase arriving on the last leg. The LEGS
    // are untouched, because what they measure is the library's memory rather than the door's
    // answer: the frontier still moves with the flow, so the one-row shrink still ASKS. What is
    // nought now is the cost.
    //
    // MEASURED: a hundred by forty made twenty-four writes nothing at all; made forty again the
    // region is thirty-nine rows; and forty to THIRTY-NINE asks the library to start the page over.
    //
    // AND IT IS A SEQUENCE OF THREE RESIZES IN ONE SESSION — shrink, grow, shrink — which is the
    // other half this case is for: the erase is nought across all of them together and not only
    // pair by pair.
    const columns = 100;
    const ran = await inPty({
      columns,
      rows: 40,
      steps: [
        opens,
        echoes('v'),
        dragged(columns, 24),
        echoes('e'),
        dragged(columns, 40),
        echoes('r'),
        dragged(columns, 39),
        echoes('i'),
        abandonsAndLeaves,
      ],
    });
    // WHICH STEP IS WHICH, and it is the KEYSTROKE that names a leg: the frame it caused is where
    // the library says how tall its region was, and the resize is the step after it. So the rows
    // read for a leg are the bytes of step `key`, and what the resize wrote is the bytes of the
    // step after it.
    const legs = [
      { what: '40 to 24', to: 24, key: 1, asks: false },
      { what: '24 to 40', to: 40, key: 3, asks: false },
      { what: '40 to 39', to: 39, key: 5, asks: true },
    ];
    const regionOf = (leg: { readonly key: number }): number =>
      theRegionBefore(ran.bytes.slice(ran.at[leg.key - 1] as number, ran.at[leg.key] as number));
    for (const leg of legs) {
      const region = regionOf(leg);
      const during = ran.bytes.slice(ran.at[leg.key] as number, ran.at[leg.key + 1] as number);
      expect(region >= leg.to, `${leg.what}: the region was ${region} rows`).toBe(leg.asks);
      // AND THE FRONTIER IS STILL WHERE IT WAS, read off the library's own replay: the one-row
      // shrink asks, and neither of the two before it does.
      expect(times(during, OPENED) > 0, `${leg.what}: the library replayed the page`).toBe(
        leg.asks,
      );
      // AND THE ANSWER IS A SCROLL, on exactly the leg that asked.
      expect(carriedPages(during) > 0, `${leg.what}: a page was carried away`).toBe(leg.asks);
    }
    // ⛔ AND NOT ONE ERASE ACROSS THREE RESIZES. This is the assertion that inverted, and it is
    // asked of the whole session rather than leg by leg, because a sequence is what the defect
    // needed: nothing about the pairs alone reaches the one-row form.
    expect(times(ran.bytes, ERASES_THE_HISTORY), 'the history was erased').toBe(0);
    expect(times(ran.bytes, REDRAWS_EVERYTHING), 'the screen was erased').toBe(0);
    // NOT VACUOUS: the last leg really is a one-row shrink of a window that grew back to the
    // height it started at, so the difference between the first leg and the last is the SEQUENCE
    // and nothing about the size.
    expect(
      regionOf(legs[2] as { readonly key: number }),
      'the region did not grow with the window',
    ).toBeGreaterThan(regionOf(legs[0] as { readonly key: number }));
  }, 300_000);

  it('⛔ carries what was on the screen ABOVE it, row for row, in the order it was in', async () => {
    // THE HALF THAT DISTINGUISHES *WE SCROLLED* FROM *WE DID NOT ERASE*, and it is asked of the
    // TEXT rather than of the absence of a byte. A door that dropped the sequence would satisfy
    // every count above and leave the caller's page destroyed all the same — the library writes the
    // page again from the top immediately afterwards, over whatever is still there.
    //
    // WHAT IS ASSERTED IS AN IDENTITY: the rows the terminal put into the scrollback while the
    // window was being made shorter ARE the rows that were on the screen, in that order. That is
    // what a page carried away means (`repl/page.ts`), and it is the strongest form available —
    // stronger than *some text of mine is above*, which a page that scrolled for any other reason
    // would satisfy.
    //
    // AND THE PAIR IS ONE THAT ASKS, with an answer on the page: forty-eight rows made twenty-four
    // is the geometry the delivery before this one found already driven and already green in
    // `tests/the-prompt-sits-at-the-foot.test.ts`, because that case reads the SCREEN and the loss
    // was in the bytes.
    const columns = 100;
    const to = 24;
    const ran = await inPty({
      columns,
      rows: 48,
      steps: [
        opens,
        { types: 'verify\r', until: arrivedSince(VERIFIED), what: 'answered' },
        echoes('v'),
        dragged(columns, to),
        abandonsAndLeaves,
      ],
    });
    // BOTH SCREENS ARE READ AT THE HEIGHT THE RESIZE'S OWN BYTES WERE WRITTEN FOR, which is what
    // makes the two readings comparable: the question is what the step CARRIED, so the before and
    // the after have to be the same instrument on the same page.
    const before = screenOf(ran.bytes.slice(0, ran.at[2] as number), columns, to);
    const after = screenOf(ran.bytes.slice(0, ran.at[3] as number), columns, to);
    expect(
      after.above.slice(before.above.length, before.above.length + to),
      'the rows carried above are not the rows that were on the screen',
    ).toEqual([...before.rows]);
    // AND IT REALLY IS A WHOLE PAGE, not a row or two the terminal happened to push: the count is
    // at least the height of the window, and nothing was taken OUT of the scrollback.
    expect(
      after.above.length - before.above.length,
      'less than a page was carried into the scrollback',
    ).toBeGreaterThanOrEqual(to);
    // AND THE SCREEN THE ROWS CAME OFF WAS A REAL PAGE rather than two empty things being equal.
    expect(before.text, 'nothing was on the page the rows were carried off').toContain(PROMPT);
    // AND IN THE CALLER'S OWN TERMS: what they typed was on their forty-eight-row window, and it is
    // above the twenty-four-row one they are left with. The echo is the one mark only a caller can
    // put on a page — the panel says what the record is on every page there is.
    expect(
      screenOf(ran.bytes.slice(0, ran.at[2] as number), columns, 48).text,
      'the caller never typed a verb',
    ).toContain(SAID);
    expect(after.aboveText, 'what the caller typed is not above').toContain(SAID);
  }, 300_000);

  it('⚠️ it is the REGION and not the panel: the same shrink asks on one page and not on the other', async () => {
    // THE PROBE THAT DISCRIMINATED THE CAUSE, kept as a case because it is the only thing that
    // tells two explanations of the same bytes apart. The other one was that the frame answering
    // the resize carries the PANEL of the taller window, so the region reaches the height of the
    // screen — and the panel is identical in both runs below, drawn at the same width and the
    // same height, out of the same bytes.
    //
    // WHAT MOVES IS THE FLOW. The region is what the page has left over, so an answer printed
    // under the opening makes it SHORTER by exactly the rows the answer took — and the same
    // shrink that makes the library give up on a page that has just opened leaves it redrawing in
    // PART on a page with an answer on it. A cause that lived in the panel could not move with the
    // flow.
    //
    // ⚠️ THE OBSERVABLE IS THE ASK AND NO LONGER THE ERASE, and the case is renamed for it: the
    // erase is nought on both runs now, so a discriminant made of it would say the two pages are
    // the same. What discriminates is the library's own replay of everything it was keeping, which
    // is what it does on the path the erase used to arrive by.
    const fresh = await shrunkTo(40, 22);
    const printed = await shrunkTo(40, 22, true);
    // THE SAME PAIR, THE OPPOSITE ANSWER, and the rule accounts for both.
    expect(fresh.openings, 'the fresh page did not make the library give up').toBeGreaterThan(0);
    expect(printed.openings, 'the printed page made the library give up').toBe(0);
    // AND THE ONE THAT ASKED WAS ANSWERED WITH A SCROLL, which is the elo between the two halves
    // of this file: the ask is the library's and the answer is the door's.
    expect(fresh.pages, 'the ask was not answered with a page carried away').toBe(fresh.openings);
    expect(printed.pages, 'a page was carried away for nothing').toBe(0);
    // ⛔ AND NEITHER RUN COST THE CALLER A ROW OF THEIR HISTORY.
    for (const [what, ran] of [
      ['fresh', fresh],
      ['printed', printed],
    ] as const) {
      expect(ran.erases, `${what}: the history was erased`).toBe(0);
      expect(ran.redraws, `${what}: the screen was erased`).toBe(0);
    }
    // AND THE REGION IS WHAT DIFFERS: shorter by what the answer landed, and the boundary with
    // it. Both readings are the library's own memory rather than this file's arithmetic.
    expect(printed.region, 'the answer did not take rows out of the region').toBeLessThan(
      fresh.region,
    );
    expect(fresh.region >= 22, 'the fresh region was under the boundary').toBe(true);
    expect(printed.region >= 22, 'the printed region was over the boundary').toBe(false);
  }, 300_000);
});

// ---------------------------------------------------------------------------
// The deltas of the opening
// ---------------------------------------------------------------------------

/** The same bytes with every style sequence taken out — what a pipe would have received. */
function stripped(text: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: the escape IS the subject.
  return text.replace(/\u001b\[[0-9;]*m/g, '');
}

/** The page as rows, with everything a layout writes to place a line taken out. */
function rowsOf(page: string): string[] {
  return stripped(withoutLayout(page)).split('\n');
}

/** The drawing of the name a terminal this wide gets, when the page it is on costs nothing. */
const drawnAcross = (columns: number): string[] =>
  bannerFor({ columns, rows: 0, needs: () => 0 }).map(renderPlain);

/**
 * The rows of the opening a console DREW, out of its bytes.
 *
 * ⚠️ THE HELPERS THIS REPLACES WERE ALL THE FRAME'S, and there were five: `boxOf`, which kept
 * the rows beginning with a corner or a side; `insideOf`, the rows between the two edges;
 * `rulesThrough`, the columns a rule ran down on every one of them; `throughRuled`, three of
 * those meaning the two-column form; and `leftOf`/`rightOf`, which cut a row at them. Every one
 * of them read a geometry that is no longer drawn. What is left is two questions — which rows,
 * and what is in the text column — and both are answered off the product's own numbers.
 */
function openingOf(page: string): string[] {
  return openingIn(rowsOf(page));
}

/**
 * What is in the TEXT COLUMN of a row: everything past the mark and the gap.
 *
 * ⚠️ THE CUT USED TO BE MADE AT THE FRAME'S OWN RULES, which is what made it possible to be
 * wrong about which padding sat on which side of one. It is made at a column derived from the
 * two things that decide it ({@link whereTheTextBegins}), so nothing here corrects for anything.
 */
function besideTheMark(row: string, columns: number): string {
  return [...row].slice(whereTheTextBegins(columns)).join('');
}

/** What a console drew, opened on a terminal `columns` wide and left again. */
async function drawnAt(columns: number): Promise<string> {
  const { terminal, close } = await opened(columns);
  await close();
  return terminal.bytes();
}

describe('the title says which build it is, and it is the one the flag prints', () => {
  it('puts the version on the opening, beside the name', async () => {
    const title = openingOf(await drawnAt(200)).find((row) => row.includes(OPENED));
    expect(title, 'nothing on the opening says what the session is').toBeDefined();
    expect(title as string).toContain(`v${VERSION}`);
    // Beside the NAME rather than anywhere on the row: the title is the product, then the
    // build, then what the session is.
    const said = title as string;
    expect(said.indexOf('mnema')).toBeLessThan(said.indexOf(`v${VERSION}`));
    expect(said.indexOf(`v${VERSION}`)).toBeLessThan(said.indexOf(OPENED));
  }, 120_000);

  it('says the same version the flag says, and the same the manifest declares', async () => {
    // THE ELO, in both directions. A title with a version of its own would be a second
    // answer to "what is running", and the flag is where a caller asks it today. The
    // manifest is the packaging fact, and the constant is not read from it — so the two
    // are held together here rather than left to agree.
    expect(await shell('--version')).toEqual([VERSION]);
    const manifest = JSON.parse(readFileSync(MANIFEST, 'utf-8')) as { version: string };
    expect(manifest.version).toBe(VERSION);
  }, 120_000);

  it('is named in one module of the product, and in no second one', () => {
    // A1. It was typed twice — the flag and the MCP handshake — and the box would have
    // been the third. The scan is for the string the MANIFEST declares, so nothing in it
    // derives from the constant it is about.
    const manifest = JSON.parse(readFileSync(MANIFEST, 'utf-8')) as { version: string };
    const naming = sourcesOf(SRC).filter((file) =>
      literalsOf(withoutComments(readFileSync(file, 'utf-8'))).some(
        (literal) => literal.slice(1, -1) === manifest.version,
      ),
    );
    expect(naming.map((file) => file.slice(SRC.length + 1))).toEqual(['version.ts']);
    // The scan read something, and it would accuse a second module.
    expect(sourcesOf(SRC).length).toBeGreaterThan(50);
    expect(literalsOf(`const SERVER_VERSION = '${manifest.version}';`)).toHaveLength(1);
  });
});

describe('nothing on the panel is a run of glyphs, because there is nothing to divide', () => {
  it('draws no rule anywhere in the opening, and the record is what is there', async () => {
    // ⚠️ THIS CASE HAS BEEN INVERTED TWICE AND RENAMED BOTH TIMES. It began as `a rule divides
    // the two sections, and it measures the column it divides`, asserting that the run between
    // `The record` and `Hints` reached as far as the widest row beside it; the second SECTION
    // went — what to type is said under the prompt, where it does not scroll away — so there was
    // nothing left to divide, and the case became `draws no run of glyphs inside the box`.
    // ⚠️ NOW THE BOX HAS GONE TOO, so `inside the box` had no subject: the rows were found by the
    // frame's own sides and the halves of each row were cut at its rules.
    //
    // WHAT SURVIVES IS THE ABSENCE, asked of the rows the panel really has: no row of the opening
    // is a run of glyphs. Kept as a case rather than deleted, because "there is no rule in here"
    // is exactly what a future delivery could undo by accident — and the two rules the input area
    // draws are OUTSIDE these rows, which is what makes the absence sayable at all.
    const opening = openingOf(await drawnAt(200));
    expect(opening.length, 'nothing was drawn').toBeGreaterThan(3);
    expect(
      opening.findIndex((row) => isRun(row.trim())),
      'a run of glyphs is drawn in the opening',
    ).toBe(-1);
    // NOT VACUOUS, IN THREE DIRECTIONS: the instrument really can see a run of glyphs, the rows
    // really are the panel's — the record put its section in them — and the page really does draw
    // a rule somewhere, which is the input area's and is not one of these rows.
    expect(isRun(RUN.repeat(3))).toBe(true);
    expect(
      opening.some((row) => row.includes('The record')),
      'no record section',
    ).toBe(true);
    expect(
      rowsOf(await drawnAt(200)).some((row) => isRun(row.trim())),
      'the input area drew no rule at all',
    ).toBe(true);
  }, 120_000);
});

describe('the text is centred down the height the mark gave the row', () => {
  it('leaves the same number of blank rows over the text as under it', async () => {
    // POSITION AND NOTHING ELSE: no row is added or dropped, so what can be observed is WHERE
    // the text starts inside a column whose height something else decided.
    //
    // WHAT IT IS FOR, measured before it was written: the row is as tall as the drawing — nine
    // rows — and what the text says is fewer, so it sat at the TOP with the difference under it.
    // Nothing said it should; a column starts at its top, and that was all. Centred, the gap is
    // halved and shared.
    //
    // ⚠️ IT USED TO BE `the right column ... the box`, and what it read was the column between two
    // of the frame's rules. The column is found by the mark and the gap now
    // ({@link whereTheTextBegins}), and what is centred is one group MORE than it was: what the
    // session is moved off the border and into these rows this delivery.
    const opening = openingOf(await drawnAt(140));
    expect(opening.length, 'nothing was drawn').toBeGreaterThan(3);
    const held = opening.map((row) => besideTheMark(row, 140).trim());
    const first = held.findIndex((row) => row.length > 0);
    const last = held.length - 1 - [...held].reverse().findIndex((row) => row.length > 0);
    expect(first, 'nothing is beside the mark').toBeGreaterThanOrEqual(0);
    // THE PROMISE: the blank over the text and the blank under it differ by at most one
    // row, which is what a gap of an odd number of rows allows and nothing more.
    const over = first;
    const under = held.length - 1 - last;
    expect(Math.abs(over - under), `${over} over, ${under} under`).toBeLessThanOrEqual(1);
    // NOT VACUOUS, IN TWO DIRECTIONS. There really is a gap to share — the text is shorter than
    // the drawing, which is what the top-aligned column put all of underneath it — and the rows
    // really are the text's rather than an empty column read as centred.
    expect(over + under, 'the text fills the row, so nothing was centred').toBeGreaterThan(2);
    expect(held.some((row) => row.includes('The record'))).toBe(true);
    expect(held.some((row) => row.includes(OPENED))).toBe(true);
  }, 120_000);
});

describe('the mark has its column to itself, and it begins at the left edge', () => {
  it('puts nothing before the mark and the place beside it, not under it', async () => {
    // ⚠️ THIS CASE IS THE INVERSE OF THE ONE IT REPLACES, and it is renamed rather than edited.
    // It was `the left column is centred on the widest thing in it`, and it asserted that the
    // narrower of the mark and the place had the same blank on each side of it — the two shared
    // a column, one of them was always much the wider, and centring made the column read as one
    // block. THE PLACE MOVED to the column beside the mark, so there is ONE group in the mark's
    // column and nothing left to centre: the alignment went, because a word that can never
    // change an answer is worse than no word.
    //
    // WHAT IS ASSERTED IS WHAT THAT MADE TRUE. The mark begins at the very first column of the
    // screen — nothing pads it, because there is no border for it to be inside and no wider
    // sibling for it to be centred against — and the place is BESIDE it.
    //
    // OPENED OVER THE PROJECT WITH THE LONGER PATH, and the fixture's reason changed with the
    // case: it existed to make the two groups differ in width inside one column, and it now
    // makes the TEXT column decisively the wider of the two — so `beside the mark` is a
    // measurement rather than a coincidence of a short path.
    process.chdir(aLongerPath);
    const page = await drawnAt(200).finally(() => process.chdir(project));
    const opening = openingOf(page);
    const widest = drawnAcross(200).reduce((most, row) => (row.length > most.length ? row : most));
    const mark = opening.find((row) => row.includes(widest));
    expect(mark, 'the drawing of the name is not in the opening').toBeDefined();
    // THE MARK IS AT THE LEFT EDGE. Its own widest row begins where the screen does, so the
    // column holds the drawing and nothing else — measured against the art rather than against a
    // number, because a form with leading blanks of its own would otherwise read as padding.
    expect((mark as string).indexOf(widest), 'something is drawn before the mark').toBe(
      widest.length - widest.trimStart().length,
    );
    // AND THE PLACE IS BESIDE IT rather than under it, which is the group that moved.
    const standing = opening.find((row) => row.includes(aLongerPath));
    expect(standing, 'the place is not on the page').toBeDefined();
    expect(
      besideTheMark(standing as string, 200),
      'the place is not in the column beside the mark',
    ).toContain(aLongerPath);
    // NOT VACUOUS: the place really is past the mark's own column, so `beside` is a position and
    // not a slice that happened to contain everything.
    expect(whereTheTextBegins(200), 'the text column begins at the left edge').toBeGreaterThan(
      widest.length,
    );
  }, 120_000);
});

// ---------------------------------------------------------------------------
// One place asks the device how big it is, and one place turns a page
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

/** Every string a source writes, quotes included. */
function literalsOf(code: string): string[] {
  return code.match(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g) ?? [];
}

/** Whether some glyphs are a run of the horizontal, and there are some. */
const isRun = (text: string): boolean => text.length > 0 && [...text].every((one) => one === RUN);

/**
 * Asking a STREAM how big the device behind it is — the discriminant, as a pattern.
 *
 * It is the property read and not the word: `panel.columns` is a number this product
 * decided and `stdout.columns` is one the terminal reported, and only the second is asking
 * a device anything.
 *
 * Built fresh at each use rather than held as one value: a global pattern remembers where
 * it stopped, so the same `test` over a list of files answers differently every other
 * time — which is a scan that reads half the product and says nothing about it.
 */
const ASKS_THE_DEVICE = String.raw`\b\w*(?:stdout|stderr|output|stream)\w*\s*\.\s*(?:columns|rows)\b`;
const asksTheDevice = (code: string): string[] =>
  code.match(new RegExp(ASKS_THE_DEVICE, 'gi')) ?? [];

/**
 * WHAT THE CONSOLE KEEPS BETWEEN FRAMES THAT COMES OUT OF THE DEVICE — the discriminant of the
 * half this delivery removed, as a scan over the console's own source.
 *
 * IT IS THE KEEPING AND NOT THE READING. Asking how tall the terminal is costs a property read
 * and is right whenever it is asked; the answer REMEMBERED is what goes stale, and a page turned
 * for a number that went stale is the defect this replaces a count of `placedAt` with. So what is
 * looked for is a name the console holds between frames (`let`, at the console's own scope) whose
 * value comes from {@link ASKS_THE_DEVICE}'s two questions, however it got there — born with it,
 * or written with it later.
 *
 * WHAT IT CANNOT SEE is a reading laundered through a local: `const rows = howTall()` and then
 * `kept = rows` is two statements and this reads one. That is the limit of a scan over text, and
 * it is why the guard is a PAIR — this says WHICH names are kept, and the cases in a pty say a drag
 * costs no page, which is what a kept height that DECIDED one would cost.
 *
 * ⚠️ IT ANSWERED FOR *nothing is kept*, AND IT STOPPED BEING ABLE TO. A terminal that shrinks
 * carries rows off the top of the page and says nothing, and how many is a DIFFERENCE — so the
 * console has to hold the height it last saw to answer it at all (`repl/console.ts`,
 * `whatTheWindowTook`). This scan is unchanged; what changed is that the case reading it names two
 * and says what separates them, which is whether a kept number can turn a page.
 */
function remembersTheDevice(code: string): string[] {
  const kept = [...code.matchAll(/\blet\s+(\w+)/g)].map((found) => found[1] as string);
  return kept.filter((name) =>
    new RegExp(String.raw`\b${name}\b[^=;()]*=\s*[^;]*\bhow(?:Tall|Wide)\s*\(`).test(code),
  );
}

describe('the FRAME asks how big the terminal is in one place, and it follows it', () => {
  it('is read off a stream in exactly the two modules that own a lifetime', () => {
    // A1, BY THE DISCRIMINANT. It used to be two of the wrong kind: the session asked how
    // wide the terminal was in order to compose the panel, and the console asked how tall
    // it was in order to carry the page away. Two readings were two answers on the FRAME
    // after a resize — the session's was the width the console opened at, forever. So the
    // console owns the device and hands the number to everything the layout draws.
    //
    // ⚠️ IT SAYS TWO NOW, AND THE SECOND IS THE ENTRY. `cli.ts` reads the width beside the
    // `isTTY` it already read, because whether a line FOLDS is part of the capability every
    // verb is handed and that is resolved once, where the process is (`wiring/color.ts`).
    // It is not the defect the sentence above describes, and the difference is WHAT each
    // reading feeds: nothing the layout draws comes from the entry's, and nothing the
    // renderer folds to comes from the console's. What the second reading does cost is
    // named rather than hidden — a session outlives the window it opened in, so lines
    // landed after a resize fold to the width the session started at, which is written down
    // in `wiring/color.ts` and is the terminal's own behaviour rather than a new one.
    //
    // A THIRD would be the defect again, and it is what this case refuses.
    const asking = sourcesOf(SRC).filter(
      (file) => asksTheDevice(withoutComments(readFileSync(file, 'utf-8'))).length > 0,
    );
    expect(asking.map((file) => file.slice(SRC.length + 1))).toEqual([
      'cli.ts',
      join('repl', 'console.ts'),
    ]);
    // Both questions really are asked there, and the scan really would accuse a second
    // module: the corpus is the whole product and the pattern matches what somebody would
    // write.
    const owner = withoutComments(readFileSync(join(SRC, 'repl', 'console.ts'), 'utf-8'));
    expect(asksTheDevice(owner).length).toBeGreaterThan(1);
    expect(asksTheDevice('const columns = output.columns ?? 0;')).toHaveLength(1);
    // And it does not accuse a number this product decided for itself. ⚠️ THE PROBE WAS
    // `width: panel.columns`, and the panel stopped carrying the terminal's width when the frame
    // came off — a probe naming a field nothing can write is a probe that proves nothing. What it
    // names now is the width the arithmetic really receives.
    expect(asksTheDevice('const wide = request.columns;')).toEqual([]);
    expect(sourcesOf(SRC).length).toBeGreaterThan(50);
  });

  it('turns a page in exactly one place, whichever of the three asked for it', () => {
    // A3. Opening the page, the word that clears it and a caller who resized their window
    // are three callers of ONE page: what is on the screen goes into the scrollback, the
    // page gets a new identity, and the layout is told. A second place doing that would be
    // a second idea of what a page is, and every case of this surface rests on there being
    // one.
    const source = withoutComments(readFileSync(join(SRC, 'repl', 'console.ts'), 'utf-8'));
    expect(times(source, 'page += 1'), 'a page is turned in more than one place').toBe(1);
    // And there really are two callers of it, plus the write to the DEVICE that opens the
    // page before there is a layout to write through — which is the third of the three.
    expect(times(source, 'thePageAgain();'), 'the one page has fewer than two callers').toBe(2);
    // ⚠️ AND IT USED TO COUNT THE WHOLE CALL — `carriedIntoTheScrollback(howTall())` — because
    // the argument was one expression written the same way at both sites. It stopped being one
    // when a page began to be PLACED as well as carried away, and the placement is gone again:
    // the rows that put the input at the foot are part of the frame now (`repl/page.ts`), so
    // there is no `placeTheFlow` to count anywhere and no third site where one could hide. What
    // the count is FOR is the two places the bytes of a page are written — the device before
    // there is a layout, and the layout's own door after. A count of ZERO for the function that
    // is gone is not written here: a ban on a name nobody can write is a guard that cannot go
    // red, and what replaces it is the positive count below.
    expect(times(source, 'carriedIntoTheScrollback('), 'the page is written elsewhere').toBe(2);
    // AND THE ROOM THE PAGE HAS TO SPARE IS ASKED FOR IN ONE PLACE, which is the frame: it is a
    // function of the same height the arrangement is chosen by, so a second site asking would be
    // a leftover worked out against a terminal the area was not.
    expect(times(source, 'theGap('), 'the room is worked out somewhere else as well').toBe(1);
    // ⛔ AND WHATEVER WRITES THE FLOW SAYS WHAT THE SCREEN HAS. The leftover is subtracted from the
    // rows of the flow that are ON the screen (`repl/console.ts`, `flowOnScreen`), and rows that
    // scrolled off the top do not come back — so a place that added to the flow without moving that
    // number would place every frame after it short of the foot, which is the defect this pairing
    // exists to prevent. Two places write the flow: a line that lands, and a page that is turned.
    // FIVE move the number: those two, the CAP — what the frame left room for — which is
    // read on the way out of every frame and once on the way out of the FIRST one, and what a
    // window the caller made SHORTER carried off the top. ⚠️ IT WAS THREE, then FOUR: the fourth
    // is the opening, because a page whose opening is longer than the screen has already scrolled
    // by the time the layout has drawn it — measured at a hundred by eight, where the list the
    // first key asked for was cut to nothing and the second identical key press drew it. ⚠️ AND THE
    // FIFTH IS THE DEVICE ITSELF: a terminal that shrinks anchors what is on it at the FOOT, so
    // rows leave the screen with nothing written at all, and the cap cannot see it — the frame
    // fitted, and the screen it fitted on stopped existing. Measured as the input left as many rows
    // above the foot as the window lost (`tests/the-prompt-sits-at-the-foot.test.ts`).
    expect(times(source, 'past = '), 'the flow is written somewhere else as well').toBe(2);
    expect(times(source, 'flowOnScreen ='), 'the rows on the screen are set somewhere else').toBe(
      5,
    );
    // AND THE CAP ITSELF IS ONE FUNCTION, which is what makes the two readings of it one answer:
    // the first frame and every frame after it ask the same question of the same subtraction.
    expect(times(source, 'function whatTheFrameLeft'), 'the cap is worked out twice').toBe(1);
    expect(times(source, 'flowOnScreen +='), 'the rows on the screen grow somewhere else').toBe(1);
    // AND SO IS WHAT A SHORTER WINDOW TOOK, for the same reason and one more: it is the only place
    // the height a resize is measured AGAINST is read or written, so the pair — take the loss, keep
    // the new height — cannot come apart. Three mentions and no fourth: born, read, written.
    expect(times(source, 'function whatTheWindowTook'), 'the loss is worked out twice').toBe(1);
    expect(times(source, 'whatTheWindowTook();'), 'the loss is taken somewhere else as well').toBe(
      1,
    );
    expect(
      times(source, 'theHeightLastSeen'),
      'the height a resize is measured against has a second reader',
    ).toBe(3);
    // ⚠️ AND IT COUNTED A HEIGHT THE PAGE REMEMBERED — `placedAt =`, twice: born with the page
    // that opened and written again wherever one was turned. THE PREMISE WAS THAT A PAGE IS A
    // DRAWING AND A PLACEMENT, so the guard on a resize had a half the drawing could not answer
    // and that half needed a number kept between frames. It is gone, and a count of ZERO for it
    // is not written here: a ban on a name nobody can write is a guard that cannot go red. What
    // replaces it is the RULE the removal leaves, asked of every name kept, by the discriminant
    // rather than by that one name.
    //
    // ⚠️ AND THE RULE WAS *NOTHING THIS CONSOLE KEEPS BETWEEN FRAMES IS A MEASUREMENT OF THE
    // DEVICE*, WHICH IS TOO STRONG BY ONE — and this guard is what said so, in red, the moment the
    // second name appeared. WHAT FALSIFIED IT is a question that cannot be asked of one reading:
    // how many rows a terminal that SHRANK took off the top is a DIFFERENCE, so answering it needs
    // the height before as well as the height now (`repl/console.ts`, `whatTheWindowTook`). What
    // the rule was really about survives, and it is about what a kept number is allowed to DECIDE:
    //
    //   - `opened` is a DRAWING and not a measurement — composed from the two readings and held as
    //     what was composed (`repl/panel.ts`, `Opening`) — and it is what the page is turned by.
    //   - `theHeightLastSeen` is a measurement, and it decides NOTHING about the page. It is
    //     subtracted from a number this console already holds; no byte is written for it and no
    //     page can be turned by it. `placedAt` was the opposite of that in exactly one way that
    //     mattered: it was the second half of the guard that turned pages, which is why a drag of
    //     a window edge cost one per step.
    //
    // SO THE LIST IS TWO NAMES AND THE ORDER IS THE SOURCE'S, and what keeps it a rule rather than
    // an exception is the count of readers beside it above: the height has ONE reader, and it is
    // the subtraction.
    const remembered = remembersTheDevice(source);
    expect(remembered, 'a measurement of the device is remembered between frames').toEqual([
      'opened',
      'theHeightLastSeen',
    ]);
    // AND THE FIRST OF THEM IS A DRAWING RATHER THAN A NUMBER, which is the half of the old rule
    // that did not fall: the opening is composed FROM the two measurements and what is held is what
    // was composed (`repl/panel.ts`, `Opening`).
    expect(source, 'the opening is not composed where it is kept').toMatch(
      /let opened: Opening = openingFor\(/,
    );
    // NOT VACUOUS, IN BOTH DIRECTIONS: the scan really accuses the half that was taken out, and
    // it really does not accuse a reading taken and spent inside one frame.
    expect(remembersTheDevice('let placedAt = howTall();')).toEqual(['placedAt']);
    expect(remembersTheDevice('let placedAt = 0;\nplacedAt = howTall();')).toEqual(['placedAt']);
    expect(remembersTheDevice('const rows = howTall();')).toEqual([]);
  });
});
