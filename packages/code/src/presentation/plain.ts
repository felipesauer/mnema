/**
 * The PLAIN renderer: a line's parts as bytes, with nothing added.
 *
 * Every piece of punctuation the terminal forms use is here, and only here: the two
 * spaces one level of depth is, the two spaces between columns, the `·` between the
 * parts of a heading, the colon after a verdict's label. Three modules held a piece
 * of it before, which is why `forms.test.ts` had to assert that a fact and an item
 * were indented alike — the two now share the constant instead of agreeing about it.
 *
 * WHAT IT PRODUCES IS WHAT THE SURFACE ALWAYS PRODUCED, byte for byte. That is the
 * point of it existing before there is a second renderer: the golden was recorded
 * against the joining these functions replaced, so it stays the proof that a line's
 * parts hold everything its text held. A byte of difference here is a byte the parts
 * lost.
 *
 * It adds no newline and removes none. A line is one line because its parts are
 * text and nothing here inserts a break between them; a break INSIDE a part is text
 * an actor wrote, and the rule about that lives at the call sites that hold such
 * fields (see `items.ts`).
 *
 * It never asks what it is writing to. Whether output is going to a terminal, a
 * pipe or a CI log is not a question `presentation/` may ask — a report whose bytes
 * depended on where they landed could not be compared to a recorded transcript, and
 * the whole surface is pinned by one. The renderer that paints exists now
 * (`styled.ts`), and the capability that chooses between the two is resolved by the
 * wiring, at the entry, and handed in; it is not read from here (`parts.test.ts`
 * refuses a `presentation/` that consults one).
 *
 * AND THE PAINTED ONE COMPOSES THROUGH THIS FILE — {@link renderWith} is the loop
 * both renderers are, so "here, and only here" survived a second renderer. A styled
 * line indents by the same constant and joins by the same table; all it adds is an
 * escape around a part's own text. That is what makes "strip the escapes and you have
 * the plain line" a property of the composition rather than of two files agreeing,
 * and `styled.test.ts` asserts it over every shape the surface builds.
 *
 * AND THE THIRD ONE COMPOSES OVER EITHER OF THEM. The renderer that folds (`folded.ts`)
 * takes the bytes one of these two produced and breaks them where a terminal of a known
 * width would otherwise have broken them badly, so it invents no punctuation of its own
 * either: the only thing it adds is the indent of a CONTINUATION, and that comes from
 * {@link indentOf}, here. The promise above got stronger rather than weaker — UNFOLD and
 * strip the escapes, and you have the plain line, exactly (`folded.test.ts`).
 */

import type { Line, Part, Role } from './line.js';
import type { Render } from './render.js';
import { widthOfText } from './width.js';

/** The two spaces one level of depth is. */
const INDENT = '  ';

/**
 * How far in a line of a given DEPTH starts — the one place that knows what a level is
 * worth.
 *
 * It is a function rather than a constant other files repeat because there is a second
 * caller now: the renderer that folds indents a continuation one level under the row that
 * generated it (`folded.ts`), and a hanging indent worked out from a `'  '` written down
 * there would be a second opinion about the same number. Changing what a level is worth
 * has to move both, and `folded.test.ts` is where that is asserted on the bytes.
 */
export function indentOf(depth: number): string {
  return INDENT.repeat(depth);
}

/**
 * What precedes a part of each role when it is not the first on its line.
 *
 * Total over {@link Role} by type, so a role that did not say how it joins the part
 * before it does not build — otherwise its separator would end up being whatever a
 * fallback chose, which is how a surface acquires a punctuation nobody decided on.
 *
 * A label's entry is empty and nothing reads it: {@link statement} is the only thing
 * that makes a label and it puts it first, where there is nothing to separate it
 * from. It is stated rather than omitted because the totality is what makes this
 * table the record of the surface's punctuation.
 *
 * `id`, `when` and `scope` take a COLUMN's separator, exactly, and the identical entries
 * are the point rather than a duplication to collapse: the three are refinements of
 * `field` for the styled renderer to dim (see `line.ts`), and a list whose id column
 * joined its neighbour by anything else would be a list whose bytes changed the day a
 * call site said what a column was. Every transcript this product is pinned by was
 * recorded before any of the three existed.
 *
 * `prompt` and `typed` take NOTHING, and that is a byte rather than a taste. The echo is
 * what a caller sent, shown back to them the way a terminal shows it — the prompt they
 * typed in front of and their own words — and the prompt carries the space it has always
 * ended in inside its own text (`repl/session.ts`, `PROMPT`). A separator here would put
 * a second one there, so what the console lands would stop being what the caller sent:
 * the plain rendering of an echo IS the prompt followed by the line, byte for byte, and
 * `echo.test.ts` asserts exactly that over the values a row being typed can hold.
 *
 * `state` takes ONE space, and that is the byte it already had. A task's position used
 * to be concatenated into the title beside it — `` `${title}${state}` `` — with the
 * parenthesized state carrying its own leading space inside one field. Splitting it into
 * a part of its own is what lets it be painted while the title is not, and it may not
 * move a character while doing it: two spaces here would turn it into a column of the
 * table, which is what the state is NOT (it belongs to the title it rides). Pinned by
 * `forms.test.ts` on the bytes, and by the golden over the whole surface.
 *
 * `pick` takes NOTHING, and it is the second entry nothing reads: the mark is the first
 * part of the row it is on (`repl/palette.ts`), where there is nothing to separate it from,
 * exactly like a `label`. It is stated for the reason the label's is — the totality is what
 * makes this table the record of the surface's punctuation — and the byte it does NOT take
 * is what keeps the plain rendering of a marked row identical to the unmarked one, glyph for
 * glyph: what is under the mark on every other row is the same column, padded.
 *
 * `word` takes a COLUMN's separator, exactly like the three above it and for the same
 * reason: it is a refinement of `field` for the styled renderer to tint, it is the first
 * column after the mark in the console's list of words, and the two spaces are the ones
 * that column already had. The role changed what the row is PAINTED in and it may not move
 * a glyph of it — pinned on the plain rendering of a palette row, which is byte for byte
 * what it was before the role existed.
 *
 * `clause` is the ONE entry that is not punctuation this surface chose. The chain's
 * one-line verdict is a sentence of clauses separated by `; `, and it hands `verify`
 * those clauses rather than the string; the `; ` here is what puts them back in the
 * order and the shape the chain's own sentence has. So it is a byte this table holds
 * and the chain holds too, and the two are not left agreeing by inspection: the
 * unpainted `verify` line is asserted to be the tree's name and the chain's own
 * `summary`, byte for byte.
 */
const PRECEDED_BY: { readonly [R in Role]: string } = {
  label: '',
  detail: ': ',
  clause: '; ',
  field: '  ',
  id: '  ',
  when: '  ',
  scope: '  ',
  state: ' ',
  subject: '  ·  ',
  prompt: '',
  typed: '',
  pick: '',
  word: '  ',
};

/**
 * A renderer: one line as the bytes a stream receives — its depth, then its parts in
 * order, each after the separator its role takes, and each first handed to `paint`.
 *
 * `paint` receives a WHOLE part and returns what stands in for it. It is the only
 * freedom a renderer has: the depth, the separators and the order are this loop's,
 * so nothing a second renderer does can move a column or drop a colon. A painter
 * that returns anything but the part's own text wrapped is a painter that changed
 * what the line says, which on an audit surface is the one thing style may not do.
 *
 * A line with no parts renders as the empty string, and nothing in the surface builds
 * one: the blank line a report puts between two groups is written as text, because
 * there is nothing on it to compose. So is the header above a list, and a record's
 * body — a whole paragraph the read hands over verbatim. Those are lines with no
 * parts to tell apart, which is why they are not made of any (see `parts.test.ts`
 * for the roles this refuses to invent).
 */
export function renderWith(paint: (part: Part) => string): Render {
  return (line) => {
    let text = indentOf(line.indent);
    for (const [index, part] of line.parts.entries()) {
      text += index === 0 ? paint(part) : `${PRECEDED_BY[part.role]}${paint(part)}`;
    }
    return text;
  };
}

/**
 * The PLAIN renderer: every part as the text it holds, and nothing added.
 *
 * What the golden was recorded against, and what a pipe, a CI log and a redirected
 * file get — the default in every one of those, decided at the entry and not here.
 */
export const renderPlain: Render = renderWith((part) => part.text);

/**
 * HOW WIDE A LINE IS ON A SCREEN, in COLUMNS — the plain rendering, measured.
 *
 * It lives beside the renderer it counts because the answer IS this renderer's output:
 * the indent, the separators and the parts are what a reader sees, and a caller that
 * measured any other way would be a second opinion about how a line is punctuated.
 *
 * THE PAINTED LINE IS THE SAME WIDTH, which is what makes one function enough. Style
 * wraps a part's own text in escapes a terminal does not print (`styled.ts`, and the
 * promise that stripping them gives back exactly this string), so the two renderings are
 * the same number of columns and different numbers of bytes. Measuring the bytes is the
 * mistake this exists to prevent: it would make a drawing that fits shrink for having
 * colour switched on.
 *
 * AND THE PARAGRAPH HERE USED TO READ *characters and not code units, because a name, a path
 * or a title may hold anything a caller wrote* — which was the right reason attached to the
 * wrong unit. Characters are not columns either: an East Asian WIDE glyph is one character and
 * two cells in every terminal there is, so a decision titled in Japanese measured half of what
 * it draws, and a combining accent measured twice. Measured on the built binary, `決定を記録する`
 * came back 7 where it occupies 14. The half of the sentence that survives whole is the reason:
 * a name, a path or a title may hold anything a caller wrote, which is exactly why the count
 * may not be a count of anything but cells. It is asked of the one authority over columns
 * (`width.ts`), which is the one the layout library draws by — so what this answers and what
 * the screen does cannot come apart.
 *
 * WHO ASKS: the console's opening panel, which chooses between three drawings by whether
 * the widest of them fits the terminal (`repl/panel.ts`), and the input area and the
 * palette, which drop what a window is too narrow for.
 *
 * AND THE SENTENCE THAT USED TO END THIS PARAGRAPH IS FALSE. It read: *nothing that
 * writes a line asks — a report is as wide as it is and the TERMINAL folds it, ON PURPOSE,
 * because a value cut to fit is a value a reader cannot check.* What falsified it is that
 * the argument is about CUTTING and it was standing in for a decision about FOLDING, and
 * the two are not the same operation: a value cut to fit loses bytes and cannot be checked
 * against the record, while a folded value loses nothing at all — only WHERE it breaks
 * moves. The choice was never whether to fold, either, because the terminal already does:
 * measured at eighty columns it splits `The console is read-` from `only by construction`
 * and returns to column zero, in the middle of a list whose other rows are indented. So the
 * option is folding WELL or leaving it folded badly, and there is a renderer that folds
 * well now (`folded.ts`). The half of the sentence that survives whole is the half about
 * cutting: nothing here truncates at any width, and `folded.test.ts` asserts that unfolding
 * a folded line gives back the line, byte for byte, over every shape the surface builds.
 */
export function widthOf(line: Line): number {
  return widthOfText(renderPlain(line));
}
