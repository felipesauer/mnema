/**
 * A REAL PSEUDO-TERMINAL, DRIVEN — because an interactive surface does not prove itself
 * in process.
 *
 * `support/console.ts` gives a pair of streams a console will treat as a device, and that
 * is the right instrument for the LOOP: what a key does, what lands on the page, whether
 * the terminal was given back. It is the wrong one for a SCREEN. How wide a rule runs, at
 * which height an arrangement gives way, where the caret was left and whether the layout
 * library reached for the sequence this product refuses to write are all questions about
 * a device with a window size and a line discipline, and only a device has one.
 *
 * SO THIS SPAWNS THE BUILT BINARY UNDER `script`, which is the portable way to hand a
 * program a terminal it did not inherit, and it RESIZES that terminal from outside with
 * `stty` — the way a caller drags the corner of a window. What comes back is every byte
 * the device received, and a mark at the end of each step, so a case can replay the bytes
 * up to one moment onto a screen (`support/screen.ts`) and ask what a reader was looking
 * at.
 *
 * IT IS ONE FILE BECAUSE IT IS ONE INSTRUMENT. Two deliveries needed it and the second
 * copied the first, which is how two ideas of "wait until the session settled" come to
 * exist and how one of them quietly stops waiting. Everything about a particular fixture
 * — where the project is, what the binary is called, what environment it runs in —
 * arrives as an argument, so nothing here knows about any one case.
 */

import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'vitest';

/**
 * WHAT THE LAYOUT WRITES WHEN A FRAME IS FINISHED: the end of the synchronized update it
 * wrapped the whole frame in.
 *
 * ⚠️ IT WAS THE CURSOR, SHOWN AGAIN, and a one-row terminal falsified that inside this
 * delivery: measured on a real pty at 100x1 and 60x1, the frame ends `ESC[?25l ESC[?2026l`
 * — the caret is hidden and never shown, because there is nowhere to put it. The end of the
 * synchronized update is written on every path there is, which is what makes it the frame's
 * boundary rather than a symptom of one. Spelled by its code point, like every unusual byte
 * in this repository.
 */
const FRAME_IS_DRAWN = '\u001b[?2026l';

/**
 * WHETHER A WHOLE FRAME HAS BEEN DRAWN since `prompt` was last written.
 *
 * ⚠️ FIVE FILES WAITED FOR THE PROMPT INSTEAD, and a prompt is written in the MIDDLE of a
 * frame: the rows under it, and the caret's own position, come after. Two of them went red
 * on one delivery for the same reason and neither was about a prompt — the opening grew by
 * a third on a terminal with room for the biggest drawing of the name, so a frame is more
 * writes and there are more places for a read to be cut in half. What was measured: a caret
 * one row below the prompt, and a rule that had not been written yet.
 *
 * IT IS HERE BECAUSE THIS FILE IS THE INSTRUMENT, and the paragraph at the top of it says
 * why in advance: two ideas of "wait until the session settled" is how one of them quietly
 * stops waiting. Two cases drive a pty of their own rather than this one, and they take
 * this function — what a finished frame IS is the rule, and it is written once.
 */
export function aFrameAfter(prompt: string): (bytes: string) => boolean {
  // AND NOTHING AFTER IT. A frame boundary that is not the END of the stream is a frame
  // boundary with another frame already in flight behind it, and a screen replayed from
  // half of one is the defect this exists to stop. Measured: with the boundary alone, the
  // two rules of the input area were on the screen about half the time at a hundred
  // columns — the rows are written after the prompt, in the same frame.
  return (bytes) =>
    bytes.endsWith(FRAME_IS_DRAWN) && bytes.lastIndexOf(prompt) < bytes.lastIndexOf(FRAME_IS_DRAWN);
}

/** The step every session begins with: the console open, and its first frame DRAWN. */
export function opensAConsole(prompt: string): Step {
  return { until: aFrameAfter(prompt), what: 'opened its console' };
}

/** One thing to do in the session, and what says it is done. */
export interface Step {
  /** What the caller types, if anything. */
  readonly types?: string;
  /** The size their window becomes first, if it changes. */
  readonly resize?: { readonly columns: number; readonly rows: number };
  /** What is true of everything received once the step has happened. */
  readonly until: (bytes: string) => boolean;
  /** What the step is, for the message when it never happens. */
  readonly what: string;
}

/** What a run in a pty produced. */
export interface Ran {
  /** Every byte the device received. */
  readonly bytes: string;
  /** How many bytes had arrived by the end of each step, in order. */
  readonly at: readonly number[];
}

/** Where a session is opened, and what it is opened with. */
export interface Fixture {
  /** The built CLI — the same file the `mnema` bin points at. */
  readonly cli: string;
  /** The verb that opens a session. */
  readonly verb: string;
  /** The project the session is opened inside. */
  readonly project: string;
  /** A directory this run may write its runner script into. */
  readonly scratch: string;
  /** The environment the binary runs in. */
  readonly environment: NodeJS.ProcessEnv;
}

/** Waits until `ready` answers true, or gives up — a poll, never a fixed sleep. */
export async function waitFor(ready: () => boolean, what: string, tries = 1200): Promise<void> {
  for (let tried = 0; tried < tries; tried++) {
    if (ready()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`the session never ${what}`);
}

/** How long the stream has to stop growing before it counts as quiet, in milliseconds. */
const QUIET = 40;

/** How many quiet periods to give a stream that keeps arriving before giving up on it. */
const AT_MOST = 200;

/** Waits until the stream has stopped growing for one quiet period. */
async function settles(bytes: () => string): Promise<void> {
  for (let tried = 0; tried < AT_MOST; tried += 1) {
    const was = bytes().length;
    await new Promise((resolve) => setTimeout(resolve, QUIET));
    if (bytes().length === was) return;
  }
}

/**
 * WHERE A STEP ENDS IN THE STREAM: how many bytes had arrived at the instant the step's own
 * question answered YES.
 *
 * ⚠️ IT WAS TWO READINGS OF ONE RULE, and they diverged in silence. The question was asked
 * at one instant — *has the step happened?* — and the length was taken at ANOTHER, after a
 * pause that only watched the stream stop growing. Between the two, the next frame arrives;
 * the pause does not ask the question again, so under load a write that stalls mid-frame for
 * longer than the pause ends the step at a point the question would have REFUSED. Measured:
 * a screen replayed from that point had the input area's two rules missing, red in the whole
 * suite and green on its own — the shape of defect the A3 amarra is about.
 *
 * SO THE ANSWER AND THE LENGTH COME OUT OF THE SAME STRING. The question is asked again once
 * the stream is quiet, and while it says no this goes on waiting; when it says yes, the
 * length taken is the length of the very string it just said yes about, with no `await`
 * between the two — so nothing can arrive in between.
 *
 * A stream that has ENDED is answered wherever it is: the process is gone, there is nothing
 * more coming, and a case reading a dead session's screen has its own assertions to fail.
 */
export async function endOf(step: Step, bytes: () => string, over: () => boolean): Promise<number> {
  for (let round = 0; round < AT_MOST; round += 1) {
    await waitFor(() => step.until(bytes()) || over(), step.what);
    await settles(bytes);
    const now = bytes();
    if (step.until(now) || over()) return now.length;
  }
  throw new Error(`the session never settled anywhere it ${step.what}`);
}

/** Runs the session on a pseudo-terminal of a given size, resizing it between steps. */
export async function inPty(
  fixture: Fixture,
  options: {
    readonly columns: number;
    readonly rows: number;
    readonly steps: readonly Step[];
  },
): Promise<Ran> {
  const here = mkdtempSync(join(fixture.scratch, 'pty-'));
  const runner = join(here, 'run.sh');
  const named = 'TTY=';
  writeFileSync(
    runner,
    [
      `cd ${fixture.project}`,
      `stty rows ${options.rows} cols ${options.columns}`,
      `echo "${named}$(tty)"`,
      `node ${fixture.cli} ${fixture.verb}`,
      '',
    ].join('\n'),
  );

  let bytes = '';
  let over = false;
  const child = spawn('script', ['-qec', `sh ${runner}`, '/dev/null'], {
    cwd: fixture.project,
    env: fixture.environment,
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
      // WHERE THE STEP ENDS is the point its own question approved, and it is asked for as
      // one thing rather than waited for here and measured there ({@link endOf} says what
      // that cost).
      at.push(
        await endOf(
          step,
          () => bytes,
          () => over,
        ),
      );
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
