/**
 * focus / resume: what an actor is touching now, and where they left off.
 *
 * Focus is always someone's focus — "the run I opened", "what I am in the middle
 * of". There is no notion of a current actor in the record (a `who` is only ever
 * stamped on past events), so the actor is a PARAMETER: the caller says whose
 * focus to derive, and the derivation stays pure and testable. Who the actor is
 * — the local key, the open session — is a question for the surface, not for a
 * read-only view.
 *
 * WHAT AN ACTOR CAN BE TIED TO (a real limit of today's projections). A run
 * carries its authorizing `who`, so "the runs this actor opened" is derivable.
 * A task projection does NOT carry `who` or `run` — the birth/transition events
 * stamp them on the envelope, but the projection drops them — so "the tasks this
 * actor is working" cannot be derived from the read model as it stands. Focus
 * therefore reports what is honestly tied to the actor: their open runs (each
 * with the goal and agent the run declared). It does not claim a set of tasks
 * as "the actor's", because the projection cannot support that claim. When a
 * future slice projects the run/who a task belongs to, focus gains the actor's
 * tasks with no change to this contract. (See the report's debt note.)
 */

import { canonicalIdentity, type ProjectionCache, type RunProjection } from '@mnema/core';

/** Which actor to derive context for. */
export interface ActorScope {
  /** The authorizing identity whose context to read (a run's `who`). */
  readonly actor: string;
}

/** What an actor is touching now: the runs they have open. */
export interface Focus {
  /** The actor this focus is for (canonical form). */
  readonly actor: string;
  /** The actor's currently open runs, most recently started first. */
  readonly openRuns: readonly RunProjection[];
}

/** Where an actor left off: their latest run, plus their current focus. */
export interface Resume {
  /** The actor this resume is for (canonical form). */
  readonly actor: string;
  /**
   * The actor's most recently started run — open OR already ended — or null if
   * the actor has no run at all. This is the "where was I" anchor: even a run
   * that ended yesterday carries the goal that reminds the actor what it was.
   */
  readonly lastRun: RunProjection | null;
  /** The actor's current focus (open runs), composed in. */
  readonly focus: Focus;
}

/**
 * The actor's focus: their open runs, most recently started first. Reads only
 * `listOpenRuns` and filters by `who`. An actor with nothing open gets an empty
 * list — never another actor's runs. A blank/whitespace actor matches nothing.
 */
export function focus(cache: ProjectionCache, scope: ActorScope): Focus {
  // Canonicalize the actor with the core's OWN identity rule (trim + NFC) — the
  // same rule the gate and the write operations apply, so this filter compares
  // the actor against `who` in the form the core produces it. In practice every
  // `who` is a writer anchor derived from a key (never a typed string), so it is
  // already canonical and the trim is a no-op; matching a differently-composed
  // (NFD) spelling still works because both sides land in NFC. The one thing this
  // does NOT match is a `who` sealed OUTSIDE that discipline — e.g. one padded
  // with spaces, which the chain stores verbatim (it NFC-normalizes but does not
  // trim). Such a `who` cannot arise from the gate or an operation, so refusing
  // to match it is correct: it would be an event no legal write could produce.
  const actor = canonicalIdentity(scope.actor);
  const openRuns =
    actor === undefined
      ? []
      : cache
          .listOpenRuns()
          .filter((r) => r.who === actor)
          .sort(byStartedDesc);
  return { actor: actor ?? '', openRuns };
}

/**
 * Where the actor left off: their latest run (open or ended) plus their focus.
 * The latest run is the one with the greatest `startedAt` among ALL the actor's
 * runs, not just the open ones — so a finished session still answers "what was
 * I doing". Composes {@link focus} for the "what is still open" half.
 */
export function resume(cache: ProjectionCache, scope: ActorScope): Resume {
  const actor = canonicalIdentity(scope.actor);
  const mine = actor === undefined ? [] : cache.listRuns().filter((r) => r.who === actor);
  // Sort a copy, then take the head; the default handles the empty case without
  // a non-null assertion (the list may be empty).
  const [lastRun = null] = [...mine].sort(byStartedDesc);
  return { actor: actor ?? '', lastRun, focus: focus(cache, scope) };
}

/** Newest run first, by `startedAt`. Ties keep a stable (id) order. */
function byStartedDesc(a: RunProjection, b: RunProjection): number {
  if (a.startedAt !== b.startedAt) return a.startedAt < b.startedAt ? 1 : -1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
