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
 *   - EITHER MEASUREMENT. ⚠️ THIS SAID `WIDTH ONLY — a window made taller moves no glyph of
 *     a drawing measured in columns`, and the drawing stopped being measured in columns
 *     alone: the name gives way by HEIGHT as well (`presentation/banner.ts`), so a window
 *     made shorter can open with a different mark. The case is inverted and renamed below,
 *     and what it counts is unchanged — pages, not redraws.
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

import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
import { decodedWhole } from './support/arriving.js';
import { ESC, fakeTerminal, hooksNothing, until, withoutLayout } from './support/console.js';
import {
  aFrameAfter,
  arrivedSince,
  resizedTo,
  sizedTo,
  theDeviceWasTheSizeAskedFor,
} from './support/pty.js';
import { screenOf } from './support/screen.js';

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

/** One thing to do in the session, and what says it is done. */
interface Step {
  /** Typed first. */
  readonly types?: string;
  /**
   * The caller resized their window before this step, in columns and rows.
   *
   * Done by setting the window size on the pty's own device from OUTSIDE the session,
   * which is what a terminal emulator does when somebody drags a corner: the kernel
   * records the new size and raises the signal at the process group on the other end.
   * Nothing here writes to the session or asks it anything.
   */
  readonly resize?: { readonly columns: number; readonly rows: number };
  /**
   * What the terminal must have received before this step counts as over.
   *
   * `since` is how many bytes had arrived when the step BEGAN — the number that lets a
   * predicate ask about the step's own doing rather than about the whole stream, which is the
   * difference between waiting for an answer and being answered by the OPENING
   * (`support/pty.ts`, `arrivedSince`).
   */
  readonly until: (bytes: string, since: number) => boolean;
  /** What to call it when it never happens. */
  readonly what: string;
}

/** What a run in a pty produced. */
interface Ran {
  /** Every byte the terminal received, from the first to the last. */
  readonly bytes: string;
  /** How much of {@link bytes} had arrived when each step was over, in order. */
  readonly at: readonly number[];
}

/** Waits until `ready` answers true, or gives up — a poll, never a fixed sleep. */
async function waitFor(ready: () => boolean, what: string, tries = 1200): Promise<void> {
  for (let tried = 0; tried < tries; tried++) {
    if (ready()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`the session never ${what}`);
}

/** How many times `what` occurs in `text`. */
const times = (text: string, what: string): number => text.split(what).length - 1;

/**
 * Runs `mnema repl` on a pseudo-terminal of a given size, resizing it between steps.
 *
 * The pty comes from `script`, which is how a shell hands a program a terminal it did not
 * inherit; the runner prints WHICH device it got before it starts the session, so the size
 * of that device can be changed while the session is running on it.
 */
async function inPty(options: {
  readonly columns: number;
  readonly rows: number;
  readonly steps: readonly Step[];
}): Promise<Ran> {
  const here = mkdtempSync(join(sandbox, 'pty-'));
  const runner = join(here, 'run.sh');
  const named = 'TTY=';
  writeFileSync(
    runner,
    [
      `cd ${project}`,
      ...sizedTo(options.rows, options.columns, here),
      `echo "${named}$(tty)"`,
      `node ${CLI} ${REPL_VERB}`,
      '',
    ].join('\n'),
  );

  const arriving = decodedWhole();
  let over = false;
  const child = spawn('script', ['-qec', `sh ${runner}`, '/dev/null'], {
    cwd: project,
    env: environment,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  arriving.from(child.stdout);
  arriving.from(child.stderr);
  const ended = new Promise<void>((resolve) => {
    child.on('close', () => {
      over = true;
      resolve();
    });
  });

  const at: number[] = [];
  try {
    await waitFor(() => arriving.text().includes(named) || over, 'said which terminal it had');
    const device = /TTY=(\S+)/.exec(arriving.text())?.[1];
    expect(device, 'the runner never named the terminal').toBeDefined();
    // The size the case asked for is the premise every count below rests on, so the device
    // is asked whether it became it — the shared instrument's rule, read from where it is
    // written (`support/pty.ts`) rather than restated here.
    await theDeviceWasTheSizeAskedFor(here, options.rows, options.columns);
    for (const step of options.steps) {
      // WHERE THE STEP BEGINS — the shared instrument's rule again, taken before the resize as
      // well as before the keystroke, because both are the step's own doing
      // (`support/pty.ts`, `arrivedSince`).
      const since = arriving.text().length;
      if (step.resize !== undefined) {
        resizedTo(device as string, step.resize.rows, step.resize.columns);
      }
      if (step.types !== undefined) child.stdin.write(step.types);
      await waitFor(() => step.until(arriving.text(), since) || over, step.what);
      // Settled: the page has stopped growing, so the offset taken below is the end of a
      // frame rather than the middle of one.
      for (let still = 0, was = -1; still < 8; still++) {
        if (arriving.text().length === was) break;
        was = arriving.text().length;
        await new Promise((resolve) => setTimeout(resolve, 40));
        still = 0;
        if (arriving.text().length === was) break;
      }
      at.push(arriving.text().length);
    }
    await Promise.race([
      ended,
      new Promise((_, reject) => setTimeout(() => reject(new Error('never came back')), 30_000)),
    ]);
  } finally {
    child.stdin.end();
    child.kill('SIGKILL');
  }
  return { bytes: arriving.text(), at };
}

/** The step every session begins with: the console is open when the prompt is drawn. */
const opens: Step = {
  // What a finished frame IS is the shared instrument's (`support/pty.ts`): a prompt is
  // written in the middle of one, and this file drives a pty of its own.
  until: aFrameAfter(PROMPT),
  what: 'opened its console',
};

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
 * How many pages a session has carried into the scrollback, at ANY height.
 *
 * ⚠️ THE CONSTANT ABOVE NAMES ONE HEIGHT, and that was enough while only a width could turn
 * a page: every page was carried at the height the console opened at. A page turned after
 * the caller made their window shorter is carried at the NEW height, so counting the one
 * sequence would count it as zero — the shape of instrument that reads a defect as a
 * success. The sequence is written by one function and by nothing else (`repl/page.ts`),
 * whatever height it names.
 */
const carriedPages = (bytes: string): number =>
  (bytes.match(new RegExp(`${ESC}\\[\\d+;1H`, 'g')) ?? []).length;

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
  it('turns the page for a height that moves no glyph, and for one that does', async () => {
    // ⚠️ THIS CASE WAS `draws nothing when a height moves no glyph, and turns the page when
    // one does`, and before that `draws nothing at all when only the height changed`. Both
    // halves of both names rested on one premise — a height the DRAWING does not depend on is
    // a height the page does not depend on — and the delivery that put the input at the FOOT
    // of the terminal falsified it: the rows a page is placed with are how many the height
    // leaves over, so a page placed at one height is misplaced at another whatever is on it
    // (`repl/page.ts`, `tests/the-prompt-sits-at-the-foot.test.ts`). Measured, on a real
    // device, before the guard was widened: at a hundred by thirty dragged to forty, not one
    // byte was written and the input stayed eleven rows above the foot.
    //
    // ⚠️ AND IT WOULD HAVE STAYED GREEN THROUGH THE EARLIER CHANGE, which is why the drag ends
    // somewhere other than where it began: a drag that came back to its own height would be
    // answered with one page by a console that turned one for every height and by a console
    // that turned none.
    //
    // WHAT IS ASSERTED NOW IS THE PAIR: the height alone turns a page, and a drag that ends
    // where it started still turns none — so this is the guard being widened rather than
    // removed.
    const { terminal, close } = await opened(200);
    const pages = () => carriedPages(terminal.bytes());
    expect(pages(), 'the page was never opened').toBe(1);
    // ⚠️ THE HEIGHTS IT USED WERE THIRTY, TWENTY AND TEN, and an earlier delivery falsified
    // the premise under them: the name gave way when the DRAWING was taller than the terminal,
    // so nothing but a four-row window could move a glyph. It gives way when the PAGE stops
    // fitting now, and every one of those three crosses a threshold. What is chosen instead
    // is derived rather than picked: the biggest drawing there is is already on the screen
    // at forty rows, so no TALLER terminal can change it — heights above the one the session
    // opened at are heights the DRAWING cannot depend on, whatever the arithmetic under it
    // says, and the drag still ends somewhere other than where it began.
    for (const rows of [50, 60, 44]) terminal.resize(200, rows);
    await new Promise((resolve) => setTimeout(resolve, LONGER_THAN_SETTLING));
    expect(pages(), 'a height with a new placement did not turn the page').toBe(2);
    // AND IT IS THE PLACEMENT AND NOT THE DRAWING THAT DID IT, which is what makes this the
    // widened half rather than a coincidence: the opening on the new page is the opening that was
    // on the old one, at the same width, so nothing a panel can see moved.
    //
    // ⚠️ THE COUNT WAS OF CORNERS — one per box drawn — and there are none. It is not replaced by
    // a count of anything: measured, the LIBRARY rewrites the region it keeps when the width
    // changes, so any count of what is on the page answers for the library as well as for this
    // product. What the product wrote is {@link carriedPages}, which is the instrument this case
    // already had for the same reason. So what is asserted about the drawing is the drawing:
    // whichever arrangement is on the page last is the one that was there before.
    expect(besideTheMark(lastTitle(terminal.bytes()), 200).trim(), 'the arrangement moved').toContain(
      OPENED,
    );
    // AND A DRAG THAT ENDS WHERE IT STARTED STILL COSTS NOTHING. The guard grew a half; it
    // did not become "a resize event happened".
    terminal.resize(200, 30);
    terminal.resize(200, 44);
    await new Promise((resolve) => setTimeout(resolve, LONGER_THAN_SETTLING));
    expect(pages(), 'a drag back to the height on the screen turned a page').toBe(2);

    // ⚠️ AND HERE IS THE OTHER HALF OF THIS CASE, INVERTED BY THIS DELIVERY. It read
    // `terminal.resize(199)` and asserted a THIRD page, on the sentence *the width still does
    // it* — and it did, because the box was drawn corner to corner and one column narrower was
    // one column of frame moved. Nothing is drawn to an edge now, so a hundred and ninety-nine
    // columns is the same drawing as two hundred and the console writes nothing at all. The
    // assertion is turned over rather than dropped, because *a width that moves no glyph costs
    // nothing* is the rule `panel.ts` states and this is the only place it can be observed.
    terminal.resize(199);
    await new Promise((resolve) => setTimeout(resolve, LONGER_THAN_SETTLING));
    expect(pages(), 'a width that moves no glyph turned a page').toBe(2);

    // AND A WIDTH THAT DOES MOVE ONE STILL DOES IT, which is the half that had to survive: at
    // seventy-four columns the text has no room beside the mark, so the arrangement is a
    // different one and the page is turned.
    terminal.resize(74);
    await new Promise((resolve) => setTimeout(resolve, LONGER_THAN_SETTLING));
    expect(pages(), 'a width that changes the arrangement did not turn the page').toBe(3);
    // And it is the ARRANGEMENT that changed, which is the reason claimed: at seventy-four
    // columns the text is under the mark, so nothing is beside it.
    expect(besideTheMark(lastTitle(terminal.bytes()), 74).trim(), 'the text is still beside the mark').toBe(
      '',
    );

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
    terminal.resize(74, 4);
    await new Promise((resolve) => setTimeout(resolve, LONGER_THAN_SETTLING));
    expect(pages(), 'a height that gives the mark away did not turn the page').toBe(4);
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
    expect([...last.replace(/ +$/, '')].length, 'the last page is wider than the drag ended').toBeLessThanOrEqual(
      ended,
    );
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
    expect(opening.some((row) => row.includes('The record')), 'no record section').toBe(true);
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
    // Three move the number: those two, and the frame that caps it at what it left room for.
    expect(times(source, 'past = '), 'the flow is written somewhere else as well').toBe(2);
    expect(times(source, 'flowOnScreen ='), 'the rows on the screen are set somewhere else').toBe(
      3,
    );
    expect(times(source, 'flowOnScreen +='), 'the rows on the screen grow somewhere else').toBe(1);
    // AND THE HEIGHT THE PAGE WAS PLACED AT IS RECORDED WHERE THE PAGE IS TURNED. It is the
    // half of the resize guard the drawing cannot answer (`repl/panel.ts`, `sameOpening`), so
    // a page turned without recording it would leave the guard comparing against a height two
    // pages old and refusing to follow the terminal at all: born with the page that opens, and
    // written again in the one place that turns one.
    expect(times(source, 'placedAt ='), 'the placement is recorded somewhere else').toBe(2);
  });
});
