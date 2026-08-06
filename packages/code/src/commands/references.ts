/**
 * `mnema refs <id>` — what an entity is connected to, and how far that reaches.
 *
 * The read that turns a search hit into a thread to pull. `search` answers "what
 * exists", `show` answers "what does it say", and this answers the question that
 * follows both: "what else is this tied to?" — the observations about it, the
 * links into and out of it, the decision that superseded it.
 *
 * One verb covers both shapes, because they are one walk with different bounds.
 * The default (`--depth 1`, both directions) is the NEIGHBOURHOOD: everything one
 * hop away, whichever way the edge points. Give it a direction and more depth and
 * it is a LINEAGE: the supersede chain of a decision, everything derived from a
 * memory. Splitting them into two verbs would put the same walk behind two names.
 *
 * It reads every visible tree, because an edge lives in the tree its event was
 * written to and its far end may live in another. Read-only in the strict sense:
 * a cache per tree, rebuilt in memory, and the copilot's pure `references`. No
 * writer, no key, no event — so no `--actor`.
 *
 * Like the other intelligence reads it refuses `NO_PROJECT` outside a project: a
 * graph of references is a property of a project's record.
 */

import { type ReferenceDirection, type ReferenceGraph, references } from '@mnema/copilot';
import { type DiscoveryEnv, resolveTrees } from '@mnema/core';
import { isReferenceDirection } from '../reference-directions.js';
import { withScopedCaches } from '../tree-sources.js';

/** What the refs command needs — injected so it is testable. */
export interface ReferencesContext {
  /** The working directory to resolve the project from. */
  readonly cwd: string;
  /** The discovery environment (XDG/home). */
  readonly env: DiscoveryEnv;
}

/** What the entity reaches and what reaches it. */
export interface ReferencesDone {
  readonly ok: true;
  /** The nodes, the edges, and whether the depth cap cut the answer. */
  readonly graph: ReferenceGraph;
}

/** The read was refused before it ran. */
export type ReferencesRefused =
  /** There is no project here — a graph of references is a project's record. */
  | { readonly ok: false; readonly reason: 'NO_PROJECT' }
  /** `--direction` named something that is not a direction. */
  | { readonly ok: false; readonly reason: 'UNKNOWN_DIRECTION'; readonly direction: string };

/**
 * Reports what `id` is connected to across every present tree. An id nothing
 * references yields a graph holding only the id itself — a legitimate answer
 * ("nothing is tied to this"), not a refusal, and the same reason `timeline`
 * has no UNKNOWN_ID. An id no tree ever authored is reported as unresolved
 * rather than rejected: the record can legitimately point at what it cannot see.
 */
export function runReferences(
  ctx: ReferencesContext,
  input: { id: string; direction?: string; depth?: number },
): ReferencesDone | ReferencesRefused {
  // The directions are a closed vocabulary. An unrecognized one that quietly
  // fell back to the default would answer a different question than the one
  // asked, and read as if it had answered the right one.
  if (input.direction !== undefined && !isReferenceDirection(input.direction)) {
    return { ok: false, reason: 'UNKNOWN_DIRECTION', direction: input.direction };
  }
  const direction: ReferenceDirection | undefined = input.direction;
  const trees = resolveTrees(ctx.cwd, ctx.env);
  if (trees.projectPublic === undefined) {
    return { ok: false, reason: 'NO_PROJECT' };
  }
  return withScopedCaches(trees, (sources) => ({
    ok: true,
    graph: references(sources, {
      id: input.id,
      ...(direction !== undefined ? { direction } : {}),
      ...(input.depth !== undefined ? { depth: input.depth } : {}),
    }),
  }));
}
