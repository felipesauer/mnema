/**
 * THE WHEEL — the one thing this console asks the mouse for, and the smallest set of modes
 * that delivers it.
 *
 * A CONSOLE THAT TAKES THE SCREEN HAS TO ROLL ITSELF. The bar down the side of the caller's
 * terminal scrolls the buffer the session is NOT in any more (`scrolling.ts`), so the wheel
 * over this page does nothing at all unless the page asks for it. The caller asked for it in
 * as many words — *the middle region is where the scroll works* — so it is asked for.
 *
 * TWO MODES, AND THE COUNT IS THE DECISION. `?1000` reports a button being pressed and
 * released, and THE WHEEL IS A BUTTON: it arrives as button sixty-four upwards and sixty-five
 * downwards, so press-and-release is already the whole of what is needed. `?1006` is not a
 * third kind of event but the ENCODING — the older one saturates at two hundred and
 * twenty-three columns, and a terminal wider than that would report a click on the wrong side
 * of the page.
 *
 * AND `?1002`/`?1003` ARE REFUSED. They add MOTION — the pointer moving, with a button
 * held or without one — which is what a program needs for hover and for dragging and which
 * this page has neither of. What they cost is a report per cell the pointer crosses, on a
 * process whose whole job is to answer a keystroke. The console this page was measured from
 * turns them OFF and turns exactly these two on; that is measurement rather than preference.
 *
 * THE COST OF ASKING AT ALL IS DECLARED AND IT IS NOT SMALL. A terminal that is reporting
 * the mouse to an application stops doing its OWN thing with it, and its own thing is
 * SELECT-AND-COPY. Copying what the console said is an auditor's gesture and auditing is half
 * of what this product is for, so this is a real loss rather than a theoretical one. What
 * every emulator that matters leaves is an escape — hold SHIFT while dragging, and the
 * selection is the terminal's again — and it is the escape the console this page was measured
 * from relies on too. It is written in the session's own tips rather than left to be
 * discovered (`session.ts`).
 *
 * NOTHING HERE READS A DEVICE AND NOTHING HERE WRITES ONE. The bytes are constants and the
 * reading is a pure function over what the keyboard library handed over, which is what lets
 * every case about the wheel be a case with no terminal in it.
 */

/** One escape byte, written as an escape — like every unusual byte in this repository. */
const ESC = '\u001b';

/**
 * WHAT TURNS THE WHEEL ON: press-and-release reporting, in the encoding that does not
 * saturate.
 *
 * Written raw rather than looked up in a terminal database, which is the same call the layout
 * library and the console this page was measured from both make: the abstract name exists, and
 * every emulator anybody opens today speaks this sequence. A database would be a dependency
 * bought to spell two constants.
 */
export const WATCHING_THE_WHEEL = `${ESC}[?1000h${ESC}[?1006h`;

/**
 * WHAT GIVES IT BACK, in the order that undoes the order above.
 *
 * IT IS PART OF GIVING THE TERMINAL BACK, and it belongs to the same set as raw mode and
 * the hidden caret: a terminal left reporting the mouse fills the caller's next shell with
 * escape sequences every time they move the pointer. So it is written on every way this
 * process can stop and not only on the polite one (`leaving.ts`).
 */
export const THE_WHEEL_BACK = `${ESC}[?1006l${ESC}[?1000l`;

/**
 * WHAT A REPORT FROM THE MOUSE MEANS TO THIS PAGE — the two notches of the wheel, and
 * *nothing at all* for every other thing a mouse can do.
 *
 * `nothing` IS NOT `undefined`, and the difference is the whole reason this is three answers
 * rather than two: a click is a report this page has no use for AND it is still a report,
 * which must not be typed onto the row. Swallowing is a decision; not recognising is the
 * absence of one.
 */
export type FromTheMouse = 'up' | 'down' | 'nothing' | undefined;

/**
 * WHICH BIT SAYS THE BUTTON IS THE WHEEL. Set, the low two bits say which way it turned;
 * clear, they say which button was pressed.
 */
const THE_WHEEL = 64;

/** The low bits, which are the button — nought upwards and one downwards, on the wheel. */
const WHICH_BUTTON = 3;

/**
 * WHAT THE KEYBOARD LIBRARY HANDED OVER, READ AS A MOUSE REPORT — and `undefined` when it is
 * not one.
 *
 * IT IS READ WITHOUT ITS ESCAPE, and that is not a convenience: the library strips the leading
 * escape from every sequence it could not name before handing it on, and a mouse report is
 * exactly such a sequence — it is a well-formed control sequence with a final byte the library
 * has no name for. So what arrives is `[<64;10;5M`, and this reads that. Measured against the
 * library's own parser rather than assumed (`tests/the-screen-is-ours.test.ts`).
 *
 * THE SHAPE IS CHECKED AND NOT SEARCHED FOR. A report begins `[<`, holds three numbers
 * separated by semicolons, and ends on the letter that says whether the button went down or
 * came up. Anything else is not a report, and answering `undefined` is what lets a caller who
 * really did paste those characters have them typed.
 */
export function fromTheMouse(input: string): FromTheMouse {
  const said = /^\[<(\d+);(\d+);(\d+)[Mm]$/.exec(input);
  if (said === null) return undefined;
  const button = Number(said[1]);
  if ((button & THE_WHEEL) === 0) return 'nothing';
  switch (button & WHICH_BUTTON) {
    case 0:
      return 'up';
    case 1:
      return 'down';
    default:
      // The wheel tilted sideways, which every emulator reports and this page has no axis
      // for. Swallowed rather than refused: it is still the mouse.
      return 'nothing';
  }
}
