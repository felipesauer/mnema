/**
 * `mnema antipatterns` — recurring shapes in the record, with their evidence.
 *
 * The third INTELLIGENCE read: it folds the UNION of the present trees
 * ({@link unionEvents}) and surfaces the shapes that recur — tasks reopened,
 * decisions superseded, skills deprecated — each with the exact events that make
 * up the count. It POINTS, it does not CONCLUDE: nothing here calls a count a
 * problem, and the `skillCandidates` it names (tasks reopened more than once) are
 * a POINTER for a human who might distill a pattern, never a skill this read
 * creates. The word "antipattern" names the shape it looks for, not a verdict.
 *
 * Read-only: it reads the present trees' tails and folds them with the copilot's
 * pure `antipatterns`. No cache, no writer, no key, and no actor (the shapes are
 * a property of the record). A shape-free record yields empty lists, not an
 * error. With no project at all it refuses `NO_PROJECT`, the same refusal the
 * other intelligence reads give.
 */

import { catalogUpcasters } from '@mnema/chain';
import { type Antipatterns, antipatterns } from '@mnema/copilot';
import { type DiscoveryEnv, resolveTrees } from '@mnema/core';
import { unionEvents } from '../intelligence-source.js';

/** What the antipatterns command needs — injected so it is testable. */
export interface AntipatternsContext {
  /** The working directory to resolve the project from. */
  readonly cwd: string;
  /** The discovery environment (XDG/home). */
  readonly env: DiscoveryEnv;
}

/** The recurring shapes found across the union, each a pointer to its evidence. */
export interface AntipatternsDone {
  readonly ok: true;
  /** The shapes: reopened tasks, superseded decisions, deprecated skills, candidates. */
  readonly patterns: Antipatterns;
}

/** The read was refused — there is no project to inspect. */
export interface AntipatternsRefused {
  readonly ok: false;
  readonly reason: 'NO_PROJECT';
}

/**
 * Reports the recurring shapes across the union of the present trees. Each
 * finding carries the evidence events in stream order. A record with no such
 * shapes yields empty lists. Read-only: it reads the tails and folds them,
 * opening no writer and no cache.
 */
export function runAntipatterns(ctx: AntipatternsContext): AntipatternsDone | AntipatternsRefused {
  const trees = resolveTrees(ctx.cwd, ctx.env);
  if (trees.projectPublic === undefined) {
    return { ok: false, reason: 'NO_PROJECT' };
  }
  const events = unionEvents(trees, catalogUpcasters());
  return { ok: true, patterns: antipatterns(events) };
}
