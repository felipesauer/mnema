/**
 * `mnema usage` — what each run of this project cost, read from the host and never
 * from the record.
 *
 * THE RECORD DOES NOT HOLD THIS NUMBER AND WILL NOT. The decision is written in
 * `RECONSTRUCTION.md` (*Custo/tokens*) and it turns on a measured property of where
 * the number lives: the host's transcripts EXPIRE (`cleanupPeriodDays` has a mandatory
 * retention and `0` is rejected), so a cost recorded in the chain would be a signed
 * claim whose only witness deletes itself in weeks — indistinguishable, by then, from
 * somebody having typed a figure. So the chain gets no field, no event and no version,
 * and this verb crosses two readings at the moment somebody asks.
 *
 * THE JOIN IS BY TIME AND DIRECTORY, AND IT IS THIS COMMAND'S INFERENCE — never a fact
 * the record states. Storing the host's session id on an event would have made the join
 * exact, and it would have been the same mistake in smaller print: a signed pointer at
 * a file that deletes itself. What is on both sides already is an instant. The record
 * has the run's window (`run.started` → `run.ended`); the host has transcripts with
 * timestamps and the directory the work was done in. The output says so in words,
 * because a table of costs that does not say where the join came from reads as part of
 * the proof.
 *
 * AND IT REFUSES TO GUESS, which is the rule that separates this from a token counter:
 *
 *   - ONE host session overlapping the window — attribute, and name the session, so a
 *     reader can go and check the same file this read.
 *   - MORE THAN ONE — name them all and attribute NOTHING. There is no tie-break that
 *     is not invented, and a number produced by an invented one is worse than its
 *     absence: it is an absence a reader cannot see.
 *   - NONE — say so as a WORD. Never `0`. Zero tokens and no transcript are different
 *     news, and the surface that confused them would be telling a person their agent
 *     worked for free. It is the same reason `tail list` prints `no waiver` instead of
 *     leaving a column empty.
 *
 * Read-only in the strict sense: it opens a projection cache per tree the way every
 * read does, opens the host's transcripts for reading, and appends nothing anywhere.
 * `the-cost-comes-from-the-host.test.ts` hashes the whole sandbox — chain, cache, keys
 * AND the host's own store — around the invocation.
 */

import { dirname } from 'node:path';
import {
  type Clock,
  type DiscoveryEnv,
  type RunProjection,
  resolveTrees,
  type Scope,
  systemClock,
  treesSearched,
} from '@mnema/core';
import {
  type HostSession,
  hostTranscriptRoot,
  numbersOf,
  reachesAtOrAfter,
  type SessionNumbers,
  sessionsOfProject,
} from '../transcripts.js';
import { caches, withScopedCaches } from '../tree-sources.js';

/** What the usage read needs — injected so it is testable. */
export interface UsageContext {
  /** The working directory to resolve the project from. */
  readonly cwd: string;
  /** The discovery environment (XDG/home) — the home is where the host's store is. */
  readonly env: DiscoveryEnv;
  /** The process environment, for the host's own `CLAUDE_CONFIG_DIR` override. */
  readonly processEnv?: NodeJS.ProcessEnv;
  /**
   * The clock an OPEN run's window ends at, defaulting to the wall clock. Injected for
   * the reason every other read injects one: a window that reaches "now" is only
   * assertable against a pinned instant.
   */
  readonly clock?: Clock;
}

/** One run, and what the host says it cost — or the word saying why it says nothing. */
export interface RunSpend {
  /** The run's id, whole. */
  readonly run: string;
  /** The agent the run was opened for. */
  readonly agent: string;
  /** `at` of `run.started`. */
  readonly startedAt: string;
  /** `at` of `run.ended`, absent while the run is open. */
  readonly endedAt?: string;
  /**
   * The host sessions whose span overlaps this run's window, by id.
   *
   * Empty, one, or several — and the three are three different answers rather than
   * three sizes of the same one. It is stated even when it holds two, because naming
   * the candidates is what lets a person do by hand the attribution this refuses to
   * do for them.
   */
  readonly sessions: readonly string[];
  /** The counts, present ONLY when exactly one session overlapped. */
  readonly numbers?: SessionNumbers;
}

/** What the runs of this project cost, and where that was read from. */
export interface UsageDone {
  readonly ok: true;
  /** Every run this record holds, most recently started first. */
  readonly runs: readonly RunSpend[];
  /** The trees the runs were read from — what an empty answer names. */
  readonly trees: readonly Scope[];
  /** The host's store, so an answer of nothing says where nothing was found. */
  readonly store: string;
  /** How many of the host's sessions record work in this project at all. */
  readonly sessionsInStore: number;
}

/** There is no project here, so there are no runs to account for. */
export interface UsageRefused {
  readonly ok: false;
  readonly reason: 'NO_PROJECT';
}

/**
 * Reports what each run of this project cost, crossing the record's runs with the
 * host's transcripts. Nothing is written and nothing is recorded.
 *
 * It refuses outside a project, unlike `tail list` and for the opposite reason: a tail
 * can genuinely live in the machine-global tree, and a RUN with no project is a session
 * that authorized work in a record this invocation cannot see. Reporting the global
 * tree's runs from a directory that is not a project would put another project's costs
 * on the screen under this one's heading.
 */
export function runUsage(ctx: UsageContext): UsageDone | UsageRefused {
  const trees = resolveTrees(ctx.cwd, ctx.env);
  const projectRoot = trees.projectPublic;
  if (projectRoot === undefined) return { ok: false, reason: 'NO_PROJECT' };
  const asOf = (ctx.clock ?? systemClock)();
  const store = hostTranscriptRoot(ctx.env.home, ctx.processEnv ?? process.env);
  const runs = withScopedCaches(trees, (sources) =>
    caches(sources)
      .flatMap((cache) => cache.listRuns())
      .sort(byStartedDesc),
  );
  // The project root is the directory the work is IN; the store is walked against the
  // repository the `.mnema/` sits in, not against the `.mnema/` itself.
  const sessions =
    runs.length === 0
      ? []
      : sessionsOfProject(store, repositoryOf(projectRoot), earliestWindowStart(runs));
  return {
    ok: true,
    trees: treesSearched(trees),
    store,
    sessionsInStore: sessions.length,
    runs: runs.map((run) => attributed(run, sessions, asOf)),
  };
}

/**
 * The repository a project tree sits in — `<repo>/.mnema` back to `<repo>`.
 *
 * The host records the directory a person was WORKING in, which is the repository, and
 * never the record's own directory inside it. Composed by cutting the one segment the
 * core appended rather than by walking up looking for something, so the two cannot
 * disagree about where the project is.
 */
function repositoryOf(projectPublic: string): string {
  return dirname(projectPublic);
}

/** Most recently started first — what a person scanning a cost table wants at the top. */
function byStartedDesc(a: RunProjection, b: RunProjection): number {
  return a.startedAt === b.startedAt
    ? a.id.localeCompare(b.id)
    : a.startedAt < b.startedAt
      ? 1
      : -1;
}

/**
 * The earliest instant any run's window opens at, so the host's store can drop what it
 * has not touched since then without opening it.
 *
 * A run whose `startedAt` this machine cannot read contributes nothing to the bound,
 * and the walk falls back to reading everything — the safe direction, since the
 * alternative is silently pruning away the transcript that would have answered.
 */
function earliestWindowStart(runs: readonly RunProjection[]): number {
  let earliest = Number.POSITIVE_INFINITY;
  for (const run of runs) {
    const at = instant(run.startedAt);
    if (at === undefined) return Number.NEGATIVE_INFINITY;
    if (at < earliest) earliest = at;
  }
  return earliest === Number.POSITIVE_INFINITY ? Number.NEGATIVE_INFINITY : earliest;
}

/** One run with whatever the host can honestly say about it. */
function attributed(run: RunProjection, sessions: readonly HostSession[], asOf: string): RunSpend {
  const from = instant(run.startedAt);
  const to = instant(run.endedAt ?? asOf);
  const overlapping =
    from === undefined || to === undefined
      ? []
      : sessions.filter((session) => overlaps(session, from, to));
  const only = overlapping.length === 1 ? overlapping[0] : undefined;
  return {
    run: run.id,
    agent: run.agent,
    startedAt: run.startedAt,
    ...(run.endedAt !== undefined ? { endedAt: run.endedAt } : {}),
    sessions: overlapping.map((session) => session.id),
    ...(only !== undefined ? { numbers: numbersOf(only) } : {}),
  };
}

/**
 * Whether a host session's span meets a run's window at all.
 *
 * OVERLAP and not containment, and the difference decides real cases: a session that
 * was already open when the run started, or that outlived it, did the run's work just
 * as much as one that fits inside it. Containment would report "no transcript" for the
 * ordinary shape — an agent session that opens a run partway through what it is doing.
 */
function overlaps(session: HostSession, from: number, to: number): boolean {
  const began = instant(session.firstAt);
  return began !== undefined && began <= to && reachesAtOrAfter(session.lastWrittenMs, from);
}

/** An instant as milliseconds, or `undefined` when it is not one this machine can read. */
function instant(at: string): number | undefined {
  const ms = Date.parse(at);
  return Number.isNaN(ms) ? undefined : ms;
}
