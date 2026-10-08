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

// The chain.
export {
  BACKUP_ROLE,
  type BackupKey,
  ensureBackupKey,
  type KeyRegistration,
  listRegistrations,
  type RegistrationFault,
  readRegistration,
} from './chain/backup.js';
export {
  type CausalOrder,
  type CitationHeld,
  type CitationNotHeld,
  causalOrder,
  type OrderKeys,
  type TailToOrder,
} from './chain/causal-order.js';
export { type OpenOptions, openChainForWriting, signerAt, verify } from './chain/chain.js';
export {
  type Checkpoint,
  CheckpointParseError,
  type CheckpointVerdict,
  checkpointHash,
  checkpointMessage,
  parseCheckpoint,
  serializeCheckpoint,
  signCheckpoint,
  verifyCheckpoint,
} from './chain/checkpoint.js';
export { CodedError } from './chain/coded-error.js';
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
export { type ChainExtent, chainExtent } from './chain/freshness.js';
export {
  contentRoot,
  entryHash,
  eventBytes,
  type WrittenEvent,
  writtenAsBuilt,
  writtenAsStored,
} from './chain/hash.js';
export {
  isProtected,
  KEY_PASSPHRASE_VARIABLE,
  KeyIsProtectedError,
  KeyPassphraseWrongError,
  NoPassphraseToProtectWithError,
  passphraseFromEnvironment,
  passphraseToOpen,
  passphraseToProtectWith,
  readPrivateKeyPair,
} from './chain/key-protection.js';
export {
  ANCHOR_PREFIX,
  deriveAnchor,
  fingerprintOf,
  generateKeyPair,
  type KeyPair,
  keyPairFromPrivatePem,
  type PublicHalf,
  publicKeyFromPem,
  publicKeyToPem,
  sign,
  verify as verifySignature,
} from './chain/keys.js';
export {
  type ChainSigner,
  committedPublicKey,
  DanglingInstallationIdError,
  type KeyFileChange,
  KeyRootBusyError,
  listAnchoredFingerprints,
  listPrivateKeyFiles,
  listPrivateKeyFingerprints,
  loadOrCreateInstallationId,
  loadOrCreateKeyPair,
  localKeyFingerprint,
  materializePublicKey,
  persistKeyPair,
  protectPrivateKeys,
  readAnchor,
  UnsettledInstallationIdError,
  UnwrittenInstallationIdError,
  unprotectPrivateKeys,
  writeAnchor,
} from './chain/keystore.js';
export {
  anchorPath,
  type ChainLayout,
  gitignorePath,
  privateKeyPath,
  projectionCachePath,
  publicKeyPath,
  tailDir,
  witnessDir,
  witnessSigstorePath,
} from './chain/layout.js';
export {
  LEVEL_REQUIREMENTS,
  type LevelRequirement,
  meetsRequirement,
  NOT_ANSWERED_BY_ANY_REQUIREMENT,
  type ProvenLevel,
  requiredLevel,
  weakerLevel,
} from './chain/level.js';
export {
  firstLinkBreakFrom,
  holdsRecord,
  type LinkBreak,
  listPublicKeyFingerprints,
  listTails,
  orderedSegments,
  readTail,
  readTailCheckpoints,
  readTailEntries,
  readTailSince,
  readTailTip,
  type TailBoundary,
  type TailRead,
  type TailSince,
} from './chain/store.js';
export { DEFAULT_WAIT_MS, TailBusyError } from './chain/tail-lock.js';
export { ensureTree } from './chain/tree.js';
export {
  type BackupKeyNote,
  type CensusNote,
  canonicalIdentityForm,
  type EmptyTailNote,
  type ForeignLinkRetractionNote,
  type ForeignRetractionNote,
  isEmptyTail,
  type KeyWithoutTailNote,
  type PartialFinalLineNote,
  type TailIssue,
  type TailResult,
  type VerdictClause,
  type VerdictClauseOf,
  type VerifyOptions,
  type VerifyResult,
  verifyChain,
  type WitnessStatus,
} from './chain/verify.js';
export {
  standingOf,
  type TailStanding,
  type TailWaiver,
  tailStanding,
  tailWaiversIn,
} from './chain/waiver.js';
// T3, the external witness. What crosses this line is what the SURFACE uses — the two
// acts, where a witness is filed, and how one reads, per checkpoint, per tail, and as
// the walk down the tail that the reading and the act that completes an attestation
// share. `witnessOfChain` stays inside: the verifier is its only caller, and an export
// nothing calls is a value with no reason to be a contract.
export {
  checkpointToWitness,
  type ProvenCheckpoint,
  readStoredWitness,
  readWitness,
  type WalkedWitness,
  type WitnessedTail,
  type WitnessReading,
  witnessOfTail,
  witnessWalk,
  writeWitness,
} from './chain/witness.js';
export {
  completeWitness,
  type Fetcher,
  stampCheckpoint,
  type WitnessNetwork,
  type WitnessRefusal,
  type WitnessRefusalKind,
  type WitnessReturnVisit,
} from './chain/witness-request.js';
export {
  ChainWriter,
  DEFAULT_MAX_SEGMENT_BYTES,
  DEFAULT_MAX_UNSIGNED_EVENTS,
  type WriterOptions,
} from './chain/writer.js';
export {
  accountLinked,
  BIRTH_ACTION,
  backupDeclared,
  channelAsked,
  channelRefused,
  channelServed,
  channelSwitched,
  checkDeclared,
  checkerEnrolled,
  checkerEnrollmentMessage,
  checkerRetired,
  checkFailed,
  checkPassed,
  decisionBirth,
  decisionRecorded,
  decisionTransitioned,
  enrollmentMessage,
  handoffRecorded,
  identityFounded,
  keyEnrolled,
  keyRevoked,
  knowledgeLinked,
  linkRetracted,
  memoryCaptured,
  noteRetracted,
  observationRecorded,
  runEnded,
  runStarted,
  skillBirth,
  skillConsulted,
  skillCreated,
  skillTransitioned,
  tailPruned,
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
  type AccountLinkedV1,
  ADDRESS_RELATIONS,
  ASKS_FOR_A_PERSON_RELATION,
  type BackupDeclaredV1,
  type CatalogEvent,
  type ChannelAskedV1,
  type ChannelRefusedV1,
  type ChannelServedV1,
  type ChannelSwitchedV1,
  type CheckDeclaredV1,
  type CheckerEnrolledV1,
  type CheckerRetiredV1,
  type CheckFailedV1,
  type CheckPassedV1,
  DERIVED_FROM_RELATION,
  type DecisionRecordedV1,
  type DecisionTransitionedV1,
  type EventKind,
  GOVERNS_RELATION,
  type HandoffRecordedV1,
  type IdentityFoundedV1,
  type KeyEnrolledV1,
  type KeyRevokedV1,
  type KnowledgeLinkedV1,
  LATEST_VERSION,
  type LinkRetractedV1,
  type MemoryCapturedV1,
  type NoteRetractedV1,
  type ObservationRecordedV1,
  RECOMMENDED_LINK_RELATIONS,
  REFUSES_A_WRITE_RELATION,
  type RunEndedV1,
  type RunStartedV1,
  type SkillConsultedV1,
  type SkillCreatedV1,
  type SkillTransitionedV1,
  type TailPrunedV1,
  type TaskCreatedV1,
  type TaskTransitionedV1,
  type TransitionFields,
} from './events/catalog.js';
export type { Envelope, Which, Who } from './events/envelope.js';
export { EventParseError, parseEvent, toCanonical, unreadableReason } from './events/parse.js';
export { PROOF_FIELDS, proofFields, transitionProse } from './events/proof.js';
export { catalogUpcasters } from './events/registry.js';
export { mayRetract } from './events/retraction.js';
export {
  type LatestVersions,
  type Upcaster,
  UpcasterError,
  UpcasterRegistry,
  type VersionedEvent,
} from './events/upcaster.js';
