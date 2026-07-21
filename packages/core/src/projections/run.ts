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
}

/** Mutable accumulator; existence comes from `started`, closure from `ended`. */
interface RunAccumulator {
  agent?: string;
  who?: string;
  goal?: string;
  startedAt?: string;
  outcome?: string;
  endedAt?: string;
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
