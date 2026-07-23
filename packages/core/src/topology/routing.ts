/**
 * Routing a write to the right tree.
 *
 * A capture lands in one of three trees. The mechanism here is "given a scope,
 * open THAT tree's chain"; the policy is the L4 cascade that decides the scope
 * when the caller does not state one:
 *
 *   1. DEFAULT by ORIGIN — a deliberate human capture is about the work the team
 *      wants to see, so it defaults to PROJECT-PUBLIC; an automatic agent capture
 *      is high-volume and curated later, so it defaults to PROJECT-PRIVATE and
 *      does not pollute the team's git (faithful to a local auto-memory).
 *   2. CONFIG by layer — a future surface setting; not here.
 *   3. OVERRIDE — an explicit scope wins over the default, always.
 *
 * Precedence is EXPLICIT (override > default), never arbitrary: a capture never
 * leaks to the team without intent, and sharing (moving private → public) is
 * always a deliberate, separate act.
 *
 * This slice carries the mechanism only, exercised over the existing task event
 * as a proof of concept; the knowledge events that will ride it are the next
 * slice. It stops at "open the correct chain for a scope, ensuring a project
 * tree owns its `.gitignore`".
 */

import { type ChainWriter, ensureTree, openChainForWriting } from '@mnema/chain';
import type { ResolvedTrees } from './resolve.js';

/** The three trees a write can be routed to. */
export type Scope = 'public' | 'private' | 'global';

/** What is known about a capture's origin, for the default-by-origin rule. */
export interface Origin {
  /**
   * The executing agent (`which`), if any. Its PRESENCE marks an automatic agent
   * capture; its absence marks a deliberate human capture. This is the same
   * `which` the write operations carry, so the origin is read from the envelope,
   * not asserted separately.
   */
  readonly which?: string | undefined;
}

/**
 * Resolves the scope for a capture: an explicit `override` wins; otherwise the
 * default is inferred from origin — an agent capture (a `which` is present) goes
 * PRIVATE, a human capture goes PUBLIC. There is no arbitrary tie: the two
 * inputs have a fixed precedence.
 */
export function resolveScope(origin: Origin, override?: Scope): Scope {
  if (override !== undefined) return override;
  return origin.which !== undefined ? 'private' : 'public';
}

/** Thrown when a scope names a tree that does not exist in this context. */
export class TreeUnavailableError extends Error {
  override readonly name = 'TreeUnavailableError';
}

/**
 * The chain root for a scope within the resolved trees, or undefined when that
 * tree is not present (the project scopes are absent when running outside a
 * project). The global tree always resolves.
 */
export function chainRootForScope(trees: ResolvedTrees, scope: Scope): string | undefined {
  switch (scope) {
    case 'public':
      return trees.projectPublic;
    case 'private':
      return trees.projectPrivate;
    case 'global':
      return trees.global;
  }
}

/** Options for opening a tree, minus the key root — that comes from the trees. */
export interface OpenTreeOptions {
  readonly maxSegmentBytes?: number;
  readonly checkpointEvery?: number;
}

/**
 * Opens the chain for a scope for writing, signing with the person's single key
 * root (referenced by all three trees, never copied). For EITHER project scope
 * it first ensures the PUBLIC tree owns its `.gitignore` — because that one file
 * is what keeps the whole `private/` subtree out of git. Ensuring it before the
 * first write, even a first write that is PRIVATE, closes the gap where an early
 * private capture would leave `private/` unprotected until some later public
 * write happened to create the `.gitignore`. This is the lazy, write-time
 * hygiene that no separate `init` step is trusted to have run. The private tree
 * needs no `.gitignore` of its own (it is already ignored in full); the global
 * tree needs none either (it lives outside any repo).
 *
 * Throws {@link TreeUnavailableError} if the scope's tree is not present, so a
 * caller cannot silently write a project-scoped capture with no project.
 */
export function openTreeForWriting(
  trees: ResolvedTrees,
  scope: Scope,
  options: OpenTreeOptions = {},
): ChainWriter {
  const chainRoot = chainRootForScope(trees, scope);
  if (chainRoot === undefined) {
    throw new TreeUnavailableError(`no ${scope} tree in this context`);
  }
  // A project write, public or private, first makes the public tree own the
  // `.gitignore` that hides `private/`. `projectPublic` is defined whenever
  // `projectPrivate` is (both come from the same discovered project), so this is
  // safe for either project scope.
  if (scope === 'public' || scope === 'private') {
    ensureTree({ root: trees.projectPublic as string });
  }
  return openChainForWriting(chainRoot, { keyRoot: trees.keyRoot, ...options });
}
