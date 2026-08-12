/**
 * THE ONE SEQUENCE THIS PRODUCT WILL NOT LET REACH THE CALLER'S TERMINAL — the erase of
 * the history above the screen — and the door that stops it.
 *
 * THE HISTORY ABOVE THE SESSION BELONGS TO THE CALLER. A product that reads a record has no
 * business deleting the log of what they were doing before they opened it, and `ESC[3J` is
 * exactly that deletion: it empties the scrollback of the buffer, and nothing brings it back.
 *
 * AND TAKING THE SCREEN DOES NOT MAKE IT HARMLESS, which is the premise this delivery
 * falsified and the reason this file survived a model it was written for. It was written down
 * here that inside the alternate screen there is *no history to destroy*. That is true of the
 * SCREEN erase and false of the HISTORY erase: the alternate screen has no scrollback of its
 * own, so an `ED3` issued from inside it erases the scrollback of the PRIMARY buffer — the
 * caller's own — which is the same destruction as ever, by the same sequence, for the same
 * reason. Measured on the same scene with the screen taken and not taken: two of each erase,
 * both times. Taking the screen changes nothing about this path at all.
 *
 * SO THE DOOR STAYS, AND IT HAS ONE RULE WHERE IT USED TO HAVE TWO. What reaches it is the
 * layout library starting the page over out of its own memory of the frame it last drew —
 * `ESC[2J ESC[3J ESC[H`, three sequences concatenated into ONE constant that it writes when a
 * frame overflows the viewport and once more while it is tearing down. The two used to have to
 * be answered together, because the screen erase was itself refused by this product and had to
 * be translated into a scroll. On a screen this session OWNS there is nothing to protect from
 * a screen erase: the alternate screen is ours, it holds nothing of the caller's, and erasing
 * it is what the library means. So the `2J` PASSES, untouched, and the `3J` alone is taken out.
 *
 * AND WHAT WAS HERE INSTEAD IS GONE WITH THE MODEL. This file used to be the page itself:
 * how many rows with nothing on them go between what the session has said and the input area,
 * and the bytes that carry a whole screen of the caller's into their own scrollback so the
 * console could open on an empty one. Both were arithmetic against a console that lived in the
 * caller's buffer and used their scrollback as its roll. The console has its own screen and its
 * own roll now (`scrolling.ts`), so there is no page to carry away and no leftover to count —
 * the three regions are exactly as tall as the terminal, by construction, on every frame.
 *
 * WHAT IT CANNOT ANSWER is a sequence split INSIDE itself: a caller who wrote `ESC[` in one
 * call and `3J` in the next would get both through, because this reads one call's worth of
 * bytes and holds nothing between them. Nothing writes that way — the library concatenates one
 * constant into one write and this surface writes the output of one function — and the
 * measurement is the proof rather than the claim: the erase is nought over a session that
 * drives the library across that very boundary (`tests/the-screen-is-ours.test.ts`).
 */

/**
 * One escape byte, written as an escape.
 *
 * Like every other unusual byte in this repository's sources: a control character typed
 * into a source file is invisible in review and survives an edit made around it.
 */
const ESC = '\u001b';

/**
 * WHAT ERASES THE SCREEN THE SESSION IS ON — every row of it, in place.
 *
 * IT IS NAMED HERE IN ORDER TO BE LET THROUGH, which is the whole of what this delivery
 * changed about it. While the console lived in the caller's own buffer, the rows this erased
 * were rows a caller might still want, and what a terminal does with them is not the same on
 * every emulator — so it was translated into a scroll. The console has a screen of its own
 * now; every row this erases was drawn by this session, and the library only ever writes it
 * immediately before drawing the page again.
 */
const ERASES_THE_SCREEN = `${ESC}[2J`;

/**
 * WHAT ERASES THE CALLER'S HISTORY — the rows above the screen, which a scroll put there
 * and nothing brings back.
 *
 * It is the one sequence this product refuses, in every buffer, for the reason at the top of
 * this file. This is the string the door looks for ({@link withoutTheHistoryErase}), which is
 * why the module that explains the refusal is also the only one that names it
 * (`tests/the-screen-is-ours.test.ts`).
 */
const ERASES_THE_HISTORY = `${ESC}[3J`;

/**
 * BYTES ON THEIR WAY TO THE CALLER'S TERMINAL, WITH THE ERASE OF THEIR HISTORY TAKEN OUT OF
 * THEM — and everything else exactly as it arrived.
 *
 * IT IS HERE BECAUSE SOMEBODY ELSE ASKS FOR IT. Every other sequence this surface writes is
 * one it chose; this one is the LAYOUT LIBRARY's, decided out of its own memory of the frame
 * it last drew and before anything of this surface runs. So there is no frame to compose
 * differently and no size to ask again: the only place left is the one the bytes have to pass
 * through on the way out, and this is the answer they are given there.
 *
 * IT USED TO TRANSLATE RATHER THAN REMOVE, and the two halves parted company when the
 * console took the screen. The screen erase became a scroll — the same empty screen, with what
 * was on it moved one scroll up instead of destroyed — because the screen was the caller's.
 * It is not any more, so a translation would be this file answering a request the library made
 * honestly with something else. What survives is the half that was never about the screen: the
 * history erase becomes NOTHING, in every buffer, always.
 *
 * TAKEN OUT AND NOT REFUSED, and the difference is what the library then believes. It writes
 * the page again immediately afterwards, from the top, out of everything it was keeping — so
 * the screen really is emptied and really is redrawn, and the only thing that did not happen
 * is the one thing the library had no business asking for.
 *
 * ONE SCAN AND NO ALLOCATION IN THE COMMON CASE, which is every frame of every session: a
 * keystroke's frame holds neither sequence, and what this function is for happens when a frame
 * overflows the viewport and once while the session is leaving.
 */
export function withoutTheHistoryErase(bytes: string): string {
  if (!bytes.includes(ERASES_THE_HISTORY)) return bytes;
  return bytes.split(ERASES_THE_HISTORY).join('');
}

/**
 * WHETHER SOME BYTES CARRY THE ERASE OF THE SCREEN — asked by the cases that have to prove the
 * library really did reach the path this door is on.
 *
 * A GUARD OVER AN ABSENCE GOES VACUOUS WHEN THE PATH STOPS BEING WALKED, and that is the
 * whole reason this is exported. *No history erase reached the caller* is satisfied by a
 * session that never made the library want one, so a case that asserts it without also
 * asserting that the library ASKED is a case that would stay green if the door were deleted.
 * The screen erase is what says it asked: the two arrive in one constant, so the presence of
 * the one this product lets through is the proof that the one it removes was there to remove.
 */
export function erasesTheScreen(bytes: string): boolean {
  return bytes.includes(ERASES_THE_SCREEN);
}
