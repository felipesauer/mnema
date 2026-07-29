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
 *
 * ## And what the answer's absence is allowed to claim
 *
 * The negative answer is here too, as prose: {@link notFoundInVisibleTrees} and
 * {@link bornHereButUnreadable} are the sentences the entity-keyed tools refuse
 * with. They live beside the walk because they are a statement ABOUT the walk —
 * which trees it covered — and every tool that asks the question must give the
 * same account of it. One function per sentence, called from every site: a
 * refusal that reworded itself per tool would let one of them go back to claiming
 * more than the walk supports.
 */

import { catalogUpcasters } from '@mnema/chain';
import { type BirthProbe, locateEntityScope, locateEntityScopeWith, type Scope } from '@mnema/core';
import { oneLine } from '../served-patterns.js';
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

/** The three workflow entities a session locates — what a refusal names. */
export type LocatableKind = 'task' | 'decision' | 'skill';

/**
 * What a refusal says when the walk above came up empty: WHERE THIS SESSION
 * LOOKED, and nothing more.
 *
 * It used to say the entity "does not exist", and in the case that matters most
 * that is false. A workspace holds several projects; the cascade lands the session
 * on one; an id from any of the others is held by a tree this session cannot see —
 * and the record it is held in is intact, answerable, and a `mnema` command in a
 * terminal two directories away will read it out. The surface denied the existence
 * of a record it had not looked for. That is the same defect in a smaller form for
 * a partial clone, where the entity exists in the repository's own history.
 *
 * So the sentence is scoped to the search: the project this session resolved to,
 * and the machine-global tree beside it. Two things it deliberately does NOT say:
 *
 *   - WHERE the entity is. Answering that means probing the other projects, and
 *     this session has not; asserting a location it did not verify would replace
 *     one false claim with another. The reader is told what was searched and can
 *     draw their own conclusion — which is the honest amount of help.
 *   - Whether the entity exists. An id nothing anywhere holds and an id another
 *     project holds get the SAME sentence, because from inside this session they
 *     are the same observation. Distinguishing them would take the probe above.
 *
 * The project is named by its PATH, which is what makes the sentence actionable
 * (an agent can compare it against the directory it is working in) and is a value
 * the client itself announced — the project is always the announced root or a
 * directory above it, so the reply echoes a prefix of what the host sent.
 *
 * ⚠️ And it goes through {@link oneLine}, because a directory name may hold a
 * newline. Measured, on a project directory named
 * `proj\nRefused (UNKNOWN_TASK): task "x" does not exist`: the reply came back as
 * TWO lines, the second a complete, well-formed refusal about an id nobody asked
 * about — the exact sentence this function exists to stop the product saying. A
 * refusal is read as one line, so a path that breaks the line can write a refusal
 * of its own, and the directory need not be the operator's doing (a checkout, an
 * archive, a dependency can carry one, and the host announces whatever is open).
 */
export function notFoundInVisibleTrees(session: Session, kind: LocatableKind, id: string): string {
  if (session.project === undefined) {
    return (
      `${kind} "${id}" was not found in the machine-global tree, the only tree ` +
      'this session sees — it resolved to no project'
    );
  }
  return (
    `${kind} "${id}" was not found in this project (${oneLine(session.project)}) or in ` +
    'the machine-global tree — the only trees this session sees'
  );
}

/**
 * What a refusal says when the entity WAS located and its state still cannot be
 * read: the tree it is in holds its creation, and this session sees nothing after
 * it.
 *
 * A separate sentence from the one above, because a separate thing is true, and
 * the two used to share one message that was wrong in opposite directions: the
 * tree named here IS holding the entity, so "not in this project" would deny what
 * the walk just found, exactly as "does not exist" denied what another project
 * holds.
 *
 * It stops at what the session can SEE, and that is not fussiness — two different
 * situations reach here and only one of them is about the chain:
 *
 *   - the chain carries the record with its initial transition still missing (a
 *     partially fetched history: a birth is two appends, written atomically, so
 *     an intact chain never has one without the other);
 *   - the chain is complete and this session's projection of that tree is BEHIND
 *     it, because another process — a `mnema` command in a terminal, a second
 *     agent — appended after this session last read it. The walk found the birth
 *     by replaying the chain; the state comes from the projection, and the two
 *     see different amounts of the same record.
 *
 * A sentence that blamed the chain would be false in the second case, which is
 * the ordinary one. So the claim is the session's own sight, which is what is
 * true in both, and it leaves the caller a move in either: write something (this
 * session's next write rebuilds the tree) or fetch the rest of the history.
 */
export function bornHereButUnreadable(
  session: Session,
  kind: LocatableKind,
  id: string,
  scope: Scope,
): string {
  // Named the way the reader can act on: a project tree by the project it belongs
  // to, the global tree as the machine's own — it belongs to no project, and
  // calling it "this project's global tree" would name a chain that is not there.
  // `oneLine` for the same reason as above: a refusal is read as one line, and a
  // directory name that breaks it can write a second refusal nobody asked for.
  const where =
    scope === 'global'
      ? 'the machine-global tree'
      : `the ${scope} tree of this project (${oneLine(session.project as string)})`;
  return (
    `${kind} "${id}" is in ${where}, but has no readable state there — this ` +
    'session sees its creation and nothing after it'
  );
}
