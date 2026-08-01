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

/** The two spaces an item is indented under its header by. */
const INDENT = '  ';

/**
 * One item, as a line: indented under its header, its fields separated by two
 * spaces.
 *
 * Every item of every list in the product sits at the SAME depth, and that is now
 * true structurally rather than by agreement. One caller used to ask for a second
 * level — the edge `refs` prints that touches neither end of the entity asked
 * about — which made indentation carry a meaning ("this belongs to the group
 * above") that nothing else here gives it, and left a reader to infer what the two
 * extra spaces said. That reading names its groups instead, so the meaning is in
 * words and the depth is a constant again.
 */
export function itemLine(fields: readonly string[]): string {
  return `${INDENT}${fields.join(COLUMN_GAP)}`;
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
