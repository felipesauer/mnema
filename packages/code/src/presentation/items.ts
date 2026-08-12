/**
 * FORM A — a list of items: a header that says how much there is, then one line
 * per item, in aligned columns.
 *
 * Six of the CLI's readings are this form: `search`, `exposure`, `refs`,
 * `timeline`, `accountability` and `skills`. Before this module each of them
 * wrote its own line by hand, and that is exactly why they drifted — two spaces
 * here, a padded column there, an id last in one report and first in another. The
 * shape lives here now, so a change to it is one edit and not six.
 *
 * ONE LINE PER ITEM IS THE POINT OF THE FORM, not a detail of it. The header says
 * how many items follow, so a reader counts them by counting lines: an item that
 * printed two lines would put a record in the list that nothing ever wrote, with
 * the count beside it saying otherwise. That is why {@link itemLine} takes the
 * fields as an ARRAY — a caller cannot accidentally emit two lines for one item,
 * because it never writes a line at all. It used to join them here as well; the
 * joining is the renderer's now (`plain.ts`), and what a caller gets back is the
 * line's PARTS. The property is the same one and it moved with the array: an item
 * is a list of fields either way, and nothing a caller holds is bytes.
 *
 * What it does NOT do is collapse the whitespace inside a field. That rule belongs
 * to the fields that hold text an ACTOR wrote (a title, an agent's name), it is
 * applied at the call sites with `oneLine`, and it is asserted there — see
 * `served-patterns.ts` for the rule and why the class it covers is the class it
 * covers. Moving it in here would be a good idea with a byte attached: a
 * whitespace-only title prints today as an empty column between two separators,
 * and `oneLine` over the whole composed field would eat one of the spaces. That is
 * a change to make deliberately, with the golden showing it, not as a side effect
 * of moving code.
 */

import type { Line, Part, Severity } from './line.js';

/**
 * The roles a COLUMN of a list may take: the ordinary value, the three a call site can
 * say it is handing over, and the one that rides another.
 *
 * It is a SUBSET of the line's roles, and the narrowing is the point: a `label` or a
 * `subject` inside a list would take a heading's separator and put a `·` in the middle
 * of a table. The subset is checked against the whole union where {@link itemLine}
 * builds its parts — a column role that stopped being a role does not compile there,
 * in `src`.
 *
 * `state` is in the subset and is NOT a column of the table, which sounds like a
 * contradiction and is the honest shape: a task's position is appended to the title it
 * belongs to, separated by the one space it always had (see `plain.ts`), so it is passed
 * where the columns are passed and lands beside the field it rides. What it needs of its
 * own is not a position in the table — it is the ability to carry a hue while the title
 * beside it does not.
 */
export type ColumnRole = 'field' | 'id' | 'when' | 'scope' | 'state';

/**
 * One column of a list, with what it is said rather than left to be guessed.
 *
 * `severity` is the second axis, and it is here for the one column that can carry news:
 * a state whose disposition says a reader has something to do about it. It is optional
 * and absent is the common case, exactly as it is on a {@link Part} — a column that
 * declared its own news without knowing any would be the surface judging the record.
 * Structurally a `Column` IS a `Part`, which is what lets {@link itemLine} hand one
 * straight through.
 */
export interface Column {
  readonly role: ColumnRole;
  readonly text: string;
  readonly severity?: Severity;
}

/**
 * This column is an ID — a handle to copy into the next command, not prose to read.
 *
 * The markers exist because six lists hand over ids, instants and trees POSITIONALLY, in
 * an array, and the shape threw away what each call site already knew. Saying it costs
 * a caller one word and buys the renderer the one distinction that makes a list
 * scannable. IT SAID *these two and no third*, and pointed at `line.ts` for the argument;
 * the third is {@link asScope}, and `line.ts` is where the premise it falsified is
 * written out.
 */
export function asId(text: string): Column {
  return { role: 'id', text };
}

/** This column is an INSTANT — when it happened, which a reader scans past. */
export function asWhen(text: string): Column {
  return { role: 'when', text };
}

/**
 * This column is the TREE a record lives in — which is nearly always the same word on
 * every row of the list it is in.
 *
 * THE THIRD MARKER, AND THE ARGUMENT IS THE FIRST TWO'S rather than one of its own: a
 * column nobody reads is a column a reader has to look past to reach the title. It is the
 * strongest case of that there is, and it is the one a print of this surface caught — a
 * reading over one project answers `public`, `public`, `public` down the page, at exactly
 * the weight of the titles beside it.
 *
 * WHAT IT IS NOT is a hue per tree. Telling the three apart would take one colour each,
 * and that is refused here as it always was (`line.ts`); what this asks for is the
 * opposite — that the word stops competing at all.
 *
 * It takes the text the call site composed rather than a scope value, so a report that
 * pads its column or brackets it keeps its own bytes: what the marker says is what the
 * column IS, never how it is written (see {@link column}, and `references.ts` for the
 * bracketed form).
 */
export function asScope(text: string): Column {
  return { role: 'scope', text };
}

/**
 * One item, as a line: indented under its header, one part per field.
 *
 * Every item of every list in the product sits at the SAME depth, and that is now
 * true structurally rather than by agreement. One caller used to ask for a second
 * level — the edge `refs` prints that touches neither end of the entity asked
 * about — which made indentation carry a meaning ("this belongs to the group
 * above") that nothing else here gives it, and left a reader to infer what the two
 * extra spaces said. That reading names its groups instead, so the meaning is in
 * words and the depth is a constant again.
 *
 * A BARE STRING IS STILL A FIELD, which is what keeps the ordinary column the default
 * and the marked one the exception. Every list used to pass nothing but strings and
 * every one of those columns was an anonymous value; the callers that know better now
 * wrap two of theirs in {@link asId} or {@link asWhen}, and the rest are unchanged —
 * including the whole of `accountability`, `next-actions` and `refs`, which compose
 * their columns out of several values and have no bare id or instant to mark.
 */
export function itemLine(fields: readonly (string | Column)[]): Line {
  return {
    indent: 1,
    parts: fields.map(
      (field): Part => (typeof field === 'string' ? { role: 'field', text: field } : field),
    ),
  };
}

/**
 * A column padded to a fixed width, for the reports whose middle columns are a
 * closed set of short words (a state, a tree) and read as a table when they line
 * up. It pads and never truncates: a value wider than the column pushes the rest
 * of the line right, which is ugly, where cutting it would be a lie.
 */
export function column(value: string, width: number): string {
  return value.padEnd(width);
}
