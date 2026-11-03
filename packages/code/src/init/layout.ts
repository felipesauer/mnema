/**
 * HOW WIDE A FRAME OF `mnema init` MAY BE, learned from the renderer and from nobody else, and the three
 * things a row does when it has to fit: wrap a paragraph, put a note under what it is about, hang a
 * continuation under the first word.
 *
 * THE WIDTH IS NOT ASKED OF A DEVICE. Two files of this product do that (`repl/console.ts` and the entry,
 * `tests/one-width-per-frame.test.ts`) and a third would be a third answer on one page. What a frame can
 * ask without asking is the renderer it was handed, which already folds to the width the entry resolved:
 * a line with no break in it, longer than any terminal, comes back folded at exactly that many columns, and
 * the first row of it is the width. A renderer that does not fold (a pipe, a file, a terminal that said
 * nothing) hands the line back whole, and that is no width: the frame is then laid out for 80, the width the
 * product's pages are written for, and nothing is folded afterwards because nothing folds.
 * (`the-init-draws-its-frames.test.ts` draws every frame at 80 and at 60.)
 *
 * WHAT DOES NOT FIT IS MOVED BEFORE IT IS FOLDED. The product's own fold keeps a row whole by breaking it
 * under the first word of the row, and a trail wants a guide down the left of every row of it; so a note
 * that would not share a row with what it is about is put on a row of its own, under it, and a paragraph is
 * wrapped here into rows that each carry the guide. A path that is longer than the room is the one thing that
 * still folds, by the product's own fold, because a path is not a thing to cut anywhere but where the width
 * cuts it.
 */

import type { Line, Part } from '../presentation/line.js';
import { renderPlain, separatorBefore } from '../presentation/plain.js';
import type { Render } from '../presentation/render.js';
import { widthOfText } from '../presentation/width.js';

/** The width a frame is laid out for where nothing folds: the one the product's pages are written for. */
export const THE_PAGE = 80;

/** A line no terminal is wider than, with no place to break it. */
const PROBE = 'x'.repeat(1000);

/**
 * How many columns the renderer folds to, or the width of a page where it folds to none.
 *
 * It asks the renderer to fold a line that has no break in it and reads how wide the first row came out:
 * that is the width the product folds this invocation's lines to, by the only function that folds them.
 */
export function theWidthOf(render: Render): number {
  const first = render({ indent: 0, parts: [{ role: 'field', text: PROBE }] }).split('\n')[0] ?? '';
  const width = widthOfText(first);
  return width >= PROBE.length ? THE_PAGE : width;
}

/**
 * `text` wrapped to rows no wider than `room`, at the spaces, a word never cut: the greedy fill a
 * paragraph is read in. A word wider than the room is a row of its own.
 */
export function wrap(text: string, room: number): readonly string[] {
  const rows: string[] = [];
  let row = '';
  for (const word of text.split(' ')) {
    if (row === '') row = word;
    else if (widthOfText(`${row} ${word}`) <= room) row = `${row} ${word}`;
    else {
      rows.push(row);
      row = word;
    }
  }
  if (row !== '') rows.push(row);
  return rows;
}

/** The room a row of the trail has for its words: the width less the guide, its gap and a margin. */
export const roomOf = (width: number, indent = 0): number => width - 3 - indent - 1;

/**
 * A row and the note that goes with it. On one row when they fit the width together, with the note's own
 * further rows (`more`) under it in the same column; and otherwise the row (as `stackedLead`, the lead
 * without the padding that lined its note up), and the note and what follows it wrapped beneath, hung
 * `hang` columns in from the text of the trail's row.
 */
export function noted(
  row: (...parts: readonly Part[]) => Line,
  lead: readonly Part[],
  note: Part | undefined,
  width: number,
  hang: number,
  more: readonly string[] = [],
  stackedLead: readonly Part[] = lead,
): readonly Line[] {
  // A lead that is wider than the width by itself (a path longer than the room, after the columns it hangs
  // in) loses its indentation: the path is the one thing that is never cut, so it starts as far left as the
  // trail lets it, and stays whole on a row of its own when it fits there.
  const fitting = (parts: readonly Part[]): readonly Part[] =>
    widthOfText(renderPlain(row(...parts))) <= width ? parts : outdented(parts);
  if (note === undefined) return [row(...fitting(stackedLead))];
  const together = row(...lead, note);
  // Where the note starts, measured on the row as it will be drawn: the lead, and the separator before the note.
  const gap = widthOfText(separatorBefore('id'));
  const at = widthOfText(renderPlain(row(...lead))) + gap;
  const widest = Math.max(
    widthOfText(renderPlain(together)),
    ...more.map((each) => at + widthOfText(each)),
  );
  if (widest <= width) {
    const under = at - widthOfText(renderPlain(row())) - gap;
    return [
      together,
      ...more.map((each) => row({ role: 'id', text: `${' '.repeat(under)}${each}` })),
    ];
  }
  const rows = wrap([note.text, ...more].join(' '), roomOf(width, hang));
  return [
    row(...fitting(stackedLead)),
    ...rows.map((each) => row({ role: 'id', text: `${' '.repeat(hang)}${each}` })),
  ];
}

/** `parts` with the indentation of the first one taken off. */
function outdented(parts: readonly Part[]): readonly Part[] {
  const [first, ...rest] = parts;
  return first === undefined ? parts : [{ ...first, text: first.text.trimStart() }, ...rest];
}

/**
 * A paragraph as rows of the trail: wrapped to the room, the first row after `lead` and every other under
 * it, so the words hang where the first row's words begin.
 */
export function paragraph(
  row: (...parts: readonly Part[]) => Line,
  words: string,
  width: number,
  lead = '',
  role: Part['role'] = 'field',
): readonly Line[] {
  const hang = widthOfText(lead);
  return wrap(words, roomOf(width, hang)).map((each, at) =>
    row({ role, text: `${at === 0 ? lead : ' '.repeat(hang)}${each}` }),
  );
}
