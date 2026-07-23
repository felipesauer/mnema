/**
 * @mnema/chain — the proof engine.
 *
 * This package is the tamper-evidence core: the typed event catalog, the
 * per-tail hash chain, Ed25519 checkpoints over a content-recomputable root,
 * and the verifier. It has zero runtime dependencies so the surface that
 * carries the proof stays small, isolated, and auditable on its own.
 *
 * This entry point exports the event core and the chain: append-only per-tail
 * writing, the hash chain, signed checkpoints, and verification.
 */

export const PACKAGE_NAME = '@mnema/chain';

// The chain.
export { type OpenOptions, openChainForWriting, verify } from './chain/chain.js';
export {
  type Checkpoint,
  CheckpointParseError,
  type CheckpointVerdict,
  checkpointHash,
  parseCheckpoint,
  serializeCheckpoint,
  signCheckpoint,
  verifyCheckpoint,
} from './chain/checkpoint.js';
export {
  type IdentityIssue,
  type IdentityResolution,
  resolveIdentity,
} from './chain/enrollment.js';
export {
  type Entry,
  type EntryLink,
  EntryParseError,
  parseEntry,
  sealEntry,
  serializeEntry,
} from './chain/entry.js';
export { contentRoot, entryHash, eventBytes, sha256Hex } from './chain/hash.js';
export {
  ANCHOR_PREFIX,
  deriveAnchor,
  fingerprintOf,
  generateKeyPair,
  type KeyPair,
  publicKeyFromPem,
  publicKeyToPem,
  sign,
  verify as verifySignature,
} from './chain/keys.js';
export {
  loadOrCreateInstallationId,
  loadOrCreateKeyPair,
  materializePublicKey,
  persistKeyPair,
  readAnchor,
  writeAnchor,
} from './chain/keystore.js';
export { type ChainLayout, gitignorePath } from './chain/layout.js';
export {
  listPublicKeyFingerprints,
  listTails,
  orderedSegments,
  readTailCheckpoints,
  readTailEntries,
} from './chain/store.js';
export { ensureTree } from './chain/tree.js';
export {
  type CensusNote,
  canonicalIdentityForm,
  type TailIssue,
  type TailResult,
  type VerifyResult,
  verifyChain,
  type WitnessStatus,
} from './chain/verify.js';
export {
  ChainWriter,
  DEFAULT_CHECKPOINT_EVERY,
  DEFAULT_MAX_SEGMENT_BYTES,
  type WriterOptions,
} from './chain/writer.js';
export {
  BIRTH_ACTION,
  decisionBirth,
  decisionRecorded,
  decisionTransitioned,
  enrollmentMessage,
  identityFounded,
  keyEnrolled,
  keyRevoked,
  runEnded,
  runStarted,
  taskBirth,
  taskCreated,
  taskTransitioned,
} from './events/build.js';
export {
  CanonicalizationError,
  type CanonicalValue,
  canonicalBytes,
  canonicalStringify,
} from './events/canonical.js';
export {
  type CatalogEvent,
  type DecisionRecordedV1,
  type DecisionTransitionedV1,
  type EventKind,
  type IdentityFoundedV1,
  type KeyEnrolledV1,
  type KeyRevokedV1,
  LATEST_VERSION,
  type RunEndedV1,
  type RunStartedV1,
  type TaskCreatedV1,
  type TaskTransitionedV1,
  type TransitionFields,
} from './events/catalog.js';
export type { Envelope, Which, Who } from './events/envelope.js';
export { EventParseError, parseEvent, toCanonical } from './events/parse.js';
export { catalogUpcasters } from './events/registry.js';
export {
  type LatestVersions,
  type Upcaster,
  UpcasterError,
  UpcasterRegistry,
  type VersionedEvent,
} from './events/upcaster.js';
