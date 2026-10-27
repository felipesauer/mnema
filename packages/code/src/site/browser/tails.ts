/**
 * The raw lines of a tail, drawn when a reader opens it.
 *
 * The page does not carry the stored lines as text: the files the verifier reads are in it, in
 * base64, and a tail's lines ARE those files. Opening a tail decodes the segments of that tail,
 * joins them in the order of their names and writes the result into the tail's `<pre>` as text.
 * The result is what the command used to write into the page, byte for byte (the lines of the
 * segments, joined, with the line breaks at the end taken off), which
 * `the-raw-lines-are-drawn-from-the-files.test.ts` holds against the same reading over a disk.
 */

import { fromBase64 } from './buffer.js';
import type { Doc } from './dom.js';

/**
 * Decoding never throws: a byte that is not UTF-8 becomes U+FFFD (the replacement character), the
 * way Node's own reading of the file does, and a byte order mark is kept and not dropped.
 */
const decoder = new TextDecoder('utf-8', { fatal: false, ignoreBOM: true });

/** The stored lines of `tail`, from the files a page carries (path to base64). */
export function rawLinesOf(files: Readonly<Record<string, string>>, tail: string): string {
  const names = Object.keys(files)
    .filter((name) => {
      const match = /^tails\/([^/]+)\/(\d+)\.jsonl$/.exec(name);
      return match !== null && match[1] === tail;
    })
    .sort();
  const text = names.map((name) => decoder.decode(fromBase64(files[name] as string))).join('');
  return text.replace(/\n+$/, '');
}

/** Draws each tail's lines the first time it is opened. */
export function wireTails(page: Doc, files: Readonly<Record<string, string>>): void {
  for (const details of Array.from(page.querySelectorAll('.tail'))) {
    const tail = details.getAttribute('data-tail');
    const [pre] = Array.from(details.querySelectorAll('pre'));
    if (tail === null || pre === undefined) continue;
    let drawn = false;
    const draw = (): void => {
      if (drawn || details.open !== true) return;
      drawn = true;
      try {
        pre.textContent = rawLinesOf(files, tail);
      } catch (error) {
        pre.textContent = `These lines could not be drawn from the files of the page: ${error instanceof Error ? error.message : String(error)}`;
      }
    };
    details.addEventListener('toggle', draw);
    draw();
  }
}
