/**
 * A TERMINAL THAT IS NOT ONE — the streams a console can be driven over in this process.
 *
 * The console reads keys off one stream and draws on another, and everything it does to
 * them is what a terminal answers to: raw mode, a width, a height. A test that wants to
 * drive the loop rather than the device needs a pair that answers the same questions,
 * and this is it — one place, because two files ask for it and a second hand-rolled pair
 * would be two definitions of what a terminal is.
 *
 * WHAT IT IS NOT is the proof. Nothing here has a line discipline, a cursor or a
 * scrollback, so nothing here can say whether the terminal was given back — that is
 * asked of a real pseudo-terminal in `the-console-on-ink.test.ts`, and it is asked there
 * because the delivery before this one measured that an interactive surface does not
 * prove itself in process.
 */

import { PassThrough } from 'node:stream';
import { THE_FLOOR } from '../../src/repl/floor.js';
import { decodedWhole } from './arriving.js';

/** One escape byte, written as an escape so no control byte enters a source file. */
export const ESC = '\u001b';

/**
 * THE KEY THAT ENDS THE INPUT, as a terminal sends it — Ctrl-D, and the ONE way out of a
 * session.
 *
 * Spelled by its code point, like every other control byte here. IT WAS A WORD AT MOST OF THE
 * SITES THAT NOW READ THIS — `/exit`, typed and submitted — and the word is gone: what a caller
 * types is the reads of the record, and the way out is the keystroke every console has answered
 * to since before this one existed (`src/session-words.ts`, `THE_KEY_THAT_LEAVES`).
 *
 * CTRL-D RATHER THAN A WORD IS ALSO WHAT THESE CASES WANT, which is why two files had already
 * moved before the word went: a submitted word is ECHOED onto the roll, so the last page a case
 * reads is one line further down than the page the caller saw.
 */
export const ENDS_THE_INPUT = '\u0004';

/**
 * How wide and how tall a fake terminal is unless a caller says otherwise.
 *
 * THE HEIGHT WAS FORTY AND IT IS THE FLOOR'S, read off the product rather than written down.
 * Forty was a number with room to spare while the shortest window this console drew on was
 * twenty-four; the floor is the height the name is drawn whole at now (`src/repl/floor.ts`),
 * and a default under it would open every case that does not care about size on the screen
 * that says the window is too small. Derived rather than retyped, so the day the floor moves
 * again these cases move with it instead of going quietly wrong.
 */
const COLUMNS = 200;
const ROWS = THE_FLOOR.rows;

/**
 * WHAT EMPTIES THE SCREEN THE SESSION IS DRAWN ON — the layout's other way of clearing the
 * page, and the one this instrument used to leave in ({@link withoutLayout}).
 *
 * Named by its code point rather than typed, like every control byte in this repository. It is
 * the sequence the product lets through on purpose, because the screen belongs to the session
 * (`repl/erasing.ts`, `ERASES_THE_SCREEN`) — so a page really carries it, and a reader of that
 * page has to know it is not a line.
 */
const ERASES_THE_SCREEN = `${ESC}[2J`;

/** A pair of streams a console will treat as the caller's terminal. */
export interface FakeTerminal {
  /** Where the console reads keys. */
  readonly stdin: NodeJS.ReadStream;
  /** Where the console draws. */
  readonly stdout: NodeJS.WriteStream;
  /** Press keys: whatever a terminal would have delivered. */
  readonly type: (text: string) => void;
  /**
   * The caller changed the size of their window, the way a device reports it: the new
   * size is readable, and then the stream says so.
   *
   * Both halves matter and in that order — a console that read the size when it was told
   * would read the OLD one if the event came first, which is the defect this shape cannot
   * hide. What a real terminal does is exactly this: the kernel updates the window size
   * and then raises the signal node turns into the event.
   */
  readonly resize: (columns: number, rows?: number) => void;
  /** Every byte the terminal has received so far. */
  readonly bytes: () => string;
  /** Whether the input is in raw mode right now, as the device would report it. */
  readonly raw: () => boolean;
}

/** A terminal made of two pipes, answering everything a console asks a device. */
export function fakeTerminal(size?: { columns?: number; rows?: number }): FakeTerminal {
  const input = new PassThrough();
  const output = new PassThrough();
  let raw = false;
  const arriving = decodedWhole();
  arriving.from(output);
  Object.assign(input, {
    isTTY: true,
    setRawMode: (on: boolean) => {
      raw = on;
      return input;
    },
    ref: () => input,
    unref: () => input,
  });
  Object.assign(output, {
    isTTY: true,
    columns: size?.columns ?? COLUMNS,
    rows: size?.rows ?? ROWS,
  });
  return {
    stdin: input as unknown as NodeJS.ReadStream,
    stdout: output as unknown as NodeJS.WriteStream,
    type: (text) => {
      input.write(text);
    },
    resize: (columns, rows) => {
      Object.assign(output, rows === undefined ? { columns } : { columns, rows });
      output.emit('resize');
    },
    bytes: arriving.text,
    raw: () => raw,
  };
}

/** A process that hooks nothing: a test drives the console, not the process. */
export const hooksNothing = {
  on: () => undefined,
  off: () => undefined,
  raise: () => undefined,
};

/**
 * Everything a layout writes to place a line, taken away — so what is left is the lines.
 *
 * Named one sequence at a time rather than by a catch-all pattern, because the one
 * sequence that must NOT be stripped is the one a rendered line can carry: a style. A
 * pattern wide enough to swallow the layout would swallow the paint, and the case that
 * compares a painted line to a plain one would then be comparing two plain ones.
 *
 * AND IT LEFT ONE OF THE TWO WAYS THE PAGE IS CLEARED IN, which is what this delivery
 * falsified. The premise written here was that everything the layout writes to place a line
 * was taken out; measured, ONE act of the layout survived — the ERASE OF THE SCREEN
 * ({@link ERASES_THE_SCREEN}). The library clears before it draws the page again, and it has
 * two ways of doing it: walk up the region erasing each row, or empty the screen in one
 * sequence. Which one it picks is decided out of its own throttle, before anything of this
 * product runs, and therefore out of WALL CLOCK — a session whose last frame was written
 * fifteen milliseconds before the caller's key gets one, and a session whose key came sooner
 * gets the other. The row erase was taken out here from the first draft and the screen erase
 * was not, so a page read through this instrument said something different depending on how
 * fast the caller typed.
 *
 * MEASURED, ON THE SAME RENDERER: a console opened and left immediately and the same console
 * opened and left three hundred milliseconds later produced pages that differ in exactly one
 * row — the row where the screen erase glues the last row of one frame to the first row of the
 * next. With the erase taken out the two agree, and so do the painted and the plain. That is
 * the whole of the trunk's first red (`the panel … says exactly what the unpainted one says`),
 * and it was NOT the two renderers disagreeing: it was one renderer disagreeing with itself.
 *
 * IT IS NOT A WEAKENING OF THE COMPARISON, and the line between the two is what a RENDERER
 * put on the page. A style is a renderer's and stays. The erase of the screen is nobody's
 * line — it carries no character a reader sees, it is the same act as the row erase already
 * taken out here, and leaving one of the pair in while removing the other is the instrument
 * disagreeing with itself. What the pages are compared for — every glyph, every gap, art and
 * padding included — is untouched, and the case that reads them asserts the library really
 * wrote the sequence, so nothing here can go quietly vacuous
 * (`repl/erasing.ts`, `erasesTheScreen`).
 *
 * SPELLED HERE RATHER THAN IMPORTED, like the rest of this function and for the reason the
 * product's own ban gives: exactly one module under `src/repl` may name an erase
 * (`repl/erasing.ts`, and `the-console-on-ink.test.ts` asserts it is the only one), and a test
 * naming the bytes it strips is outside that corpus on purpose — two other files driving a
 * device already spell this one.
 */
export function withoutLayout(bytes: string): string {
  return (
    bytes
      // THE ERASE OF THE SCREEN, which is one of the two ways the layout clears the page
      // before drawing it again — the other is the row erase below, and they are one act.
      .split(ERASES_THE_SCREEN)
      .join('')
      // Hide and show the cursor; synchronised output around a frame.
      .split(`${ESC}[?25l`)
      .join('')
      .split(`${ESC}[?25h`)
      .join('')
      .split(`${ESC}[?2026h`)
      .join('')
      .split(`${ESC}[?2026l`)
      .join('')
      // Erase a row, go back to its first column, walk up or down the redrawn region,
      // and jump to a column — everything the redraw of the input row is made of.
      .split(`${ESC}[2K`)
      .join('')
      .replace(new RegExp(`${ESC}\\[\\d*[ABG]`, 'g'), '')
      // And putting the cursor somewhere absolute, which is what the layout does with the
      // caret at the end of a frame. It PLACES and says nothing, so it goes with the rest.
      .replace(new RegExp(`${ESC}\\[\\d*(?:;\\d*)?H`, 'g'), '')
      // AND THE MODES THE CONSOLE ASKS THE TERMINAL FOR, which were not here because the
      // console asked for none. It takes the SCREEN now and turns the wheel on
      // (`repl/console.ts`, `repl/pointing.ts`), so three switches are written before the first
      // frame — and a reader that left them in would find them at the START of the first row,
      // where they make it two dozen characters wider than the terminal it was drawn on.
      // Measured: a case asserting the widest row of an arrangement read 53 on a 49-column page.
      .replace(new RegExp(`${ESC}\\[\\?\\d+[hl]`, 'g'), '')
  );
}

/** Waits until `ready` answers true, or gives up — a poll, never a fixed sleep. */
export async function until(ready: () => boolean, what: string, tries = 600): Promise<void> {
  for (let tried = 0; tried < tries; tried++) {
    if (ready()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`the console never ${what}`);
}
