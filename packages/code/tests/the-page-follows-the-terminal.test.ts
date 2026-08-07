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

import { execFileSync, spawn } from 'node:child_process';
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
import { ESC, fakeTerminal, hooksNothing, until, withoutLayout } from './support/console.js';
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
const INK = '\u2588';

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
      `stty rows ${options.rows} cols ${options.columns}`,
      `echo "${named}$(tty)"`,
      `node ${CLI} ${REPL_VERB}`,
      '',
    ].join('\n'),
  );

  let bytes = '';
  let over = false;
  const child = spawn('script', ['-qec', `sh ${runner}`, '/dev/null'], {
    cwd: project,
    env: environment,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const collect = (chunk: Buffer): void => {
    bytes += chunk.toString('utf-8');
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  const ended = new Promise<void>((resolve) => {
    child.on('close', () => {
      over = true;
      resolve();
    });
  });

  const at: number[] = [];
  try {
    await waitFor(() => bytes.includes(named) || over, 'said which terminal it had');
    const device = /TTY=(\S+)/.exec(bytes)?.[1];
    expect(device, 'the runner never named the terminal').toBeDefined();
    for (const step of options.steps) {
      if (step.resize !== undefined) {
        execFileSync('stty', [
          '-F',
          device as string,
          'rows',
          String(step.resize.rows),
          'cols',
          String(step.resize.columns),
        ]);
      }
      if (step.types !== undefined) child.stdin.write(step.types);
      await waitFor(() => step.until(bytes) || over, step.what);
      // Settled: the page has stopped growing, so the offset taken below is the end of a
      // frame rather than the middle of one.
      for (let still = 0, was = -1; still < 8; still++) {
        if (bytes.length === was) break;
        was = bytes.length;
        await new Promise((resolve) => setTimeout(resolve, 40));
        still = 0;
        if (bytes.length === was) break;
      }
      at.push(bytes.length);
    }
    await Promise.race([
      ended,
      new Promise((_, reject) => setTimeout(() => reject(new Error('never came back')), 30_000)),
    ]);
  } finally {
    child.stdin.end();
    child.kill('SIGKILL');
  }
  return { bytes, at };
}

/** The step every session begins with: the console is open when the prompt is drawn. */
const opens: Step = { until: (bytes) => bytes.includes(PROMPT), what: 'opened its console' };

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
  it('follows the terminal down to 70 and back up to 100', async () => {
    // THE REGRESSION, in one case and in both directions. Opened at a hundred and twenty
    // and narrowed, every row of the drawing has to end on the last column of the NEW
    // terminal — which is the same promise `a-page-that-opens-clean.test.ts` makes about
    // the terminal a session opened on, asked of one that changed underneath it.
    const rows = 40;
    const ran = await inPty({
      columns: 120,
      rows,
      steps: [
        opens,
        {
          resize: { columns: 70, rows },
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
      [1, 70],
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
    // Heights the drawing does not depend on, ending at one of them rather than at the one
    // it started from — and counted at EVERY height, because the bytes that carry a page
    // away name the height they carried.
    for (const rows of [30, 20, 10]) terminal.resize(200, rows);
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

    // AND THE TEETH FOR THE OTHER MEASUREMENT: a height the drawing DOES depend on. One row
    // shorter than the mark is tall, which is derived from the mark rather than chosen —
    // the tall form cannot be drawn in fewer rows than it has.
    const marked = bannerFor({ columns: 199, rows: TALL });
    expect(marked.length, 'the tall form is not the tall form').toBeGreaterThan(1);
    terminal.resize(199, marked.length - 1);
    await new Promise((resolve) => setTimeout(resolve, LONGER_THAN_SETTLING));
    expect(pages(), 'a height that gives the mark away did not turn the page').toBe(3);
    // And it is the SHORTER mark that was drawn, so the page turned for the reason claimed.
    // Read from the LAST box on the page rather than from everything written after the
    // resize: on a terminal this short the library writes out everything it is keeping,
    // which is every page so far — the old drawing included.
    const said = terminal.bytes();
    expect(
      said.slice(said.lastIndexOf(TOP_LEFT)),
      'the tall form survived a terminal too short for it',
    ).not.toContain(INK);
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
    const { terminal, close } = await opened(200);
    expect(terminal.bytes(), 'the tall form was never drawn').toContain(INK);
    const wide = terminal.bytes().length;
    terminal.resize(20);
    await new Promise((resolve) => setTimeout(resolve, LONGER_THAN_SETTLING));
    const narrow = terminal.bytes().slice(wide);
    expect(narrow, 'the drawing did not give way to a narrower form').not.toContain(INK);
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

/** The rows of the page that are the box's own. */
function boxOf(page: string): string[] {
  return rowsOf(page).filter((row) => row.includes(RULE) || row.includes(TOP_LEFT));
}

/** Where the three vertical rules of a two-column row are. */
function rulesIn(row: string): number[] {
  const at: number[] = [];
  for (const [index, glyph] of [...row].entries()) if (glyph === RULE) at.push(index);
  return at;
}

/** What is inside the right-hand column of a row of the two-column form. */
function rightOf(row: string): string {
  const at = rulesIn(row);
  return at.length < 3 ? '' : [...row].slice((at[1] as number) + 1, at[2]).join('');
}

/** What is inside the left-hand column of a row of the two-column form. */
function leftOf(row: string): string {
  const at = rulesIn(row);
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
    const box = boxOf(await drawnAt(200)).filter((row) => rulesIn(row).length >= 3);
    expect(box.length, 'the box is not in its two-column form').toBeGreaterThan(3);

    const record = box.findIndex((row) => rightOf(row).includes('The record'));
    expect(record, 'no record section').toBeGreaterThanOrEqual(0);
    expect(
      box.findIndex((row) => isRun(rightOf(row).trim())),
      'a run of glyphs is still drawn inside the column',
    ).toBe(-1);
    // AND NOTHING IS DRAWN INSIDE THE LEFT ONE EITHER, so the absence is about the box
    // rather than about the half of it this case happened to look in.
    expect(
      box.findIndex((row) => isRun(leftOf(row).trim())),
      'a run of glyphs is drawn inside the left column',
    ).toBe(-1);
    // Not vacuous, in two directions: the instrument really can see a run of glyphs, and
    // the column really has rows in it — the ones the record put there.
    expect(isRun(RUN.repeat(3))).toBe(true);
    const reach = (row: string): number => rightOf(row).replace(/ +$/, '').length;
    expect(Math.max(...box.map(reach))).toBeGreaterThan(BESIDE_THE_RULE);
  }, 120_000);
});

describe('the left column is centred on the widest thing in it', () => {
  it('leaves the same blank on each side of the mark', async () => {
    // POSITION AND NOTHING ELSE, which is why it is asked as a symmetry: no line is padded
    // or trimmed, so what can be observed is where the narrower group starts and ends
    // inside a column whose width the wider one decided.
    const box = boxOf(await drawnAt(200)).filter((row) => rulesIn(row).length >= 3);
    const mark = box.find((row) => row.includes(INK));
    expect(mark, 'the drawing of the name is not in the box').toBeDefined();
    const left = leftOf(mark as string);
    const before = left.length - left.trimStart().length - INSIDE_THE_BOX;
    const after = left.length - left.trimEnd().length - BESIDE_THE_RULE;
    expect(Math.abs(before - after), `${left}`).toBeLessThanOrEqual(1);
    // Not vacuous: left-aligned, `before` would be zero, and the two would differ by the
    // whole slack. There really is slack, because the line under the mark is wider.
    expect(before, 'the mark is at the left edge of its column').toBeGreaterThan(0);
    const standing = box.find((row) => leftOf(row).includes(project));
    expect(standing, 'the line the mark is centred over is not there').toBeDefined();
    expect(leftOf(standing as string).trim().length).toBeGreaterThan(left.trim().length);
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

describe('how big the terminal is is asked in one place, and it is the place that follows it', () => {
  it('is read off a stream in exactly one module of the product', () => {
    // A1, BY THE DISCRIMINANT. It used to be two: the session asked how wide the terminal
    // was in order to compose the panel, and the console asked how tall it was in order to
    // carry the page away. Two readings are two answers on the frame after a resize — the
    // session's is the width the console opened at, forever. So the console owns the
    // device and hands the number to everything that needs it.
    const asking = sourcesOf(SRC).filter(
      (file) => asksTheDevice(withoutComments(readFileSync(file, 'utf-8'))).length > 0,
    );
    expect(asking.map((file) => file.slice(SRC.length + 1))).toEqual([join('repl', 'console.ts')]);
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
    expect(times(source, 'carriedIntoTheScrollback(howTall())')).toBe(2);
  });
});
