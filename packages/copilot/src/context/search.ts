/**
 * search: finding things in the record the caller can see, and reading one whole.
 *
 * The core searches ONE tree's index. This searches THE RECORD — every tree the
 * caller can see — and marks each hit with the tree it came from. That marking is
 * the reason this layer exists rather than the surfaces concatenating lists: a
 * memory in the global tree is a person's own note, the same words in the public
 * tree are the team's, and a reader who cannot tell them apart will cite one as
 * the other. The scope travels with the hit, always.
 *
 * Reading across trees is cheap where it matters. A session's caches are already
 * warm, and each tree answers from an inverted index, so asking three costs three
 * indexed lookups — not three replays.
 *
 * ## What comes back, and what does not
 *
 * An INDEX: an id, a kind, a scope, an instant, and one line to recognize each
 * record by. Never the bodies. {@link readRecord} serves one whole record by id,
 * which is the second half of the same idea — find by index, read what you meant
 * to read, and leave the rest out of the context window.
 *
 * The relevance score the core ranks by does NOT travel out of here. It orders
 * the answer and then it has done its job; a bm25 figure in an agent's context is
 * noise it cannot act on.
 *
 * ## The honest limit of a merged ranking
 *
 * Each tree ranks its own hits against its own corpus, so the scores merged here
 * were computed from different statistics: a term that is rare in a small tree
 * scores higher there than the same term in a large one. Across trees the order
 * is therefore a good approximation, not a single global ranking — the alternative
 * (one index over every tree) would mean rebuilding all three whenever any one of
 * them changed, which is a real cost paid for an ordering nobody can perceive.
 */

import {
  compareSearchHits,
  type DecisionProjection,
  effectiveLimit,
  type MemoryProjection,
  type ObservationProjection,
  type ProjectionCache,
  type Scope,
  type SearchHit,
  type SearchKind,
  type SearchQuery,
  type SkillProjection,
  type TaskProjection,
} from '@mnema/core';

/** One tree's projection cache, and which tree it is. */
export interface ScopedCache {
  /** The tree this cache projects — the scope every hit from it carries. */
  readonly scope: Scope;
  /** The cache itself, already rebuilt by whoever owns it. */
  readonly cache: ProjectionCache;
}

/** What to look for, plus the one filter that is about trees rather than rows. */
export interface RecordQuery extends SearchQuery {
  /**
   * Only search this tree. Absent, every tree the caller can see is searched —
   * the default, because a person looking for something they wrote rarely knows
   * (or should have to know) which tree it landed in.
   */
  readonly scope?: Scope;
}

/** One record in the index, named and placed but not spelled out. */
export interface RecordHit {
  /** The record's id — the key {@link readRecord} takes. */
  readonly id: string;
  /** Which kind of record it is. */
  readonly kind: SearchKind;
  /** The tree it lives in: the team's, this machine's, or the person's own. */
  readonly scope: Scope;
  /** When it was recorded. */
  readonly at: string;
  /** The line to recognize it by — its title, or an excerpt (see {@link derived}). */
  readonly title: string;
  /** True when {@link title} is an excerpt of the content, not a title someone wrote. */
  readonly derived: boolean;
  /** Its current state, for the kinds that have one. */
  readonly state?: string;
}

/** The hits, and how many records matched across the trees before the limit. */
export interface RecordSearch {
  /** The matches, best first (or newest first without a term). */
  readonly hits: readonly RecordHit[];
  /** How many matched in all. Greater than `hits.length` means the answer was cut. */
  readonly total: number;
}

/**
 * One whole record, with the projection the chain proves. The union is
 * discriminated by `kind`, so a caller that needs a decision's ADR label or an
 * observation's subject reaches it typed, and a caller that only wants to render
 * it can serialize the envelope as it stands.
 */
export type RecordBody =
  | {
      readonly kind: 'memory';
      readonly id: string;
      readonly scope: Scope;
      readonly record: MemoryProjection;
    }
  | {
      readonly kind: 'observation';
      readonly id: string;
      readonly scope: Scope;
      readonly record: ObservationProjection;
    }
  | {
      readonly kind: 'decision';
      readonly id: string;
      readonly scope: Scope;
      readonly record: DecisionProjection;
    }
  | {
      readonly kind: 'task';
      readonly id: string;
      readonly scope: Scope;
      readonly record: TaskProjection;
    }
  | {
      readonly kind: 'skill';
      readonly id: string;
      readonly scope: Scope;
      readonly record: SkillProjection;
    };

/**
 * Searches every tree in `sources` (or the one `query.scope` names) and merges
 * the answers into one ordered index, each hit carrying the tree it came from.
 *
 * Each tree is asked for the same number of hits the caller wants, and the merged
 * list is cut to that number again: the top ten of a merge cannot contain an
 * eleventh-best hit from any one tree, so asking each for ten is enough to get the
 * true top ten of what those ten-hit lists can produce. `total` sums what the
 * trees matched, so a caller can still tell a complete answer from a cut one.
 */
export function searchRecords(
  sources: readonly ScopedCache[],
  query: RecordQuery = {},
): RecordSearch {
  const { scope, ...rest } = query;
  const searched = scope === undefined ? sources : sources.filter((s) => s.scope === scope);

  const found: Array<{ readonly hit: SearchHit; readonly scope: Scope }> = [];
  let total = 0;
  for (const source of searched) {
    const result = source.cache.search(rest);
    total += result.total;
    for (const hit of result.hits) found.push({ hit, scope: source.scope });
  }

  // Re-order by the core's own rule: the merge must land where a single tree
  // holding the same records would have landed, or the answer would depend on
  // how the record happens to be split across trees.
  found.sort((a, b) => compareSearchHits(a.hit, b.hit));
  return {
    hits: found.slice(0, effectiveLimit(query.limit)).map(toRecordHit),
    total,
  };
}

/**
 * Reads one whole record by id, from the first tree in `sources` that holds it,
 * or null when none does.
 *
 * The first holder answers because an id is minted once and lives in one tree —
 * there is no second holder to disagree. The five kinds are tried in turn; an id
 * that belongs to a handoff, a link or a run finds nothing here, exactly as it
 * finds nothing in the index (those have no record of their own to read).
 */
export function readRecord(sources: readonly ScopedCache[], id: string): RecordBody | null {
  for (const { scope, cache } of sources) {
    const memory = cache.getMemory(id);
    if (memory !== null) return { kind: 'memory', id, scope, record: memory };
    const observation = cache.getObservation(id);
    if (observation !== null) return { kind: 'observation', id, scope, record: observation };
    const decision = cache.getDecision(id);
    if (decision !== null) return { kind: 'decision', id, scope, record: decision };
    const task = cache.getTask(id);
    if (task !== null) return { kind: 'task', id, scope, record: task };
    const skill = cache.getSkill(id);
    if (skill !== null) return { kind: 'skill', id, scope, record: skill };
  }
  return null;
}

function toRecordHit({ hit, scope }: { hit: SearchHit; scope: Scope }): RecordHit {
  // The score is deliberately dropped: it did its work in the ordering above.
  return {
    id: hit.id,
    kind: hit.kind,
    scope,
    at: hit.at,
    title: hit.title,
    derived: hit.derived,
    ...(hit.state !== undefined ? { state: hit.state } : {}),
  };
}
