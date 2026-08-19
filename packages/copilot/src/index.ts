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
  // A label naming two rules is a shape two of this layer's answers carry — the
  // committed document's, and the audit's — so reading either needs no reach past
  // this layer.
  AdrCollision,
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
  type AwaitingJudgement,
  type Bootstrap,
  bootstrap,
} from './context/bootstrap.js';
export {
  type Brief,
  brief,
} from './context/brief.js';
// The TYPE only, still — and the prediction that used to be written here was wrong.
// It said the brief would be the caller that carried `decisionsInForce` out to the
// surface; the brief composes the two derivations INSIDE this package (see
// `context/brief.ts`), so what reached the surface is `brief` and the rule for which
// decisions govern never left. `decisionsInForce` is called by `bootstrap` and by
// `brief`, and by nothing outside this package: exporting it would be a value with no
// consumer, the shape `every-public-value-has-a-caller.test.ts` exists to catch. The
// type is exported because reading a `Bootstrap` or a `Brief` needs it. The same
// holds for the two halves of `AwaitingJudgement`: they are reachable THROUGH the
// union (`item.kind === 'decision'` narrows it without either arm being named), so
// exporting them as well would be surface nobody needs to write down.
//
// THE ACCESSOR IS A VALUE AND IT IS HERE, which is the one thing the paragraph above
// does not cover: `decisionDisposition` answers what one state MEANS, and a surface
// that shows a decision's position has to ask rather than restate it. It is the twin
// of `skillDisposition` below, and both are held on this surface — not merely allowed
// on it — by `no-classification-table-reaches-the-surface.test.ts`.
export { type DecisionRef, decisionDisposition } from './context/decisions.js';
// The vocabulary the two accessors answer IN. A consumer that maps every disposition
// to something of its own needs the union to be TOTAL over, and a caller holding only
// the three literals would have no way to write a table a fourth disposition breaks.
export type { Disposition } from './context/disposition.js';
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
// `skillCatalogue` is here as a VALUE for the reason `skillDisposition` is: it
// answers how much of the record a caller that named nothing is served, and a surface
// that decided that for itself would be a second budget nobody could see drift from
// this one. Its union comes with it — the surface has to narrow on the arm to know
// whether it is framing bodies or names — and the two ARMS do not, being reachable
// through it (`catalogue.served === 'names'` narrows without either being named).
export {
  adoptedSkills,
  lookupServedSkill,
  type ServedSkill,
  type SkillCatalogue,
  type SkillLookup,
  type SkillRef,
  skillCatalogue,
  skillDisposition,
} from './context/skills.js';
// The TYPE only, and from the module that OWNS the task machine's reads rather than
// from the composition that serves them: `WorkItem` is what `Bootstrap.work` is made
// of, so reading the opening context needs it written down. Neither `liveWork` nor
// `tasksAwaitingJudgement` is exported for the reason `decisionsInForce` is not —
// they are called by `bootstrap` and by nothing outside this package, and an export
// with no consumer is the shape `every-public-value-has-a-caller.test.ts` catches.
export type { WorkItem } from './context/tasks.js';
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
  type RecordEvents,
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
// Two readings of the same graph, and both are values here because two different
// surfaces consume them: `governingRules` answers a caller that asked, and
// `rulesInForceAt` answers a channel that pushes. The second is not reachable through
// the first — it narrows to what is in force, which is a decision the pushing channel
// has no right to take for itself.
export {
  type AddressedRule,
  type GovernanceCounts,
  type GovernanceQuery,
  type GoverningRules,
  governingRules,
  type PushedRule,
  type RulesAtPath,
  rulesInForceAt,
} from './intelligence/governance.js';
export { knownAnchors } from './intelligence/identities.js';
export {
  type PatternMove,
  type PatternMoveAction,
  type PatternMoveWitness,
  patternMoveWitness,
} from './intelligence/pattern-moves.js';
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
