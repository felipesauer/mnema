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
 *
 * THE CLOSE CARRIES ITS EXECUTOR TOO, and through the SAME check. It used to
 * carry none: `run.ended` was the one fact of a session with no `which` at all,
 * so a session opened for an agent was closed, in the record, by the person —
 * measured, on a run opened `for claude` and read back as the human's. That is
 * not a smaller version of the same field, it is the attribution being wrong: the
 * envelope's `which` is what every read credits a fact to, and a close is a fact.
 *
 * The close's agent lives on the ENVELOPE ONLY, and that is the difference from
 * the birth rather than an omission. `run.ended` has no payload field for it,
 * because the payload of a birth answers "who is this session FOR" — a property
 * of the run, true for its whole life — while the envelope answers "who did this"
 * about one event. A close is executed by whoever executed it, which need not be
 * the agent the session was opened for (a person closing a session a killed
 * process left open), so the two questions have two different answers and only
 * one of them is the close's to record.
 *
 * The check is {@link resolveExecutingAgent} at BOTH ends, not two checks that
 * agree. `who != which` is a rule of the record — nothing outside the agent
 * stands behind a fact it authorized for itself — so it cannot hold at the birth
 * and lapse at the close, and a second copy of it here is how the two forms come
 * to disagree about what counts as the same identity (the comparison runs on the
 * form that is STORED, which is the whole reason that function bundles screening,
 * canonicalizing and comparing).
 */

import { runEnded, runStarted } from '@mnema/chain';
import {
  type ContentTooLargeErr,
  type ScreenedWrite,
  screenContent,
  screened,
} from '../content/screen.js';
import { resolveExecutingAgent, type SelfAuthorizedErr } from '../identity/authority.js';
import { canonicalId, mintId } from '../identity/id.js';
import { oneLine } from '../one-line.js';
import { orderedEvents } from '../projections/order.js';
import { projectRuns } from '../projections/run.js';
import { appendEvent, type UnreadableEventErr } from './append.js';
import { systemClock } from './clock.js';
import { authorizingAnchor, ensureFounded } from './identity-operations.js';
import type { WriteContext } from './operations.js';

/** A run was opened: the `run.started` fact was appended. */
export interface StartRunOk extends ScreenedWrite {
  readonly ok: true;
  /** The new run's minted id (the event subject); the caller pins later work to it. */
  readonly id: string;
  /** The agent label AS RECORDED — screened, so an echo shows what landed. */
  readonly agent: string;
  /**
   * The goal AS RECORDED — screened, absent when none was stated. Reported for the
   * same reason the agent is: a caller that echoed the value it passed IN would
   * print a credential on the line above the one saying it had been replaced.
   */
  readonly goal?: string;
}

/** A run was closed: the `run.ended` fact was appended. */
export interface EndRunOk extends ScreenedWrite {
  readonly ok: true;
  /**
   * The agent AS RECORDED on the envelope — screened and canonical, absent when
   * the caller named nobody. Reported for the reason {@link StartRunOk.agent} is:
   * a caller that echoed the value it passed IN would print a credential on the
   * line above the one saying it had been replaced.
   */
  readonly agent?: string;
}

/** Opening a run was refused before touching the chain. */
export type StartRunError =
  /** A free-text field was over the size limit (see {@link screenContent}). */
  | ContentTooLargeErr
  /** A read would not have accepted the event (see {@link appendEvent}). */
  | UnreadableEventErr
  /**
   * The executing agent IS the authorizing anchor — an agent cannot open the
   * session that authorizes its own work.
   */
  | { readonly ok: false; readonly code: 'WHO_IS_WHICH'; readonly message: string };

/** Closing a run was refused before touching the chain. */
export type EndRunError =
  /** A free-text field was over the size limit (see {@link screenContent}). */
  | ContentTooLargeErr
  /** A read would not have accepted the event (see {@link appendEvent}). */
  | UnreadableEventErr
  /**
   * The closing agent IS the authorizing anchor — the same refusal the birth
   * earns, from the same function, because it is a rule of the record and not of
   * either verb.
   */
  | SelfAuthorizedErr
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
  /**
   * The agent CLOSING the session — the envelope's `which`, and the only place a
   * close records one (see the module doc: the birth's payload answers a different
   * question, and only the birth has one to answer).
   *
   * Named `which` and not `agent`, unlike {@link StartRunInput.agent}, because it
   * is the envelope slot the other eleven write operations take under that name
   * rather than a payload field, and the two names are what keep "who this session
   * is for" and "who did this one thing" from reading as one value.
   *
   * REQUIRED, which the other eleven `which` are not: there an omitted agent means
   * a person acted directly — legitimate, and most of what runs `mnema`. A run is
   * a delegation at both ends, and the surface that opens one already refuses to do
   * it unnamed, so a close that could be silent about its executor would be the one
   * half of the pair that reads differently. A value naming nobody still resolves
   * to no agent (the birth reads a blank the same way); requiring the field is what
   * makes the compiler ask every caller, present and future, rather than leaving
   * the question to whoever writes the next one.
   */
  readonly which: string;
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
  // The agent label and the goal are free text, so they are screened first. The
  // SCREENED agent is what goes on, both in the payload and (canonicalized) on the
  // envelope, so the two halves cannot end up carrying different strings.
  const text = screenContent({ agent: input.agent, goal: input.goal });
  if (!text.ok) return text;

  // `who` is derived from local material and the record, always a real anchor. The executing
  // agent — which the catalog carries in the payload — is also the envelope's
  // `which`, so it is checked against `who` in canonical form: an agent must not
  // be the anchor that authorizes its own session.
  const who = authorizingAnchor(ctx);
  const agent = resolveExecutingAgent(who, text.fields.agent);
  if (!agent.ok) return agent;
  const which = agent.which;

  // Minted here, not chosen by the caller (see mintId): derived from randomness
  // so two offline clones never mint the same run id, closing false-merge of
  // sessions at the root. Canonical by construction.
  const id = mintId();

  // Found this installation's anchor before the fact, so the session's signer is
  // a key valid for its anchor at verify. A no-op once founded.
  ensureFounded(ctx);
  const at = (ctx.clock ?? systemClock)();
  const appended = appendEvent(
    ctx.writer,
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
      {
        agent: text.fields.agent,
        ...(text.fields.goal !== undefined ? { goal: text.fields.goal } : {}),
      },
    ),
  );
  if (!appended.ok) return appended;
  // Both reports, merged like every other operation's — and the count is right
  // rather than doubled because the screen is idempotent: this agent name went
  // through it above, so the resolution found nothing left to take out. Merging
  // anyway is what keeps this operation the same shape as the others.
  return {
    ok: true,
    id,
    agent: text.fields.agent,
    ...(text.fields.goal !== undefined ? { goal: text.fields.goal } : {}),
    ...screened([...text.replaced, ...agent.replaced]),
  };
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
 *
 * The CLOSING agent is recorded as the envelope's `which`, resolved by the same
 * {@link resolveExecutingAgent} the birth uses and refused identically when it is
 * the authorizing anchor: a close an agent authorized for itself would put the
 * session's seal behind nothing but the agent's own word. It is resolved AFTER the
 * run is looked up, which is where every gated operation puts it — the existence
 * of the subject is not a question about authority, and an id that names no run
 * should hear so whoever is asking.
 */
export function endRun(ctx: WriteContext, input: EndRunInput): EndRunOk | EndRunError {
  const text = screenContent({ outcome: input.outcome });
  if (!text.ok) return text;

  // Key on the chain's canonical id form so the lookup matches the projection's
  // stored subject; a composition variant of the id cannot false-miss.
  const id = canonicalId(input.run);
  const runs = projectRuns(orderedEvents(ctx.layout, ctx.upcasters));
  const current = id === undefined ? undefined : runs.get(id);
  if (id === undefined || current === undefined) {
    return {
      ok: false,
      code: 'UNKNOWN_RUN',
      message: `run "${oneLine(input.run)}" does not exist`,
    };
  }
  if (!current.open) {
    return {
      ok: false,
      code: 'ALREADY_ENDED',
      message: `run "${oneLine(input.run)}" is already ended`,
    };
  }

  const who = authorizingAnchor(ctx);

  // The agent that is CLOSING, through the door the birth and the other eleven
  // writes go through — screened, canonicalized and compared in one call, so the
  // string checked against `who` is the string the envelope stores. Not screened
  // by the block above: unlike the birth's agent, this value reaches no payload,
  // so passing it through a second cleaner would be two doors on one field.
  const agent = resolveExecutingAgent(who, input.which);
  if (!agent.ok) return agent;
  const which = agent.which;

  // Found this installation's anchor before the fact, so the close is signed by
  // a key valid for its anchor at verify. A no-op once founded.
  ensureFounded(ctx);
  const at = (ctx.clock ?? systemClock)();
  const appended = appendEvent(
    ctx.writer,
    runEnded(
      {
        at,
        who,
        signerFp: ctx.writer.signerFingerprint,
        subject: id,
        // The agent that closed the session, in the uniform slot every other event
        // uses — so a read credits the close to whoever did it, the way it credits
        // every other fact. Omitted only if it does not canonicalize to an identity.
        ...(which !== undefined ? { which } : {}),
        // No `run` on the envelope: the subject already IS the run being closed.
      },
      { ...(text.fields.outcome !== undefined ? { outcome: text.fields.outcome } : {}) },
    ),
  );
  if (!appended.ok) return appended;
  // The agent AS RECORDED, and both reports merged — the screen above saw the
  // outcome, the resolution saw the agent, and a caller echoing either has to be
  // told what came out of it.
  return {
    ok: true,
    ...(which !== undefined ? { agent: which } : {}),
    ...screened([...text.replaced, ...agent.replaced]),
  };
}
