/**
 * The gated write operations for decisions: the only way the core records a
 * decision or moves one, and the seam every surface goes through.
 *
 * They mirror the task operations (read current state from the chain, never
 * the cache; run the gate, append only if authorized) with two things unique
 * to a decision:
 *
 *   1. THE FROZEN ADR LABEL. `recordDecision` derives the citable `ADR-<n>`
 *      from how many decisions the writer's local view already holds, and
 *      FREEZES it into the `decision.recorded` event. The number is computed at
 *      write time and never re-derived on read: a number derived on read would
 *      slip when a concurrent decision merges ahead of it, silently
 *      re-pointing a citation. Two clones may mint the same label offline; that
 *      is a label collision (the ids stay unique), detected by the projection,
 *      not prevented here. Two sessions of ONE installation could mint it too
 * (     every time, measured: 10 of 10 concurrent pairs), because the count was
 *      read outside the tail's lock; it is checked under it now
 *      ({@link onTheRecordAsItStands}), so those number in sequence.
 *
 *   2. THE SUPERSEDE EXISTENCE CHECK. The pure gate judges the supersede's
 *      SHAPE (a `by` is present and is not the subject); whether the subject
 *      and `by` actually EXIST needs the event stream, so it is checked here,
 *      against the same projected decisions the state is read from. A supersede
 *      naming a `by` with no record is refused (UNKNOWN_BY), the anti-dangling
 *      rule, as is one whose subject does not exist (UNKNOWN_SUBJECT).
 */

import {
  type ChainLayout,
  type ChainWriter,
  decisionBirth,
  decisionTransitioned,
  type Entry,
  type TransitionFields,
  type UpcasterRegistry,
} from '@mnema/chain';
import {
  type ScreenedWrite,
  type ScreenRefusal,
  screenContent,
  screened,
} from '../content/screen.js';
import { resolveExecutingAgent } from '../identity/authority.js';
import { canonicalId, mintId } from '../identity/id.js';
import { oneLine } from '../one-line.js';
import { projectDecisions } from '../projections/decision.js';
import { type AppendRefusal, appendFact, appendFacts } from './append.js';
import {
  type Judged,
  onTheRecordAsItStands,
  type StateMovedErr,
  stateMoved,
} from './as-the-record-stands.js';
import type { Clock } from './clock.js';
import { type DecisionGateErr, decisionGate } from './decision-gate.js';
import { INITIAL_DECISION_STATE, isDecisionState } from './decision-states.js';
import { findDecisionTransition } from './decision-transitions.js';
import { authorizingAnchor } from './identity-operations.js';
import { asTheChainIs, standing } from './read-the-record.js';

/** Shared dependencies for a write: where to read state from and where to append. */
export interface DecisionWriteContext {
  readonly writer: ChainWriter;
  readonly layout: ChainLayout;
  readonly upcasters: UpcasterRegistry;
  /** The clock that stamps `at`; defaults to the wall clock. */
  readonly clock?: Clock;
}

/** A write refused before touching the chain. */
export type DecisionWriteError =
  | DecisionGateErr
  /** A free-text field was over the size limit (see {@link screenContent}). */
  | ScreenRefusal
  /** A read would not have accepted the event (see {@link appendFact}). */
  | AppendRefusal
  /**
   * The decision acted on does not exist (no `decision.recorded` for this id).
   * This is the subject-existence check for every transition, supersede
   * included: the subject of a supersede is the decision being superseded.
   */
  | { readonly ok: false; readonly code: 'UNKNOWN_DECISION'; readonly message: string }
  /** A supersede named a successor `by` that does not exist (a dangling link). */
  | { readonly ok: false; readonly code: 'UNKNOWN_BY'; readonly message: string }
  /** Another write moved the decision between the reading this move was judged on and its append. */
  | StateMovedErr
  /** What the caller's own precondition refused ({@link DecisionTransitionInput.refusedWhen}). */
  | { readonly ok: false; readonly code: string; readonly message: string };

/** A decision was recorded: both birth events were appended, in order. */
export interface RecordOk extends ScreenedWrite {
  readonly ok: true;
  /** The new decision's id (the event subject). */
  readonly id: string;
  /** The citable label frozen into the record. */
  readonly adr: string;
  /** The `decision.recorded` then the birth `decision.transitioned`, as appended. */
  readonly entries: readonly [Entry, Entry];
}

/** A decision transition was authorized and appended. */
export interface DecisionTransitionOk extends ScreenedWrite {
  readonly ok: true;
  /** The state the decision is now in. */
  readonly to: string;
  /** The appended chain entry. */
  readonly entry: Entry;
}

/** What the caller asks to record. */
export interface RecordInput {
  readonly title: string;
  readonly rationale: string;
  /**
   * What was considered and turned down, and why not: the other half of the why.
   * Optional: many decisions had no contender. Absent when there is none, never
   * empty; an empty string reaches the append door as an unreadable event, the
   * same refusal any other blank text field earns.
   */
  readonly alternatives?: string;
  /** The agent that executed it, if any. `who` is derived from the writer's key. */
  readonly which?: string;
  /** The run this belongs to, if any. */
  readonly run?: string;
}

/**
 * The same decision was already on the record: nothing was written, and this names the one that is.
 * A `record_decision` repeated after a reply that never arrived lands here, not as a second
 * decision with another id and another `ADR-<n>`.
 */
export interface RecordedAlready extends ScreenedWrite {
  readonly ok: true;
  readonly already: true;
  /** The id of the decision already recorded. */
  readonly id: string;
  /** Its `ADR-<n>` label. */
  readonly adr: string;
}

/** What the caller asks for a plain (non-supersede) transition. */
export interface DecisionTransitionInput {
  /** The decision to move (the event subject). */
  readonly id: string;
  /** Proof and context for the move. */
  readonly fields?: TransitionFields;
  /** The agent that executed it, if any. `who` is derived from the writer's key. */
  readonly which?: string;
  /** The run this belongs to, if any. */
  readonly run?: string;
  /**
   * A precondition of the CALLER'S, asked inside the judgement (at the first reading and, when
   * the chain moved, again at the second, under the tail's lock) and refused with what it
   * returns. It is how a rule the surface owns (a switch an agent's acceptance depends on) is
   * judged against the record as it stands when the move lands, where asking it before the call
   * left a window in which the switch could be turned off after the answer and before the append.
   * It is asked first, so its refusal wins over the gate's, as it did when it was asked ahead of
   * the call.
   */
  readonly refusedWhen?: () => { readonly code: string; readonly message: string } | undefined;
}

/** What the caller asks to supersede: the subject plus its successor `by`. */
export interface SupersedeInput extends DecisionTransitionInput {
  /** The successor decision's id. */
  readonly by: string;
}

/**
 * Whether a decision in `state` is still on the record as one to act on: the states a supersede is
 * legal from are exactly the proposed and the accepted, so the table the gate reads says it and no
 * list of states is kept here.
 */
function isInForceOrProposed(state: string): boolean {
  return isDecisionState(state) && findDecisionTransition(state, 'supersede') !== undefined;
}

/**
 * Records a new decision: mints its id, derives the frozen `ADR-<n>` label from
 * the current decision count, then appends the birth pair (`decision.recorded`
 * then the birth `decision.transitioned`, `from: null` → proposed) atomically.
 * The id is minted by the operation, never supplied (see {@link mintId}); the
 * `ADR-<n>` label is separate: a human-citable rubric layered OVER the id, not
 * the identity, so it stays caller-independent and frozen at write time. Birth
 * is not a gated transition, but it still requires a human `who` who is not the
 * executing agent: the same authority invariant the gate enforces.
 */
export function recordDecision(
  ctx: DecisionWriteContext,
  input: RecordInput,
): RecordOk | RecordedAlready | DecisionWriteError {
  // The title, the rationale and the alternatives in ONE screen: a decision's
  // prose is the longest text this domain records, and the likeliest place a
  // connection string is pasted as evidence of what was decided. The alternatives
  // go in the same call rather than a second one: `screenContent` leaves an absent
  // field absent, so passing it unconditionally costs nothing when there is none,
  // and a second screen would be a second place to forget.
  //
  // The pinned run joins them for a different reason: it is not payload at all, it
  // is the envelope's second caller-supplied field, and nothing in this package
  // proves it names a session, so it goes through the door beside the prose rather
  // than around it.
  const text = screenContent({
    title: input.title,
    rationale: input.rationale,
    alternatives: input.alternatives,
    run: input.run,
  });
  if (!text.ok) return text;

  // `who` is derived from local material and the record, always a real anchor;
  // the only authority check left is that the executing agent is not that identity.
  const who = authorizingAnchor(ctx);
  const agent = resolveExecutingAgent(who, input.which);
  if (!agent.ok) return agent;
  const which = agent.which;

  // The id is minted here, not chosen by the caller: derived from randomness so
  // two offline clones never mint the same one. That is what dissolves the
  // reused-id case entirely: a caller cannot ask to record an id that already
  // exists, so there is no duplicate to refuse. It is canonical by construction.
  const id = mintId();

  // Derive the citable label from the writer's local view and FREEZE it. The count is
  // read from the projection the tree keeps, brought forward to the chain as it stands
  // at that moment ({@link asTheChainIs}): THIS SAID IT WAS READ "FROM THE CHAIN, not the
  // cache", and the premise was that the only way to be current was to replay the whole
  // record, which cost about 1 s at 100 thousand events and held the lock for as long when
  // it had to be read again under it. A cache brought forward over what arrived is the
  // chain as it stands, unless somebody edited it, and costs the arrivals, which is enough for a
  // label and not for a gate: a count edited by hand repeats a label, and a repeated label is a
  // collision the reader already names, while what a MOVE is judged on is read off the chain
  // ({@link standing}). Unlike
  // the id, the label can collide between offline clones (both mint `ADR-7`);
  // that is a legibility clash the projection surfaces, never a merge (the ids
  // stay distinct). Between two sessions of this installation it cannot: the count
  // the label is minted from is the one the tail's lock vouches for.
  //
  // THE SAME DECISION TWICE. A decision whose title, rationale and alternatives are the ones
  // being recorded, and that is still `proposed` or `accepted`, is the decision already on the
  // record: a call repeated after a reply that never arrived. It is looked for in the SCREENED
  // text (what a write stores, so a secret replaced the first time is replaced again and the two
  // compare equal) against the projection's text for the decision (which is the text of its first
  // writing, never a later one), and it is asked inside the judgement, so the second reading
  // under the lock sees a twin another session wrote meanwhile. A rejected or superseded
  // decision is not a twin: the same words recorded again are a new proposal.
  return onTheRecordAsItStands(
    ctx,
    () =>
      asTheChainIs(ctx, (cache) => ({
        size: cache.countDecisions(),
        twin: cache
          .decisionsTitled(text.fields.title)
          .find(
            (held) =>
              isInForceOrProposed(held.state) &&
              held.rationale === text.fields.rationale &&
              held.alternatives === text.fields.alternatives,
          ),
      })),
    (decisions) =>
      decisions.twin !== undefined
        ? {
            refuse: {
              ok: true,
              already: true,
              id: decisions.twin.id,
              adr: decisions.twin.adr,
              ...screened([...text.replaced, ...agent.replaced]),
            },
          }
        : {
            write: (): RecordOk | RecordedAlready | DecisionWriteError => {
              const adr = `ADR-${decisions.size + 1}`;
              // The door asks the birth pair first, then founds this installation's anchor, so both
              // events' signer is a key valid for its anchor at verify (see `appendFact`).
              const appended = appendFacts(ctx, ({ at }) =>
                decisionBirth(
                  {
                    at,
                    who,
                    signerFp: ctx.writer.signerFingerprint,
                    subject: id,
                    ...(which !== undefined ? { which } : {}),
                    ...(text.fields.run !== undefined ? { run: text.fields.run } : {}),
                  },
                  {
                    title: text.fields.title,
                    rationale: text.fields.rationale,
                    adr,
                    initial: INITIAL_DECISION_STATE,
                    // The SCREENED value, and omitted when the caller gave none: absence in,
                    // absence out, so a decision with no alternative records no key for one.
                    ...(text.fields.alternatives !== undefined
                      ? { alternatives: text.fields.alternatives }
                      : {}),
                  },
                ),
              );
              if (!appended.ok) return appended;
              const [e1, e2] = appended.entries as [Entry, Entry];
              return {
                ok: true,
                id,
                adr,
                entries: [e1, e2],
                ...screened([...text.replaced, ...agent.replaced]),
              };
            },
          },
  );
}

/** Accepts a proposed decision (requires a note). */
export function acceptDecision(
  ctx: DecisionWriteContext,
  input: DecisionTransitionInput,
): DecisionTransitionOk | DecisionWriteError {
  return transition(ctx, 'accept', input);
}

/** Rejects a proposed decision (requires a note). */
export function rejectDecision(
  ctx: DecisionWriteContext,
  input: DecisionTransitionInput,
): DecisionTransitionOk | DecisionWriteError {
  return transition(ctx, 'reject', input);
}

/**
 * Supersedes a decision with a later one. Beyond the gate's shape check (a `by`
 * that is present and not the subject), this verifies the successor `by` EXISTS:
 * a supersede that named a decision with no record would leave a dangling
 * link, which the anti-dangling rule forbids. The subject's existence is the
 * usual UNKNOWN_DECISION path.
 */
export function supersedeDecision(
  ctx: DecisionWriteContext,
  input: SupersedeInput,
): DecisionTransitionOk | DecisionWriteError {
  return transition(ctx, 'supersede', input, input.by);
}

/**
 * The shared transition path: read the current state from the chain, run the
 * gate, and for a supersede also verify the successor exists, then append only
 * if everything passed, under the tail's lock, against the state the record is
 * in at that moment ({@link onTheRecordAsItStands}). `to`, `action`, and the recorded `by` all come from the
 * gate's verdict, never from the caller's assertion.
 *
 * The proof is screened ahead of the gate for the reason the task's is: the gate
 * forwards its verdict's `fields` into the appended event, so anything screened
 * afterwards would be screened too late.
 */
function transition(
  ctx: DecisionWriteContext,
  action: 'accept' | 'reject' | 'supersede',
  input: DecisionTransitionInput,
  by?: string,
): DecisionTransitionOk | DecisionWriteError {
  const proof =
    input.fields === undefined ? undefined : screenContent<TransitionFields>(input.fields);
  if (proof !== undefined && !proof.ok) return proof;

  // The pinned run through the same door, in its own call because the proof's is
  // conditional and a move with no proof still carries a run.
  const pinned = screenContent({ run: input.run });
  if (!pinned.ok) return pinned;

  // Canonicalize the subject id (NFC, the chain's stored form) so the lookup
  // keys on the same string the projection does.
  const id = canonicalId(input.id);
  const successor = by === undefined ? undefined : canonicalId(by);
  return onTheRecordAsItStands(
    ctx,
    () => standing(ctx, [id, successor], projectDecisions),
    (decisions, earlier): Judged<DecisionTransitionOk | DecisionWriteError> => {
      const vetoed = input.refusedWhen?.();
      if (vetoed !== undefined) return { refuse: { ok: false, ...vetoed } };
      const current = id === undefined ? undefined : decisions.get(id);
      if (id === undefined || current === undefined) {
        return {
          refuse: {
            ok: false,
            code: 'UNKNOWN_DECISION',
            message: `decision "${oneLine(input.id)}" does not exist`,
          },
        };
      }

      // Judged again under the tail's lock because something landed since the first
      // reading: if it was THIS decision that moved, the move the caller asked for was
      // asked of a state it is no longer in, and that is what they are told, not the
      // gate's verdict on a state they never saw.
      const was = earlier?.get(id)?.state;
      if (was !== undefined && was !== current.state) {
        return { refuse: stateMoved('decision', id, action, was, current.state) };
      }

      // `who` is this installation's authorizing anchor, never supplied.
      const who = authorizingAnchor(ctx);

      // Resolved before the gate, and the RESOLVED value is both what the gate judges
      // and what the envelope records: `which` is free text and goes through the same
      // door as the proof, so screening it and then recording something else would be
      // the very mismatch the resolution exists to prevent.
      const agent = resolveExecutingAgent(who, input.which);
      if (!agent.ok) return { refuse: agent };
      const which = agent.which;

      const verdict = decisionGate({
        from: current.state,
        action,
        ...(proof !== undefined ? { fields: proof.fields } : {}),
        ...(by !== undefined ? { by } : {}),
        subject: id,
        who,
        ...(which !== undefined ? { which } : {}),
      });
      if (!verdict.ok) return { refuse: verdict };

      // Existence of the successor is a stream fact the pure gate cannot see. Check
      // it against the SAME projected view the state came from. `verdict.by` is in
      // the chain's canonical id form, so the lookup key matches both the
      // successor's own record subject and the `by` this event will record: no
      // composition variant can split them.
      if (verdict.action === 'supersede' && verdict.by !== undefined) {
        if (!decisions.has(verdict.by)) {
          return {
            refuse: {
              ok: false,
              code: 'UNKNOWN_BY',
              message: `supersede names a successor "${oneLine(verdict.by)}" that does not exist`,
            },
          };
        }
      }

      return {
        write: () => {
          // The door asks the fact first, then founds this installation's anchor, so the
          // transition's signer is a key valid for its anchor at verify (see `appendFact`).
          const appended = appendFact(ctx, ({ at }) =>
            decisionTransitioned(
              {
                at,
                who,
                signerFp: ctx.writer.signerFingerprint,
                subject: id,
                ...(which !== undefined ? { which } : {}),
                ...(pinned.fields.run !== undefined ? { run: pinned.fields.run } : {}),
              },
              {
                from: current.state,
                to: verdict.to,
                action: verdict.action,
                ...(verdict.by !== undefined ? { by: verdict.by } : {}),
                ...(verdict.fields !== undefined ? { fields: verdict.fields } : {}),
              },
            ),
          );
          if (!appended.ok) return appended;
          return {
            ok: true,
            to: verdict.to,
            entry: appended.entry,
            ...screened([...(proof?.replaced ?? []), ...pinned.replaced, ...agent.replaced]),
          };
        },
      };
    },
  );
}
