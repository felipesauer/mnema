/**
 * WHERE A LINE LANDS — and nothing at all about what it says.
 *
 * This is the whole of the console's layout, and it is deliberately the only file on
 * this surface that a layout library reaches. Everything in it POSITIONS: a row for what
 * the session has already said, a row for what is being typed, the caret at the offset
 * the caller's arrows put it at, a place for the words a Tab could not choose between.
 *
 * NOTHING HERE COMPOSES A LINE, and that is the limit the whole decision to take a
 * layout library rests on. Five deliveries built ONE model of what a line of this
 * product says: `presentation/` answers with parts that carry a role, a renderer turns
 * them into bytes, and a golden holds the two renderers to saying the same thing. A
 * component that put a sentence together would be a SECOND model of that, and the most
 * expensive lesson of this series is that two ways of saying the same thing diverge in
 * silence — it was the opaque summary, the vocabulary typed out at twenty-seven sites,
 * the three READMEs that disagreed.
 *
 * So the rule is: a component receives strings and puts them somewhere. It never adds a
 * word, a separator, a padding or a punctuation mark of its own. That is not a habit,
 * it is checked — a scan over this file refuses a text literal, a template and a
 * concatenation, and the case that proves the scan works makes a component say
 * something and watches it go red.
 *
 * THE ONE STYLE DECISION HERE IS NOT ABOUT A REPORT. The row of candidates a Tab offers
 * is dimmed, and it is the console's own affordance rather than a line of the record —
 * no line that came from a renderer is touched, painted, padded or trimmed here.
 *
 * AND THERE IS NO ALTERNATE SCREEN, on purpose and against the first design. Measured:
 * this library redraws the changing rows in the NORMAL buffer and leaves everything the
 * session has already said permanently in the scrollback. The alternate screen — what
 * `vim` and `htop` take — DISCARDS the scrollback when the program exits, which is the
 * opposite of a session whose whole output a caller wants to keep reading afterwards.
 */

import { Box, Static, type StaticProps, Text, useCursor, useInput } from 'ink';
import { createElement as node, type ReactNode, useEffect, useSyncExternalStore } from 'react';
import type { Keystroke } from './editing.js';

/** Everything the console is showing, as one value read at one instant. */
export interface Shown {
  /** Every line the session has already said, oldest first. Never rewritten. */
  readonly past: readonly string[];
  /** The row being typed: the prompt and what is on it, already put together. */
  readonly present: string;
  /** What a Tab could not choose between, already put together. Empty when there is none. */
  readonly hint: string;
  /** Which column of {@link present} the caret sits in. */
  readonly column: number;
}

/** What the layout reads and what it reports back to. The console implements it. */
export interface Watched {
  /** What is showing right now. A new value whenever anything changed. */
  readonly now: () => Shown;
  /** Call back on every change; the answer stops the calling back. */
  readonly watch: (changed: () => void) => () => void;
  /** A key the caller pressed. What it means is decided elsewhere. */
  readonly pressed: (stroke: Keystroke) => void;
}

/** The console: everything already said, then the row being typed. */
export function Region({ watched }: { readonly watched: Watched }): ReactNode {
  const shown = useSyncExternalStore(watched.watch, watched.now, watched.now);
  const { setCursorPosition } = useCursor();

  useInput((input, key) => {
    watched.pressed({ input, ...key });
  });

  // The real caret, on the row being typed, at the offset the arrows moved it to. The
  // row is the first of the redrawn ones because everything above it is in the
  // scrollback and out of this frame.
  useEffect(() => {
    setCursorPosition({ x: shown.column, y: 0 });
  }, [shown.column, setCursorPosition]);

  return node(
    Box,
    { flexDirection: 'column' },
    node(Past, { lines: shown.past }),
    node(Present, { present: shown.present, hint: shown.hint }),
  );
}

/**
 * What the session has already said, written once and never redrawn.
 *
 * Each line gets a box of its own, and the box's two measurements are the two ways a
 * layout can quietly change a line it was only asked to place:
 *
 *   - A ROW TALL WHATEVER IS IN IT, because a line with NOTHING on it is still a line.
 *     Text alone occupies no rows, so a report that separates its sections with blank
 *     lines would arrive with the separations gone. Measured against two reads of this
 *     product that do exactly that.
 *   - AS WIDE AS THE LINE IS LONG, so the layout never re-wraps it. Left to itself the
 *     box is as wide as the terminal and a long line comes out broken across rows with
 *     real newlines in it — which is not what the same verb writes at a shell, where the
 *     line is one line and the TERMINAL is what folds it. One more than the string is
 *     long, so an empty line still has a box to be a row in; and a line carrying style
 *     is measured longer than it looks, which only ever makes the box roomier.
 *
 * The child is passed as a PROP rather than as an argument, against the lint's advice
 * and with its suppression: this component's child is a FUNCTION OF AN ITEM rather than a
 * node, and a variadic child argument can only be handed a node.
 */
function Past({ lines }: { readonly lines: readonly string[] }): ReactNode {
  return node<StaticProps<string>>(Static, {
    items: [...lines],
    // biome-ignore lint/correctness/noChildrenProp: a variadic child cannot be a function
    children: (line: string, index: number) =>
      node(
        Box,
        { key: String(index), minHeight: 1, width: line.length + 1 },
        node(Text, null, line),
      ),
  });
}

/** The row being typed, and under it the words a Tab could not choose between. */
function Present({
  present,
  hint,
}: {
  readonly present: string;
  readonly hint: string;
}): ReactNode {
  return node(
    Box,
    { flexDirection: 'column' },
    node(Text, null, present),
    hint.length > 0 ? node(Text, { dimColor: true }, hint) : null,
  );
}
