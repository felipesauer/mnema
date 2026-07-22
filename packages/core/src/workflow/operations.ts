/**
 * The gated write operations: the only way the core moves a task, and the seam
 * every surface goes through to change state.
 *
 * A surface never appends a transition to the chain directly. It calls one of
 * these, which run the gate FIRST and append ONLY if the gate authorized the
 * move. That is the write-time enforcement the whole design rests on: an event
 * reaches the chain only after the gate judged it legal, proven, and
 * authorized, so a projection can later replay it without re-judging.
 *
 * Reading the current state comes from the chain itself (the source of truth),
 * not the SQLite cache — a stale cache must never let an illegal move through.
 * Each operation stamps `at` from one uniform clock so events across tails
 * interleave consistently.
 *
 * Identity is DERIVED, never supplied. `who` (the authorizing anchor) and
 * `signerFp` (the signing key) both come from the writer's own key — the very
 * key that will sign the checkpoint — so a caller cannot forge who authorized a
 * fact by typing a name. The caller supplies at most `which` (the executing
 * agent). `who != which` still holds: an anchor hash never collides with an
 * agent name.
 */

import {
  type CatalogEvent,
  type ChainLayout,
  type ChainWriter,
  type Entry,
  type TransitionFields,
  taskBirth,
  taskTransitioned,
  type UpcasterRegistry,
} from '@mnema/chain';
import { canonicalId } from '../identity/id.js';
import { canonicalIdentity } from '../identity/who.js';
import { orderedEvents } from '../projections/order.js';
import { projectTasks } from '../projections/task.js';
import { type Clock, systemClock } from './clock.js';
import { type GateErr, gate } from './gate.js';
import { ensureFounded } from './identity-operations.js';
import { INITIAL_STATE } from './states.js';

/** Shared dependencies for a write: where to read state from and where to append. */
export interface WriteContext {
  readonly writer: ChainWriter;
  readonly layout: ChainLayout;
  readonly upcasters: UpcasterRegistry;
  /** The clock that stamps `at`; defaults to the wall clock. */
  readonly clock?: Clock;
}

/** A write refused before touching the chain. */
export type WriteError =
  | GateErr
  /** The task does not exist (no `task.created` for this id). */
  | { readonly ok: false; readonly code: 'UNKNOWN_TASK'; readonly message: string };

/** A transition was authorized and appended. */
export interface TransitionOk {
  readonly ok: true;
  /** The state the task is now in. */
  readonly to: string;
  /** The appended chain entry. */
  readonly entry: Entry;
}

/** A task was born: both birth events were appended, in order. */
export interface CreateOk {
  readonly ok: true;
  /** The new task's id (the event subject). */
  readonly id: string;
  /** The `task.created` then the birth `task.transitioned`, as appended. */
  readonly entries: readonly [Entry, Entry];
}

/** What the caller asks to transition. */
export interface TransitionInput {
  /** The task to move (the event subject). */
  readonly id: string;
  /** The requested action. */
  readonly action: string;
  /** Proof and context for the move. */
  readonly fields?: TransitionFields;
  /** The agent that executed it, if any. `who` is derived from the writer's key. */
  readonly which?: string;
  /** The run this belongs to, if any. */
  readonly run?: string;
}

/** What the caller asks to create. */
export interface CreateInput {
  /** The new task's id (the event subject). The caller mints it. */
  readonly id: string;
  readonly title: string;
  /** The agent that executed it, if any. `who` is derived from the writer's key. */
  readonly which?: string;
  /** The run this belongs to, if any. */
  readonly run?: string;
}

/**
 * Transitions a task through the gate. Reads the task's current state from the
 * chain, asks the gate whether the move is authorized, and appends the
 * transition ONLY if it is. On refusal nothing is written and the typed reason
 * is returned. `to` is the gate's resolved state, never the caller's assertion.
 */
export function transitionTask(
  ctx: WriteContext,
  input: TransitionInput,
): TransitionOk | WriteError {
  // Look the task up in the chain's canonical id form — the SAME form its
  // subject is stored and read back in — so the lookup key matches the
  // projection's, and a composition variant of the id cannot false-miss. (The
  // decision operations already do this; the task now agrees.)
  const id = canonicalId(input.id);
  const current = id === undefined ? undefined : currentState(ctx, id);
  if (id === undefined || current === undefined) {
    return { ok: false, code: 'UNKNOWN_TASK', message: `task "${input.id}" does not exist` };
  }

  // `who` is the writer's anchor, derived from its key, never supplied — a
  // caller cannot forge who authorized the move. The gate still checks it
  // against `which` so an agent cannot pose as the authorizer.
  const who = ctx.writer.anchor;
  const verdict = gate({
    from: current,
    action: input.action,
    ...(input.fields !== undefined ? { fields: input.fields } : {}),
    who,
    ...(input.which !== undefined ? { which: input.which } : {}),
  });
  if (!verdict.ok) return verdict;

  const which = canonicalIdentity(input.which);

  // Found this installation's anchor before its first fact, so the transition's
  // signer is a key valid for its anchor at verify. A no-op once founded.
  ensureFounded(ctx);
  const at = (ctx.clock ?? systemClock)();
  const event = taskTransitioned(
    {
      at,
      who,
      signerFp: ctx.writer.signerFingerprint,
      subject: id,
      ...(which !== undefined ? { which } : {}),
      ...(input.run !== undefined ? { run: input.run } : {}),
    },
    {
      from: current,
      to: verdict.to,
      action: verdict.action,
      ...(verdict.fields !== undefined ? { fields: verdict.fields } : {}),
    },
  );
  const entry = ctx.writer.append(event);
  return { ok: true, to: verdict.to, entry };
}

/**
 * Creates a task: appends the birth pair (`task.created` then the birth
 * `task.transitioned`, `from: null` → the initial state) in order, both stamped
 * with one `at`. Birth is not a gated transition — there is no prior state to
 * judge — but it still binds a `who` (the writer's anchor) that must not be the
 * executing agent `which`, the same authority invariant the gate enforces.
 */
export function createTask(ctx: WriteContext, input: CreateInput): CreateOk | WriteError {
  // `who` is derived from the writer's key, so it is always a real anchor — the
  // MISSING_WHO path a typed-in name could hit no longer exists. The one
  // authority check that remains is that the executing agent is not that same
  // identity (an anchor never equals an agent name, but the check is cheap and
  // states the invariant explicitly).
  const who = ctx.writer.anchor;
  const which = canonicalIdentity(input.which);
  if (which !== undefined && which === who) {
    return {
      ok: false,
      code: 'WHO_IS_WHICH',
      message: 'the authorizing human and the executing agent must be different identities',
    };
  }

  const id = canonicalId(input.id);
  if (id === undefined) {
    return { ok: false, code: 'UNKNOWN_TASK', message: `"${input.id}" is not a usable id` };
  }

  // Found this installation's anchor before the birth pair, so both events'
  // signer is a key valid for its anchor at verify. A no-op once founded.
  ensureFounded(ctx);
  const at = (ctx.clock ?? systemClock)();
  const birth = taskBirth(
    {
      at,
      who,
      signerFp: ctx.writer.signerFingerprint,
      subject: id,
      ...(which !== undefined ? { which } : {}),
      ...(input.run !== undefined ? { run: input.run } : {}),
    },
    { title: input.title, initial: INITIAL_STATE },
  );
  // Append the pair atomically: a torn birth would leave a created task with no
  // state, permanently burning the id (the projection drops a stateless
  // subject, so every later transition on it fails as UNKNOWN_TASK).
  const [e1, e2] = ctx.writer.appendAll(birth) as [Entry, Entry];
  return { ok: true, id, entries: [e1, e2] };
}

/**
 * Reads a task's current state from the chain (its projected `to`), or
 * undefined if the task does not exist. This reads the source of truth, not the
 * cache, so a write is always gated against what the chain actually proves.
 */
function currentState(ctx: WriteContext, id: string): string | undefined {
  const events: readonly CatalogEvent[] = orderedEvents(ctx.layout, ctx.upcasters);
  const tasks = projectTasks(events);
  return tasks.get(id)?.state;
}
