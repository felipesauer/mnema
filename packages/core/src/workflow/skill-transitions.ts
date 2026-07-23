/**
 * The skill transition table: the legal moves of the skill workflow, in typed
 * code.
 *
 * Each row is one legal move — a `from` state, an `action`, the `to` state it
 * reaches, and which proof fields that action must carry. This is the whole
 * workflow: fixed, opinionated, compiler-checked, never loaded from a project
 * file. It mirrors the task workflow's shape (from/action/to/requires) and,
 * unlike the decision table, carries NO relational move: replacing one skill
 * with another is a `knowledge.linked`, not a transition here.
 *
 * The proof rule follows the same principle as tasks and decisions — a mandatory
 * field is the universal textual WHY of the move: a verdict (`review`, `adopt`,
 * `reject`) requires a `note`, and `deprecate` requires a `reason`.
 *
 * The shape of the machine:
 *   - `review` from `proposed` records that someone looked and commented;
 *   - `adopt` from `reviewed` makes it a live pattern;
 *   - `reject` is legal from BOTH `proposed` (dismissed without formal review)
 *     and `reviewed` (looked at and dismissed);
 *   - `deprecate` from `adopted` is the ONLY way out of `adopted` — a skill that
 *     was adopted is never rejected retroactively (that would rewrite history);
 *     `deprecated` is the honest "do not use anymore".
 *   - `rejected` and `deprecated` are terminal.
 */

import type { TransitionFields } from '@mnema/chain';
import type { SkillState } from './skill-states.js';

/** The proof fields the gate may require of a skill action. */
export type SkillProofField = keyof TransitionFields;

/** The actions a user can request on a skill. */
export const SKILL_ACTIONS = ['review', 'adopt', 'reject', 'deprecate'] as const;

/** A skill workflow action. */
export type SkillAction = (typeof SKILL_ACTIONS)[number];

/** One legal move: from a state, an action reaches a state, requiring proof. */
export interface SkillTransition {
  readonly from: SkillState;
  readonly action: SkillAction;
  readonly to: SkillState;
  /** Proof fields this action must carry; empty when it needs none. */
  readonly requires: readonly SkillProofField[];
}

/**
 * Every legal skill transition. The birth (`from: null`, action `create`) is
 * deliberately NOT here: a skill is born through the chain's birth pair, not
 * requested through the gate.
 */
export const SKILL_TRANSITIONS: readonly SkillTransition[] = [
  { from: 'proposed', action: 'review', to: 'reviewed', requires: ['note'] },
  { from: 'proposed', action: 'reject', to: 'rejected', requires: ['note'] },
  { from: 'reviewed', action: 'adopt', to: 'adopted', requires: ['note'] },
  { from: 'reviewed', action: 'reject', to: 'rejected', requires: ['note'] },
  { from: 'adopted', action: 'deprecate', to: 'deprecated', requires: ['reason'] },
];

/**
 * Finds the single legal transition for a (from, action) pair, or undefined if
 * no such move exists. At most one row per pair by construction; a duplicate
 * would be a coding error caught by the table's own test.
 */
export function findSkillTransition(
  from: SkillState,
  action: SkillAction,
): SkillTransition | undefined {
  return SKILL_TRANSITIONS.find((t) => t.from === from && t.action === action);
}
