/**
 * The order a "newest first" reading serves two records in — one rule, one site,
 * and the reason it cannot be the obvious one.
 *
 * Every listing in this product that means *most recent first* orders on an ISO
 * instant, and every one of those instants has millisecond resolution while an agent
 * writes several records inside a millisecond. So the tie is not the edge case, it is
 * the COMMON case, and whatever breaks it is the order the reader actually sees.
 *
 * THE RULE IS: instant descending, then id DESCENDING. The second half is the part
 * that was wrong at every site, in the same way, and it went unnoticed because it
 * reads as harmless: `at DESC, id` is a total order, so the answer was stable, and a
 * stable answer looks like a correct one. It is not. `id` ascending is OLDEST first —
 * `mintId` puts a monotonic counter beside the millisecond precisely so that it is —
 * and a listing whose first clause says *newest first* and whose second says *oldest
 * first* serves the oldest record of a millisecond at the top. Two clauses pointing
 * opposite ways is not a tie-break; it is a coin flip with the appearance of a rule.
 *
 * WHAT IT COST, so nobody softens it back: the trunk went red on 22/08/2026 in
 * `search.test.ts`, on two memories written in one millisecond, and the case was
 * right — the newer one was not first. Before `mintId` carried a counter the pair was
 * genuinely a coin flip (measured: 988 of 1986 same-millisecond pairs out of order),
 * so the site could not be fixed by reordering alone. Both halves had to move.
 *
 * WHAT IT DOES NOT BUY. The id carries creation order only within one process, so
 * two records from two processes that share a millisecond are ordered here by their
 * random tails — stable, and arbitrary. That is a limit of the id (see {@link mintId})
 * and not of this comparison, and no rule at this layer can reach past it.
 *
 * SIX WRITINGS BECAME ONE. This function is asked by the search index's merge across
 * trees, the opening context's work and decisions lists, the focus read's runs, the
 * decisions-in-force list, and the usage listing's runs — which had each written the
 * comparison out by hand, which is how they came to be wrong together. The SQL that
 * needs the same rule for its `LIMIT` reads {@link NEWEST_FIRST_SQL} rather than
 * spelling it, so the two writings share the words even though they cannot share the
 * code. `one-rule-for-newest-first.test.ts` is the scan that keeps a seventh from
 * being written by hand.
 */

/** What the rule needs of a record: when it happened, and which one it is. */
export interface Dated {
  readonly at: string;
  readonly id: string;
}

/**
 * Newest first, ties broken by id descending — the whole rule, in the one place it is
 * written. See the module comment for why the tie-break runs the way it does.
 */
export function newestFirst(a: Dated, b: Dated): number {
  if (a.at !== b.at) return a.at < b.at ? 1 : -1;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/**
 * {@link newestFirst} as a SQL `ORDER BY` tail, for the reads whose `LIMIT` has to
 * apply the rule before the rows reach JS.
 *
 * It names columns `at` and `id`, so a table that calls them something else cannot
 * use it — which is the point: a caller that substitutes its own column names would
 * be writing the rule a second time, and this constant exists so there is no second
 * writing to disagree with.
 */
export const NEWEST_FIRST_SQL = 'at DESC, id DESC';
