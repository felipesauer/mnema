/**
 * The transition table: the legal moves of the task workflow, in typed code.
 *
 * Each row is one legal move — a `from` state, an `action`, the `to` state it
 * reaches, and which proof fields that action must carry. This is the whole
 * workflow: fixed, opinionated, compiler-checked. It is not loaded from a
 * project file, so "what is a legal transition" can never be untrusted runtime
 * data — it is code that is read and reviewed like any other.
 *
 * `requires` names the proof fields (from the chain's `TransitionFields`) an
 * action must carry to be authorized. The principle: a mandatory field is the
 * universal textual WHY of the move, nothing that presumes a tool or is project
 * management. So cancel/block/reopen require a `reason`, complete/approve a
 * `note`, and request_changes a `feedback`; pr_url and links are always
 * optional (requiring a PR would break the local-first, no-git mode); assignee,
 * acceptance criteria, and estimates are not proof and are not here at all.
 */

import type { TransitionFields } from '@mnema/chain';
import type { TaskState } from './states.js';

/** The proof fields the gate may require of an action. */
export type ProofField = keyof TransitionFields;

/** The actions a user can request on a task. */
export const TASK_ACTIONS = [
  'submit',
  'start',
  'block',
  'unblock',
  'submit_review',
  'request_changes',
  'approve',
  'complete',
  'cancel',
  'reopen',
] as const;

/** A workflow action — one a caller can request to move a task. */
export type TaskAction = (typeof TASK_ACTIONS)[number];

/** One legal move: from a state, an action reaches a state, requiring proof. */
export interface Transition {
  readonly from: TaskState;
  readonly action: TaskAction;
  readonly to: TaskState;
  /** Proof fields this action must carry; empty when it needs none. */
  readonly requires: readonly ProofField[];
}

/**
 * Every legal transition. The birth of a task (`from: null`, action `create`)
 * is deliberately NOT here: a task is born through the chain's birth pair, not
 * requested through the gate, so `create` is never a user-requestable move.
 */
export const TRANSITIONS: readonly Transition[] = [
  { from: 'DRAFT', action: 'submit', to: 'READY', requires: [] },
  { from: 'DRAFT', action: 'cancel', to: 'CANCELED', requires: ['reason'] },
  { from: 'READY', action: 'start', to: 'IN_PROGRESS', requires: [] },
  { from: 'READY', action: 'cancel', to: 'CANCELED', requires: ['reason'] },
  { from: 'IN_PROGRESS', action: 'block', to: 'BLOCKED', requires: ['reason'] },
  { from: 'IN_PROGRESS', action: 'submit_review', to: 'IN_REVIEW', requires: [] },
  { from: 'IN_PROGRESS', action: 'complete', to: 'DONE', requires: ['note'] },
  { from: 'IN_PROGRESS', action: 'cancel', to: 'CANCELED', requires: ['reason'] },
  { from: 'BLOCKED', action: 'unblock', to: 'IN_PROGRESS', requires: [] },
  { from: 'IN_REVIEW', action: 'approve', to: 'DONE', requires: ['note'] },
  { from: 'IN_REVIEW', action: 'request_changes', to: 'IN_PROGRESS', requires: ['feedback'] },
  { from: 'DONE', action: 'reopen', to: 'IN_PROGRESS', requires: ['reason'] },
];

/**
 * Finds the single legal transition for a (from, action) pair, or undefined if
 * no such move exists. The table has at most one row per pair by construction;
 * a duplicate would be a coding error, caught by the table's own test.
 */
export function findTransition(from: TaskState, action: TaskAction): Transition | undefined {
  return TRANSITIONS.find((t) => t.from === from && t.action === action);
}
