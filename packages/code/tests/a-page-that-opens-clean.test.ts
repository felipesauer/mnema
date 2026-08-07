/**
 * THE PAGE — corner to corner, opened clean, and cleaned again on a word.
 *
 * Three promises, and all three are about a DEVICE rather than about a value, which is
 * why every case here drives the real binary on a real pseudo-terminal and reads the
 * bytes it received:
 *
 *   - THE BOX TAKES THE WIDTH OF THE TERMINAL. That is a fact about columns, and the only
 *     thing that has columns is a terminal. Asserted at three widths, on EVERY row of the
 *     drawing rather than on its top edge — a frame that reached the last column once and
 *     stopped short on the rows under it is the ragged shape this replaced.
 *   - THE PAGE OPENS CLEAN, AND NOTHING OF THE CALLER'S IS DESTROYED. The two halves are
 *     asked of two different things, because they are two different claims: what is on
 *     the SCREEN answers the first (`support/screen.ts`), and what is in the BYTES answers
 *     the second — the sequence that erases the caller's history above the session may not
 *     be there, and neither may the one that takes the page a full-screen program takes.
 *   - A CLEAN PAGE IS THE PAGE THAT OPENED. Compared screen against screen, both rendered
 *     from the SAME run, so nothing here holds a copy of what the opening looks like.
 *
 * AND THE ONE THAT IS ABOUT THE LIBRARY. What is written above the redrawn region is kept
 * by the layout in a buffer of its own, and there are frames on which it writes that
 * buffer out again — reachable on a terminal too short for the rows being redrawn. A page
 * cleared without that buffer being emptied is a page whose cleared lines come back later,
 * which is a defect nothing but a short terminal can show. So one case makes the terminal
 * short enough to reach it, and the case that proves the terminal really is short enough
 * is in the same block.
 */

import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CliIo, run } from '../src/cli.js';
import { CLEAR, LEAVE } from '../src/session-words.js';
import { REPL_VERB } from '../src/wiring/repl.js';
import { ESC } from './support/console.js';
import { screenOf } from './support/screen.js';

/** The built CLI — the same file the `mnema` bin points at. */
const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

/**
 * The glyphs the box is drawn with: its corners, its horizontal run and its rule.
 *
 * Named by their code points rather than typed, like every other unusual byte in this
 * repository's sources: a rule is one keystroke away from a pipe and a run from a hyphen.
 */
const TOP_LEFT = '╭';
const TOP_RIGHT = '╮';
const BOTTOM_RIGHT = '╯';
const RUN = '─';
const RULE = '│';

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
 * THE ECHO AND NOT THE ANSWER, and the difference is the whole reason this constant
 * exists: the panel says the record is intact, so the verdict of `verify` is on an opened
 * page as well as an answered one, and a case that looked for it after a clearing would
 * be looking at the drawing. The echo is the one thing on the page that only a caller
 * can put there.
 */
const SAID = `${PROMPT} verify`;

/** ⛔ The sequence that erases the caller's history. It is not ours to write. */
const ERASES_THE_HISTORY = `${ESC}[3J`;
/** What the layout writes when it gives up on redrawing part of the page. */
const REDRAWS_EVERYTHING = `${ESC}[2J`;
/** The page a full-screen program takes. This console must never touch it. */
const ALTERNATE_SCREEN = `${ESC}[?1049`;

/** What the caller had on their screen before the session opened. */
const THEIRS = 'A-LINE-THE-CALLER-HAD';

/**
 * THE HEIGHT AT WHICH THE LAYOUT LIBRARY STOPS REDRAWING PART OF THE PAGE, at sixty
 * columns — measured, and re-measured whenever the redrawn region changes shape.
 *
 * It was THREE while the region was the row being typed and two rows under it. The input
 * has its own place now and the region is five rows, which would have raised this; the
 * arrangement chosen by height is what stopped it, and the boundary came out at TWO. The
 * width matters because the hint folds below eighty columns, so the number is stated with
 * the width it was taken at.
 */
const TOO_SHORT_TO_REDRAW_IN_PART = 2;

/**
 * Ctrl-C, which abandons the row being typed and leaves the session alive.
 *
 * Spelled as an escape, like every other unusual byte in this repository's sources: a
 * control character typed into a source file is invisible in review and survives an edit
 * made around it — which is exactly how it got into this file on its first draft.
 */
const ABANDONS_THE_LINE = '\u0003';

// ---------------------------------------------------------------------------
// The fixture
// ---------------------------------------------------------------------------

let sandbox: string;
let project: string;
let environment: NodeJS.ProcessEnv;
const before = { cwd: process.cwd(), env: { ...process.env } };

beforeAll(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-page-'));
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
  await run(['task', 'the task the page is opened over'], io);

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
// A real pty, and where in its stream each moment was
// ---------------------------------------------------------------------------

/** One thing to do in the session, and what says it is done. */
interface Step {
  /** Typed first. Nothing at all means: only wait. */
  readonly types?: string;
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
async function until(ready: () => boolean, what: string, tries = 1200): Promise<void> {
  for (let tried = 0; tried < tries; tried++) {
    if (ready()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`the session never ${what}`);
}

/**
 * Runs `mnema repl` on a pseudo-terminal of a given size and answers with what the
 * terminal received, and where in it each step ended.
 *
 * The pty comes from `script`, which is how a shell hands a program a terminal it did not
 * inherit, and the caller's own output is printed into it BEFORE the session starts — by
 * the shell, so it is on the screen exactly as it would be if a person had run something
 * and then typed `mnema repl`.
 *
 * Each step waits for the page to STOP GROWING before its offset is taken, so a screen
 * rendered from that offset is a settled frame rather than a frame halfway written.
 */
async function inPty(options: {
  readonly columns: number;
  readonly rows: number;
  /** How many rows of the caller's own output to print before the session opens. */
  readonly theirs?: number;
  readonly steps: readonly Step[];
}): Promise<Ran> {
  const here = mkdtempSync(join(sandbox, 'pty-'));
  const runner = join(here, 'run.sh');
  writeFileSync(
    runner,
    [
      `cd ${project}`,
      `stty rows ${options.rows} cols ${options.columns}`,
      ...(options.theirs === undefined
        ? []
        : ['i=0', `while [ $i -lt ${options.theirs} ]; do echo "${THEIRS}-$i"; i=$((i+1)); done`]),
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
    for (const step of options.steps) {
      if (step.types !== undefined) child.stdin.write(step.types);
      await until(() => step.until(bytes) || over, step.what);
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

/** How many times `what` occurs in `text`. */
const times = (text: string, what: string): number => text.split(what).length - 1;

// ---------------------------------------------------------------------------
// Corner to corner
// ---------------------------------------------------------------------------

describe('the box is as wide as the terminal, and every row of it reaches the last column', () => {
  // Three widths, because one width is a coincidence: at 80 the drawing stacks, at 140 it
  // stands in two columns, and the frame has to end in the same place either way.
  for (const columns of [80, 100, 140]) {
    it(`ends on column ${columns} of ${columns}`, async () => {
      const rows = 40;
      const ran = await inPty({ columns, rows, steps: [opens, leaves] });
      const screen = screenOf(ran.bytes.slice(0, ran.at[0] as number), columns, rows);
      const box = screen.rows.filter(
        (row) => row.includes(RULE) || row.includes(TOP_LEFT) || row.includes(BOTTOM_RIGHT),
      );
      // There really is a drawing: a top edge, a bottom edge and rows between them.
      expect(box.length, `${columns}: no box`).toBeGreaterThan(3);
      expect(screen.text, `${columns}: no panel`).toContain(OPENED);
      for (const row of box) {
        const drawn = row.replace(/ +$/, '');
        expect([...drawn].length, `${columns}: a row of the box stops short: ${drawn}`).toBe(
          columns,
        );
        expect(FRAME, `${columns}: the last column is not the frame`).toContain([...drawn].at(-1));
      }
      // And the top edge really runs to the corner rather than ending in the title.
      const top = box.find((row) => row.includes(TOP_LEFT)) as string;
      expect(top).toContain(`${RUN}${TOP_RIGHT}`);
    }, 120_000);
  }
});

// ---------------------------------------------------------------------------
// It opens clean, and nothing of the caller's is destroyed
// ---------------------------------------------------------------------------

describe('the page opens clean, and what was on it is one scroll up', () => {
  it('shows nothing of the caller’s, and the caller’s screen really was full', async () => {
    const columns = 100;
    const rows = 24;
    const ran = await inPty({
      columns,
      rows,
      theirs: rows,
      steps: [
        {
          until: (bytes) => bytes.includes(`${THEIRS}-${rows - 1}`),
          what: 'printed what the caller had',
        },
        opens,
        leaves,
      ],
    });
    // THE INSTRUMENT FIRST. Rendered from the moment before the session started, the
    // caller's output is on the screen — without this, a model that drew nothing at all
    // would pass the assertion below about every page there is.
    const theirs = screenOf(ran.bytes.slice(0, ran.at[0] as number), columns, rows);
    expect(theirs.text, 'the caller’s screen was never full').toContain(THEIRS);

    // AND THEN THE PROMISE. The session is open, and not one row of what they had is on
    // the screen any more.
    const ours = screenOf(ran.bytes.slice(0, ran.at[1] as number), columns, rows);
    expect(ours.text).not.toContain(THEIRS);
    expect(ours.text, 'the panel is not on the page').toContain(OPENED);
  }, 120_000);

  it('never erases the caller’s history, and never takes the alternate screen', async () => {
    // ⛔ The other half, and it is asked of the BYTES because it is about what was
    // WRITTEN rather than about what is showing: the history above the session belongs to
    // the caller. Scrolling is the only thing this page does, and scrolling only ever adds
    // to that history.
    const ran = await inPty({ columns: 100, rows: 24, theirs: 24, steps: [opens, leaves] });
    expect(ran.bytes).not.toContain(ERASES_THE_HISTORY);
    expect(ran.bytes).not.toContain(ALTERNATE_SCREEN);
    // Not vacuous: the session really opened and really drew its box.
    expect(ran.bytes).toContain(OPENED);
    expect(ran.bytes).toContain(TOP_LEFT);
  }, 120_000);

  it('⚠️ except on a terminal too short for the rows the layout redraws', async () => {
    // A MEASUREMENT AND A BOUNDARY, and it is the LIBRARY'S rather than this product's.
    // On a terminal shorter than the region it redraws, the layout stops redrawing part of
    // the page and redraws all of it — and the sequence it uses for that carries, inside
    // it, the very one this product refuses to write. Nothing of ours writes it (guarded
    // over the source in `the-console-on-ink.test.ts`), and on an ordinary terminal it
    // never appears. Pinned in both directions so the boundary cannot move in silence: if
    // a future version of the library stops doing it, this case goes red and gets deleted.
    //
    // THE HEIGHT USED TO BE THREE ROWS and it is {@link TOO_SHORT_TO_REDRAW_IN_PART} now.
    // What moved it is the input having its own place: the region went from three rows to
    // five, which would have raised this boundary, and the arrangement chosen by height
    // (`repl/area.ts`) is what stopped it — the number came out one row LOWER than it was.
    // Measured again for this delivery rather than carried over, at the same width, in
    // `tests/the-input-has-its-own-place.test.ts`.
    const tall = await inPty({ columns: 60, rows: 24, steps: [opens, leaves] });
    expect(tall.bytes, 'an ordinary terminal saw it').not.toContain(ERASES_THE_HISTORY);
    const short = await inPty({
      columns: 60,
      rows: TOO_SHORT_TO_REDRAW_IN_PART,
      steps: [opens, leaves],
    });
    expect(short.bytes, 'the library no longer redraws everything').toContain(REDRAWS_EVERYTHING);
    expect(short.bytes, 'the library no longer erases the history with it').toContain(
      ERASES_THE_HISTORY,
    );
    // Both sessions really opened, so the difference above is the height and nothing else.
    for (const ran of [tall, short]) expect(ran.bytes).toContain(PROMPT);
  }, 180_000);
});

// ---------------------------------------------------------------------------
// A clean page is the page that opened
// ---------------------------------------------------------------------------

describe('the word that clears gives back the page the session opened with', () => {
  it('is the same screen, and what was said on it is gone from it', async () => {
    const columns = 100;
    const rows = 24;
    const ran = await inPty({
      columns,
      rows,
      steps: [
        opens,
        {
          types: 'verify\r',
          until: (bytes) => bytes.includes(VERIFIED),
          what: 'answered the verb',
        },
        {
          types: `${CLEAR}\r`,
          // The drawing is written a second time, which is what a clean page IS.
          until: (bytes) => times(bytes, TOP_LEFT) > 1,
          what: 'drew the page again',
        },
        leaves,
      ],
    });
    const opened = screenOf(ran.bytes.slice(0, ran.at[0] as number), columns, rows);
    const answered = screenOf(ran.bytes.slice(0, ran.at[1] as number), columns, rows);
    const cleared = screenOf(ran.bytes.slice(0, ran.at[2] as number), columns, rows);

    // The session really did something in between, or the comparison is between two
    // identical nothings.
    expect(answered.text, 'the verb never answered on the page').toContain(VERIFIED);
    expect(answered.text, 'the caller’s own line is not on the page').toContain(SAID);
    expect(opened.text, 'nothing was drawn when it opened').toContain(OPENED);
    expect(opened.text, 'the caller had already typed when it opened').not.toContain(SAID);

    // THE PROMISE: byte for byte the page it opened with, compared against the opening of
    // this very run rather than against a copy written here.
    expect(cleared.text).toBe(opened.text);
    // And said plainly, because equality alone would hold if both were empty.
    expect(cleared.text).not.toContain(SAID);
    // Including the caller's own request for a clean page. The WORD is still on the page,
    // in the row that says what a caller can do — what is gone is the line they typed.
    expect(cleared.text).not.toContain(`${PROMPT} ${CLEAR}`);
    expect(cleared.text).toContain(CLEAR);
  }, 120_000);

  it('does not come back on a frame the layout redraws everything on', async () => {
    // THE LIBRARY'S OWN TRAP. What is written above the redrawn region is kept in a
    // buffer, and on a terminal too short for the region the library writes that buffer
    // out again. A page cleared without emptying it is a page whose cleared lines return —
    // later, on a frame nobody connected to the clearing.
    const columns = 60;
    const rows = TOO_SHORT_TO_REDRAW_IN_PART;
    const ran = await inPty({
      columns,
      rows,
      steps: [
        opens,
        { types: 'verify\r', until: (bytes) => bytes.includes(VERIFIED), what: 'answered' },
        {
          types: `${CLEAR}\r`,
          until: (bytes) => times(bytes, TOP_LEFT) > 1,
          what: 'drew the page again',
        },
        // Keystrokes after the clearing, each of which is a frame — and on this terminal a
        // frame is where the replay would happen.
        { types: 'sear', until: (bytes) => bytes.includes('sear'), what: 'echoed' },
        { types: ABANDONS_THE_LINE, until: (bytes) => bytes.length > 0, what: 'abandoned' },
        leaves,
      ],
    });
    // The caller's own line was on the page before it was cleared, and is in nothing
    // written after it — including the frames on which the library writes out everything
    // it is keeping.
    const cleared = ran.at[2] as number;
    expect(ran.bytes.slice(0, cleared), 'the caller never typed a verb').toContain(SAID);
    expect(ran.bytes.slice(cleared), 'what was cleared came back').not.toContain(SAID);
    // And the terminal really was short enough to reach that path: what the library does
    // on such a frame is redraw the WHOLE screen, which is a sequence it does not write
    // otherwise — so its presence is what says the frames after the clearing were of that
    // kind rather than ordinary ones.
    expect(ran.bytes.slice(cleared), 'the library never redrew everything').toContain(
      REDRAWS_EVERYTHING,
    );
    expect(ran.bytes.slice(cleared)).toContain(PROMPT);
  }, 120_000);
});
