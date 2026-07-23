/**
 * @mnema/copilot — the layer that guides an agent by reading the proof.
 *
 * The core proves what happened; this layer reads that record and composes it
 * into the context an agent needs — where a person left off, what they may do
 * next, whether a move is allowed. It is a layer ABOVE the domain: it depends on
 * @mnema/core (its projections and its gate) and never the other way around.
 *
 * The one rule that defines it: the copilot only READS and COMPOSES. It never
 * emits an event, never writes state, never decides a fact. Everything here is a
 * derivation — a view of what the chain already proves — so if two clones ever
 * disagreed about it, the chain decides. A thing that would need to be recorded
 * to be true is not a derivation; it belongs in the core. That boundary is not a
 * convention here, it is a test (see `boundaries.test.ts`): the package fails its
 * own suite the moment it imports anything that writes.
 */

export const PACKAGE_NAME = '@mnema/copilot';

// The guard's request and verdict are the gate's own types (no new type). They
// are re-exported here so a consumer of @mnema/copilot can build a guard request
// and read its verdict without reaching into @mnema/core directly.
export type { GateErr, GateErrorCode, GateOk, GateRequest, GateResult } from '@mnema/core';
export {
  type Bootstrap,
  bootstrap,
  type WorkItem,
} from './context/bootstrap.js';
export {
  type ActorScope,
  type Focus,
  focus,
  type Resume,
  resume,
} from './context/focus.js';
export {
  type NextAction,
  nextActions,
  nextActionsForTask,
} from './context/next-action.js';
export {
  type GuardWithFocus,
  guard,
  guardWithFocus,
} from './guard/guard.js';
