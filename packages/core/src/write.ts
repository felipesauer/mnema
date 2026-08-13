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

// The refusal an oversize field earns, and the report a scrubbed write carries
// back. Both travel in every write's result union, so a surface needs to be able
// to name them; the screening function itself is deliberately NOT exported — the
// door is inside, and a caller that could screen separately could also skip it.
export type { ContentTooLargeErr, ScreenedWrite } from './content/screen.js';
// The one refusal a point-in-time fact can earn beyond its content: the authority
// invariant. It travels with the knowledge writes because it is in their result
// union.
export type { SelfAuthorizedErr } from './identity/authority.js';
// The handshake a machine joining an identity produces: its public key plus the
// signature proving it consents. It can mint this machine's key on first use, so
// it belongs on the writing side even though it appends nothing.
export {
  decodeKeyRequest,
  encodeKeyRequest,
  type KeyRequest,
  type RequestErr,
  type RequestErrorCode,
  type RequestInput,
  type RequestOk,
  type RequestSource,
  requestEnrollment,
} from './identity/handshake.js';
// Restoring a key from a copy of its private half — the only recovery there is.
// It appends nothing, but it installs key material and records which anchor a key
// serves, so it is a write: a read-only layer must not be able to name it.
export {
  type RestoredMembership,
  type RestoreErr,
  type RestoreErrorCode,
  type RestoreInput,
  type RestoreOk,
  restoreKey,
} from './identity/restore.js';
// Operating the roster: enrolling a requested key, and retiring one.
export {
  type EnrollRequestErr,
  type EnrollRequestErrorCode,
  type EnrollRequestInput,
  type EnrollRequestOk,
  enrollFromRequest,
  type RevokeMemberErr,
  type RevokeMemberErrorCode,
  type RevokeMemberInput,
  type RevokeMemberOk,
  revokeMember,
} from './identity/roster.js';
// The knowledge domain's writes: each appends one point-in-time fact, no gate.
export {
  type CaptureInput,
  type CaptureOk,
  captureMemory,
  type FactError,
  type HandoffInput,
  type HandoffOk,
  type LinkInput,
  type LinkOk,
  linkKnowledge,
  type ObservationInput,
  type ObservationOk,
  recordHandoff,
  recordObservation,
} from './knowledge/operations.js';
// Opening the correct tree's chain for writing (scope RESOLUTION stays on the
// read surface; only opening a writer is a write).
export { type OpenTreeOptions, openTreeForWriting } from './topology/index.js';
// The refusal an event the READER would not accept earns. Like the screen, only
// the refusal type crosses the line: the check lives inside every write, and a
// caller able to run it separately would be a caller able to skip it.
export type { UnreadableEventErr } from './workflow/append.js';
// Identity write operations — founding an anchor, establishing it WHOLE into a
// tree (the ≥2-keys policy), and enrolling or revoking keys. `ensureFounded` is
// the founding every write goes through; the `foundIdentity` wrapper around it is
// not here, because no surface ever founded on its own — `init` establishes, and
// every other write founds on its way in.
export {
  type AnchorDecision,
  authorizingAnchor,
  type DeclinedKey,
  decideAnchor,
  type EstablishedIdentity,
  enrollKey,
  ensureFounded,
  establishIdentity,
  type IdentityOk,
  revokeKey,
} from './workflow/identity-operations.js';
// The write operations for the work domain: each appends an event a gate
// authorized. Their input/result/context types travel with them — a caller that
// can write needs them; a reader never sees this module.
//
// `authorizeTailPrune` is the one here that no gate authorizes, and it is not an
// exception to the rule so much as the rule's other side: gates protect the SHAPE
// of the record, and a waiver's shape is checked against the disk by the writer's
// own door instead (`@mnema/chain`, `waiver.ts`). It arrived on this surface the day
// `mnema tail prune` asked for it, and it has that one caller.
export {
  acceptDecision,
  adoptSkill,
  authorizeTailPrune,
  type ConsultationInput,
  type ConsultationOk,
  type CreateInput,
  type CreateOk,
  createSkill,
  createTask,
  type DecisionTransitionInput,
  type DecisionTransitionOk,
  type DecisionWriteContext,
  type DecisionWriteError,
  deprecateSkill,
  type EndRunError,
  type EndRunInput,
  type EndRunOk,
  endRun,
  type PruneError,
  type PruneInput,
  type PruneOk,
  type RecordInput,
  type RecordOk,
  recordConsultation,
  recordDecision,
  rejectDecision,
  rejectSkill,
  reviewSkill,
  type SkillCreateInput,
  type SkillCreateOk,
  type SkillTransitionInput,
  type SkillTransitionOk,
  type SkillWriteContext,
  type SkillWriteError,
  type StartRunError,
  type StartRunInput,
  type StartRunOk,
  type SupersedeInput,
  startRun,
  supersedeDecision,
  type TransitionInput,
  type TransitionOk,
  transitionTask,
  type WriteContext,
  type WriteError,
} from './workflow/index.js';
