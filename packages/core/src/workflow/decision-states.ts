/**
 * The decision workflow's states, fixed in typed code.
 *
 * Like the task workflow, this is the product's one opinion about how a
 * decision moves — not data loaded from a project file. The states are part of
 * the format (`WORKFLOWS` in `@mnema/chain`, FORMAT.md §6.7), because every
 * reader judges a move by them; this module takes them from there and only
 * NAMES them for the domain. The legal moves live in the transition table.
 *
 * A decision is proposed, then accepted or rejected, and an accepted (or still
 * proposed) decision may be superseded by a later one. There is no reopening: a
 * superseded decision stays superseded, and the record of what replaced it is
 * the successor, not a mutation of the old one — the chain is append-only, so
 * "changing your mind" is a new decision that supersedes, never an edit.
 */

import { WORKFLOWS } from '@mnema/chain';

/** The four states a decision can be in. */
export const DECISION_STATES = WORKFLOWS['decision.transitioned'].states;

/** A decision's state — one of the four, as a literal string. */
export type DecisionState = (typeof DECISION_STATES)[number];

/** The state every decision is born into. */
export const INITIAL_DECISION_STATE: DecisionState = WORKFLOWS['decision.transitioned'].birth.to;

/** True when `value` is one of the workflow's states. */
export function isDecisionState(value: string): value is DecisionState {
  return (DECISION_STATES as readonly string[]).includes(value);
}
