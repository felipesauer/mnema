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
 * SIGNATURE CAVEAT (shared by every projection). A projection reflects the facts
 * as written; it does not itself attest that they are signature-covered. The
 * fields it reads — `who` above all — carry only the assurance of the chain
 * layer that covers them: an event past the last checkpoint rests on the keyless
 * hash chain alone (the declared residual window). So a `who` read from the read
 * model inherits that caveat: it is authenticated only once `verify(...)`
 * reports `fullySigned` for the range it sits in. Consult the verifier for the
 * proof grade; the read model is the queryable state, not the attestation.
 */

import type { CatalogEvent } from '@mnema/chain';

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
    entry = {};
    acc.set(id, entry);
  }
  return entry;
}
