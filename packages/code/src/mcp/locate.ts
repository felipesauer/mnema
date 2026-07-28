/**
 * Finding an entity's home tree inside a session.
 *
 * Every entity-keyed tool — the three transitions, `next_actions`, `guard` —
 * starts here, because a move must land in the tree the entity was born in and a
 * read must come from it. The RULE is the core's and is not restated: which
 * trees are searched, in what order, and what counts as the same id all stay in
 * `locateEntityScope`. What a session changes is one mechanical question — does
 * the tree rooted HERE hold this birth? — which the core takes as a probe.
 *
 * A fresh process answers it by replaying the chain, and that is the whole cost:
 * a linear scan of every tree, run before every entity-keyed call, growing with
 * the record. A session does not have to pay it. It already holds a projection
 * of each tree it has read, and in that projection the entity's id is the
 * PRIMARY KEY of its table — the same question, over a view of the same facts,
 * answered by an index instead of a scan.
 *
 * ## Why the projection alone is not the answer
 *
 * A projection is a view, and two things are true of it that are not true of the
 * chain:
 *
 *   1. It holds COMPLETE entities only. A birth is two appends — the record and
 *      its initial transition — written atomically, so an intact chain never
 *      carries one without the other; a partially-fetched chain can, and the
 *      projection drops such a subject rather than invent a state for it.
 *   2. It is this session's view, refreshed when this session writes. A write
 *      from ANOTHER process — a `mnema` command in a terminal, a second agent —
 *      is not in it until something this session does rebuilds that tree. That
 *      limit is declared and deliberate for reads, and it was already the answer
 *      `next_actions` and `guard` gave. It was NOT the answer a MOVE gave: the
 *      operations read the chain, so a task another process had just created
 *      moved successfully. Locating from the projection alone would have turned
 *      that into `UNKNOWN_TASK` — a task that exists, reported as missing, on
 *      the one surface that was still telling the truth.
 *
 * So the walk runs twice, and only when it has to: the projections first, and
 * the chains ONLY IF no tree claimed the entity. A found entity — the
 * overwhelming case, and the only one on the hot path — never touches a chain.
 * A missing one costs exactly what it cost before, which is the point: nothing
 * that used to be found becomes lost, and nothing that used to be answerable
 * becomes unanswerable. The two walks are the same core function over two
 * probes, so they cannot disagree about the rule; the fallback exists because
 * the probes see different amounts of the same record, not because they read it
 * by different rules.
 */

import { catalogUpcasters } from '@mnema/chain';
import { type BirthProbe, locateEntityScope, locateEntityScopeWith, type Scope } from '@mnema/core';
import type { CacheRegistry } from './cache-registry.js';
import type { Session } from './session.js';

/**
 * A probe over a session's caches: for the tree rooted at `chainRoot`, whether
 * the session's projection of it holds a workflow entity with this id.
 *
 * Three tables are consulted because a birth belongs to one of exactly three
 * workflow entities — task, decision, skill — the same three the core counts as
 * births. A memory, an observation, a handoff, a link have no home to locate:
 * nothing transitions them and nothing reads them by entity, so an id that is
 * one of those is not found here, exactly as it is not found by a replay.
 *
 * Asking the registry (rather than opening a cache here) is what keeps this
 * correct as well as cheap: it returns the tree's cache rebuilt if this
 * session's writes left it behind, so an entity this connection created a moment
 * ago is found without the probe knowing whether a replay just happened.
 */
export function cachedBirthProbe(caches: CacheRegistry): BirthProbe {
  return (chainRoot, id) => {
    const cache = caches.get(chainRoot);
    return (
      cache.getTask(id) !== null || cache.getDecision(id) !== null || cache.getSkill(id) !== null
    );
  };
}

/**
 * The tree an entity lives in, or undefined when no tree this session can see
 * holds its birth.
 *
 * Reads the session's projections first and falls back to the chains only when
 * they came up empty — see the module doc for why both halves are load-bearing.
 * The answer is indistinguishable from what a fresh process would give; the only
 * difference is how long the common case takes.
 */
export function locateEntityInSession(session: Session, id: string): Scope | undefined {
  const fromProjections = locateEntityScopeWith(
    session.trees,
    id,
    cachedBirthProbe(session.caches),
  );
  if (fromProjections !== undefined) return fromProjections;
  return locateEntityScope(session.trees, id, catalogUpcasters());
}
