/**
 * @mnema/core — the work domain.
 *
 * Built on @mnema/chain (the source of truth), it holds: the projections that
 * replay chain events into a queryable SQLite cache without re-validating them;
 * the workflow and its write-time gate; and identity — how an entity is named
 * for a human without that name ever becoming its identity.
 *
 * The projection cache is pure: it is derived from the chain, never committed,
 * and rebuilt by dropping and replaying — there are no data migrations.
 */

// The relation labels a READER has to know by name, and the set of them. It read
// "the ONE relation label" and named `governs` alone; `asks-for-a-person` falsified
// that, and `ADDRESS_RELATIONS` is the pair itself, so a reader asks whether a label
// carries an address without spelling out either. They are the chain's constants and
// are re-exported here for one reason — the copilot may not name `@mnema/chain` (its
// boundary test bans the specifier, because that package holds writers), and a reader
// that typed a literal instead would be the second place a label lives.
//
// The proof a MOVE carried is not among them, and the absence is deliberate:
// `transitionProse`, `proofFields` and `PROOF_FIELDS` also live in the chain, and their
// consumers name that package directly — this package's own fold
// (`projections/proof.ts`) and the command line's presentation layer, neither of which
// is banned from the specifier. A re-export nobody imported would be a public value
// with no caller, which is the shape amarra A2 exists to kill.
export {
  ADDRESS_RELATIONS,
  ASKS_FOR_A_PERSON_RELATION,
  DERIVED_FROM_RELATION,
  GOVERNS_RELATION,
} from '@mnema/chain';
// Reading a directory of decision documents somebody else already wrote — the
// market's ADR form, turned into the four things this product records. It is a pure
// READ of text and of a directory: no writer, no key, no event, and no model. What it
// produces is input to a write the caller still has to ask for.
//
// ONLY THE DIRECTORY WALK COMES OUT. The reader of a single document, the status rule
// and the four label tables stay inside the package: nothing outside it consumes them,
// and a value exported with no consumer is published surface nobody is holding up —
// the shape `every-public-value-has-a-caller.test.ts` exists for. The package's own
// modules and its own cases import them from `./adr/read.js` directly.
export type {
  AdrDocument,
  AdrRefusalCode,
} from './adr/read.js';
export {
  type AdrScan,
  type ScannedDecision,
  type ScanRefusal,
  type ScanRefusalCode,
  scanAdrDirectory,
} from './adr/scan.js';
// What a credential looks like, and how much text a field may hold. Detecting is
// a READ — a pure question about a string — so it belongs here, and the audit of
// an existing record reaches it through this barrel. Only SCREENING (refusing and
// rewriting on the way to an append) lives on the writing side.
export { FIELD_BYTE_LIMIT } from './content/screen.js';
export {
  detectSecrets,
  SECRET_CLASSES,
  type SecretClass,
  secretPlaceholder,
} from './content/secrets.js';
export { openDatabase, type SqliteDatabase } from './db/sqlite.js';
export {
  ALIAS_PREFIXES,
  type AliasKind,
  type AnchorResolution,
  canonicalId,
  canonicalIdentity,
  deriveAlias,
  isAnchorId,
  type MintedId,
  mintedIdsIn,
  resolveAnchorPrefix,
  SHORT_ALIAS_HEX,
  SHORT_ANCHOR_HEX,
  shortenAnchors,
} from './identity/index.js';
// The refusal a write earns when the record does not name ONE identity for this
// machine's key. It is thrown, not returned (the decision sits below every write),
// so a surface needs to be able to name the class to report it as the refusal it
// is — the same reason `TreeUnavailableError` lives on the read surface.
export {
  IdentityUnavailableError,
  type MembershipRefusalCode,
} from './identity/membership.js';
export { type CacheOptions, ProjectionCache } from './projections/cache.js';
export type { ChannelSwitchProjection } from './projections/channel.js';
export {
  type AdrCollision,
  adrCollisions,
  type DecisionProjection,
  projectDecisions,
} from './projections/decision.js';
export {
  getDecision,
  listDecisions,
  listDecisionsByState,
} from './projections/decision-store.js';
export {
  type HandoffProjection,
  type LinkEdge,
  type MemoryProjection,
  type ObservationProjection,
  projectHandoffs,
  projectKnowledge,
  projectLinks,
  projectObservations,
} from './projections/knowledge.js';
export {
  getMemory,
  getObservation,
  listHandoffs,
  listLinksByRelation,
  listLinksFrom,
  listLinksTo,
  listMemories,
  listObservationsAbout,
} from './projections/knowledge-store.js';
export { type Dated, NEWEST_FIRST_SQL, newestFirst } from './projections/newest-first.js';
export { orderedEvents, orderedEventsOfRecord, type RecordOrder } from './projections/order.js';
// What each move of a record SAID, and how it is read back out of one column. One
// shape for the three state machines that have moves, so the three folds and the
// three reads cannot come to disagree about what a move's proof is.
// Only the SHAPE crosses the boundary: the command line's `show` prints a proof and
// needs to name its type. The four functions around it — the fold's reader, the index's
// text, and the two halves of the column encoding — have callers inside this package
// and nowhere else, so they stay internal rather than becoming public values whose only
// callers are their own package.
export type { TransitionProof } from './projections/proof.js';
export {
  type AuthorshipFilter,
  type AuthorshipTally,
  isKnownEntity,
  listAuthors,
  listReferences,
  listSubjectRuns,
  matchesAuthorship,
  materializeReferences,
  REFERENCE_ROLES,
  type ReferenceDirection,
  type ReferenceEdgeRow,
  type ReferenceRole,
  type ReferenceRow,
  type ReferenceSeed,
  type ReferringRole,
  type SubjectRun,
  tallyAuthorship,
  walkReferences,
} from './projections/reference-store.js';
export { projectRuns, type RunProjection, type WrittenInRun } from './projections/run.js';
export { getRun, listOpenRuns, listRuns } from './projections/run-store.js';
export {
  compareSearchHits,
  effectiveLimit,
  isSearchKind,
  SEARCH_DEFAULT_LIMIT,
  SEARCH_KINDS,
  SEARCH_MAX_LIMIT,
  type SearchHit,
  type SearchKind,
  type SearchQuery,
  type SearchResult,
  searchRecord,
} from './projections/search-store.js';
export {
  projectSkills,
  type SkillAdoption,
  type SkillProjection,
} from './projections/skill.js';
export { getSkill, listSkills, listSkillsByState } from './projections/skill-store.js';
export { projectTasks, type TaskProjection } from './projections/task.js';
export { getTask, listTasks, listTasksByState } from './projections/task-store.js';
// The window every read that takes `--from`/`--to` asks — one boundary rule in two
// readings (a predicate and a `WHERE`), plus the declaration of what a given read's
// window is OVER, which is the half that was silent.
export {
  WINDOW_IS_OVER,
  type Window,
  type WindowSubject,
  windowConditions,
  withinWindow,
} from './projections/window.js';
export {
  type BirthProbe,
  chainRootForScope,
  type DiscoveryEnv,
  type HeldTail,
  locateEntityScope,
  locateEntityScopeWith,
  locateTailScope,
  type Origin,
  PROJECT_DIR,
  type ResolvedTrees,
  type RoutedKind,
  replayingBirthProbe,
  resolveScope,
  resolveTrees,
  type Scope,
  TreeUnavailableError,
  tailsHeld,
  treesSearched,
} from './topology/index.js';
export {
  type Clock,
  DECISION_ACTIONS,
  DECISION_STATES,
  DECISION_TRANSITIONS,
  type DecisionAction,
  type DecisionGateErr,
  type DecisionGateErrorCode,
  type DecisionGateOk,
  type DecisionGateRequest,
  type DecisionGateResult,
  type DecisionProofField,
  type DecisionState,
  type DecisionTransition,
  decisionGate,
  findDecisionTransition,
  findSkillTransition,
  findTransition,
  type GateErr,
  type GateErrorCode,
  type GateOk,
  type GateRequest,
  type GateResult,
  gate,
  INITIAL_DECISION_STATE,
  INITIAL_SKILL_STATE,
  INITIAL_STATE,
  isDecisionState,
  isSkillState,
  isTaskState,
  type ProofField,
  SKILL_ACTIONS,
  SKILL_STATES,
  SKILL_TRANSITIONS,
  type SkillAction,
  type SkillGateErr,
  type SkillGateErrorCode,
  type SkillGateOk,
  type SkillGateRequest,
  type SkillGateResult,
  type SkillProofField,
  type SkillState,
  type SkillTransition,
  skillGate,
  systemClock,
  TASK_ACTIONS,
  TASK_STATES,
  type TaskAction,
  type TaskDisposition,
  type TaskState,
  TRANSITIONS,
  type Transition,
  taskDisposition,
} from './workflow/index.js';
