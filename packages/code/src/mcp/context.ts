/**
 * Resolving the tree a stdio MCP server operates on.
 *
 * A CLI command has an obvious working directory; a server does not — the host
 * spawns it with an arbitrary cwd, so the project cannot be read off `cwd` the
 * way `mnema init` reads it. The project is discovered from the client instead,
 * in a fixed cascade from most explicit to fallback:
 *
 *   1. an explicit project path (a server arg/env), if the host configured one;
 *   2. the client's workspace `roots` — the first root that resolves to a
 *      project (has a `.mnema/`), walked up from that root's directory;
 *   3. GLOBAL — with no configured path and no project among the roots, the
 *      server does NOT guess a project at some cwd (only `mnema init` may create
 *      a `.mnema/`). It operates on the global tree. This is not a limbo; the
 *      global tree is legitimate cross-project knowledge. It never refuses.
 *
 * This module is pure: it takes the already-listed roots (the server does the
 * protocol call) and returns which tree to work on. The scope of a write —
 * private within a project, global outside one — is not decided here; that is
 * the core's routing rule ({@link resolveScope}), applied at the write with the
 * `which` in hand. This decides only WHERE (which trees), never public/private.
 */

import { fileURLToPath } from 'node:url';
import { type DiscoveryEnv, type ResolvedTrees, resolveTrees } from '@mnema/core';

/** What the server hands the resolver — the raw discovery inputs. */
export interface ContextInput {
  /**
   * An explicit project directory the server was configured with (arg/env), if
   * any. The strongest signal: the operator named the exact project.
   */
  readonly configProject?: string | undefined;
  /**
   * The client's workspace roots as `file://` URIs (from `roots/list`). Empty
   * when the client declares no `roots` capability or opened no workspace.
   */
  readonly roots?: readonly string[] | undefined;
  /** The discovery environment (XDG/home), for the global tree and identity. */
  readonly env: DiscoveryEnv;
}

/** The tree the session works on, and whether it landed in a project. */
export interface ResolvedContext {
  /** The three trees resolved for the chosen directory (project or global). */
  readonly trees: ResolvedTrees;
  /**
   * Whether a project was found. True → the project scopes are present and a
   * write goes to the project (private, by the origin rule); false → there is
   * no project and everything works on the global tree.
   */
  readonly inProject: boolean;
}

/**
 * Resolves the tree the session operates on, following the cascade above. It
 * probes the explicit path first, then each root in order, taking the first
 * that resolves to a project; failing all, it falls back to the global tree
 * resolved from the environment (the same `ResolvedTrees` shape, with the
 * project scopes simply absent).
 *
 * It never creates a `.mnema/` and never refuses: an unmatched cascade is a
 * legitimate global session, not an error.
 */
export function resolveContext(input: ContextInput): ResolvedContext {
  // 1. An explicit project path wins, if it actually resolves to a project.
  if (input.configProject !== undefined) {
    const trees = resolveTrees(input.configProject, input.env);
    if (trees.projectPublic !== undefined) return { trees, inProject: true };
  }

  // 2. The first workspace root that resolves to a project.
  for (const root of input.roots ?? []) {
    const dir = rootToPath(root);
    if (dir === undefined) continue;
    const trees = resolveTrees(dir, input.env);
    if (trees.projectPublic !== undefined) return { trees, inProject: true };
  }

  // 3. Fallback: the GLOBAL tree, deliberately with NO project. `resolveTrees`
  // always returns `global` + `keyRoot` regardless of where it resolves from,
  // so we take exactly those two and drop any project scopes a walk-up might
  // have found — the server must never adopt a project the client did not point
  // at (a stray `.mnema/` above home would otherwise leak in).
  const { global, keyRoot } = resolveTrees(input.env.home, input.env);
  return { trees: { global, keyRoot }, inProject: false };
}

/**
 * Turns a `file://` root URI into a filesystem path, or undefined for a
 * non-file URI (a client may expose non-file roots the server cannot resolve).
 */
function rootToPath(root: string): string | undefined {
  try {
    return root.startsWith('file://') ? fileURLToPath(root) : undefined;
  } catch {
    return undefined;
  }
}
