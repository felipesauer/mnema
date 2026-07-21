/**
 * The decision transition table: the legal moves of the decision workflow, in
 * typed code.
 *
 * Each row is one legal move — a `from` state, an `action`, the `to` state it
 * reaches, and which proof fields that action must carry. This is the whole
 * workflow: fixed, opinionated, compiler-checked, never loaded from a project
 * file. It mirrors the task workflow's shape; the difference is which proof a
 * decision's moves require.
 *
 * The proof rule follows the same principle as tasks — a mandatory field is the
 * universal textual WHY of the move, nothing that presumes a tool:
 *   - `accept`/`reject` require a `note` (why this verdict);
 *   - `supersede` requires a `reason` (why it is being replaced) AND, separately
 *     from proof, the `by` id of the successor — but `by` is a relational id on
 *     the event, not a textual proof field, so it is enforced by the gate's
 *     supersede check, not listed in `requires`.
 *
 * `supersede` is legal from BOTH `proposed` and `accepted`: a decision can be
 * replaced whether it was merely on the table or already adopted. A `rejected`
 * decision is terminal — there is nothing to supersede — and a `superseded` one
 * cannot be superseded again (the successor is the live decision now).
 */

import type { TransitionFields } from '@mnema/chain';
import type { DecisionState } from './decision-states.js';

/** The proof fields the gate may require of a decision action. */
export type DecisionProofField = keyof TransitionFields;

/** The actions a user can request on a decision. */
export const DECISION_ACTIONS = ['accept', 'reject', 'supersede'] as const;

/** A decision workflow action. */
export type DecisionAction = (typeof DECISION_ACTIONS)[number];

/** One legal move: from a state, an action reaches a state, requiring proof. */
export interface DecisionTransition {
  readonly from: DecisionState;
  readonly action: DecisionAction;
  readonly to: DecisionState;
  /** Proof fields this action must carry; empty when it needs none. */
  readonly requires: readonly DecisionProofField[];
}

/**
 * Every legal decision transition. The birth (`from: null`, action `create`)
 * is deliberately NOT here: a decision is born through the chain's birth pair,
 * not requested through the gate.
 */
export const DECISION_TRANSITIONS: readonly DecisionTransition[] = [
  { from: 'proposed', action: 'accept', to: 'accepted', requires: ['note'] },
  { from: 'proposed', action: 'reject', to: 'rejected', requires: ['note'] },
  { from: 'proposed', action: 'supersede', to: 'superseded', requires: ['reason'] },
  { from: 'accepted', action: 'supersede', to: 'superseded', requires: ['reason'] },
];

/**
 * Finds the single legal transition for a (from, action) pair, or undefined if
 * no such move exists. At most one row per pair by construction; a duplicate
 * would be a coding error caught by the table's own test.
 */
export function findDecisionTransition(
  from: DecisionState,
  action: DecisionAction,
): DecisionTransition | undefined {
  return DECISION_TRANSITIONS.find((t) => t.from === from && t.action === action);
}
