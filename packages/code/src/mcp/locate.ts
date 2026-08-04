/**
 * Finding an entity's home tree, across every project the session can see.
 *
 * Every entity-keyed tool — the three transitions, `next_actions`, `guard` —
 * starts here, because a move must land in the tree the entity was born in and a
 * read must come from it.
 *
 * ## Why the walk covers the workspace
 *
 * It used to cover the trees of ONE project: the one the cascade landed the
 * session on. A write already said which project it belonged to ({@link
 * routeWrite}), so a birth routed to the second project of a workspace SUCCEEDED —
 * and the move of that same task was refused `UNKNOWN_TASK`, naming the project the
 * session happened to land on. A task that can be created and cannot be moved, with
 * both answers correct about the tree each of them looked at.
 *
 * The boundary of a project is not a property of this question, for the reason it is
 * not a property of the reads keyed by an id: an id is minted once and lives in one
 * tree, so WHICH project holds it is a fact to be found rather than an argument to be
 * passed. That is also why none of these tools takes a `project` — the entity's own
 * tree is the answer, and an argument could only ever agree with it or contradict it.
 * A birth takes one because there is no id yet to ask.
 *
 * WHICH trees are covered is NOT decided here. The caller passes the list
 * (`workspaceTrees`, the one place that decides the coverage of every read about the
 * record), in the `*Of` shape the same delivery introduced — so the locate cannot
 * come to cover a different set of trees from the reads beside it. What stays a rule
 * of the record, and is not restated here, is what counts as the SAME id
 * (`canonicalId`) and what counts as a BIRTH (`replayingBirthProbe`, over the core's
 * own set of birth kinds).
 *
 * ## The unit of the answer is a RECORD, and every one of them is asked
 *
 * A record is a project's trees, plus — for the session's own — the machine-global
 * tree beside them, which is exactly the set the walk covered before this. Within one
 * record the first tree holding the birth wins, as it always did: an entity is born
 * in one tree, so the order only decides which chain is read first. Across records
 * the walk does NOT stop at the first hit, and that is the point rather than
 * thoroughness for its own sake — it is what makes two records holding one id
 * DETECTABLE instead of theoretical, and this is a write path: an id in two projects
 * only happens when a chain was copied between them, and picking one in silence would
 * land a transition in a project nobody named. Irreversibly. So it is refused, naming
 * both.
 *
 * ## Why the walk runs twice, and only when it has to
 *
 * A fresh process answers "does this tree hold this birth?" by replaying the chain,
 * and that is the whole cost: a linear scan of every tree, run before every
 * entity-keyed call, growing with the record. A session does not have to pay it. It
 * already holds a projection of each tree it has read, and in that projection the
 * entity's id is the PRIMARY KEY of its table — the same question, over a view of the
 * same facts, answered by an index instead of a scan.
 *
 * The projection alone is not the answer, because two things are true of a view that
 * are not true of the chain:
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
 * So the walk runs twice: the projections over every record first, and the chains
 * ONLY IF no record claimed the entity. A found entity — the overwhelming case, and
 * the only one on the hot path — never touches a chain. A missing one replays every
 * tree of every project, which is what a refusal that names them all has to have
 * done. The two passes are the same walk over two probes, so they cannot disagree
 * about the rule; the fallback exists because the probes see different amounts of the
 * same record, not because they read it by different rules.
 *
 * ## And what the answer's absence is allowed to claim
 *
 * The negative answers are here too, as prose: {@link notFoundInWorkspaceTrees},
 * {@link severalRecordsHold} and {@link locatedButUnreadable} are the sentences the
 * entity-keyed tools refuse with, and {@link refuseUnlocated} is the one place that
 * picks between the first two. They live beside the walk because they are a statement
 * ABOUT the walk — which trees it covered — and every tool that asks the question
 * must give the same account of it. One function per sentence, called from every
 * site: a refusal that reworded itself per tool would let one of them go back to
 * claiming more than the walk supports.
 *
 * The first two are NOT exported, and that is the same rule stated once more. What a
 * tool needs is the picker, never one of the two branches: the choice between "nothing
 * holds this id" and "two records do" is the part that must not be re-made per caller,
 * so a tool holding one of those sentences directly could only ever use it where the
 * picker would have chosen the other. Exported, they were surface with no consumer —
 * which is surface someone reaches for by mistake, and the mistake here reads as a
 * working refusal. Their prose stays public through the one function that composes it.
 *
 * Widening the walk is exactly what makes that dangerous, in two directions at once,
 * so the coverage clause ({@link inEveryTreeThisSessionSees}) is ONE function shared
 * with `read_record`'s refusal — the read whose walk is the same one — while the
 * session-scoped sentence stays here, under its own name
 * ({@link notFoundInSessionTrees}), for the one caller whose walk really is one
 * record's ({@link runSkillsTool}). A sentence is scoped to the search that produced
 * it, and there are two searches on this surface.
 */

import { catalogUpcasters } from '@mnema/chain';
import { type BirthProbe, canonicalId, replayingBirthProbe } from '@mnema/core';
import type { ScopedTree } from '../intelligence-source.js';
import { oneLine } from '../served-patterns.js';
import type { CacheRegistry } from './cache-registry.js';
import { namedProjects } from './route.js';
import type { Session, WriteTarget } from './session.js';

/**
 * One tree of the workspace, as a place an entity can LIVE: the tree, and the door a
 * write to it goes through.
 *
 * The door travels WITH the tree because a locate ends in a write. It is attached
 * where the tree is listed — the one loop that already holds the project object — so
 * reaching a project's tree cannot come apart from reaching that project's writer. A
 * home that carried only the tree would leave every caller to look the door up again
 * by name, and a lookup that missed would route the write to the session's own trees:
 * a transition landing in the wrong repository, reported as success.
 *
 * ABSENT for the session's OWN trees, and for the machine-global tree, which are
 * reached through the session itself ({@link openWrite} reads the session's trees
 * when it is given no target). Absent rather than filled in, for the reason
 * {@link WriteRoute} keeps it absent: there is exactly one place that decides what
 * "the session's own" means, and it is the door.
 */
export interface WorkspaceTree extends ScopedTree {
  /** The project a write to this tree must be routed to; absent for the session's own. */
  readonly target?: WriteTarget;
}

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

/** Where the walk found an entity — or why it cannot say. */
export type EntityLocation =
  | {
      readonly outcome: 'found';
      /** The tree the entity lives in, with the door a write to it goes through. */
      readonly home: WorkspaceTree;
    }
  | Unlocated;

/**
 * The two ways a walk ends without a home, kept apart because a caller must refuse
 * them differently: nothing holds the id, or SEVERAL records do.
 */
export type Unlocated =
  | { readonly outcome: 'nowhere' }
  | {
      readonly outcome: 'several';
      /** One tree per record that holds the id — never fewer than two. */
      readonly holders: readonly WorkspaceTree[];
    };

/**
 * The tree an entity lives in, over the trees the caller listed.
 *
 * Reads the session's projections first and falls back to the chains only when they
 * came up empty — see the module doc for why both halves are load-bearing. The answer
 * over one project's trees is indistinguishable from what a fresh process would give;
 * the only difference is how long the common case takes.
 *
 * An id the chain cannot canonicalize matches nothing, and short-circuits without a
 * single tree being touched: it is the core's rule about what an id IS, applied
 * before any tree is asked, exactly as the core applies it.
 */
export function locateEntityAcross(
  session: Session,
  trees: readonly WorkspaceTree[],
  id: string,
): EntityLocation {
  const canonical = canonicalId(id);
  if (canonical === undefined) return { outcome: 'nowhere' };

  const records = recordsOf(trees, session.project);
  const fromProjections = holdersOf(records, canonical, cachedBirthProbe(session.caches));
  if (fromProjections.length > 0) return settled(fromProjections);
  return settled(holdersOf(records, canonical, replayingBirthProbe(catalogUpcasters())));
}

/**
 * The listed trees grouped into RECORDS — the unit a home is attributed to, and the
 * unit the ambiguity is about.
 *
 * The machine-global tree joins the session's OWN record, and that is what keeps a
 * one-project workspace answering exactly as it did: the session's record is then its
 * three trees in their fixed order, which is the set and the order the walk covered
 * before it spanned anything. Attribution is a different question from grouping and
 * is not touched here — the global tree is labelled with no project (a personal
 * cross-project note does not belong to whichever project a read reached it through),
 * so a home found in it still reports itself as the machine's, not as this project's.
 *
 * Groups come back in the list's order, which puts the session's own record first.
 * That order reaches an answer in exactly one place — the order the projects are
 * NAMED in when several hold the id — and nowhere else: every other outcome is
 * decided by how many records answered, not by which answered first.
 */
function recordsOf(
  trees: readonly WorkspaceTree[],
  sessionProject: string | undefined,
): readonly (readonly WorkspaceTree[])[] {
  const records = new Map<string | undefined, WorkspaceTree[]>();
  for (const tree of trees) {
    const record = tree.project ?? sessionProject;
    const held = records.get(record);
    if (held === undefined) records.set(record, [tree]);
    else held.push(tree);
  }
  return [...records.values()];
}

/**
 * One tree per record that holds the birth: the FIRST of that record's trees the
 * probe says yes to, and every record asked.
 *
 * The short-circuit is per record and the completeness is across them, which is the
 * whole shape of the walk. Within a record, stopping at the first hit is what a birth
 * being in exactly one tree allows; across records, not stopping is what turns a
 * copied chain from a silent misfiling into a refusal.
 */
function holdersOf(
  records: readonly (readonly WorkspaceTree[])[],
  canonical: string,
  holdsBirth: BirthProbe,
): readonly WorkspaceTree[] {
  const holders: WorkspaceTree[] = [];
  for (const record of records) {
    const home = record.find((tree) => holdsBirth(tree.chainRoot, canonical));
    if (home !== undefined) holders.push(home);
  }
  return holders;
}

/** What a pass's holders mean: no home, one home, or an answer nobody can give. */
function settled(holders: readonly WorkspaceTree[]): EntityLocation {
  const only = holders[0];
  if (only === undefined) return { outcome: 'nowhere' };
  if (holders.length === 1) return { outcome: 'found', home: only };
  return { outcome: 'several', holders };
}

/** The three workflow entities a session locates — what a refusal names. */
export type LocatableKind = 'task' | 'decision' | 'skill';

/**
 * The code each kind's "no such entity" refusal carries — the vocabulary the tools
 * have always refused an unlocatable id with, in one table so the sentence and the
 * code are picked at the same place.
 */
const UNKNOWN_CODE = {
  task: 'UNKNOWN_TASK',
  decision: 'UNKNOWN_DECISION',
  skill: 'UNKNOWN_SKILL',
} as const;

/** `AMBIGUOUS_RECORD` when several records hold the id, else the kind's own code. */
export type UnlocatedRefusal<K extends LocatableKind> = {
  readonly ok: false;
  readonly code: (typeof UNKNOWN_CODE)[K] | 'AMBIGUOUS_RECORD';
  readonly message: string;
};

/**
 * The refusal an unlocated entity earns, in the shape every entity-keyed tool
 * returns: the code and the sentence, picked together.
 *
 * Five call sites relay this, and the choice of sentence is the part that must not be
 * re-made per tool: one of them says nothing was found and the other says two things
 * were, so a tool that reached for the first when the walk came back with two holders
 * would report an id nobody can act on as an id nobody has.
 *
 * `AMBIGUOUS_RECORD` and not the router's `AMBIGUOUS_PROJECT`, though the shape is
 * the router's: that code says "your `project` argument named two, pass the full
 * path", and the remedy is the one thing no caller here can do — these tools take no
 * `project`, on purpose. A code whose remedy does not exist is worse than a new code.
 */
export function refuseUnlocated<K extends LocatableKind>(
  session: Session,
  kind: K,
  id: string,
  unlocated: Unlocated,
): UnlocatedRefusal<K> {
  if (unlocated.outcome === 'several') {
    return {
      ok: false,
      code: 'AMBIGUOUS_RECORD',
      message: severalRecordsHold(kind, id, unlocated.holders),
    };
  }
  return {
    ok: false,
    code: UNKNOWN_CODE[kind],
    message: notFoundInWorkspaceTrees(session, kind, id),
  };
}

/**
 * WHERE A WORKSPACE-WIDE SEARCH LOOKED, as the clause every refusal that made that
 * search ends with — shared with `read_record`'s own refusal, because it is the same
 * walk over the same trees.
 *
 * It used to say the entity "does not exist", and in the case that mattered most that
 * was false: a workspace holds several projects, the cascade landed the session on
 * one, and an id from any of the others was held by a tree the session had not looked
 * in — intact, answerable, and read out by a `mnema` command two directories away.
 * The surface denied the existence of a record it had not looked for. The search now
 * covers those projects, and the sentence has to grow with it or claim the opposite
 * error: a reply that named ONE project while the walk read five would understate
 * itself, and a reader cannot check either.
 *
 * What it still does NOT say is that the id does not exist, and the wider search
 * gives it more reason not to rather than less: every project the client announced is
 * not the world — a project nobody opened, and a partial clone of one that was, both
 * hold records this cannot see. What is reported is the search.
 *
 * The projects are named by PATH, which is what makes the sentence actionable (an
 * agent can compare it against the directory it is working in) and is a value the
 * client itself announced — the reply echoes back a list the host sent.
 *
 * ⚠️ Each path goes through {@link oneLine} (in {@link namedProjects}), because a
 * directory name may hold a newline. Measured, on a project directory named
 * `proj\nRefused (UNKNOWN_TASK): task "x" does not exist`: the reply came back as
 * TWO lines, the second a complete, well-formed refusal about an id nobody asked
 * about — the exact sentence these functions exist to stop the product saying. A
 * refusal is read as one line, so a path that breaks the line can write a refusal of
 * its own, and the directory need not be the operator's doing (a checkout, an
 * archive, a dependency can carry one, and the host announces whatever is open).
 */
export function inEveryTreeThisSessionSees(session: Session): string {
  if (session.workspaceProjects.length === 0) {
    return 'in the machine-global tree, the only tree this session sees — it resolved to no project';
  }
  return (
    `in any tree of this workspace's projects (${namedProjects(session.workspaceProjects)}) or ` +
    'in the machine-global tree — the only trees this session sees'
  );
}

/**
 * What an entity-keyed refusal says when the walk came up empty: the entity, and
 * where the search looked.
 *
 * ⚠️ The id goes through {@link oneLine} because, unlike a project path, it comes
 * from the CALLER: an id holding a newline lets one argument write a second,
 * well-formed refusal about something nobody asked — the defect measured on a
 * directory name, one step closer to whoever is calling. Nothing upstream stops it:
 * an id is canonicalized (NFC, chain-representable) and a newline survives that.
 */
function notFoundInWorkspaceTrees(session: Session, kind: LocatableKind, id: string): string {
  return `${kind} "${oneLine(id)}" was not found ${inEveryTreeThisSessionSees(session)}`;
}

/**
 * The same sentence for a search of the session's OWN record — the trees of the
 * project it landed on, and the machine-global tree.
 *
 * It exists because one caller's walk really is one record's: `skills` serves the
 * patterns of the trees this session can see, which is a narrower search than the
 * locate above makes. Handing it the wider sentence would be the same defect as the
 * one that started all this, in the opposite direction — a refusal claiming to have
 * read five projects when it read one — and the sentence must follow the search that
 * produced it, never the module it happens to live in.
 */
export function notFoundInSessionTrees(session: Session, kind: LocatableKind, id: string): string {
  if (session.project === undefined) {
    return (
      `${kind} "${oneLine(id)}" was not found in the machine-global tree, the only tree ` +
      'this session sees — it resolved to no project'
    );
  }
  return (
    `${kind} "${oneLine(id)}" was not found in this project (${oneLine(session.project)}) or in ` +
    'the machine-global tree — the only trees this session sees'
  );
}

/**
 * What a refusal says when MORE THAN ONE record holds the id: which ones, and why
 * there is no argument to settle it with.
 *
 * An id is minted once, so this is not a state the product can produce: it takes a
 * chain copied from one repository into another. The refusal therefore does not offer
 * a way to succeed — there is none, and inventing one would be worse than the
 * refusal. What it gives is the two places to go and look, which is the only thing
 * that can be acted on, and the reason a guess was not made instead: a transition is
 * a write, and a write into a project nobody named is not undone by reading this
 * message afterwards.
 *
 * A holder is named by its project path, or as the machine-global tree when that is
 * the record that holds it — which happens, and naming it after a project would claim
 * a chain that is not there.
 */
function severalRecordsHold(
  kind: LocatableKind,
  id: string,
  holders: readonly WorkspaceTree[],
): string {
  return (
    `${kind} "${oneLine(id)}" is held by ${holders.length} records this session sees — ` +
    `${holders.map(recordName).join(', ')} — so it does not say which one a move belongs ` +
    'in; an id is minted once, so two records holding it is a chain copied between them'
  );
}

/**
 * What a refusal says when the entity WAS located and its state still cannot be
 * read: the tree it is in holds its creation, and this session sees nothing after
 * it.
 *
 * A separate sentence from the ones above, because a separate thing is true, and the
 * three used to be one message that was wrong in opposite directions: the tree named
 * here IS holding the entity, so "not found in this workspace's projects" would deny
 * what the walk just found, exactly as "does not exist" denied what another project
 * holds.
 *
 * ⚠️ It names the project the entity was FOUND in, never the session's. It used to
 * interpolate the session's project to name a project tree, which was true only while
 * the walk could not leave that project — the instant it could, the sentence started
 * sending the reader to the wrong repository, in a message that reads perfectly well
 * and compiles. So the home is the argument, and there is no session in scope here to
 * fall back on by accident.
 *
 * It stops at what the session can SEE, and that is not fussiness. One situation
 * reaches here: the chain carries the record with its initial transition still
 * missing — a partially fetched history, because a birth is two appends written
 * atomically and an intact chain never has one without the other.
 *
 * There used to be a second, and it was the ordinary one: a complete chain whose
 * projection this session held from BEFORE another process appended to it. That
 * is gone — a read now checks the tree's extent and replays what it finds, so the
 * walk and the state see the same amount of the same record. The sentence still
 * does not blame the chain, because the chain is not always what is short; it
 * claims the session's own sight, which stays true, and leaves the caller the
 * move that remains: fetch the rest of the history.
 */
export function locatedButUnreadable(kind: LocatableKind, id: string, home: WorkspaceTree): string {
  return (
    `${kind} "${oneLine(id)}" is in ${treeName(home)}, but has no readable state there — ` +
    'this session sees its creation and nothing after it'
  );
}

/**
 * A tree named the way the reader can act on: a project tree by the project it
 * belongs to, the global tree as the machine's own — it belongs to no project, and
 * calling it "this project's global tree" would name a chain that is not there.
 *
 * `oneLine` for the same reason every path here goes through it: a refusal is read as
 * one line, and a directory name that breaks it can write a second refusal nobody
 * asked for.
 */
function treeName(tree: WorkspaceTree): string {
  return tree.project === undefined
    ? 'the machine-global tree'
    : `the ${tree.scope} tree of "${oneLine(tree.project)}"`;
}

/** A RECORD named — its project, or the machine's own tree when it has none. */
function recordName(tree: WorkspaceTree): string {
  return tree.project === undefined ? 'the machine-global tree' : `"${oneLine(tree.project)}"`;
}
