/**
 * THE WINDOW — one rule, and every reading of it asks HERE.
 *
 * Three reads of this product take `--from`/`--to`: `accountability` (a tally, in SQL
 * over the reference index), `export` (a stream of facts, as a predicate over events),
 * and `search` (an index of records, in SQL over the full-text table). Each one wrote
 * the comparison out for itself.
 *
 * THE DOC THAT PROMISED THIS WAS RECONCILED NAMED A TEST THAT DOES NOT EXIST.
 * `reference-store.ts` said, of the first two: *"`one-window-two-readings.test.ts` runs
 * both over the same record with the same matrix of filters and asserts they select the
 * same set; a condition added to one and not the other is red there rather than in a
 * review."* There is no such file, and `grep` finds no test naming `matchesAuthorship`
 * at all. So the sentence was an intention written as a fact — and the count was wrong
 * too: the readings are THREE, because the index's own window was never in that
 * paragraph's view.
 *
 * WHAT IS ONE HERE AND WHAT CANNOT BE. The BOUNDARY is one: inclusive on both ends,
 * compared on the ISO strings directly — ISO-8601 UTC stamps sort lexically, in the
 * order the chain merges on, and parsing to a date would be a second notion of order and
 * the one place two readings could disagree about a boundary instant. That rule is
 * {@link withinWindow} and {@link windowConditions}, and neither is a restatement of the
 * other: one answers about a value in memory, the other builds the `WHERE` a query
 * needs, and a predicate cannot be a `GROUP BY`. What makes them agree is
 * `one-window-three-readings.test.ts`, which drives all three reads over one record with
 * one matrix of filters.
 *
 * WHAT THE WINDOW IS OVER IS **NOT** ONE, AND THAT IS THE PART THAT WAS SILENT. For
 * `accountability` and `export` a window selects FACTS: an event's `at`. For `search` it
 * selects RECORDS by the instant each was RECORDED — a decision's `createdAt`, a
 * memory's `capturedAt` — because the index holds records and not facts. Both are
 * honest; what was not honest is that one flag name covered two axes and no read said
 * so. {@link WINDOW_IS_OVER} is that declaration, and the surfaces gloss the flag from
 * it, so a reader is told which axis they are narrowing at the place they narrow it.
 */

/** What a read's window narrows: the facts themselves, or the records they made. */
export type WindowSubject = 'fact' | 'record';

/**
 * What each subject MEANS, in the one sentence every door prints.
 *
 * Keyed by the subject, so a third axis does not compile until it says what it is.
 *
 * IT IS A LIST OF LINES AND NOT A STRING, and the reason is a rule of the surface rather
 * than a taste. The sentence is printed twice: flat, in a tool's field description, and
 * folded, under a verb's flags. Folding it at the door would put a decision about WIDTH
 * in a module that has no business making one — this workspace names the five modules
 * that may choose a shape by the size of a terminal, and a vocabulary is not among them
 * (`a-floor-under-the-window.test.ts` accused exactly that the first time this was
 * written with a wrapper). So the breaks are AUTHORED here, at the clause boundaries,
 * the way every other help paragraph on that surface already is; one door joins them
 * with a space and the other indents them.
 */
export const WINDOW_IS_OVER: Readonly<Record<WindowSubject, readonly string[]>> = {
  fact: [
    'A window (`from`/`to`) selects the FACTS themselves,',
    'by the instant each was recorded.',
  ],
  record: [
    'A window (`from`/`to`) selects RECORDS by the instant each was RECORDED —',
    'never by when one last moved, and never by the state it is in now.',
  ],
};

/** A window over ISO-8601 instants, inclusive on both ends. Either end may be absent. */
export interface Window {
  /** At or after this instant. */
  readonly from?: string;
  /** At or before this instant. */
  readonly to?: string;
}

/**
 * Whether an instant falls in the window — the reading a stream of facts needs.
 *
 * An absent end is no bound, so an empty window admits everything. An INVERTED window
 * (`from` after `to`) admits nothing, and that is an answer rather than a refusal: the
 * caller asked for the instants that are both at-or-after one moment and at-or-before an
 * earlier one, and there are none. It is stated because a read that refused it would be
 * the fourth behaviour under one flag name.
 */
export function withinWindow(at: string, window: Window): boolean {
  if (window.from !== undefined && at < window.from) return false;
  if (window.to !== undefined && at > window.to) return false;
  return true;
}

/**
 * The same rule as SQL, over a column holding an ISO instant — the reading a query needs.
 *
 * The column is named by the caller because the three tables spell it differently in
 * principle and identically today; what the caller may NOT decide is the comparison. The
 * parameter names are fixed (`@from`, `@to`) so a caller merging these into a larger
 * clause cannot bind one of them to something else and still typecheck.
 */
export function windowConditions(
  column: string,
  window: Window,
): { readonly sql: readonly string[]; readonly params: Record<string, string> } {
  const sql: string[] = [];
  const params: Record<string, string> = {};
  if (window.from !== undefined) {
    sql.push(`${column} >= @from`);
    params.from = window.from;
  }
  if (window.to !== undefined) {
    sql.push(`${column} <= @to`);
    params.to = window.to;
  }
  return { sql, params };
}
