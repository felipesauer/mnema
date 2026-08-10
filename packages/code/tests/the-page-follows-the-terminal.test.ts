/**
 * THE PAGE FOLLOWS THE TERMINAL — the box is drawn corner to corner, so the corner moves
 * when the caller's window does.
 *
 * IT IS A REGRESSION AND IT HAS A NAME. While the drawing was as wide as its own content,
 * a session opened at a hundred and twenty columns and narrowed to eighty still fitted;
 * corner to corner it does not, and eight rows of frame get folded in half by the terminal.
 * That was reported from real use — "it does not become responsive when the terminal
 * changes size" — and reproduced before it was fixed.
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
 *     box on the page after thirty changes" is.
 *   - AND NOTHING IS READ TO DO IT. That half is asked where the instrument for it already
 *     lives, `tests/the-name-and-the-hints.test.ts`, which counts the reads of the record:
 *     three width changes read what no width change reads.
 *
 * THE THREE DELTAS OF THE BOX are here too, and they are here rather than in
 * `the-panel.test.ts` because all three came out of the same reading of the same
 * reference: the version on the title, a rule between the two sections of the right-hand
 * column, and the left column centred. ⚠️ THE SECOND OF THEM IS GONE, with the section it
 * divided, and its case is inverted rather than deleted — the reference has two sections
 * there and this console has one, which is a difference from the reference that is
 * DECIDED (`.refactor/decisions/estudo-o-console-do-mnema.md`, D-b). What is left is
 * measured against the DRAWING, the centring against the blanks on either side of the
 * mark, so no number in this file can drift away from what is on the screen.
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
import { openSession } from '../src/repl/session.js';
import { LEAVE } from '../src/session-words.js';
import { VERSION } from '../src/version.js';
import { REPL_VERB } from '../src/wiring/repl.js';
import { decodedWhole } from './support/arriving.js';
import { ESC, fakeTerminal, hooksNothing, until, withoutLayout } from './support/console.js';
import { aFrameAfter, resizedTo, sizedTo, theDeviceWasTheSizeAskedFor } from './support/pty.js';
import { screenOf } from './support/screen.js';

/** The built CLI — the same file the `mnema` bin points at. */
const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
/** `packages/code/src`, for the guards that read the surface's own source. */
const SRC = fileURLToPath(new URL('../src', import.meta.url));
/** This package's manifest — the packaging fact the version is held against. */
const MANIFEST = fileURLToPath(new URL('../package.json', import.meta.url));

/**
 * The glyphs the box is drawn with.
 *
 * Named by their code points rather than typed, like every other unusual byte in this
 * repository's sources: a rule is one keystroke away from a pipe and a run from a hyphen.
 */
const TOP_LEFT = '\u256d';
const TOP_RIGHT = '\u256e';
const BOTTOM_RIGHT = '\u256f';
const RUN = '\u2500';
const RULE = '\u2502';

/** Every character the frame can end a row with. */
const FRAME = [TOP_RIGHT, BOTTOM_RIGHT, RULE];

/** What the opening always says, whatever the terminal is like. */
const OPENED = 'a session over this project';
/** What the caller types in front of, as the layout writes it: trimmed at the end. */
const PROMPT = 'mnema>';
/** What the record says about a tree that is intact. */
const VERIFIED = 'local integrity verified';

/**
 * A verb the caller ran, as the page shows it: the prompt and the word they typed.
 *
 * THE ECHO AND NOT THE ANSWER, and that is the whole reason this is the mark. The panel
 * says what the record is, so `verify`'s own verdict is on an opened page as well as an
 * answered one — looking for it after a redraw would be looking at the drawing. Only a
 * caller can put this on a page.
 */
const SAID = `${PROMPT} verify`;

/** The gap between the rule down the middle of the box and the column beside it. */
const BESIDE_THE_RULE = 2;
/** The gap between the border and what is inside it. */
const INSIDE_THE_BOX = 1;

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
  /** What the terminal must have received before this step counts as over. */
  readonly until: (bytes: string) => boolean;
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
      if (step.resize !== undefined) {
        resizedTo(device as string, step.resize.rows, step.resize.columns);
      }
      if (step.types !== undefined) child.stdin.write(step.types);
      await waitFor(() => step.until(arriving.text()) || over, step.what);
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

/** The box, as the rows of a screen: every row the frame is on. */
function boxRowsOf(screen: { readonly rows: readonly string[] }): string[] {
  return screen.rows.filter(
    (row) => row.includes(RULE) || row.includes(TOP_LEFT) || row.includes(BOTTOM_RIGHT),
  );
}

// ---------------------------------------------------------------------------
// The box takes the width the terminal has NOW
// ---------------------------------------------------------------------------

describe('the box is redrawn at the width the caller left their window at', () => {
  it('follows the terminal down to 74 and back up to 100', async () => {
    // THE REGRESSION, in one case and in both directions. Opened at a hundred and twenty
    // and narrowed, every row of the drawing has to end on the last column of the NEW
    // terminal — which is the same promise `a-page-that-opens-clean.test.ts` makes about
    // the terminal a session opened on, asked of one that changed underneath it.
    //
    // ⚠️ IT NARROWED TO SEVENTY AND SEVENTY HAS NO BOX ANY MORE. The name's widest drawing
    // is seventy columns across, so a terminal exactly that wide is given the art and has
    // nothing left to put a frame around it — the panel answers with no box, which is a
    // real answer and the wrong instrument for a case about a box being REDRAWN. Narrowed
    // to the first width that still has one, so what moves is the width and not the form.
    const rows = 40;
    const ran = await inPty({
      columns: 120,
      rows,
      steps: [
        opens,
        {
          resize: { columns: 74, rows },
          until: (bytes) => times(bytes, TOP_LEFT) > 1,
          what: 'drew the box again after shrinking',
        },
        {
          resize: { columns: 100, rows },
          until: (bytes) => times(bytes, TOP_LEFT) > 2,
          what: 'drew the box again after growing',
        },
        leaves,
      ],
    });

    for (const [step, columns] of [
      [1, 74],
      [2, 100],
    ] as const) {
      const screen = screenOf(ran.bytes.slice(0, ran.at[step] as number), columns, rows);
      const box = boxRowsOf(screen);
      expect(box.length, `${columns}: no box`).toBeGreaterThan(3);
      expect(screen.text, `${columns}: no panel`).toContain(OPENED);
      for (const row of box) {
        const drawn = row.replace(/ +$/, '');
        expect([...drawn].length, `${columns}: a row of the box stops short: ${drawn}`).toBe(
          columns,
        );
        expect(FRAME, `${columns}: the last column is not the frame`).toContain([...drawn].at(-1));
      }
      const top = box.find((row) => row.includes(TOP_LEFT)) as string;
      expect(top, `${columns}: the top edge stops at the title`).toContain(`${RUN}${TOP_RIGHT}`);
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
        { types: 'verify\r', until: (bytes) => bytes.includes(VERIFIED), what: 'answered' },
        {
          resize: { columns: 90, rows },
          until: (bytes) => times(bytes, TOP_LEFT) > 1,
          what: 'drew the box again',
        },
        leaves,
      ],
    });
    const answered = screenOf(ran.bytes.slice(0, ran.at[1] as number), 120, rows);
    const resized = screenOf(ran.bytes.slice(0, ran.at[2] as number), 90, rows);
    // The caller really did type a verb, or the assertion below is about nothing.
    expect(answered.text, 'the caller never typed a verb').toContain(SAID);
    expect(resized.text, 'what the caller had said went with the old page').toContain(SAID);
    // And it is the page AGAIN rather than the old page left alone: the box is there, at
    // the new width.
    expect(resized.text, 'no box after the resize').toContain(OPENED);
    for (const row of boxRowsOf(resized)) {
      expect([...row.replace(/ +$/, '')].length).toBe(90);
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

describe('the page follows the drawing, and once per drag', () => {
  it('draws nothing when a height moves no glyph, and turns the page when one does', async () => {
    // ⚠️ THIS CASE WAS `draws nothing at all when only the height changed`, and it is
    // renamed because what it asserted stopped being true: the name gives way by HEIGHT as
    // well now (`presentation/banner.ts`), so a window made short enough opens with a
    // different mark. What survived is the half with teeth — a height that changes no glyph
    // costs the caller nothing — and it survived because the guard stopped comparing SIZES
    // and started comparing the opening itself (`repl/panel.ts`, `sameOpening`).
    //
    // ⚠️ AND IT WOULD HAVE STAYED GREEN THROUGH THE CHANGE, which is why it is here rather
    // than deleted: it ended its drag back at the height it started from, so a console that
    // turned a page for every height still answered one. The drag below ends somewhere
    // else.
    const { terminal, close } = await opened(200);
    const pages = () => carriedPages(terminal.bytes());
    expect(pages(), 'the page was never opened').toBe(1);
    // ⚠️ THE HEIGHTS IT USED WERE THIRTY, TWENTY AND TEN, and this delivery falsified the
    // premise under them: the name gave way when the DRAWING was taller than the terminal,
    // so nothing but a four-row window could move a glyph. It gives way when the PAGE stops
    // fitting now, and every one of those three crosses a threshold. What is chosen instead
    // is derived rather than picked: the biggest drawing there is is already on the screen
    // at forty rows, so no TALLER terminal can change it — heights above the one the session
    // opened at are heights the drawing cannot depend on, whatever the arithmetic under it
    // says, and the drag still ends somewhere other than where it began.
    for (const rows of [50, 60, 44]) terminal.resize(200, rows);
    await new Promise((resolve) => setTimeout(resolve, LONGER_THAN_SETTLING));
    expect(pages(), 'a height that moves no glyph turned the page').toBe(1);

    // THE WIDTH STILL DOES IT, which is what this case has always been beside — and it is
    // asked here, at a height with room for the whole drawing, because a short terminal is
    // one the LIBRARY writes what it is keeping out again on, and the count of boxes stops
    // being this product's answer there (measured: five corners for three pages at four
    // rows; `tests/a-page-that-opens-clean.test.ts` is where that behaviour is pinned).
    terminal.resize(199);
    await new Promise((resolve) => setTimeout(resolve, LONGER_THAN_SETTLING));
    expect(pages(), 'a change of width did not turn the page').toBe(2);
    expect(times(terminal.bytes(), TOP_LEFT), 'the box was not drawn again').toBe(2);

    // AND THE TEETH FOR THE OTHER MEASUREMENT: a height the drawing DOES depend on.
    //
    // ⚠️ IT USED TO BE ONE ROW SHORTER THAN THE MARK IS TALL, derived from the drawing on
    // the premise that the drawing was what the height was measured against. This delivery
    // falsified that — what a height is measured against is the whole PAGE, so the drawing
    // gives way long before a window is shorter than it — and a case that kept the old
    // derivation would still be green while asserting the wrong reason. What is derived now
    // is the drawing itself: the widest form is what a tall terminal draws, and the height
    // is walked down until something else is.
    const widest = drawnAcross(199).reduce((most, row) => (row.length > most.length ? row : most));
    expect(terminal.bytes(), 'the widest form was not on the wide terminal').toContain(widest);
    const before = terminal.bytes().length;
    terminal.resize(199, 4);
    await new Promise((resolve) => setTimeout(resolve, LONGER_THAN_SETTLING));
    expect(pages(), 'a height that gives the mark away did not turn the page').toBe(3);
    // And it is a SHORTER mark that was drawn, so the page turned for the reason claimed.
    // Read from the LAST box on the page rather than from everything written after the
    // resize: on a terminal this short the library writes out everything it is keeping,
    // which is every page so far — the old drawing included.
    const said = terminal.bytes();
    expect(before, 'nothing was written before the resize').toBeGreaterThan(0);
    expect(
      said.slice(said.lastIndexOf(TOP_LEFT)),
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
    const { terminal, close } = await opened(200);
    const dragged = 30;
    for (let step = 1; step <= dragged; step++) terminal.resize(200 - step);
    await new Promise((resolve) => setTimeout(resolve, LONGER_THAN_SETTLING));
    // One for the page that opened, one for the size the drag ended on.
    expect(times(terminal.bytes(), CARRIES_THE_PAGE), 'a page per step of the drag').toBe(2);
    // And it really is the size the drag ENDED on, rather than the one it started from.
    const last = stripped(withoutLayout(terminal.bytes()))
      .split('\n')
      .filter((row) => row.includes(TOP_LEFT))
      .at(-1) as string;
    expect([...last.replace(/ +$/, '')].length).toBe(200 - dragged);
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
// The three deltas of the box
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
 * The rows of a box that are its own — the ones beginning at the left edge of the screen.
 *
 * ⚠️ ANY ROW HOLDING THE RULE USED TO COUNT, and the name's widest drawing is inked with
 * the rule's own glyph now: a page with no box came back as eleven rows of a box that is
 * not there.
 */
function boxOf(page: string): string[] {
  return rowsOf(page).filter((row) => row.startsWith(RULE) || row.startsWith(TOP_LEFT));
}

/**
 * WHERE THE RULES OF THE BOX ARE — the columns of the screen one runs down on EVERY row of
 * it: the two sides, and the divider when there is one.
 *
 * ⚠️ IT USED TO BE THE RULES ON ONE ROW, and that was the same character in two roles. The
 * name's widest drawing is inked with three glyphs and one of them is {@link RULE}, so a
 * row of the art carries a handful of them in places that are not columns of the box at
 * all — and the two halves of a row were then cut at whichever of the art's verticals came
 * second. A rule of the FRAME is in the same column on every row; a vertical of the art is
 * in a different one on each.
 */
function rulesThrough(box: readonly string[]): number[] {
  const inside = insideOf(box);
  if (inside.length === 0) return [];
  return [...(inside[0] as string)].flatMap((_, at) =>
    inside.every((row) => [...row][at] === RULE) ? [at] : [],
  );
}

/** The rows of a box between its two edges — the ones a rule of the frame runs down. */
function insideOf(box: readonly string[]): string[] {
  return box.filter((row) => row.startsWith(RULE));
}

/** The rows inside a box that is in its two-column form, and none when it is not. */
function throughRuled(box: readonly string[]): string[] {
  return rulesThrough(box).length >= 3 ? insideOf(box) : [];
}

/** What is inside the right-hand column of a row, given where the box's rules run. */
function rightOf(row: string, at: readonly number[]): string {
  return at.length < 3 ? '' : [...row].slice((at[1] as number) + 1, at[2]).join('');
}

/** What is inside the left-hand column of a row, given where the box's rules run. */
function leftOf(row: string, at: readonly number[]): string {
  return at.length < 3 ? '' : [...row].slice((at[0] as number) + 1, at[1]).join('');
}

/** What a console drew, opened on a terminal `columns` wide and left again. */
async function drawnAt(columns: number): Promise<string> {
  const { terminal, close } = await opened(columns);
  await close();
  return terminal.bytes();
}

describe('the title says which build it is, and it is the one the flag prints', () => {
  it('puts the version on the box, beside the name', async () => {
    const title = boxOf(await drawnAt(200)).find((row) => row.includes(OPENED));
    expect(title, 'no title on the box').toBeDefined();
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

describe('nothing divides the right-hand column, because there is one section in it', () => {
  it('draws no run of glyphs inside the box, and the record is what is there', async () => {
    // ⚠️ THIS CASE IS THE INVERSE OF THE ONE IT REPLACES, and it is renamed rather than
    // edited. It used to be `a rule divides the two sections, and it measures the column it
    // divides`, and it asserted that the run between `The record` and `Hints` reached as far
    // as the widest row beside it. Two things fell at once. The second SECTION went — what
    // to type is said under the prompt, in the place that does not scroll away — so there is
    // nothing left for a rule to divide. And the property the case was pinning had already
    // stopped being true of the DRAWING: the box is as wide as the terminal now, so the
    // column is stretched, and the rule went on measuring its siblings instead — a run of 45
    // inside a column of 61, measured on a terminal 120 wide. It passed because both numbers
    // came from the same siblings.
    //
    // Kept as a case rather than deleted, because "there is no rule" is exactly what a
    // future delivery could undo by accident.
    const box = throughRuled(boxOf(await drawnAt(200)));
    expect(box.length, 'the box is not in its two-column form').toBeGreaterThan(3);
    const at = rulesThrough(box);

    const record = box.findIndex((row) => rightOf(row, at).includes('The record'));
    expect(record, 'no record section').toBeGreaterThanOrEqual(0);
    expect(
      box.findIndex((row) => isRun(rightOf(row, at).trim())),
      'a run of glyphs is still drawn inside the column',
    ).toBe(-1);
    // AND NOTHING IS DRAWN INSIDE THE LEFT ONE EITHER, so the absence is about the box
    // rather than about the half of it this case happened to look in.
    expect(
      box.findIndex((row) => isRun(leftOf(row, at).trim())),
      'a run of glyphs is drawn inside the left column',
    ).toBe(-1);
    // Not vacuous, in two directions: the instrument really can see a run of glyphs, and
    // the column really has rows in it — the ones the record put there.
    expect(isRun(RUN.repeat(3))).toBe(true);
    const reach = (row: string): number => rightOf(row, at).replace(/ +$/, '').length;
    expect(Math.max(...box.map(reach))).toBeGreaterThan(BESIDE_THE_RULE);
  }, 120_000);
});

describe('the right column is centred down the height the mark gave the box', () => {
  it('leaves the same number of blank rows over the record as under it', async () => {
    // POSITION AND NOTHING ELSE, on the other axis, and it is the same shape of question the
    // case below asks across the left column: no row is added or dropped, so what can be
    // observed is WHERE the section starts inside a column whose height something else
    // decided.
    //
    // WHAT IT IS FOR, measured before it was written: the box is as tall as the drawing — ten
    // rows at a hundred and forty columns — and the record's section is three of them, so the
    // section sat at the top with SEVEN blank rows under it. Nothing said it should; a column
    // starts at its top, and that was all. Centred, the gap is halved and shared.
    const box = throughRuled(boxOf(await drawnAt(140)));
    expect(box.length, 'the box is not in its two-column form').toBeGreaterThan(3);
    const at = rulesThrough(box);
    const held = box.map((row) => rightOf(row, at).trim());
    const first = held.findIndex((row) => row.length > 0);
    const last = held.length - 1 - [...held].reverse().findIndex((row) => row.length > 0);
    expect(first, 'nothing is in the right-hand column').toBeGreaterThanOrEqual(0);
    // THE PROMISE: the blank over the section and the blank under it differ by at most one
    // row, which is what a gap of an odd number of rows allows and nothing more.
    const over = first;
    const under = held.length - 1 - last;
    expect(Math.abs(over - under), `${over} over, ${under} under`).toBeLessThanOrEqual(1);
    // NOT VACUOUS, IN TWO DIRECTIONS. There really is a gap to share — the section is shorter
    // than the box, which is what the top-aligned drawing put all of underneath it — and the
    // section really is the record's rather than an empty column read as centred.
    expect(over + under, 'the section fills the box, so nothing was centred').toBeGreaterThan(2);
    expect(held.filter((row) => row.length > 0).length, 'the column is empty').toBeGreaterThan(1);
    expect(held.some((row) => row.includes('The record'))).toBe(true);
  }, 120_000);
});

describe('the left column is centred on the widest thing in it', () => {
  it('leaves the same blank on each side of the mark', async () => {
    // POSITION AND NOTHING ELSE, which is why it is asked as a symmetry: no line is padded
    // or trimmed, so what can be observed is where the narrower group starts and ends
    // inside a column whose width the wider one decided.
    //
    // ⚠️ THE BOX ROWS WERE THE ROWS WITH THREE RULES ON THEM, and the widest drawing of the
    // name is inked with the rule's own glyph — so its rows counted as box rows and its
    // verticals as dividers. What makes a row the box's is that it BEGINS at the left edge
    // of the screen, and what makes the form the two-column one is a rule running THROUGH
    // every row of it rather than three on any one of them.
    //
    // OPENED OVER THE PROJECT WITH THE LONGER PATH, for the reason the fixture gives: the
    // slack between the two groups came to ONE column when the drawing changed, and a
    // symmetry measured across one column of slack is a case that would pass left-aligned.
    process.chdir(aLongerPath);
    const page = await drawnAt(200).finally(() => process.chdir(project));
    const box = throughRuled(boxOf(page));
    const at = rulesThrough(box);
    const widest = drawnAcross(200).reduce((most, row) => (row.length > most.length ? row : most));
    const mark = box.find((row) => row.includes(widest));
    expect(mark, 'the drawing of the name is not in the box').toBeDefined();
    const standing = box.find((row) => leftOf(row, at).includes(aLongerPath));
    expect(standing, 'the line beside the mark is not there').toBeDefined();
    // ⚠️ WHICH OF THE TWO IS CENTRED USED TO BE WRITTEN DOWN, and it was the mark: the
    // five-row drawing was twenty-nine columns and the path under it is about fifty, so the
    // path decided the column's width and the art sat in the middle of it. The next drawing
    // was seventy columns, so the two changed places; the one after it is fifty, so on an
    // ordinary sandbox path they changed places AGAIN and came within a column of each other.
    // The property this case is for did not move through any of that: whichever group is
    // NARROWER is the one with the same blank on each side of it. Written as the pair rather
    // than as the winner, which is what let three changes of art pass through it.
    //
    // ⚠️ AND IT WAS ASKED AS BLANK-BEFORE AGAINST BLANK-AFTER, each corrected by one of the
    // box's own constants. That arithmetic held while the column's width came from the line
    // under the mark, and it is off by three now that it comes from the drawing — the two
    // gaps are measured from different edges, so the correction has to be right about which
    // padding is on which side. WHAT THE CASE IS FOR needs neither constant: centred means
    // the two groups have the SAME MIDDLE, and a middle is a position rather than a gap.
    const inColumn = (row: string): string => leftOf(row, at);
    const middleOf = (row: string): number => {
      const held = inColumn(row);
      const from = held.length - held.trimStart().length;
      return from + (held.trim().length - 1) / 2;
    };
    const [wider, narrower] =
      inColumn(mark as string).trim().length >= inColumn(standing as string).trim().length
        ? [mark as string, standing as string]
        : [standing as string, mark as string];
    expect(
      Math.abs(middleOf(wider) - middleOf(narrower)),
      `${inColumn(narrower)}`,
    ).toBeLessThanOrEqual(1);
    // Not vacuous, in two directions. Left-aligned, the two middles would differ by half the
    // slack — and there really is slack, because one group is wider than the other.
    const slack = inColumn(wider).trim().length - inColumn(narrower).trim().length;
    expect(slack, 'the two groups are the same width, so nothing was centred').toBeGreaterThan(2);
    const held = inColumn(narrower);
    expect(
      held.length - held.trimStart().length,
      'the narrower group is at the left edge of its column',
    ).toBeGreaterThan(INSIDE_THE_BOX);
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

/** Whether some glyphs are a run of the box's own edge, and there are some. */
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
    // And it does not accuse the number this product decided for itself.
    expect(asksTheDevice('width: panel.columns')).toEqual([]);
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
    // ⚠️ AND IT USED TO NAME THE HEIGHT — `carriedIntoTheScrollback(howTall())`. A page is
    // placed against four numbers now rather than one, because the input is anchored at the
    // foot and the leftover is a subtraction over what the opening and the area take
    // (`repl/page.ts`); the height alone would place the page and not the anchor. The shape
    // this counts moved with it, which is why the count is over the call and not the symbol:
    // a caller that passed something else would be a second idea of what page is being turned.
    expect(times(source, 'carriedIntoTheScrollback(thePage())')).toBe(2);
  });
});
