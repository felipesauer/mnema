/**
 * timeline: the history of one entity, as the events that touch it.
 *
 * "Tell me the story of this task / decision / skill / memory." The story is the
 * events where the entity is the PROTAGONIST (`subject`) plus the events where it
 * is REFERRED to — an observation `about` it, a knowledge link whose `target` is
 * it. A task's narrative is richer than its own transitions: it was created,
 * moved, then someone observed something about it and linked it to a decision.
 * Those referring facts live on OTHER subjects (the observation's own id, the
 * linking entity's id), so a filter on `subject` alone would miss them; timeline
 * gathers all three axes.
 *
 * It RELATES, it does not JUDGE. Each entry is the event as written — when, what
 * kind, who authorized it, which agent executed it, and the role by which the
 * entity appears. No entry says a history is "long", "troubled", or "healthy":
 * that reading is the caller's. The line the whole intelligence layer holds.
 *
 * The stream is already in one total, deterministic order (`orderedEvents`), so
 * timeline PRESERVES that order rather than re-sorting — the k-way merge's order
 * is the faithful interleaving, and re-sorting by `at` alone would break a tail's
 * proven within-tail order when two events share an `at`. It filters and maps; it
 * never reorders.
 *
 * What it does NOT do: resolve what KIND the entity is, or what kind a referring
 * target is. The catalog carries ids, not kinds, across a relation (a link's
 * `target` is only an id); resolving "linked to a DECISION" means crossing
 * projections, a debt carried since the knowledge slice. timeline answers in
 * events and ids — the honest minimum. A surface that wants types crosses the
 * projections on top.
 */

import type { CatalogEvent, EventKind } from './events.js';

/** Why an entity appears in an event: as its subject, or referred to by it. */
export type TimelineRole =
  /** The entity IS the event's subject — the protagonist of the fact. */
  | 'subject'
  /** An observation is `about` the entity — it is referred to, not the subject. */
  | 'about'
  /** A knowledge link's `target` is the entity — it is pointed at. */
  | 'target';

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
  readonly role: TimelineRole;
  /** The event as written, for a reader that needs the typed payload. */
  readonly event: CatalogEvent;
}

/**
 * The history of `entityId`: every event where it is the subject, or is referred
 * to by an observation's `about` or a knowledge link's `target`, in the stream's
 * own order. An entity that no event touches yields an empty list. A blank
 * entityId matches nothing (a whitespace id is never a real minted id).
 *
 * An event that touches the entity on more than one axis at once cannot occur in
 * this catalog — the referring axes (`about`, `target`) live on events whose own
 * subject is a different id — so each matched event yields exactly one entry, and
 * `role` records the single axis by which it matched.
 */
export function timeline(events: readonly CatalogEvent[], entityId: string): TimelineEntry[] {
  if (entityId.trim() === '') return [];
  const out: TimelineEntry[] = [];
  for (const event of events) {
    const role = roleOf(event, entityId);
    if (role === undefined) continue;
    out.push({
      at: event.at,
      kind: event.kind,
      who: event.who,
      ...(event.which !== undefined ? { which: event.which } : {}),
      subject: event.subject,
      role,
      event,
    });
  }
  return out;
}

/**
 * The role by which `entityId` appears in `event`, or undefined if it does not.
 * Subject wins first (the entity is the protagonist); otherwise the referring
 * axes are checked on exactly the kinds that carry them.
 */
function roleOf(event: CatalogEvent, entityId: string): TimelineRole | undefined {
  if (event.subject === entityId) return 'subject';
  if (event.kind === 'observation.recorded' && event.payload.about === entityId) return 'about';
  if (event.kind === 'knowledge.linked' && event.payload.target === entityId) return 'target';
  return undefined;
}
