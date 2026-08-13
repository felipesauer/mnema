/**
 * WHERE THE CHOICE IS DRAWN — the layout library, asked for the smallest thing it does.
 *
 * It draws rows and it reads keys. It composes nothing, decides nothing, and knows neither
 * what a door is nor which one is picked: what arrives is a list of strings and what leaves
 * is a keystroke. That is the same division the console keeps between the page and the
 * library (`repl/region.ts`), held one size down — the page is composed and rendered in
 * `doors.ts`, and this only places it.
 *
 * IT IS THE SECOND MODULE OF THIS PRODUCT THAT REACHES THE LIBRARY, and the rule that
 * governs both is the one the console's opening carries: that library resolves the colour of
 * everything it draws from a channel it reads ONCE, while it is being loaded, so this
 * product's answer has to arrive in the instant before the import that loads it. Which is
 * why this module exists at all rather than being the body of `asked.ts` — the import has to
 * be a line somebody can put a call in front of, and it is (`asked.ts`, and
 * `tests/one-authority-over-colour.test.ts`, which enumerates the doors by what they
 * import rather than by a list).
 *
 * IT DOES NOT TAKE THE SCREEN, and the console does. A console is a page a caller lives on
 * and it is worth the alternate buffer; this is a question, and a question that cleared the
 * caller's terminal to ask itself would take away the very thing they were looking at when
 * they typed the name. So it draws where the cursor already was, and the library takes its
 * own rows back when it is unmounted — what is left on the page is what was there before,
 * plus whatever the chosen line then prints.
 *
 * NOTHING HERE ASKS THE DEVICE HOW BIG IT IS. Two files do and a third would be a third
 * answer (`tests/one-width-per-frame.test.ts`): the rows arrive already folded to this
 * terminal's width by the renderer the entry resolved, which is the one place a line of this
 * product is ever broken (`presentation/folded.ts`).
 */

import { Box, render, Text, useInput } from 'ink';
import { createElement as node, type ReactElement, type ReactNode } from 'react';
import type { Keystroke } from '../repl/editing.js';
import { armLeaving, type Leaving } from '../repl/leaving.js';

/**
 * A row with nothing on it, as the library needs it to be given.
 *
 * An empty string is not a row to a layout that lays out boxes — there is nothing to place —
 * so the breath between the parts of the page would close up. One space is a row with a glyph
 * on it that a terminal draws as nothing, which is what a blank line IS on a screen.
 */
const AN_EMPTY_ROW = ' ';

/** The page, as rows, with a caller listening to the keyboard. */
function Choosing({
  rows,
  pressed,
}: {
  readonly rows: readonly string[];
  readonly pressed: (stroke: Keystroke) => void;
}): ReactNode {
  // WHAT ARRIVED FROM THE KEYBOARD, handed straight on. What a key MEANS is decided where
  // the pick is (`asked.ts`), for the reason the console decides it outside its own layout:
  // a component that answered a key would be a case that needs a terminal to run.
  useInput((input, key) => {
    pressed({ input, ...key });
  });
  return node(
    Box,
    { flexDirection: 'column' },
    ...rows.map((row, at) =>
      // The index is the key because the rows are a fixed page in a fixed order: the same row
      // is the same row on every frame, and the only thing that changes between two of them
      // is which one carries the mark.
      node(Text, { key: `${at}` }, row.length === 0 ? AN_EMPTY_ROW : row),
    ),
  );
}

/** What a choice can do to the screen it is drawn on. */
export interface Screen {
  /** Draw these rows instead of the ones on the page. */
  readonly show: (rows: readonly string[]) => void;
  /** Take the page down and give the terminal back. Idempotent, and synchronous. */
  readonly close: () => void;
}

/** Where a choice is drawn, and what it is drawn with. */
export interface ScreenRequest {
  /** Where the keystrokes come from. */
  readonly stdin: NodeJS.ReadStream;
  /** The page it draws on. */
  readonly stdout: NodeJS.WriteStream;
  /** The rows it opens with, top first, already rendered and already folded. */
  readonly rows: readonly string[];
  /** A key the caller pressed. What it means is the caller's to decide. */
  readonly pressed: (stroke: Keystroke) => void;
  /** Every way this process can stop, so the terminal is given back in all of them. */
  readonly leaving: Leaving;
}

/**
 * Draws the choice and answers with the two things a caller can do to it.
 *
 * THE TERMINAL IS GIVEN BACK ON EVERY WAY THIS PROCESS CAN STOP, not only on the polite
 * one. Drawing puts the input in raw mode and hides the caret, and neither of those belongs
 * to this process — they belong to the TERMINAL and they outlive whatever set them
 * (`repl/leaving.ts` has the measurement). A menu is a shorter thing to be killed in the
 * middle of than a session, not a safer one.
 */
export function openScreen(request: ScreenRequest): Screen {
  const { stdin, stdout, pressed, leaving } = request;
  const page = (rows: readonly string[]): ReactElement => node(Choosing, { rows, pressed });

  const app = render(page(request.rows), {
    stdin,
    stdout,
    // Ctrl-C is a way of answering this question — with nothing — and the answer is the
    // caller's to give rather than the library's to take: a library that exited the process
    // on it would leave the terminal to whatever its own teardown does, and the whole point
    // of the two lines below is that this product decides what leaving looks like.
    exitOnCtrlC: false,
    // The global `console` is left alone, exactly as the session leaves it: every line this
    // product prints goes through its own port, so there is nothing to reroute.
    patchConsole: false,
    // WHETHER THERE IS A TERMINAL IS THIS PRODUCT'S ANSWER and it has already been given —
    // the entry asks the device, at both ends, before anything reaches here. Left to itself
    // the library decides by looking for the marks of a build server, and would draw one
    // last frame on a machine with a real terminal and a `CI` in its environment.
    interactive: true,
  });

  let closed = false;
  function restore(): void {
    if (closed) return;
    closed = true;
    disarm();
    app.unmount();
  }
  const disarm = armLeaving(leaving, restore);

  return {
    show: (rows) => {
      if (closed) return;
      app.rerender(page(rows));
    },
    close: restore,
  };
}
