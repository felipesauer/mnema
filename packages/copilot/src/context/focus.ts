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
 * The same argument settles two more parameters, and it is the same argument
 * because they are the same kind of fact. The record does not hold WHICH SESSION IS
 * ASKING (a run carries its authorizing anchor, and one anchor is one machine, so
 * every session on a machine reads as the same actor) and it does not hold WHAT TIME
 * IT IS NOW (an `at` is only ever the instant a fact was written). Both are things
 * only the asker knows, so both arrive as {@link AskerContext} rather than being
 * reached for inside a derivation that must stay pure. That is what lets this file
 * report the two things a list of open runs is otherwise silently wrong about:
 * whether a run is the asker's own, and whether anything is still happening in it.
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
 *
 * EVERY TREE THE CALLER CAN SEE, not one. A run is opened in the tree the fact it
 * authorizes lands in, and what a session records is routed by KIND — so one
 * connection that recorded a decision and a memory holds two runs, one per tree,
 * and a derivation given a single cache would report half of what the actor has
 * open while looking complete. The caller says which caches those are; passing
 * `[cache]` is the honest answer when one tree is the whole world.
 *
 * Reading per-tree projections and concatenating is not an approximation of reading
 * the union: a run's whole history lands in ONE tree (it is opened and ended in the
 * tree it carries), so the per-tree fold and the union fold see the same events for
 * it. The order is a property of the CONTENT (`startedAt`, then id), so adding a
 * tree to the list never reshuffles what an asker sees.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: decide whether an open run is ABANDONED. The
 * record holds no fact about a process — no pid, no boot id — so "old" and "idle"
 * are what an asker can be told, and "dead" is not. A live agent sitting idle is
 * byte-identical to one that was killed, so a derivation that called either of them
 * finished would be asserting what nothing here proves. It reports; it does not
 * judge, and nothing in this file closes, hides or ranks a run by its age.
 */

import { canonicalIdentity, type ProjectionCache, type RunProjection } from '@mnema/core';

/**
 * What only the ASKER knows: the instant it is asking at, and the runs it opened
 * itself.
 *
 * Neither is in the record, and neither can be guessed from it. `asOf` is the
 * asker's own clock — the record's instants are all writers' clocks, so an age is
 * always a comparison of two clocks and never a fact of the chain. `sessionRuns`
 * is the structural answer to "is this run mine": a session KNOWS which runs it
 * opened, whereas the record cannot tell two sessions of one machine apart (they
 * share an anchor, and an agent name is declared rather than detected — so
 * filtering by the name would swap one wrong answer for another).
 */
export interface AskerContext {
  /**
   * The instant to measure age and idleness against, as an ISO-8601 timestamp —
   * normally the asker's own clock at the moment of the call.
   */
  readonly asOf: string;
  /**
   * The ids of the runs THE ASKER ITSELF opened. Empty when it has opened none,
   * which is the honest state for a read-only session and for a command-line
   * process (a read opens no run) — every run then reports as not this asker's,
   * because none of them is.
   */
  readonly sessionRuns: readonly string[];
}

/** Which actor to derive context for, and what the asker knows about itself. */
export interface ActorScope extends AskerContext {
  /** The authorizing identity whose context to read (a run's `who`). */
  readonly actor: string;
}

/**
 * A run as REPORTED to an asker: the projection, plus what only the asker's own
 * position adds.
 *
 * The three added fields are derived, never stored — nothing new is written to the
 * record to produce them. That is deliberate: the defect they answer is a session's
 * life cycle, and a permanent field on a signed, append-only event is the wrong
 * place for a detail whose useful life is minutes.
 */
export interface ReportedRun extends RunProjection {
  /**
   * Whether THIS asker opened this run.
   *
   * `false` says the run came from somewhere else — another live session on this
   * machine, or one that ended without recording it. It does NOT say the run is
   * dead, and it does not say another agent's work is less valid; it says only that
   * the asking session is not the one that opened it, which is exactly the
   * distinction "where did I leave off" needs and could not previously make.
   */
  readonly thisSession: boolean;
  /**
   * How many seconds ago the run STARTED, measured against {@link AskerContext.asOf}.
   *
   * Present only while the run is open: an ended run already reports `endedAt`, and
   * an age would invite reading it as time still passing.
   *
   * It compares the asker's clock against the WRITER's, so a run opened by a machine
   * whose clock differs reports that difference — including a NEGATIVE value, which
   * says the writer's clock is ahead of the asker's. It is left unclamped on purpose:
   * a zero there would hide a disagreement the reader would otherwise have no way to
   * see. Absent when either instant cannot be parsed.
   */
  readonly ageSeconds?: number;
  /**
   * How many seconds ago the run last RECORDED something, measured against
   * {@link AskerContext.asOf} — the answer to "is anything still happening in it".
   *
   * Present only while the run is open AND something is pinned to it. Absent means
   * the run has recorded NOTHING: a session opens its run at the first write, so a
   * run with no fact is one whose first write did not land. Its age is then the only
   * measure there is, and that is why the two fields are separate rather than one
   * with a shifting basis.
   *
   * Same two-clock caveat as {@link ReportedRun.ageSeconds}.
   */
  readonly idleSeconds?: number;
}

/** What an actor is touching now: the runs they have open. */
export interface Focus {
  /** The actor this focus is for (canonical form). */
  readonly actor: string;
  /** The actor's currently open runs, most recently started first. */
  readonly openRuns: readonly ReportedRun[];
}

/** Where an actor left off: their latest run, plus their current focus. */
export interface Resume {
  /** The actor this resume is for (canonical form). */
  readonly actor: string;
  /**
   * Where to pick up: a run THIS asker opened when it has one in this record,
   * otherwise the actor's most recently started run — open OR already ended — or
   * null if the actor has no run at all. `thisSession` on the answer says which of
   * the two happened, so the preference never has to be guessed at.
   *
   * The asker's own run wins because "where was I" is a question about the asking
   * session, and two live sessions on one machine share an anchor: without the
   * preference, whichever started later answered for both, and the answer was
   * regularly another agent's open work. A session that has written nothing has no
   * run to prefer, so it still gets the run the work actually happened in — which is
   * the whole reason the run is not opened at the handshake.
   */
  readonly lastRun: ReportedRun | null;
  /** The actor's current focus (open runs), composed in. */
  readonly focus: Focus;
}

/**
 * The actor's focus: their open runs, most recently started first. Reads only
 * `listOpenRuns` and filters by `who`. An actor with nothing open gets an empty
 * list — never another actor's runs. A blank/whitespace actor matches nothing.
 *
 * Every run comes back REPORTED (see {@link ReportedRun}): whether this asker
 * opened it, how old it is, and how long since it recorded anything. Ten sessions
 * that ended without closing their runs list as ten runs here — the list is not
 * pruned or ranked — but they no longer list as ten runs indistinguishable from the
 * asker's own.
 */
export function focus(caches: readonly ProjectionCache[], scope: ActorScope): Focus {
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
      : caches
          .flatMap((cache) => cache.listOpenRuns())
          .filter((r) => r.who === actor)
          .sort(byStartedDesc)
          .map((r) => report(r, scope));
  return { actor: actor ?? '', openRuns };
}

/**
 * Where the actor left off: their latest run (open or ended) plus their focus.
 * A run this asker opened wins; failing that, the greatest `startedAt` among ALL
 * the actor's runs, not just the open ones — so a finished session still answers
 * "what was I doing". Composes {@link focus} for the "what is still open" half.
 */
export function resume(caches: readonly ProjectionCache[], scope: ActorScope): Resume {
  const actor = canonicalIdentity(scope.actor);
  const mine =
    actor === undefined
      ? []
      : caches.flatMap((cache) => cache.listRuns()).filter((r) => r.who === actor);
  // Sort a copy, then take the head; the default handles the empty case without
  // a non-null assertion (the list may be empty).
  const newestFirst = [...mine].sort(byStartedDesc);
  // The asker's own first, and its OWN newest at that: a session with a run in these
  // records answers about that run. Run ids are minted, never typed, so both sides
  // are already the canonical form and a plain lookup cannot false-miss. A session
  // whose runs are all in trees NOT passed here finds none and falls through, which
  // is right — nothing given holds a run of its own to point at.
  const opened = new Set(scope.sessionRuns);
  const chosen = newestFirst.find((r) => opened.has(r.id)) ?? newestFirst[0];
  return {
    actor: actor ?? '',
    lastRun: chosen === undefined ? null : report(chosen, scope),
    focus: focus(caches, scope),
  };
}

/**
 * Adds to a run what only the asker's position can say. `ageSeconds` and
 * `idleSeconds` are attached only while the run is OPEN — the question they answer
 * ("is anything still happening here?") has no meaning for a run that has ended,
 * which already carries its own `endedAt`.
 */
function report(run: RunProjection, asker: AskerContext): ReportedRun {
  const thisSession = asker.sessionRuns.includes(run.id);
  if (!run.open) return { ...run, thisSession };
  const age = elapsedSeconds(run.startedAt, asker.asOf);
  const idle =
    run.lastFactAt === undefined ? undefined : elapsedSeconds(run.lastFactAt, asker.asOf);
  return {
    ...run,
    thisSession,
    ...(age !== undefined ? { ageSeconds: age } : {}),
    ...(idle !== undefined ? { idleSeconds: idle } : {}),
  };
}

/**
 * Whole seconds from one instant to another, or undefined when either does not
 * parse. Truncated toward the past (`floor`), so "3 seconds ago" never rounds up
 * into 4, and never clamped: a negative result is two clocks disagreeing, which is
 * a fact about the answer and not an error in it.
 */
function elapsedSeconds(from: string, to: string): number | undefined {
  const start = Date.parse(from);
  const end = Date.parse(to);
  if (Number.isNaN(start) || Number.isNaN(end)) return undefined;
  return Math.floor((end - start) / 1000);
}

/** Newest run first, by `startedAt`. Ties keep a stable (id) order. */
function byStartedDesc(a: RunProjection, b: RunProjection): number {
  if (a.startedAt !== b.startedAt) return a.startedAt < b.startedAt ? 1 : -1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
