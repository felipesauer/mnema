/**
 * The skill gate: the pure function that decides whether a requested skill
 * transition is authorized, and turns it into the fact to record.
 *
 * It mirrors the TASK gate — authority, then legality, then proof — and NOT the
 * decision gate: a skill is not relational, so there is no `by` to shape-check.
 * That is the whole difference. The gate is pure (no clock, no I/O, no chain),
 * so it checks everything decidable from its inputs alone:
 *   1. AUTHORITY — a human `who` authorized it, and `who` is not the executing
 *      agent `which`. Checked first: the identity invariant holds regardless of
 *      the move, so a self-authorized illegal move reports the more fundamental
 *      fault.
 *   2. LEGALITY — the (from, action) pair is a transition the workflow allows.
 *   3. PROOF — every field the action requires is present and non-empty.
 *
 * On success it returns the resolved `to` state (taken from the table, never
 * from the caller) so the writer records the transition the workflow defines.
 * On failure it returns a typed reason; the writer emits nothing.
 *
 * The gate never throws: its declared inputs are strings, but a surface at the
 * untrusted boundary may forward junk, so an invalid request comes back as a
 * typed refusal. Identities are compared in canonical form (trimmed, NFC — the
 * form the chain seals) so neither whitespace nor a decomposed lookalike can
 * defeat the who != which invariant.
 */

import type { TransitionFields } from '@mnema/chain';
import { canonicalIdentity } from '../identity/who.js';
import { isSkillState, type SkillState } from './skill-states.js';
import {
  findSkillTransition,
  SKILL_ACTIONS,
  type SkillAction,
  type SkillProofField,
} from './skill-transitions.js';

/** What the caller asks the skill gate to authorize. */
export interface SkillGateRequest {
  /** The skill's current state (the `to` of its last transition). */
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
export interface SkillGateOk {
  readonly ok: true;
  /** The state the transition reaches, resolved from the table. */
  readonly to: SkillState;
  /** The action, validated as a known workflow action. */
  readonly action: SkillAction;
  /** The proof to record, containing exactly the fields that were supplied. */
  readonly fields?: TransitionFields;
}

/** Why the gate refused. Each code names a distinct, testable failure. */
export type SkillGateErrorCode =
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
export interface SkillGateErr {
  readonly ok: false;
  readonly code: SkillGateErrorCode;
  readonly message: string;
  /** For MISSING_PROOF, the field that was required and absent. */
  readonly field?: SkillProofField;
}

/** The gate's verdict: authorized (with the fact to record) or refused. */
export type SkillGateResult = SkillGateOk | SkillGateErr;

/**
 * Decides whether a requested skill transition is authorized. Pure: same inputs,
 * same verdict, always. Never throws — an invalid request is a typed
 * {@link SkillGateErr}, not an exception, so a surface handles refusal as data.
 */
export function skillGate(request: SkillGateRequest): SkillGateResult {
  // AUTHORITY first for the identity invariant that holds regardless of the
  // move: a fact with no human behind it, or one an agent authorized for
  // itself, is never valid. Identity is taken in canonical form (trimmed,
  // NFC-normalized) so a non-string or whitespace-only `who` is no human, and a
  // `which` differing from `who` only by whitespace or composition cannot slip
  // past the self-authorization check.
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

  if (!isSkillState(request.from)) {
    return err('UNKNOWN_STATE', `"${request.from}" is not a skill state`);
  }
  if (!isSkillAction(request.action)) {
    return err('UNKNOWN_ACTION', `"${request.action}" is not a skill action`);
  }

  const transition = findSkillTransition(request.from as SkillState, request.action);
  if (transition === undefined) {
    return err('ILLEGAL_TRANSITION', `cannot "${request.action}" a skill in ${request.from}`);
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
function isSkillAction(action: string): action is SkillAction {
  return (SKILL_ACTIONS as readonly string[]).includes(action);
}

/**
 * True when a required proof field is present and non-empty. Only textual fields
 * are ever required, so a required field is always a non-empty string, and
 * whitespace is not proof.
 */
function hasProof(fields: TransitionFields | undefined, field: SkillProofField): boolean {
  if (fields === undefined || fields === null || typeof fields !== 'object') return false;
  const value = fields[field];
  return typeof value === 'string' && value.trim().length > 0;
}

function err(code: SkillGateErrorCode, message: string): SkillGateErr {
  return { ok: false, code, message };
}
