/**
 * The run projection: fold an ordered event stream into current run state.
 *
 * A run is the session an agent works inside, and it is a first-class entity:
 * `run.started` names the agent that executes (`which`) and carries, on its
 * envelope, the human who authorized the session (`who`) — the root of
 * authority for everything done in that run. `run.ended` closes it. The domain
 * that gates actions will ask this projection "who authorized this run?", so
 * the authorizer is projected explicitly, not left implicit on events.
 *
 * Like every projection this is a pure, deterministic replay — no validation,
 * no re-judging; it replays facts. The rule mirrors tasks:
 *   - a run EXISTS once its `run.started` is seen;
 *   - it is OPEN until a `run.ended` for the same run is seen;
 *   - its authorizer (`who`), agent, goal, and outcome are read literally.
 *
 * A `run.ended` with no `run.started` is not a run and is not projected. A run
 * id is unique (a fresh id per session), so a run closes once and stays closed;
 * a second `run.started` for an id already ended is not a legal flow, and the
 * projection — which replays rather than polices — leaves the run closed.
 *
 * It also folds WHEN THE RUN LAST DID SOMETHING ({@link RunProjection.lastFactAt}),
 * and that is the one field here read off events the run is not the subject of: any
 * event whose envelope pins it to this run. The reads that report an open run need
 * it — a run's own `startedAt` says how long it has existed and nothing about
 * whether anything is still happening in it — and every other way of getting it
 * would replay the stream a second time to learn something this pass already sees.
 * Absent when the run has recorded nothing, which is a real state: a session opens
 * its run on the first write, so a run with no fact pinned to it is one whose first
 * write did not land.
 *
 * AND WHAT WAS WRITTEN IN IT ({@link RunProjection.wrote}), off the SAME pass and the
 * same envelope slot. The two fields are one question asked along its two axes — an
 * instant says WHEN the last fact landed and can never say WHAT landed — and the
 * measurement that asked for the second one put it plainly: every read that reports a
 * run reported the CONTAINER, never what was put in it. A reader shown `last recorded
 * 12s ago` learns that a session is alive and nothing whatever about what it did.
 *
 * It is a COUNT PER KIND and not a list of the facts, and that is a divergence from
 * the naming convention the opening context states for its own lists (names and ids,
 * cut, with the total beside the cut — see `copilot`'s `bootstrap.ts`). The reason is
 * the ceiling: those lists are over entities, which a record holds without limit, so
 * they are cut and the cut declares itself; this one is over the event CATALOG, which
 * is a closed union, so its length is bounded by the number of kinds whatever the run
 * did. A bounded answer needs no cut, and a cut it does not need would be a second
 * observable decision to document for nothing. What a caller loses is the id of each
 * fact — which is the entity's own history, and `audit_timeline` answers it per
 * entity, which is the question anyone actually asks next.
 *
 * SIGNATURE CAVEAT (shared by every projection). A projection reflects the facts
 * as written; it does not itself attest that they are signature-covered. The
 * fields it reads — `who` above all — carry only the assurance of the chain
 * layer that covers them: an event past the last checkpoint rests on the keyless
 * hash chain alone (the declared residual window). So a `who` read from the read
 * model inherits that caveat: it is authenticated only once `verify(...)`
 * reports `fullySigned` for the range it sits in. Consult the verifier for the
 * proof grade; the read model is the queryable state, not the attestation.
 */

import type { CatalogEvent, EventKind } from '@mnema/chain';

/**
 * One sort of fact written in a run, and how many of it there were.
 *
 * The `kind` is the catalog's own discriminator, not a second vocabulary: it is what
 * `search` filters by and what a tool description already names, so a reader that
 * meets `decision.recorded` here can spell it at the next read without translating.
 */
export interface WrittenInRun {
  /** The event kind, as the catalog spells it. */
  readonly kind: EventKind;
  /** How many facts of that kind were pinned to the run. At least 1 — a zero is no row. */
  readonly count: number;
}

/** Current projected state of one run. */
export interface RunProjection {
  /** The run's id (the event subject). */
  readonly id: string;
  /** The agent the run is for — the `which` of its actions. */
  readonly agent: string;
  /** The human who authorized the session — the root of authority. */
  readonly who: string;
  /** The stated goal, if the run declared one. */
  readonly goal?: string;
  /** The outcome note, if the run ended with one. */
  readonly outcome?: string;
  /** True while the run has no `run.ended`. */
  readonly open: boolean;
  /** `at` of `run.started`. */
  readonly startedAt: string;
  /** `at` of `run.ended`, if it has ended. */
  readonly endedAt?: string;
  /**
   * `at` of the most recent fact PINNED to this run — the latest event whose
   * envelope carries `run: <this id>`.
   *
   * Absent when nothing has been pinned to it. That is not a gap: neither
   * `run.started` nor `run.ended` carries a `run` (their subject IS the run), so
   * this field speaks only of the WORK done inside the session, and a run holding
   * none has done none.
   *
   * The `at` is the writer's own clock, like every other instant in the record.
   * Comparing it against a reader's clock compares two clocks, which is what a
   * reader has and what it must be told (see the surfaces that report idleness).
   */
  readonly lastFactAt?: string;
  /**
   * WHAT was written in this run: one entry per kind of fact pinned to it, with how
   * many of that kind there were.
   *
   * ALWAYS PRESENT, and EMPTY is the answer for a run that wrote nothing — never
   * absent. That is the one deliberate difference from {@link RunProjection.lastFactAt}
   * beside it, which is absent in exactly the same case: an absent field is read as
   * "this reader does not know", and the two claims are not the same claim. Here the
   * fold DOES know — it saw every event of the stream — so it says so with a list
   * whose length is zero.
   *
   * Read off the same envelope slot as `lastFactAt` (`run: <this id>`), so it counts
   * the WORK done in the session and not the session's own bookkeeping: neither
   * `run.started` nor `run.ended` carries a `run`, so a run that only opened and
   * closed reports `[]`.
   *
   * Ordered by `count` DESCENDING, ties broken by `kind` ascending — a total order,
   * so the same events always fold to the same array and a caller may compare two
   * projections byte for byte. Commonest first because a reader scanning a session
   * asks what it mostly DID; the tie-break is the kind's own spelling because nothing
   * about two equal counts ranks one above the other, and a tie left unbroken would
   * hand the order to whichever kind the stream happened to reach first.
   *
   * Not cut, and it needs no total beside it: the entries are over the event catalog,
   * which is a closed union, so the length is bounded by the number of kinds however
   * long the run ran (see the module doc for why the opening context's cut convention
   * does not carry here).
   */
  readonly wrote: readonly WrittenInRun[];
}

/** Mutable accumulator; existence comes from `started`, closure from `ended`. */
interface RunAccumulator {
  agent?: string;
  who?: string;
  goal?: string;
  startedAt?: string;
  outcome?: string;
  endedAt?: string;
  lastFactAt?: string;
  /** How many facts of each kind were pinned to the run; ordered on the way out. */
  wrote: Map<EventKind, number>;
}

/**
 * Folds ordered events into a map of run id → projection. Only runs that have a
 * `run.started` appear; an ended-only run is dropped rather than invented.
 */
export function projectRuns(events: readonly CatalogEvent[]): Map<string, RunProjection> {
  const acc = new Map<string, RunAccumulator>();

  for (const event of events) {
    if (event.kind === 'run.started') {
      const entry = getOrInit(acc, event.subject);
      entry.agent = event.payload.agent;
      entry.who = event.who;
      entry.startedAt = event.at;
      if (event.payload.goal !== undefined) entry.goal = event.payload.goal;
    } else if (event.kind === 'run.ended') {
      const entry = getOrInit(acc, event.subject);
      entry.endedAt = event.at;
      if (event.payload.outcome !== undefined) entry.outcome = event.payload.outcome;
    }
    // Every event, whatever its kind, may be pinned to a run — including one whose
    // `run.started` this stream does not hold (a fact written in a project whose run
    // lives in another tree). Such a run gets an accumulator and is dropped below
    // for having no birth, which is the same rule an ended-only subject meets: this
    // projection reports the runs this tree opened, not the runs it was told about.
    if (event.run !== undefined) {
      const entry = getOrInit(acc, event.run);
      // MOST RECENT by `at`, not last-seen: the stream is ordered by the interleave
      // across tails, and a run's facts can arrive from more than one of them. Taking
      // whatever came last would let a tail read later hand back an earlier instant.
      if (entry.lastFactAt === undefined || entry.lastFactAt < event.at) {
        entry.lastFactAt = event.at;
      }
      // WHAT was written, counted on the same pass and off the same slot. Tallied by
      // kind rather than collected as ids: the catalog is a closed union, so a tally
      // is bounded whatever the run did, and a list of ids is not.
      entry.wrote.set(event.kind, (entry.wrote.get(event.kind) ?? 0) + 1);
    }
  }

  const result = new Map<string, RunProjection>();
  for (const [id, entry] of acc) {
    // Existence needs the started event; an ended-only subject is dropped.
    if (entry.agent === undefined || entry.who === undefined || entry.startedAt === undefined) {
      continue;
    }
    const projection: Mutable<RunProjection> = {
      id,
      agent: entry.agent,
      who: entry.who,
      open: entry.endedAt === undefined,
      startedAt: entry.startedAt,
      wrote: orderedWrites(entry.wrote),
    };
    if (entry.goal !== undefined) projection.goal = entry.goal;
    if (entry.outcome !== undefined) projection.outcome = entry.outcome;
    if (entry.endedAt !== undefined) projection.endedAt = entry.endedAt;
    if (entry.lastFactAt !== undefined) projection.lastFactAt = entry.lastFactAt;
    result.set(id, projection);
  }
  return result;
}

/** Local helper: build the readonly projection through a mutable shape. */
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

function getOrInit(acc: Map<string, RunAccumulator>, id: string): RunAccumulator {
  let entry = acc.get(id);
  if (entry === undefined) {
    entry = { wrote: new Map() };
    acc.set(id, entry);
  }
  return entry;
}

/**
 * The tally as the array a caller reads: commonest kind first, ties by the kind's own
 * spelling.
 *
 * The tie-break is what makes this a TOTAL order rather than nearly one, and that
 * matters beyond neatness: the array is stored and compared (`run-store.ts` round-trips
 * it, and `advance.test.ts` asserts an incremental fold writes the same bytes as a full
 * replay), so an order that depended on which kind the stream reached first would make
 * two equal records disagree.
 */
function orderedWrites(tally: Map<EventKind, number>): readonly WrittenInRun[] {
  return [...tally]
    .map(([kind, count]) => ({ kind, count }))
    .sort((a, b) => b.count - a.count || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0));
}
