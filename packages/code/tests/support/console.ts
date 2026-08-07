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

/** One escape byte, written as an escape so no control byte enters a source file. */
export const ESC = '\u001b';

/** How wide and how tall a fake terminal is unless a caller says otherwise. */
const COLUMNS = 200;
const ROWS = 40;

/** A pair of streams a console will treat as the caller's terminal. */
export interface FakeTerminal {
  /** Where the console reads keys. */
  readonly stdin: NodeJS.ReadStream;
  /** Where the console draws. */
  readonly stdout: NodeJS.WriteStream;
  /** Press keys: whatever a terminal would have delivered. */
  readonly type: (text: string) => void;
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
  let bytes = '';
  output.on('data', (chunk: Buffer) => {
    bytes += chunk.toString('utf-8');
  });
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
    bytes: () => bytes,
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
 */
export function withoutLayout(bytes: string): string {
  return (
    bytes
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
      // And putting the cursor somewhere absolute, which is how the page is opened
      // clean: the console goes to the last row, scrolls a page, and comes back to the
      // top (`repl/page.ts`). It PLACES and says nothing, so it goes with the rest.
      .replace(new RegExp(`${ESC}\\[\\d*(?:;\\d*)?H`, 'g'), '')
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
