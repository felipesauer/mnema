/**
 * The decision gate: the pure function that decides whether a requested
 * decision transition is authorized, and turns it into the fact to record.
 *
 * It mirrors the task gate — authority, then legality, then proof — and adds
 * the one thing a decision transition has that a task's does not: the `by` id
 * of a supersede. The gate is pure (no clock, no I/O, no chain), so it checks
 * everything decidable from its inputs alone:
 *   1. AUTHORITY — a human `who` authorized it, and `who` is not the executing
 *      agent `which`. Checked first: the identity invariant holds regardless of
 *      the move.
 *   2. LEGALITY — the (from, action) pair is a transition the workflow allows.
 *   3. PROOF — every field the action requires is present and non-empty.
 *   4. SUPERSEDE SHAPE — a `supersede` must name a `by` (the successor), and
 *      that `by` must not be the decision being superseded (a decision cannot
 *      supersede itself). Any non-supersede action must NOT carry a `by`.
 *
 * What the pure gate CANNOT judge — because it needs the event stream — is
 * whether `by` and the subject actually EXIST. That existence check lives in
 * the operation that has the chain, reported as UNKNOWN_BY / UNKNOWN_SUBJECT.
 * Splitting it this way keeps the gate pure and exhaustively testable while
 * still enforcing the whole rule at write time: the operation runs the pure
 * gate AND the existence check before it appends.
 *
 * The gate never throws: an invalid request comes back as a typed refusal, and
 * identities are compared in canonical form (trimmed, NFC-normalized — the same
 * form the chain will seal) so neither whitespace nor a decomposed lookalike
 * can defeat who != which.
 */

import type { TransitionFields } from '@mnema/chain';
import { canonicalIdentity } from '../identity/who.js';
import { type DecisionState, isDecisionState } from './decision-states.js';
import {
  DECISION_ACTIONS,
  type DecisionAction,
  type DecisionProofField,
  findDecisionTransition,
} from './decision-transitions.js';

/** The action that supersedes a decision — the only one that carries `by`. */
const SUPERSEDE: DecisionAction = 'supersede';

/** What the caller asks the decision gate to authorize. */
export interface DecisionGateRequest {
  /** The decision's current state (the `to` of its last transition). */
  readonly from: string;
  /** The action requested. */
  readonly action: string;
  /** The proof fields supplied with the request, if any. */
  readonly fields?: TransitionFields;
  /** The successor decision's id — required for `supersede`, forbidden otherwise. */
  readonly by?: string;
  /** The decision being acted on (its id) — needed to reject a self-supersede. */
  readonly subject: string;
  /** The human who authorized the move. Required. */
  readonly who: string;
  /** The agent that executed it, if one did. Must differ from `who`. */
  readonly which?: string;
}

/** The gate authorized the move: record a transition to `to`. */
export interface DecisionGateOk {
  readonly ok: true;
  /** The state the transition reaches, resolved from the table. */
  readonly to: DecisionState;
  /** The action, validated as a known workflow action. */
  readonly action: DecisionAction;
  /** The successor id to record — present only on a supersede. */
  readonly by?: string;
  /** The proof to record, containing exactly the fields that were supplied. */
  readonly fields?: TransitionFields;
}

/** Why the gate refused. Each code names a distinct, testable failure. */
export type DecisionGateErrorCode =
  /** `from` is not a state the workflow knows. */
  | 'UNKNOWN_STATE'
  /** `action` is not an action the workflow knows. */
  | 'UNKNOWN_ACTION'
  /** No legal transition exists for this (from, action) pair. */
  | 'ILLEGAL_TRANSITION'
  /** A required proof field is missing or empty. */
  | 'MISSING_PROOF'
  /** A `supersede` did not name the successor `by`. */
  | 'MISSING_BY'
  /** A `by` was supplied on an action that is not a supersede. */
  | 'UNEXPECTED_BY'
  /** The decision named itself as its own successor. */
  | 'SELF_SUPERSEDE'
  /** No human `who` authorized the move. */
  | 'MISSING_WHO'
  /** `who` and `which` are the same identity — an agent cannot self-authorize. */
  | 'WHO_IS_WHICH';

/** The gate refused: a typed reason and a human-readable message. */
export interface DecisionGateErr {
  readonly ok: false;
  readonly code: DecisionGateErrorCode;
  readonly message: string;
  /** For MISSING_PROOF, the field that was required and absent. */
  readonly field?: DecisionProofField;
}

/** The gate's verdict: authorized (with the fact to record) or refused. */
export type DecisionGateResult = DecisionGateOk | DecisionGateErr;

/**
 * Decides whether a requested decision transition is authorized. Pure: same
 * inputs, same verdict, always. Never throws — an invalid request is a typed
 * {@link DecisionGateErr}. Existence of `by`/subject is NOT judged here (it
 * needs the stream); the operation layer does that.
 */
export function decisionGate(request: DecisionGateRequest): DecisionGateResult {
  const who = canonicalIdentity(request.who);
  if (who === undefined) {
    return err('MISSING_WHO', 'a decision transition needs a human who authorized it');
  }
  if (request.which !== undefined) {
    const which = canonicalIdentity(request.which);
    if (which !== undefined && which === who) {
      return err(
        'WHO_IS_WHICH',
        'the authorizing human and the executing agent must be different identities',
      );
    }
  }

  if (!isDecisionState(request.from)) {
    return err('UNKNOWN_STATE', `"${request.from}" is not a decision state`);
  }
  if (!isDecisionAction(request.action)) {
    return err('UNKNOWN_ACTION', `"${request.action}" is not a decision action`);
  }

  const transition = findDecisionTransition(request.from as DecisionState, request.action);
  if (transition === undefined) {
    return err('ILLEGAL_TRANSITION', `cannot "${request.action}" a decision in ${request.from}`);
  }

  for (const field of transition.requires) {
    if (!hasProof(request.fields, field)) {
      return {
        ok: false,
        code: 'MISSING_PROOF',
        message: `"${request.action}" requires a non-empty "${field}"`,
        field,
      };
    }
  }

  // Supersede shape: `by` is mandatory on a supersede and forbidden elsewhere.
  // The successor is compared in canonical form so a whitespace/composition
  // variant of the subject cannot slip past the self-supersede check — the same
  // reasoning as who != which.
  const by = canonicalIdentity(request.by);
  if (request.action === SUPERSEDE) {
    if (by === undefined) {
      return err('MISSING_BY', 'a supersede must name the successor decision "by"');
    }
    const subject = canonicalIdentity(request.subject);
    if (subject !== undefined && by === subject) {
      return err('SELF_SUPERSEDE', 'a decision cannot supersede itself');
    }
  } else if (by !== undefined) {
    return err('UNEXPECTED_BY', `"${request.action}" does not take a successor "by"`);
  }

  const ok: Mutable<DecisionGateOk> = { ok: true, to: transition.to, action: request.action };
  if (request.action === SUPERSEDE && by !== undefined) ok.by = by;
  if (request.fields !== undefined) ok.fields = request.fields;
  return ok;
}

/** Local helper: build the readonly result through a mutable shape. */
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** True when `action` is one the workflow defines. */
function isDecisionAction(action: string): action is DecisionAction {
  return (DECISION_ACTIONS as readonly string[]).includes(action);
}

/**
 * True when a required proof field is present and non-empty. Only textual
 * fields are ever required, so a required field is always a non-empty string,
 * and whitespace is not proof.
 */
function hasProof(fields: TransitionFields | undefined, field: DecisionProofField): boolean {
  if (fields === undefined || fields === null || typeof fields !== 'object') return false;
  const value = fields[field];
  return typeof value === 'string' && value.trim().length > 0;
}

function err(code: DecisionGateErrorCode, message: string): DecisionGateErr {
  return { ok: false, code, message };
}
