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
 * ## One record, or every project of a workspace
 *
 * {@link antipatterns} folds one stream, which is the answer when that stream is one
 * record. {@link antipatternsByProject} keeps a workspace's records apart — one set
 * of shapes each, never merged — because everything it returns is a COUNT, and counts
 * of three codebases added together answer a question nobody asked under the name of
 * one somebody did. It calls the same fold, once per record.
 */

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
}

/** One record's events, already merged across its trees, and which record it is. */
export interface ProjectEvents {
  /**
   * The project whose trees these came from — absent for the machine-global tree,
   * which belongs to no project and is the same tree for all of them.
   */
  readonly project?: string;
  /**
   * That record's events in one proven order. ONE ENTRY PER RECORD: the merge across
   * a project's own trees belongs to whoever read them (it is a k-way merge over
   * tails, which a pure fold cannot redo), so two entries for one project would come
   * back as two entries here — visibly, rather than by silently concatenating two
   * streams into an order neither one proves.
   */
  readonly events: readonly CatalogEvent[];
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
 * The recurring shapes in `events`. An entity appears only if its shape occurred
 * (a task with no reopen is absent, not a zero row). Each finding carries the
 * evidence events in the stream's own order, so a reader can inspect exactly what
 * was counted. An empty or shape-free stream yields empty lists, never an error.
 *
 * ONE record's shapes. Handed the merged streams of several projects it would count
 * across codebases — {@link antipatternsByProject} is that read.
 */
export function antipatterns(events: readonly CatalogEvent[]): Antipatterns {
  const reopens = collect(events, (e) =>
    e.kind === 'task.transitioned' && e.payload.action === 'reopen' ? e.subject : undefined,
  );
  const supersedes = collect(events, (e) =>
    e.kind === 'decision.transitioned' && e.payload.action === 'supersede' ? e.subject : undefined,
  );
  const deprecates = collect(events, (e) =>
    e.kind === 'skill.transitioned' && e.payload.action === 'deprecate' ? e.subject : undefined,
  );
  return {
    reopenedTasks: reopens,
    supersededDecisions: supersedes,
    deprecatedSkills: deprecates,
    skillCandidates: reopens.filter((f) => f.count >= 2),
  };
}

/**
 * The recurring shapes of EACH record handed in, kept apart, with the project whose
 * record it is on every entry.
 *
 * DECOMPOSED, never merged, and that follows from what this read returns: every field
 * of it is a count with its evidence. "Three tasks reopened" across three codebases is
 * not a fact about any of them, and the entity ids inside would come from records a
 * reader cannot act on together — a skill candidate is distilled in the project whose
 * work kept reopening, so a candidate list that mixed projects would point a person at
 * work they are not doing.
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
      ...antipatterns(source.events),
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
