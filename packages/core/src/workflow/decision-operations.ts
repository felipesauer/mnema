/**
 * The gated write operations for decisions: the only way the core records a
 * decision or moves one, and the seam every surface goes through.
 *
 * They mirror the task operations — read current state from the chain (never
 * the cache), run the gate, append only if authorized — with two things unique
 * to a decision:
 *
 *   1. THE FROZEN ADR LABEL. `recordDecision` derives the citable `ADR-<n>`
 *      from how many decisions the writer's local view already holds, and
 *      FREEZES it into the `decision.recorded` event. The number is computed at
 *      write time and never re-derived on read: a number derived on read would
 *      slip when a concurrent decision merges ahead of it, silently
 *      re-pointing a citation. Two clones may mint the same label offline; that
 *      is a label collision (the ids stay unique), detected by the projection,
 *      not prevented here.
 *
 *   2. THE SUPERSEDE EXISTENCE CHECK. The pure gate judges the supersede's
 *      SHAPE (a `by` is present and is not the subject); whether the subject
 *      and `by` actually EXIST needs the event stream, so it is checked here,
 *      against the same projected decisions the state is read from. A supersede
 *      naming a `by` with no record is refused (UNKNOWN_BY) — the anti-dangling
 *      rule — as is one whose subject does not exist (UNKNOWN_SUBJECT).
 */

import {
  type CatalogEvent,
  type ChainLayout,
  type ChainWriter,
  decisionBirth,
  decisionTransitioned,
  type Entry,
  type TransitionFields,
  type UpcasterRegistry,
} from '@mnema/chain';
import { canonicalId } from '../identity/id.js';
import { canonicalIdentity } from '../identity/who.js';
import { type DecisionProjection, projectDecisions } from '../projections/decision.js';
import { orderedEvents } from '../projections/order.js';
import { type Clock, systemClock } from './clock.js';
import { type DecisionGateErr, decisionGate } from './decision-gate.js';
import { INITIAL_DECISION_STATE } from './decision-states.js';

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
  /**
   * The decision acted on does not exist (no `decision.recorded` for this id).
   * This is the subject-existence check for every transition, supersede
   * included — the subject of a supersede is the decision being superseded.
   */
  | { readonly ok: false; readonly code: 'UNKNOWN_DECISION'; readonly message: string }
  /** A record reused an id that already names a decision. */
  | { readonly ok: false; readonly code: 'ALREADY_RECORDED'; readonly message: string }
  /** A supersede named a successor `by` that does not exist (a dangling link). */
  | { readonly ok: false; readonly code: 'UNKNOWN_BY'; readonly message: string };

/** A decision was recorded: both birth events were appended, in order. */
export interface RecordOk {
  readonly ok: true;
  /** The new decision's id (the event subject). */
  readonly id: string;
  /** The citable label frozen into the record. */
  readonly adr: string;
  /** The `decision.recorded` then the birth `decision.transitioned`, as appended. */
  readonly entries: readonly [Entry, Entry];
}

/** A decision transition was authorized and appended. */
export interface DecisionTransitionOk {
  readonly ok: true;
  /** The state the decision is now in. */
  readonly to: string;
  /** The appended chain entry. */
  readonly entry: Entry;
}

/** What the caller asks to record. */
export interface RecordInput {
  /** The new decision's id (the event subject). The caller mints it. */
  readonly id: string;
  readonly title: string;
  readonly rationale: string;
  /** The agent that executed it, if any. `who` is derived from the writer's key. */
  readonly which?: string;
  /** The run this belongs to, if any. */
  readonly run?: string;
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
}

/** What the caller asks to supersede: the subject plus its successor `by`. */
export interface SupersedeInput extends DecisionTransitionInput {
  /** The successor decision's id. */
  readonly by: string;
}

/**
 * Records a new decision: derives the frozen `ADR-<n>` label from the current
 * decision count, then appends the birth pair (`decision.recorded` then the
 * birth `decision.transitioned`, `from: null` → proposed) atomically. Birth is
 * not a gated transition, but it still requires a human `who` who is not the
 * executing agent — the same authority invariant the gate enforces.
 */
export function recordDecision(
  ctx: DecisionWriteContext,
  input: RecordInput,
): RecordOk | DecisionWriteError {
  // `who` is derived from the writer's key, always a real anchor; the only
  // authority check left is that the executing agent is not that identity.
  const who = ctx.writer.anchor;
  const which = canonicalIdentity(input.which);
  if (which !== undefined && which === who) {
    return {
      ok: false,
      code: 'WHO_IS_WHICH',
      message: 'the authorizing human and the executing agent must be different identities',
    };
  }

  // Take the subject id in the chain's canonical form — the SAME form it is
  // stored and read back in — so the duplicate check below (and every later
  // lookup) keys on the identical string the projection does. An id the chain
  // cannot represent is refused, never appended and then thrown on.
  const id = canonicalId(input.id);
  if (id === undefined) {
    return { ok: false, code: 'UNKNOWN_DECISION', message: `"${input.id}" is not a usable id` };
  }

  const decisions = projectedDecisions(ctx);
  // Refuse a reused id (the mirror of UNKNOWN_DECISION on a transition). A
  // second record for the same subject would fold onto the same projection —
  // silently rewriting its frozen label and birth time, and losing the number
  // the first record minted. An id names exactly one decision, once.
  if (decisions.has(id)) {
    return {
      ok: false,
      code: 'ALREADY_RECORDED',
      message: `decision "${id}" is already recorded`,
    };
  }

  // Derive the label from the writer's local view and FREEZE it. Reading the
  // count from the chain (the source of truth), not the cache, keeps the number
  // consistent with what the chain actually proves at this moment.
  const adr = `ADR-${decisions.size + 1}`;

  const at = (ctx.clock ?? systemClock)();
  const birth = decisionBirth(
    {
      at,
      who,
      signerFp: ctx.writer.signerFingerprint,
      subject: id,
      ...(which !== undefined ? { which } : {}),
      ...(input.run !== undefined ? { run: input.run } : {}),
    },
    { title: input.title, rationale: input.rationale, adr, initial: INITIAL_DECISION_STATE },
  );
  const [e1, e2] = ctx.writer.appendAll(birth) as [Entry, Entry];
  return { ok: true, id, adr, entries: [e1, e2] };
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
 * that is present and not the subject), this verifies the successor `by` EXISTS
 * — a supersede that named a decision with no record would leave a dangling
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
 * if everything passed. `to`, `action`, and the recorded `by` all come from the
 * gate's verdict, never from the caller's assertion.
 */
function transition(
  ctx: DecisionWriteContext,
  action: 'accept' | 'reject' | 'supersede',
  input: DecisionTransitionInput,
  by?: string,
): DecisionTransitionOk | DecisionWriteError {
  // Canonicalize the subject id (NFC, the chain's stored form) so the lookup
  // keys on the same string the projection does.
  const id = canonicalId(input.id);
  const decisions = projectedDecisions(ctx);
  const current = id === undefined ? undefined : decisions.get(id);
  if (id === undefined || current === undefined) {
    return {
      ok: false,
      code: 'UNKNOWN_DECISION',
      message: `decision "${input.id}" does not exist`,
    };
  }

  // `who` is the writer's anchor, derived from its key, never supplied.
  const who = ctx.writer.anchor;
  const verdict = decisionGate({
    from: current.state,
    action,
    ...(input.fields !== undefined ? { fields: input.fields } : {}),
    ...(by !== undefined ? { by } : {}),
    subject: id,
    who,
    ...(input.which !== undefined ? { which: input.which } : {}),
  });
  if (!verdict.ok) return verdict;

  // Existence of the successor is a stream fact the pure gate cannot see. Check
  // it against the SAME projected view the state came from. `verdict.by` is in
  // the chain's canonical id form, so the lookup key matches both the
  // successor's own record subject and the `by` this event will record — no
  // composition variant can split them.
  if (verdict.action === 'supersede' && verdict.by !== undefined) {
    if (!decisions.has(verdict.by)) {
      return {
        ok: false,
        code: 'UNKNOWN_BY',
        message: `supersede names a successor "${verdict.by}" that does not exist`,
      };
    }
  }

  const which = canonicalIdentity(input.which);

  const at = (ctx.clock ?? systemClock)();
  const event = decisionTransitioned(
    {
      at,
      who,
      signerFp: ctx.writer.signerFingerprint,
      subject: id,
      ...(which !== undefined ? { which } : {}),
      ...(input.run !== undefined ? { run: input.run } : {}),
    },
    {
      from: current.state,
      to: verdict.to,
      action: verdict.action,
      ...(verdict.by !== undefined ? { by: verdict.by } : {}),
      ...(verdict.fields !== undefined ? { fields: verdict.fields } : {}),
    },
  );
  const entry = ctx.writer.append(event);
  return { ok: true, to: verdict.to, entry };
}

/**
 * Projects the decisions from the chain (the source of truth), not the cache,
 * so both the ADR count and the state/existence checks are gated against what
 * the chain actually proves.
 */
function projectedDecisions(ctx: DecisionWriteContext): Map<string, DecisionProjection> {
  const events: readonly CatalogEvent[] = orderedEvents(ctx.layout, ctx.upcasters);
  return projectDecisions(events);
}
