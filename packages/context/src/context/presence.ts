/**
 * presence: which OTHER runs of this machine were charged at a path lately — the one reading
 * behind "another run consulted this path N min ago".
 *
 * WHAT IT IS MADE OF, and nothing is new. The record already holds two things that, put side by
 * side, say who has been at a path: the runs a machine has open (`run.started` with no
 * `run.ended`), and the facts a rule's charge leaves with the run it was made in and the path it
 * was about (`channel.asked`, `channel.refused`). This joins them. It writes nothing, and it adds
 * no kind and no field: a path on which no rule has ever charged anyone is a path the record has
 * no fact about, and this says nothing of it rather than guess.
 *
 * THE ACTOR IS THE MACHINE'S IDENTITY AND NOT THE SESSION, for the reason {@link focus} gives: a
 * committed record travels, and a teammate's open run is in it too. A run of somebody else is
 * not "here", and naming one would tell a person where a colleague is working. The runs of the
 * asker itself are left out, by the ids it holds ({@link AskerContext.sessionRuns}).
 *
 * THE CEILING OF AGE IS WHAT MAKES "OPEN" MEAN "HERE". An open run is not a live one: a host
 * killed with SIGKILL leaves its run open for good (measured: three after three rounds), and
 * {@link focus} reports such a run and judges nothing, which is right of a list a person asked
 * for and wrong of a sentence pushed at somebody's edit. So a charge counts only while it is
 * younger than {@link A_RUN_IS_HERE_FOR_SECONDS}. A charge is a fact pinned to its run, so a
 * run charged that recently has done something that recently, and one that was opened last
 * night and charged a minute ago is here; one charged yesterday is not, whatever its run does.
 *
 * TWO CLOCKS. Every instant in the record is a writer's clock and the asker has its own, so an
 * age is a comparison of two. A charge in the future by more than {@link CLOCKS_MAY_DIFFER_BY_SECONDS}
 * comes from a clock that cannot be compared with this one, and says nothing; within it, the age
 * is zero rather than negative, because "−40 seconds ago" is not a thing a person was told.
 */

import { canonicalIdentity, type ProjectionCache } from '@mnema/core';
import type { AskerContext } from './focus.js';

/**
 * How long a run counts as here after it last did something, and how recent a charge must be to
 * be reported: thirty minutes. A person's agent that has been silent for half an hour is more
 * often finished, killed or waiting for somebody than about to write the file.
 */
export const A_RUN_IS_HERE_FOR_SECONDS = 30 * 60;

/** How far ahead of the asker's clock a writer's instant may be and still be read as now. */
export const CLOCKS_MAY_DIFFER_BY_SECONDS = 60;

/** One other run that was charged at the path, as much as the record says of it. */
export interface RunHere {
  /** The agent the run declared when it started — a name, never what it was asked to do. */
  readonly agent: string;
  /** Whole seconds since the run's newest charge at the path; never negative. */
  readonly secondsAgo: number;
}

/** What to ask: the path as the record compares it, whose runs, and where the asker stands. */
export interface PresenceQuery extends AskerContext {
  /** The path, project-relative as a charge records it. */
  readonly path: string;
  /** The identity whose runs these are — the asker's own anchor. */
  readonly actor: string;
  /** The channels whose charges count, by name: the ones that ask for a person or refuse. */
  readonly channels: readonly string[];
}

/**
 * The other runs of the actor that were charged at `query.path` within the ceiling, the most
 * recently charged first, one entry per run. Empty when there are none, for any reason.
 */
export function runsHere(caches: readonly ProjectionCache[], query: PresenceQuery): RunHere[] {
  const actor = canonicalIdentity(query.actor);
  if (actor === undefined) return [];
  const mine = new Set(query.sessionRuns);
  // The path is stored as the content door writes it (NFC), so it is asked for in that form.
  const path = query.path.normalize('NFC');
  const here: RunHere[] = [];
  for (const cache of caches) {
    const charges = cache.chargesAt(path, query.channels);
    if (charges.length === 0) continue;
    const open = new Map(
      cache
        .listOpenRuns()
        .filter((run) => run.who === actor && !mine.has(run.id))
        .map((run) => [run.id, run]),
    );
    for (const charge of charges) {
      const run = open.get(charge.run);
      if (run === undefined) continue;
      const charged = ageOf(charge.at, query.asOf);
      if (charged === undefined) continue;
      here.push({ agent: run.agent, secondsAgo: charged });
    }
  }
  return here.sort((a, b) => a.secondsAgo - b.secondsAgo);
}

/**
 * Whole seconds from `from` to `to`, or `undefined` when the instant cannot be read, is further
 * ahead than the clocks may differ, or is older than the ceiling.
 */
function ageOf(from: string, to: string): number | undefined {
  const start = Date.parse(from);
  const end = Date.parse(to);
  if (Number.isNaN(start) || Number.isNaN(end)) return undefined;
  const seconds = Math.floor((end - start) / 1000);
  if (seconds < -CLOCKS_MAY_DIFFER_BY_SECONDS) return undefined;
  if (seconds > A_RUN_IS_HERE_FOR_SECONDS) return undefined;
  return Math.max(0, seconds);
}
