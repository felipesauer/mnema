/**
 * disposition: what a state MEANS to whoever is reading the record.
 *
 * A workflow state answers "where is this entity"; a disposition answers the
 * question a reader actually asks — does this hold, is somebody expected to move
 * it, or is it over. The two are not the same question, and reading one off the
 * other case by case is how a filter comes to disagree with itself: a decision
 * that governs and a pattern that is a live way of working are the same
 * disposition under two different names (`accepted`, `adopted`), and a decision
 * still on the table and a pattern awaiting review are the same disposition under
 * three (`proposed`, `proposed`, `reviewed`).
 *
 * THE VOCABULARY IS SHARED; THE CLASSIFICATION IS NOT. Each machine's table lives
 * in the module that already owns that machine's reads — decisions in
 * `decisions.ts`, skills in `skills.ts` — because they are distinct domains and a
 * module holding both would be a place to change one machine while looking at the
 * other. What is shared is this type and the one-line derivation below, which is
 * the whole of what the two have in common.
 *
 * WHY A TABLE AND NOT A PREDICATE: a `Record<State, Disposition>` is TOTAL in the
 * compiler. A state added to either machine's union does not compile until it has
 * been given a meaning here, which is the one guard that cannot be forgotten —
 * the alternative (an `if` naming the states it cares about) is silent about
 * every state it does not name, and a new state would join no list at all.
 * Asserted in `disposition.test.ts` — "every state of both machines has a
 * disposition" — and proved by mutation in this slice's report.
 */

/** What one workflow state means to a reader of the record. */
export type Disposition =
  /** It holds: this is what governs the work right now. */
  | 'in-force'
  /** It waits for a judgement somebody has to make before it can hold or close. */
  | 'awaiting-judgement'
  /** Nothing is pending and nothing governs — the entity is done being decided. */
  | 'closed';

/**
 * The states of one machine that carry `wanted`, in the machine's own declared
 * order.
 *
 * The enumeration comes from the workflow's own tuple (`DECISION_STATES`,
 * `SKILL_STATES`) rather than from the table's keys, so the set being filtered is
 * the product's published vocabulary and not a copy of it — and the table is what
 * decides. That pairing is why "which states govern" and "which states wait" are
 * each written exactly once per machine: derived here, never restated beside the
 * table as a second constant that a later edit could leave behind.
 */
export function statesWith<S extends string>(
  states: readonly S[],
  table: Readonly<Record<S, Disposition>>,
  wanted: Disposition,
): readonly S[] {
  return states.filter((state) => table[state] === wanted);
}
