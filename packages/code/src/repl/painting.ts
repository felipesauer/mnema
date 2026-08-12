/**
 * TELLING THE LAYOUT LIBRARY WHAT THIS PRODUCT ALREADY DECIDED ABOUT COLOUR.
 *
 * The page has two kinds of colour on it and they had two authorities. What the session
 * SAYS is composed here and rendered by the rule every other invocation of this product
 * obeys — a flag, two conventional variables, a terminal (`wiring/color.ts`). What the page
 * IS — the rules that close its regions, the guide down its margin, the mark on a picked
 * row, the product's own mark and title — is drawn by the layout library, in the library's
 * own vocabulary, and coloured by the library's own detection. Measured on a real terminal:
 * a session opened with `NO_COLOR=1` wrote **thirty-two accents and not one byte from our
 * renderer**, which is a page that obeyed the caller in half.
 *
 * THE CAUSE IS NOT THAT THE LIBRARY DISAGREED. Its colour library does not read `NO_COLOR`
 * at all — the string appears in no file of `chalk@5.6.2` — so there was nothing there to
 * disagree with. What its detection does read is `FORCE_COLOR`
 * (`chalk/source/vendor/supports-color/index.js`), with `TERM`, `COLORTERM` and a sniff of
 * the process's own argv beside it. So the fix is not a bridge and not a second opinion: it
 * is this product's one answer, delivered on the channel the library listens to.
 *
 * WHY THE VARIABLE AND NOT THE ARGV IT ALSO SNIFFS, AND THIS IS WHERE THE DEFECT HID. That
 * library looks for `--color=never` and `--color=always` on the process's own command line,
 * so ONE of the four rungs was already being honoured — by luck, and only when the caller
 * typed the flag. Measured before this module existed, on a real terminal: `--color=never`
 * alone left **zero** style sequences on the whole page, which reads exactly like a flag that
 * is wired. The same flag with `FORCE_COLOR=1` beside it left **a hundred and twenty**, every
 * one of them the library's own accent — because that library consults the VARIABLE first and
 * overwrites whatever it read off the command line. So the sniff is not a channel, it is a
 * coincidence that made the other three rungs look fixed; the variable is the channel, and it
 * is the one that wins.
 *
 * WHAT THE TWO VALUES MEAN, and why they cannot change what is painted:
 *
 *   - {@link PLAIN} is off, flatly. The library's detection returns before every other
 *     question it would have asked, so no terminal, no `TERM` and no CI marker can put a
 *     byte of colour back.
 *   - {@link PAINTS} is the BASIC EIGHT, which is all this surface's chrome ever asks for.
 *     A named colour is the same escape at every level above zero — the level only decides
 *     how a 24-bit or 256-colour request is DOWNGRADED, and nothing here makes one — so
 *     telling the library `1` where it would have said `2` or `3` on its own cannot move a
 *     byte. This slice is about WHO DECIDES, never about what is painted or in which hue.
 *
 * WHAT IT CHANGES ON A TERMINAL THAT SAYS IT CANNOT PAINT, said out loud because it is the
 * one place a page moves for a caller who asked for nothing. That library refuses colour on a
 * `TERM=dumb` device and this product's precedence never reads `TERM` at all — it asks whether
 * the destination is a terminal — so the two disagreed and the page came out half painted:
 * measured, a hundred and ninety-two style sequences from our renderer and NOT ONE from the
 * library, on a device with real chrome on it. It is three hundred and twelve now, which is
 * the same page every other terminal gets. That is the decision this file exists to deliver
 * rather than a side effect of it: a caller who wants no colour on a `TERM=dumb` machine has
 * `NO_COLOR`, `FORCE_COLOR=0` and `--color=never`, and all three now reach the whole page.
 *
 * WHEN IT HAS TO BE SAID IS THE ONE THING A READER CANNOT SEE FROM THE CALL. That library
 * reads the variable ONCE, while its own module graph is being loaded, and fixes a level it
 * never asks again — so this is said before the import that loads it and would be inert
 * after it. That is why the layout is reached by a dynamic import and why the call sits
 * against it (`session.ts`), and it is asserted structurally rather than left to the two
 * lines staying next to each other: the module graph that reaches the library is enumerated,
 * and a static import of any of it from anywhere would be an import that runs before this
 * (`tests/one-authority-over-colour.test.ts`).
 *
 * IT IS THE ONE PLACE IN THIS PRODUCT THAT WRITES TO THE ENVIRONMENT. Nothing else does,
 * and the same case is what says so.
 */

/**
 * THE CHANNEL: the variable the layout library's colour detection reads.
 *
 * Named here rather than spelled at the call, because it is also rung THREE of this
 * product's own precedence (`wiring/color.ts`) — the same word, read there and written
 * here, and the two sites are what a reader has to be able to find from either end.
 */
export const WHAT_THE_LIBRARY_READS = 'FORCE_COLOR';

/** What says PAINT on that channel: the basic eight, which is all the chrome asks for. */
export const PAINTS = '1';

/** What says NOTHING on it — the value node and that library both made mean "no colour". */
export const PLAIN = '0';

/**
 * The decision, delivered.
 *
 * `env` is the process's own by default and a parameter so the rule can be exercised
 * without a process to put back — the library reads `process.env` and nothing else, so a
 * caller passing anything else is a test.
 */
export function theLibraryIsTold(paints: boolean, env: NodeJS.ProcessEnv = process.env): void {
  env[WHAT_THE_LIBRARY_READS] = paints ? PAINTS : PLAIN;
}
