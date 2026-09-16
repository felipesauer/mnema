/**
 * The LINE the command line prints when the record a read just served does not chain.
 *
 * THE WORDS ARE NOT HERE, AND THAT IS THE CORRECTION THIS FILE CARRIES. This module
 * used to hold both the sentence and its shape, and its own doc gave the reason: *"IT
 * LIVES IN THE WIRING, beside `verify.ts`, and not in `presentation/`, because that is
 * where the shape it copies lives."* The premise held while the command line was the
 * only reader told anything, and the MCP falsified it — an agent is served the same
 * record through a door that may not import this directory. So the sentence moved to
 * `record-integrity.ts`, where both surfaces can ask for it, and what stayed is the
 * shape, which really is the wiring's: `verify`'s issue line, out of `fact`.
 *
 * IT ANSWERS WITH LINES AND NOT WITH BYTES, and the guard that made it so is
 * `every-refusal-is-red.test.ts`: a helper that rendered inside itself and handed back
 * strings put `io.err(line)` in two verbs with no `render` beside it, and the scanner
 * that exists to catch an unpainted error line accused both. It reads the line a verb
 * WRITES, which is the only thing it can read, so the rendering has to be visible
 * there. That is the convention `verify.ts` already keeps.
 */

import { fact } from '../presentation/detail.js';
import type { Line } from '../presentation/line.js';
import { linkBreakSentences, type ScopedLinkBreak } from '../record-integrity.js';

/**
 * The lines a read owes about the tails it served that do not chain — none at all for
 * a sound record, which is every record this product wrote on its own.
 *
 * AT THE LEFT EDGE (`depth` 0), unlike the same line in `verify`. There it sits under a
 * heading that names the tree it is about; here there is no heading, and an indented
 * line with nothing above it reads as a continuation of something.
 */
export function linkBreakNotice(breaks: readonly ScopedLinkBreak[]): readonly Line[] {
  return linkBreakSentences(breaks).map((sentence) => fact(sentence, 0));
}
