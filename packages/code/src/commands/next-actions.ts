/**
 * `mnema next-actions <task-id>` — the moves the workflow allows a task next.
 *
 * The third context read, and the one keyed by an ENTITY rather than an actor.
 * It answers "what can I do to this task now" by reading the task's current
 * state and returning the transitions that leave it — each a real move the gate
 * would authorize, so the suggestion never disagrees with what the gate accepts.
 * Read-only in the strict sense: it opens the cache, rebuilds, and calls the
 * copilot's PURE `nextActionsForTask`; no writer, no event, no key.
 *
 * It needs no actor — the answer is a property of the task's state and the
 * workflow, not of who is asking. It DOES need the task's home tree: a task is
 * born in one tree (public/private/global), so the adapter locates that tree
 * ({@link locateEntityScope}) and reads its cache. Not found in any visible tree
 * → `UNKNOWN_TASK`, the honest refusal (distinct from an existing terminal task,
 * which yields an empty list — "no legal moves", not "no such task").
 */

import { catalogUpcasters } from '@mnema/chain';
import { type NextAction, nextActionsForTask } from '@mnema/copilot';
import {
  chainRootForScope,
  type DiscoveryEnv,
  locateEntityScope,
  ProjectionCache,
  resolveTrees,
} from '@mnema/core';

/** What the next-actions command needs — injected so it is testable. */
export interface NextActionsContext {
  /** The working directory to resolve the project from. */
  readonly cwd: string;
  /** The discovery environment (XDG/home). */
  readonly env: DiscoveryEnv;
}

/** The legal moves for the task (possibly empty — a terminal state). */
export interface NextActionsDone {
  readonly ok: true;
  /** The task id the moves are for. */
  readonly id: string;
  /** The transitions the workflow allows from the task's state; empty when terminal. */
  readonly actions: readonly NextAction[];
}

/** The read was refused. */
export type NextActionsRefused =
  /** There is no project here — a task read needs one. */
  | { readonly ok: false; readonly reason: 'NO_PROJECT' }
  /** No visible tree holds a task with this id. */
  | { readonly ok: false; readonly reason: 'UNKNOWN_TASK' };

/**
 * Reports the legal next moves for the task with `id`. Locates the tree the task
 * was born in, opens that tree's cache, rebuilds, and returns the copilot's
 * `nextActionsForTask`. An empty list means the task exists but is terminal — no
 * move leaves its state. `UNKNOWN_TASK` means no visible tree holds it (it never
 * existed here, or its tail is truncated below the birth). With no project at all
 * it refuses `NO_PROJECT`. Read-only: no writer, no event.
 */
export function runNextActions(
  ctx: NextActionsContext,
  input: { id: string },
): NextActionsDone | NextActionsRefused {
  const trees = resolveTrees(ctx.cwd, ctx.env);
  // A task read needs a project — the global tree holds no project tasks a person
  // asks about here. If there is no project AND no such id anywhere, the honest
  // answer is UNKNOWN_TASK; but with no project at all, NO_PROJECT is the reason
  // that tells the caller to `init` first.
  if (trees.projectPublic === undefined) {
    return { ok: false, reason: 'NO_PROJECT' };
  }
  const upcasters = catalogUpcasters();
  // Find the task's home tree the same way a move does — a task lives in exactly
  // one tree, and its state must be read from there.
  const scope = locateEntityScope(trees, input.id, upcasters);
  if (scope === undefined) {
    return { ok: false, reason: 'UNKNOWN_TASK' };
  }
  const root = chainRootForScope(trees, scope) as string;
  const cache = ProjectionCache.open(root, { upcasters });
  cache.rebuild();
  const actions = nextActionsForTask(cache, input.id);
  // `locateEntityScope` found the birth, so a null here means the tail is
  // truncated below it (the birth is not replayable through the projection) —
  // report it as unknown rather than an empty terminal list, which would falsely
  // claim the task exists with no moves.
  if (actions === null) {
    return { ok: false, reason: 'UNKNOWN_TASK' };
  }
  return { ok: true, id: input.id, actions };
}
