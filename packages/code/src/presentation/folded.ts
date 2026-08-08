/**
 * The renderer that FOLDS: the same line, broken between words, with the continuation
 * indented one level under the row that generated it.
 *
 * WHAT IT IS FOR, measured rather than argued: at eighty columns a hit of `search` came
 * out as `The console is read-` / `only by construction` — a word split down the middle,
 * the second half returning to column zero, in the middle of a list whose every other row
 * is indented two. That is the terminal folding, and a terminal folds at the margin
 * because it is counting cells and does not know what a word is. The choice was never
 * whether to fold. It is folding WELL or leaving it folded badly, and `plain.ts` says
 * which premise that falsified.
 *
 * IT IS A THIRD RENDERER AND IT COMPOSES OVER THE OTHER TWO. `Render` is the one seam
 * between a line's parts and the bytes a stream receives (`render.ts`), and this takes
 * one and hands back one: the bytes of the renderer it was given, broken. So the depth,
 * the separators, the order and the escapes are still the loop's in `plain.ts`, this file
 * decides nothing about what a line SAYS, and the answer is resolved where the other two
 * are — once, at the entry, from the capability the process actually has
 * (`wiring/color.ts`).
 *
 * THE PROMISE IS THE STYLED ONE, STRENGTHENED: UNFOLD IT, STRIP THE ESCAPES, AND YOU HAVE
 * THE PLAIN LINE — exactly, byte for byte. Not "the same information": a folded line holds
 * every character the unfolded one held, in the same order, and the only bytes this file
 * adds are the break and the indent after it. That is what lets a fold be presentation
 * rather than a fourth account of the record, and `folded.test.ts` asserts it over every
 * shape the surface builds and over every line the CLI writes.
 *
 * NOTHING THAT FITS IS TOUCHED, byte for byte, and it is the property everything else on
 * this surface leans on. The console's chrome is composed to fit — the panel picks the
 * widest arrangement the terminal has room for, the palette drops a row it would have to
 * fold, the input area drops a badge or a hint too wide to be one row — so the fold is the
 * identity on all of it, and a box drawn corner to corner comes out corner to corner. It
 * is asserted rather than assumed (`folded.test.ts`), because the failure would be a frame
 * broken in half by the thing that exists to stop lines breaking badly.
 *
 * IT NEVER TRUNCATES, at any width. `…` is one declared exception on this surface and it
 * belongs to the palette, which cuts a DESCRIPTION and says how many words it left out.
 * A fold that dropped a character would put a value on the screen that a reader could not
 * check against the record, which is the argument the premise in `plain.ts` was always
 * making and the half of it that survived whole.
 *
 * A WORD IS NOT SPLIT unless it is the only thing there is: the break goes between words,
 * and a single word wider than the room breaks where the room ends because there is
 * nowhere else. That is not taste — splitting mid-word is exactly what the terminal
 * already does, and it is half of what was measured as broken.
 *
 * IT COUNTS COLUMNS AND NOT BYTES, which is why it can be handed the painted renderer. An
 * escape sequence occupies no cell on a screen, so a styled line and its plain twin are
 * the same number of columns and different numbers of bytes ({@link widthOf} says the
 * same); counting the bytes would fold a line for having colour switched on. The two
 * renderings therefore break in the SAME places, which `folded.test.ts` asserts as its own
 * case — a fold that disagreed with itself about where a line breaks would put a terminal
 * and a CI log one row apart.
 *
 * ⚠️ ONE COUNT DIVERGES FROM {@link widthOf}, deliberately, and it is worth naming: a
 * FIELD may hold an escape byte an actor wrote (it is text, and the content door screens
 * for credentials rather than for control bytes). `widthOf` counts those bytes as
 * characters; this file counts them as the nothing a terminal draws. The fold is the one
 * that is right about a screen, and the disagreement is confined to a line nobody has
 * written yet — said out loud so that the day it matters, it is a known difference and not
 * a discovery.
 */

import type { Line } from './line.js';
import { indentOf, renderPlain } from './plain.js';
import type { Render } from './render.js';

/** One escape byte, written as an escape so no control byte enters a source file. */
const ESC = '\u001b';

/** What an escape has to be followed by to be a control sequence: `ESC [`. */
const CSI = '[';

/**
 * What ENDS a control sequence — any character from `@` to `~`.
 *
 * The range is the standard's own (a CSI sequence is the introducer, then parameter and
 * intermediate bytes, then one final byte in that range), so a sequence this file has
 * never heard of is still skipped whole rather than half-counted. Both ends are printable,
 * which is why this pattern can be written literally.
 */
const ENDS_A_SEQUENCE = /[@-~]/;

/** One unit of a rendered line: its bytes, and how much of a screen they take. */
interface Cell {
  /** The bytes themselves — one character, or a whole control sequence. */
  readonly bytes: string;
  /** How many columns it occupies: one for a character, none for a sequence. */
  readonly width: number;
  /** Whether it is the space a break may be taken after. */
  readonly space: boolean;
}

/**
 * A rendered row as the cells a screen would give it.
 *
 * By CHARACTER and not by code unit, for the reason `widthOf` gives: a title, a path or a
 * name may hold anything a caller wrote, and a fold that counted code units would break an
 * emoji in half.
 */
function cellsOf(text: string): readonly Cell[] {
  const glyphs = [...text];
  const cells: Cell[] = [];
  let at = 0;
  while (at < glyphs.length) {
    const glyph = glyphs[at] as string;
    if (glyph === ESC && glyphs[at + 1] === CSI) {
      let end = at + 2;
      while (end < glyphs.length && !ENDS_A_SEQUENCE.test(glyphs[end] as string)) end += 1;
      cells.push({ bytes: glyphs.slice(at, end + 1).join(''), width: 0, space: false });
      at = end + 1;
      continue;
    }
    cells.push({ bytes: glyph, width: 1, space: glyph === ' ' });
    at += 1;
  }
  return cells;
}

/** The bytes of `cells` from `from` up to `to`, in order and with nothing added. */
function bytesOf(cells: readonly Cell[], from: number, to: number): string {
  return cells
    .slice(from, to)
    .map((cell) => cell.bytes)
    .join('');
}

/**
 * Where a row that starts at `from` stops fitting in `room` columns — the largest prefix
 * that does.
 *
 * A sequence costs nothing, so the ones sitting at the end of what fits come along: a
 * closer belongs to the row whose text it closes.
 */
function fitsWithin(cells: readonly Cell[], from: number, room: number): number {
  let taken = 0;
  let at = from;
  while (at < cells.length && taken + (cells[at] as Cell).width <= room) {
    taken += (cells[at] as Cell).width;
    at += 1;
  }
  return at;
}

/**
 * Where to break a row that has to break: after the LAST space of what fits, and at the
 * margin when there is no space to take.
 *
 * The space stays on the row it ended, so unfolding is putting the rows back together and
 * nothing else — a fold that swallowed the space would be a fold that lost a byte, and the
 * whole promise is that it loses none.
 *
 * NO SPACE AT ALL is a word wider than the room, and then the margin is the only place
 * there is. It is the one case that splits a word, and it is the case the terminal applies
 * to every line.
 *
 * ⚠️ THE SPACES A ROW OPENS WITH ARE NOT A PLACE TO BREAK, and a first draft of this that
 * did not know it produced a row holding nothing but the indent: a line at depth one whose
 * first word was wider than the room broke after the depth, so the screen got two spaces,
 * a break, and then the word — a blank row bought at the price of the room it was supposed
 * to save. A break is taken after a space that follows something, so every row carries at
 * least one character of what the line says.
 */
function breakBefore(cells: readonly Cell[], from: number, margin: number): number {
  let word = from;
  while (word < margin && ((cells[word] as Cell).space || (cells[word] as Cell).width === 0)) {
    word += 1;
  }
  for (let at = margin; at > word; at -= 1) {
    if ((cells[at - 1] as Cell).space && !(cells[at] as Cell).space) return at;
  }
  return margin;
}

/**
 * One rendered row, folded to `columns` — the row itself when it fits, and the rows it
 * becomes when it does not.
 *
 * THE INDENT GIVES WAY when it leaves no room beside it, which is the rule the panel and
 * the input area already choose their arrangements by: a form gives way when it stops
 * fitting. A terminal narrower than one level of depth would otherwise get continuations of
 * one column, and a hanging indent wider than the window is not an indent, it is the whole
 * row. With that, every row has at least one column for a character, so a fold always makes
 * progress and cannot loop — which is why there is no floor written down here.
 */
function foldRow(bytes: string, columns: number, hanging: string): string {
  if (columns <= 0) return bytes;
  // The same bound the whole line was already answered by ({@link foldedAt}), applied to
  // one row of it: a row with fewer units than the terminal has columns cannot be too
  // wide. It is worth asking twice because a line an actor broke arrives here as several
  // rows, and only one of them may be the long one.
  if (bytes.length <= columns) return bytes;
  const cells = cellsOf(bytes);
  if (cells.reduce((wide, cell) => wide + cell.width, 0) <= columns) return bytes;
  const hang = hanging.length < columns ? hanging : '';
  const room = columns - hang.length;
  const rows: string[] = [];
  let from = 0;
  while (from < cells.length) {
    const margin = fitsWithin(cells, from, rows.length === 0 ? columns : room);
    if (margin >= cells.length) {
      rows.push(bytesOf(cells, from, cells.length));
      break;
    }
    const cut = breakBefore(cells, from, margin);
    rows.push(bytesOf(cells, from, cut));
    from = cut;
  }
  return rows.join(`\n${hang}`);
}

/**
 * The renderer for a terminal `columns` wide: what `render` says, folded.
 *
 * The width arrives as a PARAMETER, which is the whole of how this stays in
 * `presentation/`: nothing here asks how wide a terminal is, or whether the destination is
 * one — the answer is a value the entry reads where the process is and hands down
 * (`wiring/color.ts`, and `parts.test.ts` refuses a module here that reaches for it). It is
 * the precedent `bannerFor(columns)` set.
 *
 * THE CONTINUATION IS ONE LEVEL UNDER THE LINE THAT GENERATED IT, and the level comes from
 * {@link indentOf} rather than from a number written here — the same two spaces every other
 * depth on this surface is made of. A line at depth one continues at depth two, so a
 * folded item stays inside the list it belongs to instead of returning to the left edge,
 * which is what a reader tells a continuation from a new item by.
 *
 * A BREAK AN ACTOR WROTE IS LEFT ALONE. A field may hold a newline — it is text, and the
 * rule about collapsing it lives at the call sites that hold such fields — so what arrives
 * here can already be several rows. Each is folded on its own and they are joined back with
 * the break that was between them, unindented: this file adds rows, it does not take over
 * the ones that were already there.
 */
export function foldedAt(columns: number, render: Render): Render {
  return (line) => {
    const bytes = render(line);
    // THE WHOLE LINE, ANSWERED BEFORE IT IS TAKEN APART. A line with fewer UNITS than the
    // terminal has columns cannot hold a row that is too wide, whatever is in it: an
    // escape sequence adds units and occupies no column, and a character outside the basic
    // plane is two units and one column. So the length of the string is an upper bound on
    // the width of the row, and the common case — almost every line of almost every report
    // fits — costs one comparison instead of a split, a walk of every character and a join.
    //
    // MEASURED, over two hundred thousand renders of one list item, with the two halves
    // run in both orders: 129 ns for the plain renderer and 130 ns through this, which is
    // the tie identical work has to produce. Without it the same line cost 1037 ns. The
    // line that does NOT fit pays the walk — 3.4 µs for a hundred columns of text folded
    // to eighty — and there is no report where that is the cost anybody notices.
    if (bytes.length <= columns) return bytes;
    const hanging = indentOf(line.indent + 1);
    return bytes
      .split('\n')
      .map((row) => foldRow(row, columns, hanging))
      .join('\n');
  };
}

/**
 * HOW MANY ROWS a line takes on a terminal `columns` wide — asked of the fold itself.
 *
 * WHO ASKS: the console's opening, which has to know how much of the screen the page it is
 * about to draw will take, so that the drawing of the name can give way before the top of
 * the box ends up in the scrollback (`repl/panel.ts`).
 *
 * ⚠️ IT USED TO BE ARITHMETIC — `ceil(widthOf(line) / columns)`, which is what a TERMINAL
 * does: fill the row, break at the margin, start again at column zero. That was the right
 * count while the terminal was the thing folding, and this renderer falsified it: a
 * continuation is indented, so it holds fewer characters than the first row and a line can
 * take one row more than the division says. Measured on a real pseudo-terminal, one row
 * was exactly the error — the caret opened one row below the prompt and the two rules
 * around the input ran off the bottom of the screen
 * (`tests/the-opening-fits-the-screen.test.ts`, `tests/the-input-has-its-own-place.test.ts`,
 * which both went red on the delivery that added the fold).
 *
 * So the count is not a second reading of the rule: it is the fold, counted. The plain
 * renderer is what it counts because a painted line is the same number of columns and
 * therefore breaks in the same places, which `folded.test.ts` asserts on its own.
 */
export function rowsAt(line: Line, columns: number): number {
  return foldedAt(columns, renderPlain)(line).split('\n').length;
}
