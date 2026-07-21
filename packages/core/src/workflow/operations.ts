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

  const at = (ctx.clock ?? systemClock)();
  const event = taskTransitioned(
    {
      at,
      who: input.who,
      subject: input.id,
      ...(input.which !== undefined ? { which: input.which } : {}),
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
  if (input.who.length === 0) {
    return {
      ok: false,
      code: 'MISSING_WHO',
      message: 'creating a task needs a human who authorized it',
    };
  }
  if (input.which !== undefined && input.which === input.who) {
    return {
      ok: false,
      code: 'WHO_IS_WHICH',
      message: 'the authorizing human and the executing agent must be different identities',
    };
  }

  const at = (ctx.clock ?? systemClock)();
  const [created, transitioned] = taskBirth(
    {
      at,
      who: input.who,
      subject: input.id,
      ...(input.which !== undefined ? { which: input.which } : {}),
      ...(input.run !== undefined ? { run: input.run } : {}),
    },
    { title: input.title, initial: INITIAL_STATE },
  );
  const e1 = ctx.writer.append(created);
  const e2 = ctx.writer.append(transitioned);
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
