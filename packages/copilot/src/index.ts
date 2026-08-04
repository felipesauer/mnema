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

// The core's own types, re-exported so a consumer of @mnema/copilot can build a
// guard request and read its verdict, or read a timeline entry's `role`, or a
// skill's adoption, without reaching into @mnema/core directly. The guard's
// request and verdict are the gate's own (no new type), and the reference
// index's vocabulary is the core's.
//
// TYPES only. The `REFERENCE_ROLES` tuple was re-exported here too — a VALUE — and
// no consumer ever asked this layer for it, so it is reached where it lives.
export type {
  GateErr,
  GateErrorCode,
  GateOk,
  GateRequest,
  GateResult,
  ReferenceDirection,
  ReferenceRole,
  ReferringRole,
  // A skill's adoption — the instant and the agent, straight off the projection —
  // is re-exported for the same reason: it appears in what a provenance report
  // hands back, so reading one needs no reach past this layer.
  SkillAdoption,
} from '@mnema/core';
export {
  type Bootstrap,
  bootstrap,
  type WorkItem,
} from './context/bootstrap.js';
// The TYPE only. `decisionsInForce` is called by `bootstrap` and by nothing outside
// this package, so plumbing it to the surface would be an export with no consumer —
// the shape `every-public-value-has-a-caller.test.ts` exists to catch. The brief that
// will call it can carry it out here, with its caller, in the same change.
export type { DecisionRef } from './context/decisions.js';
export {
  type ActorScope,
  type AskerContext,
  type Focus,
  focus,
  type ReportedRun,
  type Resume,
  resume,
} from './context/focus.js';
export {
  type NextAction,
  nextActions,
  nextActionsForTask,
} from './context/next-action.js';
export {
  type HiddenMatches,
  type RecordBody,
  type RecordHit,
  type RecordQuery,
  type RecordSearch,
  readRecord,
  searchRecords,
} from './context/search.js';
export {
  type AdoptedSkill,
  adoptedSkills,
  lookupAdoptedSkill,
  type SkillLookup,
  type SkillRef,
} from './context/skills.js';
export {
  type GuardWithFocus,
  guard,
  guardWithFocus,
} from './guard/guard.js';
export {
  type Accountability,
  type AccountabilityFilter,
  accountability,
  accountabilityByProject,
  type KindCount,
  type ProjectAccount,
  type WhichCount,
  type WhoAccount,
  type WorkspaceAccountability,
} from './intelligence/accountability.js';
export {
  type Antipatterns,
  antipatterns,
  antipatternsByProject,
  type ProjectAntipatterns,
  type ProjectEvents,
  type RecurrenceFinding,
  type WorkspaceAntipatterns,
} from './intelligence/antipatterns.js';
export { consultationsByRun } from './intelligence/consultation.js';
export type { CatalogEvent, EventKind } from './intelligence/events.js';
export {
  type ExposedRecord,
  type Exposure,
  exposure,
  type ProjectScan,
  type ScopedEvents,
  type WorkspaceExposure,
  workspaceExposure,
} from './intelligence/exposure.js';
export { knownAnchors } from './intelligence/identities.js';
export {
  type PatternProvenance,
  patternProvenance,
} from './intelligence/provenance.js';
export {
  effectiveDepth,
  REFERENCE_DEFAULT_DEPTH,
  REFERENCE_MAX_DEPTH,
  type ReferenceGraph,
  type ReferenceLink,
  type ReferenceNode,
  type ReferenceQuery,
  references,
} from './intelligence/references.js';
export {
  type TimelineEntry,
  timeline,
} from './intelligence/timeline.js';
export type { ScopedCache } from './sources.js';
