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
