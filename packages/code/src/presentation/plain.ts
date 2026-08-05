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
 * the whole surface is pinned by one. When a renderer exists that paints, the
 * capability that chooses it is resolved by the wiring, at the entry, and handed in;
 * it is not read from here (`parts.test.ts` refuses a `presentation/` that consults
 * one).
 */

import type { Line, Role } from './line.js';

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
 */
const PRECEDED_BY: { readonly [R in Role]: string } = {
  label: '',
  detail: ': ',
  field: '  ',
  subject: '  ·  ',
};

/**
 * One line as the bytes a stream receives: its depth, then its parts in order, each
 * after the separator its role takes.
 *
 * A line with no parts is the empty string — which is what a blank line between two
 * groups of a report is, and how one is written where a report needs one.
 */
export function renderPlain(line: Line): string {
  let text = INDENT.repeat(line.indent);
  for (const [index, part] of line.parts.entries()) {
    text += index === 0 ? part.text : `${PRECEDED_BY[part.role]}${part.text}`;
  }
  return text;
}
