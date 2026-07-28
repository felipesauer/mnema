/**
 * `mnema search [term]` — find what has been recorded, or list what is recent.
 *
 * The auditor's way into the record. Everything mnema holds was, until now,
 * reachable only by an id someone still had: a memory captured in March could be
 * proved but not found. This searches the words a person wrote — across the
 * team's tree, this machine's, and the personal one — and returns an INDEX: an
 * id, a kind, the tree it lives in, when it was recorded, and one line each. The
 * body of any one of them is `mnema show <id>`.
 *
 * The term is OPTIONAL, so the same verb answers both "where did we write about
 * X" and "what has been going on here" — with an inverted index those are one
 * query and one clause apart.
 *
 * It needs NO `--actor`: what matches is a property of the record, not of who is
 * asking (the same reason `timeline` and `next-actions` take none). Read-only in
 * the strict sense — it opens a cache per tree, rebuilds it in memory, and calls
 * the copilot's pure `searchRecords`; no writer, no key, no event.
 *
 * It does NOT refuse outside a project, and that is the one place it parts from
 * the intelligence reads. Those audit a PROJECT's record; this searches the
 * record the caller can see, and outside a project that is the global tree —
 * a person's own notes, which are a legitimate thing to search from anywhere.
 */

import { catalogUpcasters } from '@mnema/chain';
import {
  type RecordQuery,
  type RecordSearch,
  type ScopedCache,
  searchRecords,
} from '@mnema/copilot';
import {
  chainRootForScope,
  type DiscoveryEnv,
  isSearchKind,
  ProjectionCache,
  resolveTrees,
  type Scope,
} from '@mnema/core';

/** The trees a search reads, in a fixed order. The order reaches no answer. */
const SCOPES: readonly Scope[] = ['public', 'private', 'global'];

/** What the search command needs — injected so it is testable. */
export interface SearchContext {
  /** The working directory to resolve the trees from. */
  readonly cwd: string;
  /** The discovery environment (XDG/home). */
  readonly env: DiscoveryEnv;
}

/** The index of what matched (possibly empty), and how many matched in all. */
export interface SearchDone {
  readonly ok: true;
  /** The hits, each marked with its tree, plus the true total. */
  readonly result: RecordSearch;
}

/** The search was refused before it ran. */
export type SearchRefused =
  /** `--scope` named a tree that does not exist here. */
  | { readonly ok: false; readonly reason: 'SCOPE_UNAVAILABLE'; readonly scope: Scope }
  /** `--kind` named something that is not a kind of record. */
  | { readonly ok: false; readonly reason: 'UNKNOWN_KIND'; readonly kind: string };

/**
 * Searches (or lists) the record across every visible tree. Opens a cache per
 * tree, rebuilds it from the chain, and merges the answers with the scope of
 * each hit attached. The caches are closed before returning — the read holds
 * nothing open.
 */
export function runSearch(ctx: SearchContext, input: RecordQuery = {}): SearchDone | SearchRefused {
  if (input.kind !== undefined && !isSearchKind(input.kind)) {
    return { ok: false, reason: 'UNKNOWN_KIND', kind: input.kind };
  }
  const trees = resolveTrees(ctx.cwd, ctx.env);
  if (input.scope !== undefined && chainRootForScope(trees, input.scope) === undefined) {
    return { ok: false, reason: 'SCOPE_UNAVAILABLE', scope: input.scope };
  }

  const upcasters = catalogUpcasters();
  const sources: ScopedCache[] = [];
  try {
    for (const scope of SCOPES) {
      const root = chainRootForScope(trees, scope);
      if (root === undefined) continue;
      const cache = ProjectionCache.open(root, { upcasters });
      cache.rebuild();
      sources.push({ scope, cache });
    }
    return { ok: true, result: searchRecords(sources, input) };
  } finally {
    for (const source of sources) source.cache.close();
  }
}
