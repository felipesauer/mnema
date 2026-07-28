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
// The reference index's own vocabulary — the four roles and the direction of a
// walk — is the core's, and re-exported for the same reason: a consumer reads a
// timeline entry's `role` or asks for a direction without reaching past this
// layer.
export {
  REFERENCE_ROLES,
  type ReferenceDirection,
  type ReferenceRole,
  type ReferringRole,
  // A skill's adoption — the instant and the agent, straight off the projection —
  // is re-exported for the same reason: it appears in what a provenance report
  // hands back, so reading one needs no reach past this layer.
  type SkillAdoption,
} from '@mnema/core';
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
  type KindCount,
  type WhichCount,
  type WhoAccount,
} from './intelligence/accountability.js';
export {
  type Antipatterns,
  antipatterns,
  type RecurrenceFinding,
} from './intelligence/antipatterns.js';
export type { CatalogEvent, EventKind } from './intelligence/events.js';
export {
  type ExposedRecord,
  type Exposure,
  exposure,
  type ScopedEvents,
} from './intelligence/exposure.js';
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
