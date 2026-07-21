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
 * interleave consistently, and records the canonical `who`/`which` — the same
 * form the identity rule validated — so what was judged legal is what the event
 * proves.
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
import { canonicalIdentity } from '../identity/who.js';
import { orderedEvents } from '../projections/order.js';
import { projectTasks } from '../projections/task.js';
import { type Clock, systemClock } from './clock.js';
import { type GateErr, gate } from './gate.js';
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
  /** The human who authorized it. */
  readonly who: string;
  /** The agent that executed it, if any. */
  readonly which?: string;
  /** The run this belongs to, if any. */
  readonly run?: string;
}

/** What the caller asks to create. */
export interface CreateInput {
  /** The new task's id (the event subject). The caller mints it. */
  readonly id: string;
  readonly title: string;
  /** The human who authorized the creation. */
  readonly who: string;
  /** The agent that executed it, if any. */
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
  const current = currentState(ctx, input.id);
  if (current === undefined) {
    return { ok: false, code: 'UNKNOWN_TASK', message: `task "${input.id}" does not exist` };
  }

  const verdict = gate({
    from: current,
    action: input.action,
    ...(input.fields !== undefined ? { fields: input.fields } : {}),
    who: input.who,
    ...(input.which !== undefined ? { which: input.which } : {}),
  });
  if (!verdict.ok) return verdict;

  // Record the SAME canonical identity the gate validated, never the raw input:
  // what was judged legal is what the event proves. The gate already accepted a
  // canonical `who`, so this cannot be undefined here.
  const who = canonicalIdentity(input.who) as string;
  const which = canonicalIdentity(input.which);

  const at = (ctx.clock ?? systemClock)();
  const event = taskTransitioned(
    {
      at,
      who,
      subject: input.id,
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
 * judge — but it still requires a human `who`, and `who` must not be the
 * executing agent `which`, the same authority invariant the gate enforces.
 */
export function createTask(ctx: WriteContext, input: CreateInput): CreateOk | WriteError {
  // Birth applies the SAME identity rule as a gated transition: canonicalize
  // once, then validate and record that canonical form. A `who` that is not a
  // real string or is empty once trimmed is no human; a `which` that equals
  // `who` is an agent authorizing itself.
  const who = canonicalIdentity(input.who);
  if (who === undefined) {
    return {
      ok: false,
      code: 'MISSING_WHO',
      message: 'creating a task needs a human who authorized it',
    };
  }
  const which = canonicalIdentity(input.which);
  if (which !== undefined && which === who) {
    return {
      ok: false,
      code: 'WHO_IS_WHICH',
      message: 'the authorizing human and the executing agent must be different identities',
    };
  }

  const at = (ctx.clock ?? systemClock)();
  const birth = taskBirth(
    {
      at,
      who,
      subject: input.id,
      ...(which !== undefined ? { which } : {}),
      ...(input.run !== undefined ? { run: input.run } : {}),
    },
    { title: input.title, initial: INITIAL_STATE },
  );
  // Append the pair atomically: a torn birth would leave a created task with no
  // state, permanently burning the id (the projection drops a stateless
  // subject, so every later transition on it fails as UNKNOWN_TASK).
  const [e1, e2] = ctx.writer.appendAll(birth) as [Entry, Entry];
  return { ok: true, id: input.id, entries: [e1, e2] };
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
