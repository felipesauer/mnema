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
 */

import type { Part, Role } from './line.js';
import type { Render } from './render.js';

/** The two spaces one level of depth is. */
const INDENT = '  ';

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
 * `id` and `when` take a COLUMN's separator, exactly, and the identical entries are
 * the point rather than a duplication to collapse: the two are refinements of `field`
 * for the styled renderer to dim (see `line.ts`), and a list whose id column joined
 * its neighbour by anything else would be a list whose bytes changed the day a call
 * site said what a column was. Every transcript this product is pinned by was
 * recorded before either role existed.
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
  subject: '  ·  ',
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
    let text = INDENT.repeat(line.indent);
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
