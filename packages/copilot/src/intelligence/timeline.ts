/**
 * timeline: the history of one entity, as the events that touch it.
 *
 * "Tell me the story of this task / decision / skill / memory." The story is the
 * events where the entity is the PROTAGONIST (`subject`) plus the events where it
 * is REFERRED to — an observation `about` it, a knowledge link whose `target` is
 * it, a supersede whose successor (`by`) is it. A task's narrative is richer than
 * its own transitions: it was created, moved, then someone observed something
 * about it and linked it to a decision. Those referring facts live on OTHER
 * subjects (the observation's own id, the linking entity's id), so a filter on
 * `subject` alone would miss them.
 *
 * Which is exactly what the REFERENCE INDEX holds — one row per (event, entity,
 * role) — so this reads the index rather than scanning the stream. Two things
 * follow from that, and both are the point:
 *
 *   - The fourth role costs nothing. `by` used to be invisible from the
 *     successor's side: the fact naming it lives on the SUPERSEDED decision's
 *     event, so a scan for "events whose subject is this decision" never found
 *     it and the successor's story never said it had superseded anything. As a
 *     row it is found by the same query as the other three.
 *   - It is answered from the cache. A history used to re-read every tree's
 *     tails on every call; now it is an indexed lookup per tree, which is what
 *     a warm session makes nearly free.
 *
 * It RELATES, it does not JUDGE. Each entry is the event as written — when, what
 * kind, who authorized it, which agent executed it, which tree AND WHICH PROJECT it
 * lives in, and the role by which the entity appears. No entry says a history is
 * "long", "troubled", or "healthy": that reading is the caller's. The line the whole
 * intelligence layer holds.
 *
 * The project is part of the story rather than decoration on it. An entity written in
 * one codebase and normalized into two others has its normalizations recorded in
 * THEIR records, and a merged history that only said `private` three times would put
 * three codebases behind one word.
 *
 * ## The order
 *
 * Within a tree the index keeps the stream's own position (`ord`), so a tree's
 * entries come back in its proven order — never re-sorted by `at`, which would
 * move a later-sequenced fact earlier whenever a clock stepped back. Across trees
 * they are merged by the SAME rule the chain's own union uses: repeatedly take
 * the tree whose next entry has the smallest `at`, ties broken by the fixed tree
 * order. That is a k-way merge, and a k-way merge is associative — merging each
 * tree's already-merged tails and then merging those lists lands exactly where
 * merging every tail at once lands, because every tail of an earlier tree sorts
 * before every tail of a later one. So this reproduces `orderedEventsAcross`
 * rather than approximating it, and a test holds it to that.
 *
 * What it does NOT do: resolve what KIND the entity is, or what kind a referring
 * target is. timeline answers in events and ids — the honest minimum. A surface
 * that wants types crosses the projections on top (`references` does exactly
 * that for the graph reading).
 */

import type { ReferenceRole, ReferenceRow, Scope } from '@mnema/core';
import type { ScopedCache } from '../sources.js';
import type { CatalogEvent, EventKind } from './events.js';

/** One event in an entity's history, normalized to what a reader needs. */
export interface TimelineEntry {
  /** ISO-8601 timestamp of the fact, straight from the envelope. */
  readonly at: string;
  /** The event kind (e.g. `task.transitioned`, `observation.recorded`). */
  readonly kind: EventKind;
  /** The human who authorized the fact (an anchor id). */
  readonly who: string;
  /** The agent that executed it, when one did. */
  readonly which?: string;
  /** The event's own subject id (NOT necessarily the queried entity). */
  readonly subject: string;
  /** How the queried entity appears in this event. */
  readonly role: ReferenceRole;
  /** The tree the fact lives in: the team's, this machine's, or the person's own. */
  readonly scope: Scope;
  /**
   * The project whose record holds the fact, absent for the machine-global tree.
   *
   * A history crosses projects — the entity was written in one and normalized into
   * another — so the scope alone no longer places an entry: two entries marked
   * `private` can be two different codebases. Absent means the machine-global tree,
   * which belongs to no project.
   */
  readonly project?: string;
  /** The event as written, for a reader that needs the typed payload. */
  readonly event: CatalogEvent;
}

/**
 * The history of `entityId` across `sources`: every event where it is the
 * subject, or is referred to by an observation's `about`, a knowledge link's
 * `target`, or a supersede's `by` — in the union's own order. An entity that no
 * event touches yields an empty list (a legitimate answer, never an error), and
 * a blank entityId matches nothing.
 *
 * An event that names the entity on more than one axis yields ONE entry, whose
 * `role` is the strongest of them: being the protagonist of a fact outranks
 * being referred to by it. The index applies that rule per tree, and an event
 * belongs to exactly one tree, so it holds across the merge too.
 */
export function timeline(sources: readonly ScopedCache[], entityId: string): TimelineEntry[] {
  const streams = sources
    .map((source) => ({
      source,
      rows: source.cache.references(entityId),
      cursor: 0,
    }))
    .filter((stream) => stream.rows.length > 0);

  const merged: TimelineEntry[] = [];
  for (;;) {
    const next = earliest(streams);
    if (next === undefined) break;
    merged.push(toEntry(next.rows[next.cursor] as ReferenceRow, next.source));
    next.cursor += 1;
  }
  return merged;
}

/**
 * One tree's entries for the queried entity, and how far they are drained.
 *
 * It keeps the SOURCE rather than copying the fields off it, because what an entry
 * has to say about where it came from is now two things and will not stay two if a
 * tree ever gains a third. A stream that copied them would be a second place for the
 * list of them to be maintained.
 */
interface Stream {
  readonly source: ScopedCache;
  readonly rows: readonly ReferenceRow[];
  cursor: number;
}

/**
 * The stream to take the next entry from: the one whose head has the smallest
 * `at`, ties broken by the order the trees were given. Consuming heads this way
 * never reorders a tree against its own proven order — only heads of DIFFERENT
 * trees are ever compared, exactly as the chain's own merge does it.
 */
function earliest(streams: readonly Stream[]): Stream | undefined {
  let chosen: Stream | undefined;
  for (const stream of streams) {
    if (stream.cursor >= stream.rows.length) continue;
    if (chosen === undefined) {
      chosen = stream;
      continue;
    }
    const head = (stream.rows[stream.cursor] as ReferenceRow).at;
    const best = (chosen.rows[chosen.cursor] as ReferenceRow).at;
    if (head < best) chosen = stream;
  }
  return chosen;
}

function toEntry(row: ReferenceRow, from: ScopedCache): TimelineEntry {
  return {
    at: row.at,
    kind: row.kind,
    who: row.who,
    ...(row.which !== undefined ? { which: row.which } : {}),
    subject: row.subject,
    role: row.role,
    scope: from.scope,
    ...(from.project !== undefined ? { project: from.project } : {}),
    event: row.event,
  };
}
