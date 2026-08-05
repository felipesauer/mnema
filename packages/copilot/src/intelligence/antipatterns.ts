/**
 * antipatterns (evolve++): recurring shapes in the record, with their evidence.
 *
 * Some things the events say happen again and again: a task reopened after it was
 * done, a decision superseded by a later one, a skill deprecated. Each is a real,
 * COUNTABLE fact of the chain — a `task.transitioned {action: "reopen"}` exists
 * only because a reopen happened. This derivation finds those shapes, counts how
 * often each occurred, and hands back the EVIDENCE: the exact events that make up
 * the count.
 *
 * It POINTS, it does not CONCLUDE. It says "this task reopened 3 times, here are
 * the three events" — never "this is a problem", "too much rework", "a bad
 * decision". The word "antipattern" names the SHAPE it looks for, not a verdict
 * on what it finds; nothing in the output calls anything good or bad. Whether a
 * reopen count is a smell or a healthy iteration is the reader's judgment, made
 * against context this layer does not have. That restraint is the line: the
 * moment it graded a finding it would be inventing a fact the chain never proved.
 *
 * Two things it deliberately does NOT do:
 *   - It does not detect "bypassed gates". There is no such event: the gate runs
 *     at write time, so an event exists ONLY because it passed. A bypass leaves
 *     no fact to find — claiming to detect it would be inventing one.
 *   - It does not create a skill. Tasks that reopen repeatedly are surfaced as
 *     skill CANDIDATES — a pointer for a human who might distill a reusable
 *     pattern — but the skill is only born if a human runs the write. This layer
 *     reads; it never writes, and never auto-adopts a candidate.
 *
 * The scope is the caller's: it folds exactly the stream handed to it. It reads
 * the transition payloads (`action`) to spot the shapes and the envelope
 * (`subject`, `at`) to attribute and order them.
 *
 * ## The record, and the chains it is made of
 *
 * A record is read TWICE over, and the two views are not interchangeable. The
 * recurring shapes are counted over the record as a whole ({@link RecordEvents.events}),
 * because an entity's story is the record's and not one tree's. The `ADR-<n>`
 * collision is found in each chain on its own ({@link RecordEvents.chains}), because
 * that is the only unit the number claims to be unique in: it is minted from the
 * writer's view of ONE chain, so a project's public and private trees each hold an
 * `ADR-1` as soon as both have a decision, and a read that pooled them would report
 * the product's own design as a fault, on nearly every project. Both views come from
 * one reading of the tails (`orderedEventsOfRecord` in @mnema/core), so the second one
 * costs a walk rather than a second parse.
 *
 * ## One record, or every project of a workspace
 *
 * {@link antipatterns} folds one record, which is the answer when the caller is asking
 * about one. {@link antipatternsByProject} keeps a workspace's records apart — one set
 * of shapes each, never merged — because everything it returns is a COUNT, and counts
 * of three codebases added together answer a question nobody asked under the name of
 * one somebody did. It calls the same fold, once per record. The labels make that
 * sharper rather than softer: `ADR-1` in one codebase and `ADR-1` in another are two
 * projects numbering their own rules, and a merged answer would invent a clash between
 * two records nobody cites together.
 */

import { type AdrCollision, adrCollisions, projectDecisions } from '@mnema/core';
import type { CatalogEvent } from './events.js';

/** How many times an entity underwent a counted transition, with the evidence. */
export interface RecurrenceFinding {
  /** The entity id (a task, decision, or skill) the finding is about. */
  readonly entityId: string;
  /** How many times the counted transition occurred for this entity. */
  readonly count: number;
  /** The events that make up the count, in stream order — the evidence. */
  readonly evidence: readonly CatalogEvent[];
}

/** The recurring shapes found in a stream, each a pointer to its evidence. */
export interface Antipatterns {
  /**
   * Tasks that were reopened (`task.transitioned {action: "reopen"}`), one entry
   * per task that reopened at least once, most reopens first (then id-sorted).
   */
  readonly reopenedTasks: readonly RecurrenceFinding[];
  /**
   * Decisions that were superseded (`decision.transitioned {action:
   * "supersede"}`), one entry per superseded decision.
   */
  readonly supersededDecisions: readonly RecurrenceFinding[];
  /**
   * Skills that were deprecated (`skill.transitioned {action: "deprecate"}`), one
   * entry per deprecated skill.
   */
  readonly deprecatedSkills: readonly RecurrenceFinding[];
  /**
   * Tasks that reopened more than once — POINTED at as candidates a human might
   * distill into a reusable skill. A pointer, never an action: nothing here
   * creates a skill. This is the `reopenedTasks` subset with `count >= 2`, carried
   * separately so a reader need not re-derive the threshold.
   */
  readonly skillCandidates: readonly RecurrenceFinding[];
  /**
   * `ADR-<n>` labels that more than one decision of ONE chain answers to, each with
   * every id that carries it — one label naming two rules, which is the one shape
   * here that is not a count.
   *
   * It is a shape of the record like the others and it is found the same way: stated
   * with its evidence, never judged, and never acted on. Nothing renumbers a label —
   * both were frozen into signed events by machines that could not see each other, so
   * there was no write to refuse and there is no edit to make.
   *
   * Two entries can carry the same label when two chains of one record each hold a
   * collision on it. That is two findings and not one: they are clashes in different
   * chains, and merging them would name four ids as if any two of them competed.
   */
  readonly labelCollisions: readonly AdrCollision[];
}

/** One record read two ways: as a whole, and as the chains it is made of. */
export interface RecordEvents {
  /**
   * That record's events in one proven order. ONE ENTRY PER RECORD: the merge across
   * a project's own trees belongs to whoever read them (it is a k-way merge over
   * tails, which a pure fold cannot redo), so two entries for one project would come
   * back as two entries here — visibly, rather than by silently concatenating two
   * streams into an order neither one proves.
   */
  readonly events: readonly CatalogEvent[];
  /**
   * The same record's chains, each on its own — the unit an `ADR-<n>` is numbered
   * in, which the merged stream above cannot recover (nothing on an event says which
   * chain it was read from). A record whose trees have never been written contributes
   * empty entries, and an empty list is a record with no chains rather than a record
   * with no collisions: both answer the same here, and there is nothing to tell apart.
   */
  readonly chains: readonly (readonly CatalogEvent[])[];
}

/** One record's two views, and which record it is. */
export interface ProjectEvents extends RecordEvents {
  /**
   * The project whose trees these came from — absent for the machine-global tree,
   * which belongs to no project and is the same tree for all of them.
   */
  readonly project?: string;
}

/** One record's recurring shapes, and which record they are in. */
export interface ProjectAntipatterns extends Antipatterns {
  /** The project whose record this is — absent for the machine-global tree. */
  readonly project?: string;
}

/** The records of a workspace, each with its own shapes, never added together. */
export interface WorkspaceAntipatterns {
  /**
   * One set of shapes per record: each project of the workspace, and the
   * machine-global tree. Projects in the order the caller handed them over, the
   * projectless entry last.
   *
   * A record with nothing recurring is still HERE, with four empty lists. An entry
   * missing from the list would be indistinguishable from a record the read never
   * opened.
   */
  readonly byProject: readonly ProjectAntipatterns[];
}

/**
 * The recurring shapes in one record. An entity appears only if its shape occurred
 * (a task with no reopen is absent, not a zero row). Each finding carries the
 * evidence events in the stream's own order, so a reader can inspect exactly what
 * was counted. An empty or shape-free record yields empty lists, never an error.
 *
 * ONE record's shapes. Handed the merged streams of several projects it would count
 * across codebases — {@link antipatternsByProject} is that read.
 *
 * It takes the record as ONE argument holding both views rather than two arguments,
 * so a caller cannot hand over the whole of one record and the chains of another:
 * the two are read together and travel together.
 */
export function antipatterns(record: RecordEvents): Antipatterns {
  const reopens = collect(record.events, (e) =>
    e.kind === 'task.transitioned' && e.payload.action === 'reopen' ? e.subject : undefined,
  );
  const supersedes = collect(record.events, (e) =>
    e.kind === 'decision.transitioned' && e.payload.action === 'supersede' ? e.subject : undefined,
  );
  const deprecates = collect(record.events, (e) =>
    e.kind === 'skill.transitioned' && e.payload.action === 'deprecate' ? e.subject : undefined,
  );
  return {
    reopenedTasks: reopens,
    supersededDecisions: supersedes,
    deprecatedSkills: deprecates,
    skillCandidates: reopens.filter((f) => f.count >= 2),
    labelCollisions: collisionsPerChain(record.chains),
  };
}

/**
 * Every label naming two rules, chain by chain, in one list ordered by label then by
 * the first id — total, so the same record always reports the same way.
 *
 * ONE detector, called once per chain: the same {@link adrCollisions} the cache over
 * a chain calls for the document. What differs between the two readers is the source
 * (a projection already built, or a stream folded here), never the rule — "which
 * labels name more than one rule" written twice is two rules that can come to
 * disagree, in a product whose answer to a clash is that a human reconciles it.
 */
function collisionsPerChain(chains: readonly (readonly CatalogEvent[])[]): AdrCollision[] {
  return chains
    .flatMap((events) => adrCollisions(projectDecisions(events).values()))
    .sort((a, b) => order(a.adr, b.adr) || order(a.ids[0] ?? '', b.ids[0] ?? ''));
}

/** String order, as a number, so two keys can be tried in sequence. */
function order(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The recurring shapes of EACH record handed in, kept apart, with the project whose
 * record it is on every entry.
 *
 * DECOMPOSED, never merged, and that followed from what this read returned: every
 * field of it WAS a count with its evidence. "Three tasks reopened" across three
 * codebases is not a fact about any of them, and the entity ids inside would come from
 * records a reader cannot act on together — a skill candidate is distilled in the
 * project whose work kept reopening, so a candidate list that mixed projects would
 * point a person at work they are not doing.
 *
 * `labelCollisions` is the field that is NOT a count, and it does not weaken the rule
 * — it is the sharpest case of it. Merging counts inflates an answer; merging labels
 * INVENTS one, because two projects numbering their own first decision `ADR-1` is two
 * records doing exactly what they should, and a pooled read would report the pair as a
 * clash nobody can reconcile. So the argument for keeping records apart no longer
 * rests on every field being a count, and the rule it rests on instead is the one
 * above it: an answer about a record is about that record.
 *
 * Not decomposing was the other way to be wrong: this read takes no project argument,
 * deliberately, so shapes locked to the session's own project leave an agent unable to
 * ask about the others at all.
 *
 * The entries are in source order with the projectless record last, and they are NOT
 * ordered by count. Ordering records by how much recurred would rank the projects,
 * which is the one thing a read that "points and does not conclude" must not do.
 */
export function antipatternsByProject(sources: readonly ProjectEvents[]): WorkspaceAntipatterns {
  const byProject = sources
    .map((source) => ({
      ...(source.project !== undefined ? { project: source.project } : {}),
      ...antipatterns(source),
    }))
    .sort(projectlessLast);
  return { byProject };
}

/** Keeps the projectless record after the projects, leaving their order untouched. */
function projectlessLast(a: ProjectAntipatterns, b: ProjectAntipatterns): number {
  if (a.project === b.project) return 0;
  if (a.project === undefined) return 1;
  if (b.project === undefined) return -1;
  return 0;
}

/**
 * Groups the events a `select` maps to an entity id into per-entity findings,
 * preserving stream order within each entity's evidence and ordering the findings
 * by count (descending) then id (ascending) for a stable, deterministic shape.
 * `select` returns the entity id an event counts toward, or undefined to skip it.
 */
function collect(
  events: readonly CatalogEvent[],
  select: (event: CatalogEvent) => string | undefined,
): RecurrenceFinding[] {
  const byEntity = new Map<string, CatalogEvent[]>();
  for (const event of events) {
    const id = select(event);
    if (id === undefined) continue;
    const evidence = byEntity.get(id);
    if (evidence === undefined) byEntity.set(id, [event]);
    else evidence.push(event);
  }
  return [...byEntity.entries()]
    .map(([entityId, evidence]) => ({ entityId, count: evidence.length, evidence }))
    .sort((a, b) =>
      a.count !== b.count
        ? b.count - a.count
        : a.entityId < b.entityId
          ? -1
          : a.entityId > b.entityId
            ? 1
            : 0,
    );
}
