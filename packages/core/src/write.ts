/**
 * @mnema/core/write — the WRITING surface of the work domain.
 *
 * Everything here changes the record: it appends an event through a gate, or
 * opens the writer that does. It is a subpath of its own so a read-only consumer
 * (the copilot) can depend on `@mnema/core` for projections and the gate WITHOUT
 * being able to name a single writer — the separation is structural, enforced by
 * the module graph, not by a hand-maintained denylist. A new write operation
 * added here is caught by that boundary automatically, because it is born on the
 * writing side of the line.
 *
 * The read surface (`@mnema/core`) carries the projections, the pure gate
 * (asking "would this be authorized?" is a read), the workflow tables and
 * states, identity derivation, and tree/scope RESOLUTION (computing which tree a
 * scope maps to is a read; only OPENING it for writing is here).
 */

// Capturing a memory: the knowledge domain's one write.
export { type CaptureInput, type CaptureOk, captureMemory } from './knowledge/operations.js';
// Opening the correct tree's chain for writing (scope RESOLUTION stays on the
// read surface; only opening a writer is a write).
export { type OpenTreeOptions, openTreeForWriting } from './topology/index.js';
// Identity write operations — founding an anchor, enrolling and revoking keys.
export {
  enrollKey,
  ensureFounded,
  foundIdentity,
  type IdentityOk,
  revokeKey,
} from './workflow/identity-operations.js';
// The write operations for the work domain: each appends an event a gate
// authorized. Their input/result/context types travel with them — a caller that
// can write needs them; a reader never sees this module.
export {
  acceptDecision,
  type CreateInput,
  type CreateOk,
  createTask,
  type DecisionTransitionInput,
  type DecisionTransitionOk,
  type DecisionWriteContext,
  type DecisionWriteError,
  type RecordInput,
  type RecordOk,
  recordDecision,
  rejectDecision,
  type SupersedeInput,
  supersedeDecision,
  type TransitionInput,
  type TransitionOk,
  transitionTask,
  type WriteContext,
  type WriteError,
} from './workflow/index.js';
