/**
 * What a READ says when the record it just served does not chain.
 *
 * ## Why a read says anything at all
 *
 * It used to say nothing. Over a tree `mnema verify` exits 1 on — `seq gap: expected
 * 6, found 4`, which is what two sessions writing one tail at once used to leave —
 * `mnema search --kind decision` exited 0 with no word, and so did `mnema status`.
 * Every fact was there and every fact was served; the only thing missing was that the
 * record could no longer prove nothing had been inserted between them. A product
 * whose whole purpose is proof cannot hand somebody a broken proof in silence.
 *
 * ## Why it is a NOTICE and not a refusal
 *
 * Nothing is lost when a tail stops chaining, and that is not a consolation, it is the
 * shape of the damage: the entries are all on disk, all readable, all things somebody
 * wrote. Refusing the read would take a sound answer away over a broken proof, and the
 * exit stays zero for the same reason — the read DID answer, and ruling on the record
 * is a verb of its own. What changes is that nobody is left thinking the answer came
 * off an intact record.
 *
 * ## Where it goes, and in whose voice
 *
 * To `err`, in the same shape `verify` gives an issue — `issue [T1] <scope> <tail>#<seq>:
 * <detail>` — because it IS that issue, reached by a different road: the sentence comes
 * from the chain's own rule (`linkBreakAt`), which the verifier and the reader now both
 * ask. A second wording here would be a second opinion about the same bytes.
 *
 * IT LIVES IN THE WIRING, beside `verify.ts`, and not in `presentation/`, because that
 * is where the shape it copies lives: the issue line is composed by the verb that
 * prints it, out of a primitive (`fact`) and a folding rule (`onOneLine`) that do come
 * from presentation.
 *
 * IT ANSWERS WITH LINES AND NOT WITH BYTES, and the guard that made it so is
 * `every-refusal-is-red.test.ts`: a helper that rendered inside itself and handed back
 * strings put `io.err(line)` in two verbs with no `render` beside it, and the scanner
 * that exists to catch an unpainted error line accused both. It reads the line a verb
 * WRITES, which is the only thing it can read, so the rendering has to be visible
 * there. That is the convention `verify.ts` already keeps.
 *
 * The stream matters for the same reason it matters in `verify`: `--json` consumers
 * take stdout, and a notice on stdout would corrupt the one output this surface
 * promises is machine-readable.
 */

import { fact } from '../presentation/detail.js';
import type { Line } from '../presentation/line.js';
import type { ScopedLinkBreak } from '../tree-sources.js';
import { onOneLine } from './on-one-line.js';

/**
 * The lines a read owes about the tails it served that do not chain — none at all for
 * a sound record, which is every record this product wrote on its own.
 *
 * The second line is not decoration. The first says what is wrong with one tail; a
 * reader who has never met a chain needs to be told that the answer above is still
 * the facts, and that there is a verb whose job is to say how far the damage goes.
 * Told once, however many tails broke.
 */
export function linkBreakNotice(breaks: readonly ScopedLinkBreak[]): readonly Line[] {
  if (breaks.length === 0) return [];
  // AT THE LEFT EDGE (`depth` 0), unlike the same line in `verify`. There it sits
  // under a heading that names the tree it is about; here there is no heading, and an
  // indented line with nothing above it reads as a continuation of something.
  const lines = breaks.map((broken) =>
    fact(
      onOneLine`issue [T1] ${broken.scope} ${broken.tail}#${String(broken.seq)}: ${broken.detail}`,
      0,
    ),
  );
  lines.push(
    fact(
      onOneLine`the records above are all still on the tail — what broke is the proof that nothing was inserted between them. \`mnema verify\` says how far it reaches.`,
      0,
    ),
  );
  return lines;
}
