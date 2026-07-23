/**
 * The knowledge projection: fold an ordered event stream into captured memories.
 *
 * Like every projection this is a PURE, deterministic replay — it does not
 * validate, and given the same ordered events always yields the same result.
 * But where the task projection joins two things (existence AND a state derived
 * from transitions), a memory is a point-in-time FACT: existence is the whole
 * of it. There is no state accumulator and no completeness guard, because a
 * memory has no state to derive — the single `memory.captured` event both proves
 * it exists and carries everything it is. Because nothing is derived, nothing a
 * future workflow could change can ever re-derive it wrongly: replaying a memory
 * a thousand times gives the identical fact. This is why a memory needs no birth
 * pair the way a task or decision does — the birth pair exists only to pin an
 * initial STATE, and a fact with no state has none to pin.
 *
 * The single rule, applied verbatim:
 *   - a memory EXISTS once its `memory.captured` is seen;
 *   - its CONTENT, its author (`who`), and its capture time (`at`) are read
 *     straight off that one event.
 *
 * The filter — take only the knowledge kinds — is what gives the knowledge
 * domain its own view over the same shared tail: memories live in the same chain
 * as tasks and runs, and the projection separates them by kind, never by a
 * separate store or tail.
 */

import type { CatalogEvent } from '@mnema/chain';

/** A captured memory, as projected from its one event. */
export interface MemoryProjection {
  /** The memory's id (the event subject). */
  readonly id: string;
  /** The captured content. */
  readonly content: string;
  /** The anchor that captured it (the authorizing `who`). */
  readonly who: string;
  /** `at` of the capture. */
  readonly capturedAt: string;
}

/**
 * Folds ordered events into a map of memory id → projection. It keeps ONLY
 * `memory.captured` events; every other kind is another domain's concern. A
 * memory needs no completeness guard the way a task does — one event is the
 * whole fact, so seeing it is enough to project it.
 *
 * If two `memory.captured` events ever shared a subject (they cannot: the id is
 * minted per capture), the last seen would win — but that path is unreachable
 * by construction, so the fold stays a plain last-write map with no special
 * case.
 */
export function projectKnowledge(events: readonly CatalogEvent[]): Map<string, MemoryProjection> {
  const result = new Map<string, MemoryProjection>();
  for (const event of events) {
    if (event.kind === 'memory.captured') {
      result.set(event.subject, {
        id: event.subject,
        content: event.payload.content,
        who: event.who,
        capturedAt: event.at,
      });
    }
  }
  return result;
}

/** An observation, as projected from its one event. */
export interface ObservationProjection {
  /** The observation's OWN id (the event subject). */
  readonly id: string;
  /** The id of the entity observed (from the payload, resolved on read). */
  readonly about: string;
  /** The topic label. */
  readonly topic: string;
  /** The observation text. */
  readonly text: string;
  /** The anchor that recorded it (the authorizing `who`). */
  readonly who: string;
  /** `at` of the observation. */
  readonly recordedAt: string;
}

/**
 * Folds ordered events into a map of observation id → projection, keeping ONLY
 * `observation.recorded`. Like a memory, an observation is a point-in-time fact
 * with no state, so existence is the whole of it and one event projects it.
 * Because each observation carries its OWN minted id as the subject, two
 * observations about the same entity never overwrite one another — they are
 * distinct rows keyed by distinct ids, and the entity they share sits in the
 * `about` field, not the key.
 */
export function projectObservations(
  events: readonly CatalogEvent[],
): Map<string, ObservationProjection> {
  const result = new Map<string, ObservationProjection>();
  for (const event of events) {
    if (event.kind === 'observation.recorded') {
      result.set(event.subject, {
        id: event.subject,
        about: event.payload.about,
        topic: event.payload.topic,
        text: event.payload.text,
        who: event.who,
        recordedAt: event.at,
      });
    }
  }
  return result;
}

/** One handoff on a task, as projected from its event. */
export interface HandoffProjection {
  /** The task the handoff is about (the event subject). */
  readonly task: string;
  /** The agent handing off. */
  readonly fromAgent: string;
  /** The agent taking over (may equal `fromAgent`). */
  readonly toAgent: string;
  /** The anchor that recorded it (the authorizing `who`). */
  readonly who: string;
  /** `at` of the handoff. */
  readonly recordedAt: string;
}

/**
 * Folds ordered events into a map of task id → the LIST of its handoffs, keeping
 * ONLY `handoff.recorded`. A handoff's subject is the task, and a task may have
 * many handoffs over its life — so unlike a memory (one fact per id) the fold
 * ACCUMULATES into a list rather than overwriting last-write. The list is in the
 * order the events were seen, which the ordered stream keeps stable (by `at`).
 * A task with no handoff simply has no entry.
 */
export function projectHandoffs(events: readonly CatalogEvent[]): Map<string, HandoffProjection[]> {
  const result = new Map<string, HandoffProjection[]>();
  for (const event of events) {
    if (event.kind === 'handoff.recorded') {
      const handoff: HandoffProjection = {
        task: event.subject,
        fromAgent: event.payload.fromAgent,
        toAgent: event.payload.toAgent,
        who: event.who,
        recordedAt: event.at,
      };
      const list = result.get(event.subject);
      if (list === undefined) result.set(event.subject, [handoff]);
      else list.push(handoff);
    }
  }
  return result;
}

/**
 * One knowledge link, as a directed edge. The relation is N:N and cross-type —
 * a subject may link to many targets and a target may be linked from many
 * subjects — so a link is projected as an EDGE, not as columns on an entity the
 * way a 1:1 supersede is. Both endpoints are only ids; what each is (a memory, a
 * task, a decision) is resolved on read by crossing the other projections.
 */
export interface LinkEdge {
  /** The entity that originates the link (the event subject). */
  readonly subject: string;
  /** The entity linked to. */
  readonly target: string;
  /** The relation label (an open literal string). */
  readonly rel: string;
  /** The anchor that recorded it (the authorizing `who`). */
  readonly who: string;
  /** `at` of the link. */
  readonly linkedAt: string;
}

/**
 * Folds ordered events into the list of knowledge-link EDGES, keeping ONLY
 * `knowledge.linked`. Where a supersede is 1:1 and can be folded into two
 * columns on the decision (supersededBy/supersedes), a link is N:N cross-type,
 * so it is projected as a flat set of directed edges. Querying "what links out
 * of X" and "what links into X" is then a filter on `subject` vs `target` — both
 * directions answerable from the same edge set, the same bidirectional
 * reachability the supersede's two columns give, generalized to N:N.
 *
 * A duplicate edge — the same (subject, target, rel) recorded twice, e.g. by two
 * offline clones — is COLLAPSED to one: the relation is idempotent (X relates-to
 * Y is either true or not; asserting it twice adds nothing), so the fold keeps a
 * single edge per (subject, target, rel), with the FIRST-seen envelope (`who`,
 * `linkedAt`) as its origin. This keeps the union of two clones that both
 * asserted the same link from double-counting it.
 *
 * No dangling check: an edge whose target (or subject) is not present in the
 * projected entities is an honest cross-tree assertion, kept verbatim. The
 * reader resolves it against the union of trees.
 */
export function projectLinks(events: readonly CatalogEvent[]): LinkEdge[] {
  const seen = new Map<string, LinkEdge>();
  for (const event of events) {
    if (event.kind === 'knowledge.linked') {
      const key = edgeKey(event.subject, event.payload.target, event.payload.rel);
      if (seen.has(key)) continue; // idempotent: a repeated assertion adds nothing.
      seen.set(key, {
        subject: event.subject,
        target: event.payload.target,
        rel: event.payload.rel,
        who: event.who,
        linkedAt: event.at,
      });
    }
  }
  return [...seen.values()];
}

/**
 * The dedup key for an edge, framed so it is unambiguous for ANY content. Each
 * part is prefixed with its length (`<len>:<part>`), so no choice of delimiter
 * can be forged inside a part to make two distinct triples collide. A plain
 * delimiter would not be safe: `rel` is an open literal string and `target` is
 * not format-checked, so either could contain the delimiter itself — e.g.
 * (target `"B\nx"`, rel `"y"`) and (target `"B"`, rel `"x\ny"`) would share a
 * newline-joined key and the second edge would be dropped as a false duplicate.
 * Length-prefixing removes that ambiguity the same way the chain frames its hash
 * inputs.
 */
function edgeKey(subject: string, target: string, rel: string): string {
  return `${subject.length}:${subject}|${target.length}:${target}|${rel.length}:${rel}`;
}
