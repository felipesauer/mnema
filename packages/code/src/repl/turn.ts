/**
 * WHAT A TURN OF THE CONSOLE MEASURES — the words for how long an answer took and for the hour
 * it was done, and the verb a line names. The line under an answer is built out of these
 * (`presentation/echo.ts`, `doneLine`), and they are here and not there because the one thing
 * `presentation/` may not do is ask a clock anything: a number goes in and a word comes out.
 *
 * ONLY WHAT WAS MEASURED. The console calls no model, so none of these says anything about
 * thinking: a span is the time between the line being sent and the session saying it was done,
 * on the clock the console was handed (`console.ts`, `ConsoleRequest.now`), and the hour is the
 * one on the clock of the machine the session runs on.
 */

/**
 * HOW LONG AN ANSWER TOOK, in the words the line under it uses: milliseconds under a second,
 * seconds to a tenth under a minute, and minutes and seconds after that. A negative span is no
 * span: zero.
 */
export function tookWords(milliseconds: number): string {
  const ms = Math.max(0, Math.round(milliseconds));
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  return `${minutes}m ${String(100 + seconds).slice(1)}s`;
}

/** The hour an answer finished, on the machine's own clock: `HH:MM`, from milliseconds since the epoch. */
export function hourWords(at: number): string {
  const when = new Date(at);
  const two = (n: number): string => String(100 + n).slice(1);
  return `${two(when.getHours())}:${two(when.getMinutes())}`;
}

/** The first word of what a caller typed — the verb the line under its answer names. */
export function firstWordOf(line: string): string {
  return line.trim().split(/\s+/)[0] ?? '';
}

/** One escape byte, written as an escape so no control byte enters a source file. */
const ESC = '\u001b';

/** What the line under an answer opens with once it has been rendered: any paint, then the mark. */
const A_DONE_LINE = new RegExp(`^(?:${ESC}\\[[0-9;]*m)*\\u273b `);

/**
 * THE WINDOW WITHOUT THE LINES UNDER ANSWERS — what the page says apart from what the console
 * measured about saying it.
 *
 * IT IS WHAT *THE PAGE DID NOT MOVE* IS ASKED OF. A read asked again answers with the same words,
 * and the row that says so (`console.ts`, `judged`) is true of the words: the line under the answer
 * carries the time it took and the hour it was done, which differ on every ask and are not
 * something the answer said. Compared with them, no answer would ever leave a page as it was and
 * the row would be silent for every caller.
 */
export function withoutTheDoneLines(window: readonly string[]): readonly string[] {
  return window.filter((line) => !A_DONE_LINE.test(line));
}
