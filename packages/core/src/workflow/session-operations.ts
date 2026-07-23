/**
 * The write operations for a run: opening a session and closing it. A run is
 * the session an agent works inside — the ROOT of authority for everything done
 * within it, because every event of the session carries the run's `who` as the
 * human who authorized the work. So these two operations are where that root is
 * established and sealed.
 *
 * Unlike a task or a skill, a run has NO workflow of states. It is not a machine
 * with legal moves to gate: it exists once its `run.started` is seen and is open
 * until its `run.ended` — a fact of presence, not a transition. The projection
 * ({@link projectRuns}) decides open-vs-closed; these operations never carry a
 * state table. So {@link startRun} runs the authority half of the gate (a human
 * `who`, never the executing agent) but no legality/proof half, and {@link
 * endRun} guards only that the run exists and is still open — never a transition
 * verdict.
 *
 * The disciplines the other write operations rely on still hold, because they
 * defend the proof, not a workflow:
 *   - `who` (the authorizing anchor) and `signerFp` (the signing key) come from
 *     the writer's own key, never supplied — a caller cannot forge who
 *     authorized a session by typing a name.
 *   - the run's id is MINTED by {@link startRun} (see {@link mintId}), never
 *     chosen by the caller, so two offline clones never mint the same run id and
 *     two unrelated sessions cannot false-merge when their chains are unioned.
 *   - the installation founds its anchor before its first fact, so the session's
 *     events are signed by a key valid for its anchor at verify.
 *
 * The `which` of a run lives in TWO places by design, and both are the same
 * agent. The catalog puts the executing agent in the payload (`agent`) because
 * the projection reads it as a first-class field; the envelope also carries it
 * as `which`, the uniform slot every other event uses for "the agent that
 * executed this" — so scope resolution and the read-model's actor attribution
 * see a run the same way they see every other fact. {@link startRun} derives one
 * from the other and validates who != which against it: an agent must not open
 * the session that authorizes its own work, or the whole session would inherit a
 * `who` the agent chose for itself.
 */

import { runEnded, runStarted } from '@mnema/chain';
import { canonicalId, mintId } from '../identity/id.js';
import { canonicalIdentity } from '../identity/who.js';
import { orderedEvents } from '../projections/order.js';
import { projectRuns } from '../projections/run.js';
import { systemClock } from './clock.js';
import { ensureFounded } from './identity-operations.js';
import type { WriteContext } from './operations.js';

/** A run was opened: the `run.started` fact was appended. */
export interface StartRunOk {
  readonly ok: true;
  /** The new run's minted id (the event subject); the caller pins later work to it. */
  readonly id: string;
}

/** A run was closed: the `run.ended` fact was appended. */
export interface EndRunOk {
  readonly ok: true;
}

/** Opening a run was refused before touching the chain. */
export type StartRunError =
  /**
   * The executing agent IS the authorizing anchor — an agent cannot open the
   * session that authorizes its own work.
   */
  { readonly ok: false; readonly code: 'WHO_IS_WHICH'; readonly message: string };

/** Closing a run was refused before touching the chain. */
export type EndRunError =
  /** No `run.started` for this id — there is no session to close. */
  | { readonly ok: false; readonly code: 'UNKNOWN_RUN'; readonly message: string }
  /** The run already has a `run.ended` — closing it again would be an orphan fact. */
  | { readonly ok: false; readonly code: 'ALREADY_ENDED'; readonly message: string };

/** What the caller asks to open a run. */
export interface StartRunInput {
  /** The agent this session is for (the `which` for the run's actions). */
  readonly agent: string;
  /** The stated goal of the session, if any. */
  readonly goal?: string;
}

/** What the caller asks to close a run. */
export interface EndRunInput {
  /** The id of the run to close (the run.started's minted subject). */
  readonly run: string;
  /** A short outcome note, if any. */
  readonly outcome?: string;
}

/**
 * Opens a run: mints its id, then appends the single `run.started` fact that is
 * the root of authority for the session. The id is minted here, never supplied
 * — the caller receives it back in {@link StartRunOk.id} and pins every later
 * event to it. `who` is the writer's anchor, derived from its key; the executing
 * `agent` is validated to not be that same identity (canonical form both sides),
 * because a session an agent authorized for itself would let the whole chain
 * inherit forged authorship. There is no gate beyond that authority check: a run
 * has no prior state to judge.
 */
export function startRun(ctx: WriteContext, input: StartRunInput): StartRunOk | StartRunError {
  // `who` is derived from the writer's key, always a real anchor. The executing
  // agent — which the catalog carries in the payload — is also the envelope's
  // `which`, so it is checked against `who` in canonical form: an agent must not
  // be the anchor that authorizes its own session.
  const who = ctx.writer.anchor;
  const which = canonicalIdentity(input.agent);
  if (which !== undefined && which === who) {
    return {
      ok: false,
      code: 'WHO_IS_WHICH',
      message: 'the authorizing human and the executing agent must be different identities',
    };
  }

  // Minted here, not chosen by the caller (see mintId): derived from randomness
  // so two offline clones never mint the same run id, closing false-merge of
  // sessions at the root. Canonical by construction.
  const id = mintId();

  // Found this installation's anchor before the fact, so the session's signer is
  // a key valid for its anchor at verify. A no-op once founded.
  ensureFounded(ctx);
  const at = (ctx.clock ?? systemClock)();
  ctx.writer.append(
    runStarted(
      {
        at,
        who,
        signerFp: ctx.writer.signerFingerprint,
        subject: id,
        // The same agent lives in the payload (`agent`) and, canonicalized, on
        // the envelope (`which`) — the uniform slot scope resolution and actor
        // attribution read; omitted from the envelope only if it does not
        // canonicalize to an identity (the payload still carries the raw agent).
        // No `run` on the envelope: this event IS the run's birth — its subject
        // is the run — so it belongs to no parent run.
        ...(which !== undefined ? { which } : {}),
      },
      { agent: input.agent, ...(input.goal !== undefined ? { goal: input.goal } : {}) },
    ),
  );
  return { ok: true, id };
}

/**
 * Closes a run: reads the run from the chain (never the cache) to confirm it
 * exists and is still open, then appends one `run.ended`. The subject is the
 * EXISTING run's id, not a fresh one — the run was born in {@link startRun}. A
 * close is refused (nothing written) when the run is unknown or already ended,
 * because a `run.ended` with no open run to match would be a permanent orphan or
 * duplicate on an append-only log. `who` is the writer's anchor, but the run's
 * authorizer stays the one recorded at start — the projection keeps the opener's
 * `who`, not the closer's.
 */
export function endRun(ctx: WriteContext, input: EndRunInput): EndRunOk | EndRunError {
  // Key on the chain's canonical id form so the lookup matches the projection's
  // stored subject; a composition variant of the id cannot false-miss.
  const id = canonicalId(input.run);
  const runs = projectRuns(orderedEvents(ctx.layout, ctx.upcasters));
  const current = id === undefined ? undefined : runs.get(id);
  if (id === undefined || current === undefined) {
    return { ok: false, code: 'UNKNOWN_RUN', message: `run "${input.run}" does not exist` };
  }
  if (!current.open) {
    return { ok: false, code: 'ALREADY_ENDED', message: `run "${input.run}" is already ended` };
  }

  const who = ctx.writer.anchor;

  // Found this installation's anchor before the fact, so the close is signed by
  // a key valid for its anchor at verify. A no-op once founded.
  ensureFounded(ctx);
  const at = (ctx.clock ?? systemClock)();
  ctx.writer.append(
    runEnded(
      {
        at,
        who,
        signerFp: ctx.writer.signerFingerprint,
        subject: id,
        // No `run` on the envelope: the subject already IS the run being closed.
      },
      { ...(input.outcome !== undefined ? { outcome: input.outcome } : {}) },
    ),
  );
  return { ok: true };
}
