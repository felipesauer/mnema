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
 * fields as an ARRAY and joins them itself — a caller cannot accidentally emit two
 * lines for one item, because it never writes a line at all.
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

/** The two spaces between one column and the next. */
const COLUMN_GAP = '  ';

/** The two spaces one level of nesting indents by. */
const INDENT = '  ';

/**
 * One item, as a line: indented by `depth`, its fields separated by two spaces.
 *
 * `depth` is 2 in exactly one place — the edge `refs` prints that touches neither
 * end of the entity asked about, which is a sub-item of the entity's own edges.
 * That it is needed once is worth noticing rather than hiding: it says that
 * reading is really two lists, an entity's edges and the graph beyond them, and
 * the second one is nested inside the first.
 */
export function itemLine(fields: readonly string[], depth = 1): string {
  return `${INDENT.repeat(depth)}${fields.join(COLUMN_GAP)}`;
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
