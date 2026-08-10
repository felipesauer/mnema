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
 * THE TASK MACHINE HAS A CLASSIFICATION TOO, and it is neither here nor in this
 * package: it is `core`'s `TASK_DISPOSITION`, in its own five words, beside the
 * transition table it is derived from. `tasks.ts` reads it through
 * `taskDisposition` exactly as the two modules above read their own tables — which
 * is why {@link statesMeaning} below takes the accessor rather than the table, and
 * why the {@link Disposition} type here does not widen to cover it. Whether three
 * machines should ever speak one vocabulary is an open question and not this
 * module's to settle.
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
 * The states of one machine that MEAN one of `wanted`, in the machine's own
 * declared order.
 *
 * The enumeration comes from the workflow's own tuple (`DECISION_STATES`,
 * `SKILL_STATES`, `TASK_STATES`) rather than from a table's keys, so the set being
 * filtered is the product's published vocabulary and not a copy of it — and the
 * classification is what decides. That pairing is why "which states govern", "which
 * states are live work" and "which states wait" are each written exactly once per
 * machine: derived here, never restated beside the table as a second constant that a
 * later edit could leave behind.
 *
 * IT USED TO TAKE THE TABLE ITSELF, and what changed it is the third machine. The
 * task machine's classification is `core`'s (`TASK_DISPOSITION`), and that table is
 * deliberately off the package's surface — a consumer gets `taskDisposition`, the
 * question, and never the table behind it
 * (`no-classification-table-reaches-the-surface.test.ts`). So the parameter is the
 * ACCESSOR each machine already publishes, which every machine has and only two of
 * them could have handed over as a record; the two that own their table pass their
 * own accessor for it, so all three read alike.
 *
 * `wanted` is variadic and not one value for the same reason: the live-work question
 * is answered by TWO dispositions (`advancing` and `stalled`), and a caller that had
 * to call this twice and concatenate would be deciding the union at the call site —
 * one more place for the rule to be written differently. Typed as a non-empty tuple,
 * so asking for the states that mean nothing at all does not compile.
 *
 * It is generic over the disposition too, because the two vocabularies are NOT one
 * (see `core`'s `disposition.ts` for why, and it is not this module's call to
 * overrule): a task's five names answer "can this move" and the other two machines'
 * three answer "does this govern". What this function needs of them is only that a
 * state maps to a word and that words compare, which is all `D extends string` asks.
 */
export function statesMeaning<S extends string, D extends string>(
  states: readonly S[],
  meaningOf: (state: S) => D,
  ...wanted: readonly [D, ...D[]]
): readonly S[] {
  return states.filter((state) => wanted.includes(meaningOf(state)));
}
