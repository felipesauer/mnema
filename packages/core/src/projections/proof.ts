/**
 * THE PROOF A RECORD'S MOVES CARRIED — one shape, one reading, three state machines.
 *
 * A task, a decision and a skill each move through a transition that may carry
 * `fields`: the words somebody wrote to justify the move. Those words enter the signed
 * chain, and MEASURED, before this module existed, they came out of exactly one read —
 * `mnema timeline --json`, which serves the whole event verbatim. `mnema timeline`
 * without the flag, `mnema show`, and `mnema search <the words of the note>` all had
 * nothing. So the record held prose that the human read and the index could not reach.
 *
 * IT IS A LIST AND NOT THE LATEST ONE, and that is the decision in this module worth
 * writing down. A task completed, reopened with a reason, and completed again holds
 * three pieces of prose, and the record holds all three. A projection carrying only the
 * last would leave the earlier two searchable by nothing — a silent hole of exactly the
 * shape a partial answer makes, where the read looks complete and is not. So the fold
 * accumulates every move that said something, in the order the chain proved.
 *
 * ONLY THE MOVES THAT SAID SOMETHING. Most transitions carry no fields at all, and a
 * row per silent move would make the list mostly noise and the index mostly empty
 * strings. An absent entry is the fact that the move recorded no proof.
 *
 * WHAT EACH CONSUMER DOES WITH IT, so the shape is not read as one surface's
 * convenience: `show` prints it under a heading, served whole below the facts, the way
 * a decision's `alternatives` already is; the full-text index folds every `said` into
 * the record's body, so the words are findable by the words; and `timeline` does not use
 * this at all — it reads each event's own fields, because an event list's unit is the
 * event and it already holds one.
 */

import type { TransitionFields } from '@mnema/chain';
import { transitionProse } from '@mnema/chain';

/** What one move of a record's state said, and which move it was. */
export interface TransitionProof {
  /** The action as recorded — a literal, never a pointer into a workflow. */
  readonly action: string;
  /** `at` of the transition that said it. */
  readonly at: string;
  /** The proof as text, `name: value` per line. Never empty: see {@link proofOf}. */
  readonly said: string;
}

/**
 * The proof one transition carried, or undefined when it carried none.
 *
 * The single site that decides what "carried proof" means, so the three folds cannot
 * come to disagree about it — which is the same reason `transitionProse` is one
 * function for the text itself. The event is taken by the shape it is read through
 * rather than by its catalog arm, because the three arms differ in fields this does not
 * touch (a decision's `by`) and narrowing to their union here would make this module
 * ask about them.
 */
export function proofOf(event: {
  readonly at: string;
  readonly payload: { readonly action: string; readonly fields?: TransitionFields };
}): TransitionProof | undefined {
  const said = transitionProse(event.payload.fields);
  if (said === '') return undefined;
  return { action: event.payload.action, at: event.at, said };
}

/**
 * The prose of every move of one record, as one block of text — what the index takes.
 *
 * The action and the instant are left OUT of it deliberately: they are already indexed
 * as structure (a state, a date), and folding the word `complete` into the body of every
 * completed task would make that word match half the record and rank as if it were
 * content somebody wrote.
 */
export function proofText(proof: readonly TransitionProof[] | undefined): string {
  return (proof ?? []).map((one) => one.said).join('\n');
}

/**
 * The proof as one TEXT column, or null when the record holds none.
 *
 * JSON in one column rather than a table of its own, and the reason is what the value
 * IS: it is not queried, joined or filtered by anything — the three reads that want it
 * ask for the record and get it whole, and the index gets the words through
 * {@link proofText}. A table would buy a join for a value nobody selects on. The cache
 * is dropped and replayed rather than migrated, so the shape can change with the fold
 * that writes it.
 *
 * NULL AND NOT `'[]'`, so the absence survives the round trip: a record whose moves
 * said nothing has no key at all when it comes back, which is what every consumer
 * checks. One site for both directions, so an encoding cannot drift from its decoder.
 */
export function proofColumn(proof: readonly TransitionProof[] | undefined): string | null {
  return proof === undefined || proof.length === 0 ? null : JSON.stringify(proof);
}

/** The proof read back out of its column — absent when the column is null. */
export function proofFromColumn(column: string | null): {
  readonly proof?: readonly TransitionProof[];
} {
  if (column === null) return {};
  const parsed = JSON.parse(column) as readonly TransitionProof[];
  return parsed.length === 0 ? {} : { proof: parsed };
}
