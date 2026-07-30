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
 *
 * Several PROJECTS make that worse, and the caller has to be told. There are more
 * corpora, they differ more from each other than a project's own three trees do, and
 * the {@link RecordQuery.limit} cuts the merged list: it can fill the answer from one
 * project's tail and leave a sibling project's matches ENTIRELY out. `total` says the
 * list was cut, and that is not the same statement — a reader who cannot tell the tail
 * of what they are seeing from a whole project they are not concludes "nothing there"
 * about a record that matched.
 *
 * Two limits, and they are declared in two different places on purpose:
 *
 *   The approximate ORDER is a constant property of this read. It is true of every
 *   answer, it never varies, and no caller can act on it per call — so it is stated
 *   here and in the surface's own description, and it is NOT a field. Exactly the
 *   reason the bm25 score does not travel out either: a value that is always the
 *   same shape of noise in an agent's context is not honesty, it is weight.
 *
 *   A project SHUT OUT by the limit is a fact about THIS answer. It varies, and the
 *   caller can act on it (ask again with a larger limit, or narrow the query). So it
 *   is {@link RecordSearch.hidden}, present only when it happened — the same idiom as
 *   a walk that says `truncated` and a verification that says `not-covered`.
 *
 * What is NOT done: a per-project quota on the limit. It would trade an ordering
 * nobody can perceive for a rule every caller would have to learn, to fix a pain
 * that has not been felt yet. Declared, not resolved.
 */

import {
  compareSearchHits,
  type DecisionProjection,
  effectiveLimit,
  type MemoryProjection,
  type ObservationProjection,
  type Scope,
  type SearchHit,
  type SearchKind,
  type SearchQuery,
  type SkillProjection,
  type TaskProjection,
} from '@mnema/core';
import type { ScopedCache } from '../sources.js';

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
  /**
   * The project whose tree holds it — absent when the holder is the machine-global
   * tree, which belongs to none. The other half of WHERE, and the half a reader can
   * act on: the scope says which of a project's trees, this says whose.
   */
  readonly project?: string;
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
  /**
   * How many matched in all. Greater than `hits.length` means the answer was cut.
   *
   * A property of the LIST — "was this index complete" — which is why it is one
   * number over a merged answer and not a breakdown. It is not a claim about how much
   * any one record holds; the read that makes that claim decomposes instead.
   */
  readonly total: number;
  /**
   * The records whose matches the limit shut out of {@link hits} ENTIRELY — one entry
   * per project (and the machine-global tree, unlabelled) that matched and has no hit
   * in the list. Absent when nothing was left out that way.
   *
   * A refinement of the cut `total` already declares, never a second way of saying
   * it: the best hit of an answer is always shown, so this can only be non-empty when
   * more than one record was searched AND the list was cut. It is the honest half of
   * a merged ranking (see the note above) — what the answer does not guarantee, said
   * where the reader is, and only when it is true.
   */
  readonly hidden?: readonly HiddenMatches[];
}

/** What one record matched that the limit left out of the answer. */
export interface HiddenMatches {
  /** The project — absent for the machine-global tree, which belongs to none. */
  readonly project?: string;
  /** How many records matched there. All of them are outside `hits`. */
  readonly matched: number;
}

/**
 * One whole record, with the projection the chain proves. The union is
 * discriminated by `kind`, so a caller that needs a decision's ADR label or an
 * observation's subject reaches it typed, and a caller that only wants to render
 * it can serialize the envelope as it stands.
 *
 * WHERE it lives is two answers, not one: the `scope` is which of a project's trees
 * holds it, and the `project` is which project that is — absent when the holder is
 * the machine-global tree, which belongs to none. Both are spelled out on every arm
 * rather than factored into a shared shape, because the arms are what a caller reads
 * to know what a `RecordBody` is.
 */
export type RecordBody =
  | {
      readonly kind: 'memory';
      readonly id: string;
      readonly scope: Scope;
      readonly project?: string;
      readonly record: MemoryProjection;
    }
  | {
      readonly kind: 'observation';
      readonly id: string;
      readonly scope: Scope;
      readonly project?: string;
      readonly record: ObservationProjection;
    }
  | {
      readonly kind: 'decision';
      readonly id: string;
      readonly scope: Scope;
      readonly project?: string;
      readonly record: DecisionProjection;
    }
  | {
      readonly kind: 'task';
      readonly id: string;
      readonly scope: Scope;
      readonly project?: string;
      readonly record: TaskProjection;
    }
  | {
      readonly kind: 'skill';
      readonly id: string;
      readonly scope: Scope;
      readonly project?: string;
      readonly record: SkillProjection;
    };

/**
 * Searches every tree in `sources` (or the ones `query.scope` names) and merges the
 * answers into one ordered index, each hit carrying the tree AND the project it came
 * from.
 *
 * Each tree is asked for the same number of hits the caller wants, and the merged
 * list is cut to that number again: the top ten of a merge cannot contain an
 * eleventh-best hit from any one tree, so asking each for ten is enough to get the
 * true top ten of what those ten-hit lists can produce. `total` sums what the
 * trees matched, so a caller can still tell a complete answer from a cut one.
 *
 * Merging ITEMS across projects widens the answer and changes nothing in it: a hit is
 * a hit wherever it was written, and the label says where to go read it. The failure
 * this removes is the one that has no shape a reader can see — a search of one project
 * answering "nothing matches" about a workspace, in the same words it would use if
 * nothing did.
 *
 * `scope` still filters on the tree's ROLE, and over several projects that selects
 * every project's tree in that role — two `public` trees are two repositories, and
 * both are the team's record.
 */
export function searchRecords(
  sources: readonly ScopedCache[],
  query: RecordQuery = {},
): RecordSearch {
  const { scope, ...rest } = query;
  const searched = scope === undefined ? sources : sources.filter((s) => s.scope === scope);

  const found: Array<{ readonly hit: SearchHit; readonly source: ScopedCache }> = [];
  // What each RECORD matched, keyed by the project holding it (`undefined` is the
  // machine-global tree). Kept per record and not only summed, because the sum cannot
  // say that the limit fell on one whole project — see `hiddenByLimit`.
  const matched = new Map<string | undefined, number>();
  let total = 0;
  for (const source of searched) {
    const result = source.cache.search(rest);
    total += result.total;
    matched.set(source.project, (matched.get(source.project) ?? 0) + result.total);
    for (const hit of result.hits) found.push({ hit, source });
  }

  // Re-order by the core's own rule: the merge must land where a single tree
  // holding the same records would have landed, or the answer would depend on
  // how the record happens to be split across trees.
  found.sort((a, b) => compareSearchHits(a.hit, b.hit));
  const hits = found.slice(0, effectiveLimit(query.limit)).map(toRecordHit);
  const hidden = hiddenByLimit(matched, hits);
  return { hits, total, ...(hidden.length > 0 ? { hidden } : {}) };
}

/**
 * The records that matched but have no hit in the answer — the limit's uneven cut,
 * reported only when it happened.
 *
 * A record with no match is not hidden (there was nothing to show), and one with a hit
 * in the list is not hidden however much of its tail was cut — `total` covers that. So
 * this fires on exactly the case the totals cannot express: matched, and invisible.
 *
 * It follows that a single record can never be hidden, because the answer's best hit
 * belongs to some record and that record is therefore shown. The command line, which
 * searches one project's trees under one label, gets an absent field for that reason
 * and not by a check.
 */
function hiddenByLimit(
  matched: ReadonlyMap<string | undefined, number>,
  hits: readonly RecordHit[],
): HiddenMatches[] {
  const shown = new Set(hits.map((hit) => hit.project));
  const hidden: HiddenMatches[] = [];
  for (const [project, count] of matched) {
    if (count === 0 || shown.has(project)) continue;
    hidden.push({ ...(project !== undefined ? { project } : {}), matched: count });
  }
  return hidden;
}

/**
 * Reads one whole record by id, from the first tree in `sources` that holds it,
 * or null when none does.
 *
 * The first holder answers because an id is minted once and lives in one tree —
 * there is no second holder to disagree. That is what makes the list's length a
 * matter of REACH and never of precedence: given every tree of every project a
 * caller can see, the id picks out its own holder, and one more tree can only turn
 * a null into an answer. The five kinds are tried in turn; an id that belongs to a
 * handoff, a link or a run finds nothing here, exactly as it finds nothing in the
 * index (those have no record of their own to read).
 */
export function readRecord(sources: readonly ScopedCache[], id: string): RecordBody | null {
  for (const { scope, project, cache } of sources) {
    // The holder, named once for whichever kind answers: an id and the two halves
    // of where it lives. Built per source rather than per kind so the five returns
    // below cannot come to disagree about what "where" means.
    const held = { id, scope, ...(project !== undefined ? { project } : {}) };
    const memory = cache.getMemory(id);
    if (memory !== null) return { kind: 'memory', ...held, record: memory };
    const observation = cache.getObservation(id);
    if (observation !== null) return { kind: 'observation', ...held, record: observation };
    const decision = cache.getDecision(id);
    if (decision !== null) return { kind: 'decision', ...held, record: decision };
    const task = cache.getTask(id);
    if (task !== null) return { kind: 'task', ...held, record: task };
    const skill = cache.getSkill(id);
    if (skill !== null) return { kind: 'skill', ...held, record: skill };
  }
  return null;
}

function toRecordHit({ hit, source }: { hit: SearchHit; source: ScopedCache }): RecordHit {
  // The score is deliberately dropped: it did its work in the ordering above.
  return {
    id: hit.id,
    kind: hit.kind,
    scope: source.scope,
    ...(source.project !== undefined ? { project: source.project } : {}),
    at: hit.at,
    title: hit.title,
    derived: hit.derived,
    ...(hit.state !== undefined ? { state: hit.state } : {}),
  };
}
