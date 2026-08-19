/**
 * Where the product's own switches stand: one line each, and what each one carries.
 *
 * IT SAYS BOTH POSITIONS ON EVERY LINE, which is `tails.ts`'s rule for the same reason. A
 * list that printed a word only for the switched-off ones would read as a list where
 * nothing is off when the reader is looking at a list where nothing was ever LOOKED at,
 * and those are not the same news — the second is what a fresh project answers.
 *
 * WHAT EACH CHANNEL CARRIES IS ON THE LINE, and it is why this is a list and not a pair of
 * words. The channels are the product's own identifiers and no other reading spells one,
 * so a person deciding whether to turn one off has to be told here what stops arriving.
 * The sentence arrives WITH the row (`commands/switch.ts`), which is what keeps this file
 * from having to assert that a name is one of the product's channels.
 *
 * THE ANCHOR IS SHORTENED AND THE REASON IS THE SURFACE'S, not this report's: an anchor is
 * `mnid:` and 64 hex, and at that width nobody reads it. It is shortened against every
 * identity the trees hold rather than against the ones this listing prints, so the value a
 * reader copies is one `--actor` accepts back (`anchors.ts`). An identity the record does not
 * know keeps every character, which is that module's rule and not a fallback.
 *
 * WHOSE SWITCH IT IS, AND WHETHER IT TRAVELS. An off switch is attributed, dated and
 * scoped, so a reader can tell a call the team made from something on this machine — and
 * the second is the case a committed document cannot report, which makes it the one a
 * person has to read here. It uses the `travels` vocabulary the pushed rules already do
 * rather than the tree's own name: what a reader can act on is whether a clone holds it.
 *
 * ONE LINE PER CHANNEL, and the rule is not free here. The `reason` on an off switch is
 * text somebody wrote, so it goes through {@link oneLine} — a newline in it would end its
 * own line and put a channel in the list that this product has none of, under a header
 * that counts them. The anchor goes through it for the same reason the other reports
 * collapse a `who`.
 *
 * IT NAMES WHERE IT LOOKED, on every answer rather than only on an empty one. There is no
 * empty answer here — the channels exist whether or not a record does — so the line that
 * `tails.ts` prints instead of a list is a suffix on the header here: everything ON in a
 * directory with no project reads exactly like everything on in a project, and the reader
 * who most needs the difference is the one who typed the verb in the wrong place.
 */

import type { Scope } from '@mnema/core';
import { type AnchorForms, anchorText } from '../anchors.js';
import type { SwitchRow } from '../commands/switch.js';
import { oneLine } from '../one-line.js';
import { asId, asWhen, type Column, column, itemLine } from './items.js';
import type { Render } from './render.js';

/** The width the position column is padded to, so the sentences beside it line up. */
const POSITION_WIDTH = 3;

/** What a line says about where a channel stands. */
const ON = 'on';
const OFF = 'off';

/** What a line says when the off switch is not in the tree that travels. */
const NOT_COMMITTED = '(not committed to this project)';

/** The lines `mnema switch` prints. */
export function switchReport(
  render: Render,
  rows: readonly SwitchRow[],
  trees: readonly Scope[],
  anchors: AnchorForms,
): string[] {
  // The name column is padded to the WIDEST name in the list, and it is computed rather
  // than declared: the set of channels is the product's and it grows, so a constant here
  // would go stale into a table whose columns stop lining up. Every other column of every
  // report on this surface pads to a fixed width because its values are a closed set of
  // short words; a channel name is a closed set of LONG ones.
  const width = Math.max(...rows.map((row) => row.state.channel.length));
  return [
    `${rows.length} channel(s), looked in ${trees.join(', ')}:`,
    ...rows.map((row) => render(itemLine(columnsOf(row, width, anchors)))),
  ];
}

/**
 * One channel's columns: its name, where it stands, what it carries, and — when it is
 * off — who switched it, when, whether that travels, and why.
 *
 * The name is marked as an ID because it is what a reader copies into `mnema switch off`.
 * The attribution fields are read off the state and are only ever present together: a
 * state is off because a switch put it there, so there is no line that says `off` with
 * nobody's name on it.
 */
function columnsOf(row: SwitchRow, width: number, anchors: AnchorForms): (string | Column)[] {
  const stands: (string | Column)[] = [
    asId(column(row.state.channel, width)),
    // A PLAIN column and not a marked one. The three markers say what a column IS — an id
    // to copy, an instant to scan past, the TREE a record lives in — and this is none of
    // them: it is the news of the row. Reaching for `asScope` to have it dimmed was the
    // first draft, and it would have made the guard over that marker say this list prints a
    // tree (`the-page-shows-its-seams.test.ts` is what said so).
    column(row.state.on ? ON : OFF, POSITION_WIDTH),
    row.carries,
  ];
  if (row.state.on) return stands;
  return [
    ...stands,
    '·',
    `switched off by ${oneLine(anchorText(anchors, row.state.by ?? ''))}`,
    asWhen(row.state.at ?? ''),
    ...(row.state.travels === false ? [NOT_COMMITTED] : []),
    ...(row.state.reason !== undefined ? [`— ${oneLine(row.state.reason)}`] : []),
  ];
}
