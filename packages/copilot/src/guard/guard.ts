/**
 * guard: the workflow gate asked as a QUESTION — "may I do this?" — never as a
 * write.
 *
 * The core's {@link gate} is already a pure function that decides whether a
 * transition is authorized and returns a typed verdict. guard exposes that
 * verdict as a read-only CONSULTATION from the copilot layer: a caller asks
 * "would this move be allowed, and if not, why?" and gets the answer back as
 * data, having written nothing. It is deliberately a thin pass-through — the
 * whole point is that the authorization rule lives in ONE place (the gate), and
 * the copilot never re-implements or relaxes it.
 *
 * WHAT THIS IS NOT. This is not a guard that INTERCEPTS an action before it
 * happens — that belongs to the surface, where there is an actual action to
 * stop. Here there is no action, only a question; guard reaches no writer and
 * changes no state. It answers, and that is all.
 *
 * The verdict type is the gate's own ({@link GateResult}) — no new type — so
 * "what guard says" and "what a write would do" can never drift.
 */

import { type GateRequest, type GateResult, gate, type ProjectionCache } from '@mnema/core';
import { type Focus, focus } from '../context/focus.js';

/**
 * Asks the gate whether a move would be authorized, and returns its verdict
 * unchanged. Read-only: it calls the pure gate and writes nothing. A legal move
 * comes back `{ ok: true, to, ... }`; an illegal or unauthorized one comes back
 * `{ ok: false, code, message }` with the gate's typed reason — including the
 * `who === which` refusal, the identity invariant the gate exists to hold.
 */
export function guard(request: GateRequest): GateResult {
  return gate(request);
}

/** A guard verdict paired with the asker's current focus. */
export interface GuardWithFocus {
  /** The gate's verdict for the requested move. */
  readonly verdict: GateResult;
  /** The asker's focus at the time of the question (their open runs). */
  readonly focus: Focus;
}

/**
 * The same verdict, plus the asker's current focus — "you may (or may not) do
 * this, and here is what you are in the middle of". Composes {@link guard} with
 * {@link focus} so a caller gets the decision and the context in one read. Still
 * read-only: two pure reads, no write. The `who` of the request is taken as the
 * actor whose focus to attach.
 */
export function guardWithFocus(cache: ProjectionCache, request: GateRequest): GuardWithFocus {
  return { verdict: guard(request), focus: focus(cache, { actor: request.who }) };
}
