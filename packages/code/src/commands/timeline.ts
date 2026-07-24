/**
 * `mnema timeline <id>` — the history of one entity, across every tree.
 *
 * The first INTELLIGENCE read, and the auditor's counterpart of `next-actions`:
 * it takes an id and tells the entity's whole story — every event where it is
 * the subject, plus the events that REFER to it (an observation `about` it, a
 * knowledge link whose `target` is it). Those referring facts live on other
 * subjects in possibly other trees, so the source is the UNION of the present
 * trees ({@link unionEvents}), not one tree's cache — a task's narrative crosses
 * the public/private/global boundary and the read must too.
 *
 * Read-only in the strict sense: it reads the tails of the present trees and
 * folds them with the copilot's pure `timeline`. No cache is rebuilt to disk, no
 * writer is opened, no key is minted — so it needs no `--actor` (the story is a
 * property of the record, not of who asks).
 *
 * An id no event touches yields an empty history — a legitimate answer ("nothing
 * is recorded about this yet"), not a refusal. There is no UNKNOWN_ID: an entity
 * with no history is still a valid question, and the empty list IS the answer.
 * With no project at all it refuses `NO_PROJECT` — an intelligence read is about
 * a project's record, so it asks the caller to `init` first, exactly as the
 * context and guard reads do.
 */

import { catalogUpcasters } from '@mnema/chain';
import { type TimelineEntry, timeline } from '@mnema/copilot';
import { type DiscoveryEnv, resolveTrees } from '@mnema/core';
import { unionEvents } from '../intelligence-source.js';

/** What the timeline command needs — injected so it is testable. */
export interface TimelineContext {
  /** The working directory to resolve the project from. */
  readonly cwd: string;
  /** The discovery environment (XDG/home). */
  readonly env: DiscoveryEnv;
}

/** The entity's history, in the union's own order (possibly empty). */
export interface TimelineDone {
  readonly ok: true;
  /** The entity id the history is for. */
  readonly id: string;
  /** Every event that touches the entity, across the trees, in stream order. */
  readonly entries: readonly TimelineEntry[];
}

/** The read was refused — there is no project to read a history from. */
export interface TimelineRefused {
  readonly ok: false;
  readonly reason: 'NO_PROJECT';
}

/**
 * Reports the history of the entity with `id`: every event across the present
 * trees where it is the subject, or is referred to by an observation's `about`
 * or a knowledge link's `target`, in the union's own deterministic order. An
 * empty list means no event touches it (never seen, or nothing recorded yet).
 * Read-only: it reads the tails and folds them, opening no writer and no cache.
 */
export function runTimeline(
  ctx: TimelineContext,
  input: { id: string },
): TimelineDone | TimelineRefused {
  const trees = resolveTrees(ctx.cwd, ctx.env);
  // An intelligence read is about a project's record; with no project at all the
  // honest answer is NO_PROJECT (run `init` first), the same refusal the context
  // and guard reads give.
  if (trees.projectPublic === undefined) {
    return { ok: false, reason: 'NO_PROJECT' };
  }
  const events = unionEvents(trees, catalogUpcasters());
  return { ok: true, id: input.id, entries: timeline(events, input.id) };
}
