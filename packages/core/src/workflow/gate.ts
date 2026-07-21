/**
 * The gate: the pure function that decides whether a requested task transition
 * is authorized, and turns it into the fact to record.
 *
 * This is where "what is a legal move" is enforced, once, at write time (a
 * projection later replays the fact without re-judging it). The gate is a pure
 * function of its inputs — no clock, no I/O, no chain — so it is exhaustively
 * testable and always agrees with itself. It answers one question: given the
 * task's current state and a requested action, may this move be recorded, and
 * if so, to which state and carrying which proof?
 *
 * It enforces three things, in the order it checks them:
 *   1. AUTHORITY — a human `who` authorized it, and `who` is not the agent
 *      `which` that executed it (a human authorizes; an agent executes; they
 *      are never the same identity). `which` may be absent — a human acting
 *      directly, with no agent — but when present it must differ from `who`.
 *      Checked first: the identity invariant holds regardless of the move, so a
 *      self-authorized illegal move reports the more fundamental fault.
 *   2. LEGALITY — the (from, action) pair is a transition the workflow allows.
 *   3. PROOF — every field the action requires is present and non-empty.
 *
 * On success it returns the resolved `to` state (taken from the table, never
 * from the caller) so the writer records the transition the workflow defines,
 * not one the caller asserts. On failure it returns a typed reason; the writer
 * emits nothing.
 *
 * The gate never throws: its declared inputs are strings, but a surface at the
 * untrusted boundary may forward junk, and an invalid request must come back as
 * a typed refusal, not an exception. Non-string identities are refused (not
 * crashed on), and identity comparison is whitespace-insensitive so a lookalike
 * spelling cannot defeat the who != which invariant. (It reads `fields` as
 * plain data; a surface is responsible for handing it a plain object, not one
 * with active getters.)
 */

import type { TransitionFields } from '@mnema/chain';
import { canonicalIdentity } from '../identity/who.js';
import { isTaskState, type TaskState } from './states.js';
import { findTransition, type ProofField, TASK_ACTIONS, type TaskAction } from './transitions.js';

/** What the caller asks the gate to authorize. */
export interface GateRequest {
  /** The task's current state (the `to` of its last transition). */
  readonly from: string;
  /** The action requested. */
  readonly action: string;
  /** The proof fields supplied with the request, if any. */
  readonly fields?: TransitionFields;
  /** The human who authorized the move. Required. */
  readonly who: string;
  /** The agent that executed it, if one did. Must differ from `who`. */
  readonly which?: string;
}

/** The gate authorized the move: record a transition to `to` with `fields`. */
export interface GateOk {
  readonly ok: true;
  /** The state the transition reaches, resolved from the table. */
  readonly to: TaskState;
  /** The action, validated as a known workflow action. */
  readonly action: TaskAction;
  /** The proof to record, containing exactly the fields that were supplied. */
  readonly fields?: TransitionFields;
}

/** Why the gate refused. Each code names a distinct, testable failure. */
export type GateErrorCode =
  /** `from` is not a state the workflow knows. */
  | 'UNKNOWN_STATE'
  /** `action` is not an action the workflow knows. */
  | 'UNKNOWN_ACTION'
  /** No legal transition exists for this (from, action) pair. */
  | 'ILLEGAL_TRANSITION'
  /** A required proof field is missing or empty. */
  | 'MISSING_PROOF'
  /** No human `who` authorized the move. */
  | 'MISSING_WHO'
  /** `who` and `which` are the same identity — an agent cannot self-authorize. */
  | 'WHO_IS_WHICH';

/** The gate refused: a typed reason and a human-readable message. */
export interface GateErr {
  readonly ok: false;
  readonly code: GateErrorCode;
  readonly message: string;
  /** For MISSING_PROOF, the field that was required and absent. */
  readonly field?: ProofField;
}

/** The gate's verdict: authorized (with the fact to record) or refused. */
export type GateResult = GateOk | GateErr;

/**
 * Decides whether a requested transition is authorized. Pure: same inputs, same
 * verdict, always. Never throws — an invalid request is a typed {@link GateErr},
 * not an exception, so a surface handles refusal as data.
 */
export function gate(request: GateRequest): GateResult {
  // AUTHORITY first for the identity invariant that holds regardless of the
  // move: a fact with no human behind it, or one an agent authorized for
  // itself, is never valid — checked before legality so the reason is precise.
  // Identity is normalized (a real string, trimmed): a non-string or
  // whitespace-only `who` is no human, and a `which` that differs from `who`
  // only by whitespace must not slip past the self-authorization check.
  const who = canonicalIdentity(request.who);
  if (who === undefined) {
    return err('MISSING_WHO', 'a transition needs a human who authorized it');
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

  if (!isTaskState(request.from)) {
    return err('UNKNOWN_STATE', `"${request.from}" is not a workflow state`);
  }
  if (!isTaskAction(request.action)) {
    return err('UNKNOWN_ACTION', `"${request.action}" is not a workflow action`);
  }

  const transition = findTransition(request.from as TaskState, request.action);
  if (transition === undefined) {
    return err('ILLEGAL_TRANSITION', `cannot "${request.action}" a task in ${request.from}`);
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

  return request.fields !== undefined
    ? { ok: true, to: transition.to, action: request.action, fields: request.fields }
    : { ok: true, to: transition.to, action: request.action };
}

/** True when `action` is one the workflow defines. */
function isTaskAction(action: string): action is TaskAction {
  return (TASK_ACTIONS as readonly string[]).includes(action);
}

/**
 * True when a required proof field is present and non-empty. Only the textual
 * fields are ever required (`links` is never a requirement), so a required
 * field is always a non-empty string — and whitespace is not proof, so a
 * blank-but-present value does not satisfy the requirement.
 */
function hasProof(fields: TransitionFields | undefined, field: ProofField): boolean {
  if (fields === undefined || fields === null || typeof fields !== 'object') return false;
  const value = fields[field];
  return typeof value === 'string' && value.trim().length > 0;
}

function err(code: GateErrorCode, message: string): GateErr {
  return { ok: false, code, message };
}
