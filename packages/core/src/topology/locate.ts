/**
 * Locating the tree something lives in — an ENTITY by its birth, a TAIL by its
 * files.
 *
 * Both questions have the same shape and the same answer must not be reached two
 * ways: which trees are searched, in what order, and stopping at the first one that
 * holds it. That walk is {@link treesToSearch}, and every reading below is over it.
 *
 * IT USED TO SAY the two readings differ ONLY in what "holds it" means, both of them
 * over {@link firstTreeHolding}. What falsified it is that a tail has a second
 * question — WHICH tails are here, which `mnema tail list` prints — and a walk that
 * can only answer yes or no about one name cannot answer it. So the tail half is an
 * ENUMERATION now ({@link tailsHeldIn}) and locating one is a search over that
 * enumeration; the entity half is unchanged. What survived is the rule that matters:
 * the tree set and its order are decided in one place, and a reading that needs to
 * say where it looked asks that same place ({@link treesSearched}).
 *
 * An entity (a task, a decision, a skill) is BORN in exactly one tree: its
 * birth event — `task.created`, `decision.recorded`, `skill.created` — is
 * appended once, to one chain, and its id is minted per creation, so two trees
 * never hold a birth for the same id. This read answers "which tree holds the
 * birth of the entity with this id?" by replaying each resolved tree and looking
 * for that birth. It returns the scope of the tree that has it, or undefined
 * when no visible tree does (a partial clone simply does not carry it).
 *
 * Why the surface needs this: a transition must land in the SAME tree the
 * entity was born in. Writing a `task.transitioned` to a tree other than the
 * one holding its `task.created` splits the entity's history across the
 * public/private boundary — and whoever reads only one tree (the team, who
 * clones only the public tree) sees a partial, incoherent history: a task born
 * public that never moves, or a move with no birth the projection correctly
 * drops. So a surface resolves the entity's home with this read, then opens
 * THAT tree's writer. The birth's scope decides where every later transition
 * goes; the entity has one home for life.
 *
 * The operation that appends a transition stays pure — it takes one context (one
 * tree) and knows nothing of the others. Finding the home is a READ the surface
 * composes before it opens the writer, keeping the write a single-tree act.
 *
 * THE RULE IS HERE; HOW A TREE IS ASKED IS THE CALLER'S. Two things decide the
 * answer: which trees are searched and in what order, and what counts as the
 * same id — both are domain rules and both stay in this module. What varies is
 * only the mechanical question "does the tree rooted HERE hold this birth?",
 * which {@link locateEntityScopeWith} takes as a {@link BirthProbe}. Replaying
 * the chain is one way to answer it and the default one ({@link locateEntityScope});
 * a caller holding a materialized read model over that same chain can answer it
 * with an indexed lookup instead. Because both go through the same walk, the two
 * cannot disagree about the rule — only about how one tree is interrogated.
 *
 * Cost of the default: it replays every present tree until it finds the birth
 * (short-circuiting on the first match). There are at most three trees, but the
 * replay is linear in the chain and this read runs before every entity-keyed
 * operation, so it grows with the record — which is precisely why the probe is a
 * parameter rather than a fixed strategy.
 */

import {
  type CatalogEvent,
  listTails,
  readTailEntries,
  standingOf,
  type TailStanding,
  tailWaiversIn,
  type UpcasterRegistry,
} from '@mnema/chain';
import { canonicalId } from '../identity/id.js';
import { orderedEvents } from '../projections/order.js';
import type { ResolvedTrees } from './resolve.js';
import { chainRootForScope, type Scope } from './routing.js';

/**
 * The birth event kinds — the one event each workflow entity is created by.
 * A subject appears in one of these exactly once, in the tree it was born in.
 */
const BIRTH_KINDS = new Set<CatalogEvent['kind']>([
  'task.created',
  'decision.recorded',
  'skill.created',
]);

/**
 * The scopes to search, in a fixed, deterministic order. Since an entity is born
 * in exactly one tree, the order does not change the result — only which chain
 * is replayed first before the match short-circuits the rest.
 */
const SEARCH_ORDER: readonly Scope[] = ['public', 'private', 'global'];

/**
 * THE WALK every reading here shares: the trees this context has, in
 * {@link SEARCH_ORDER}, skipping the ones it does not have.
 *
 * It is one function because the ORDER and the skipping of absent trees are the
 * parts a second copy would get subtly right and then drift on — the answer would
 * still look correct, and two surfaces would disagree about which tree owns a thing
 * present in two of them. It yields rather than returning a list so a caller that
 * stops early never opens a tree the answer no longer depends on.
 */
function* treesToSearch(trees: ResolvedTrees): Generator<{ scope: Scope; root: string }> {
  for (const scope of SEARCH_ORDER) {
    const root = chainRootForScope(trees, scope);
    if (root === undefined) continue; // that tree is not present in this context
    yield { scope, root };
  }
}

/**
 * The trees a search from here covers, in the order it covers them — the set, said
 * out loud.
 *
 * A reading that finds NOTHING has to name where it looked, or its answer is
 * indistinguishable from "there is nowhere to look" (`mnema tail list` over a record
 * with no tail says this). Naming them from the same walk that does the searching is
 * what keeps the sentence true: a fourth tree added to {@link SEARCH_ORDER} is
 * searched and named by one change, not by two that can disagree.
 */
export function treesSearched(trees: ResolvedTrees): Scope[] {
  return [...treesToSearch(trees)].map((tree) => tree.scope);
}

/**
 * The walk, stopping at the first tree that holds what is being looked for.
 * Undefined when none of them does. What each caller supplies is only what "holds
 * it" means.
 */
function firstTreeHolding(
  trees: ResolvedTrees,
  holds: (chainRoot: string) => boolean,
): Scope | undefined {
  for (const { scope, root } of treesToSearch(trees)) {
    if (holds(root)) return scope;
  }
  return undefined;
}

/**
 * Answers, for ONE tree, whether it holds the birth of the entity with this id.
 *
 * The id arrives already canonical — the caller of a probe never has to
 * canonicalize, and a probe must not apply a policy of its own, or the two
 * halves of the read would disagree about what "the same id" means.
 *
 * A probe answers about the tree rooted at `chainRoot` and nothing else. It is
 * called at most once per searched tree, in the search order, and not at all for
 * trees the context does not have.
 *
 * A probe that reads a PROJECTION rather than the raw chain answers about
 * entities the projection holds, and a projection holds only COMPLETE ones (a
 * birth is two appends: the record and its initial transition). A tree carrying
 * a truncated birth — the record with no transition — is located by a replaying
 * probe and not by a projecting one. Every operation keyed on such an entity
 * refuses `UNKNOWN_<KIND>` either way, so the difference does not reach the
 * caller through the ordinary paths; a caller adding a new one should know the
 * boundary exists.
 */
export type BirthProbe = (chainRoot: string, id: string) => boolean;

/**
 * Finds the scope of the tree the entity with `id` was born in — the whole rule,
 * with `holdsBirth` answering the per-tree question. Returns undefined when no
 * present tree holds the birth (it is not visible here — a partial clone, or an
 * id that never existed). Generic across entity kinds: a birth is a birth,
 * whichever of the three workflow entities it belongs to.
 *
 * Two things happen here that a probe must never repeat or override:
 *
 *   - The id is canonicalized once, into the same form a birth's subject is
 *     stored in, so a composition variant cannot false-miss (the write
 *     operations look entities up the same way). An id the chain cannot
 *     canonicalize matches nothing and short-circuits to undefined without a
 *     single tree being touched.
 *   - The trees are searched in {@link SEARCH_ORDER}, skipping those the context
 *     does not have, and the walk stops at the first hit — so a probe is never
 *     asked about a tree the answer no longer depends on.
 */
export function locateEntityScopeWith(
  trees: ResolvedTrees,
  id: string,
  holdsBirth: BirthProbe,
): Scope | undefined {
  const canonical = canonicalId(id);
  if (canonical === undefined) return undefined;
  return firstTreeHolding(trees, (root) => holdsBirth(root, canonical));
}

/**
 * The probe that reads the chain itself: replays the tree and looks for a birth
 * event with this subject. It sees every birth on the chain, complete or not,
 * because it reads the facts rather than a view derived from them.
 *
 * Exported because {@link BIRTH_KINDS} — what counts as a birth at all — is a
 * domain rule, and a caller searching a set of trees this module cannot name (a
 * surface spanning several records) would otherwise have to restate the set to
 * fall back on the chain. Restating it is how the two halves of one search come to
 * disagree about which events are births.
 */
export function replayingBirthProbe(upcasters: UpcasterRegistry): BirthProbe {
  return (chainRoot, id) => {
    const events = orderedEvents({ root: chainRoot }, upcasters);
    return events.some((event) => BIRTH_KINDS.has(event.kind) && event.subject === id);
  };
}

/**
 * Finds the scope of the tree the entity with `id` was born in by replaying each
 * tree's chain — the read with no dependency beyond the chain itself, and the
 * one every surface uses unless it is holding something faster.
 *
 * This is {@link locateEntityScopeWith} over the replaying probe, not a second
 * implementation: the search order, the canonicalization and the short-circuit
 * are the same code, so a caller that swaps the probe changes how one tree is
 * asked and nothing else.
 */
export function locateEntityScope(
  trees: ResolvedTrees,
  id: string,
  upcasters: UpcasterRegistry,
): Scope | undefined {
  return locateEntityScopeWith(trees, id, replayingBirthProbe(upcasters));
}

/**
 * One tail a tree here holds: which tree, which tail, what the disk says about it,
 * and whether that tree already carries a waiver authorizing its cut.
 */
export interface HeldTail {
  /** The tree holding it — the one a waiver over it has to be written to. */
  readonly scope: Scope;
  /** The tail id, whole: it is what `tail prune` takes, so a short form is unusable. */
  readonly tail: string;
  /** What the disk says right now: how it ends, how much it holds, whose it is. */
  readonly standing: TailStanding;
  /**
   * Whether some waiver IN THE SAME TREE already authorizes cutting it.
   *
   * Same tree, because that is where a waiver has to live to be met by the census
   * that reads it — see {@link locateTailScope}. A waiver about this tail sitting in
   * another tree is a signed fact nobody will meet, and saying "authorized" from it
   * would report an authorization the record cannot use.
   */
  readonly authorized: boolean;
}

/**
 * Every tail the trees here hold, tree by tree in {@link SEARCH_ORDER} and tail by
 * tail in the sorted order the store lists — the one enumeration, which
 * {@link locateTailScope} is a search over and `mnema tail list` prints.
 *
 * A TAIL IS NOT AN ENTITY, so this asks the disk rather than the record: a tail is a
 * directory of files, not a subject some event was minted for. Each tree's tails are
 * read ONCE — the entries answer both what each tail's standing is
 * (`standingOf`, the one reading of that there is) and which waivers the tree
 * carries (`tailWaiversIn`, which the census asks with the same function).
 *
 * AN EMPTY TAIL IS NOT HELD, for the reason `tailStanding` gives: a directory with
 * an ownership proof and no event is the ordinary residue of a session that only
 * read, and there is nothing in it to account for. So it is absent from the listing
 * and unlocatable by the verb that authorizes a cut, which is the same answer twice
 * rather than two answers.
 *
 * Cost: it reads every tail of every tree it walks, whole. That is what the caller
 * asking for the LIST needs by definition; the caller looking for ONE tail stops at
 * the tree that holds it (this is a generator, and {@link locateTailScope} does not
 * drain it), so it pays for the tails read before the match and for no later tree.
 */
function* tailsHeldIn(trees: ResolvedTrees, upcasters: UpcasterRegistry): Generator<HeldTail> {
  for (const { scope, root } of treesToSearch(trees)) {
    const layout = { root };
    const entriesByTail = new Map(
      listTails(layout).map((tail) => [tail, readTailEntries(layout, tail, upcasters)] as const),
    );
    const authorized = new Set(tailWaiversIn(entriesByTail).map((waiver) => waiver.tail));
    for (const [tail, entries] of entriesByTail) {
      const standing = standingOf(entries);
      if (standing === undefined) continue;
      yield { scope, tail, standing, authorized: authorized.has(tail) };
    }
  }
}

/**
 * Every tail the trees here hold — {@link tailsHeldIn} drained, for the reading that
 * wants all of them.
 */
export function tailsHeld(trees: ResolvedTrees, upcasters: UpcasterRegistry): HeldTail[] {
  return [...tailsHeldIn(trees, upcasters)];
}

/**
 * Finds the scope of the tree that holds the tail `tailId` — the tree a waiver
 * over that tail has to be written to. Undefined when no present tree holds it
 * with events in it.
 *
 * IT IS A SEARCH OVER {@link tailsHeldIn} AND THAT IS THE POINT. The verb that
 * authorizes a cut resolves the tree with this; the verb that lists what can be cut
 * prints that enumeration. A tail one of them sees and the other does not is a
 * listing that offers a cut the record refuses, or a cut of something the listing
 * never showed — and a second implementation of "where I look for tails" is exactly
 * what produces it. `the-verb-says-which-tails.test.ts` holds the two to each other;
 * this makes them the same walk, so the test guards a property rather than a habit.
 *
 * WHY THE SURFACE NEEDS IT, and it is the same argument a transition makes: a
 * waiver lives in the SAME tree as the tail it names, because the census that later
 * reads it is per-tree (`@mnema/chain`, `waiver.ts`). A waiver written to another
 * tree is a signed fact nobody looking at the orphaned key will ever meet. So a
 * surface resolves the tail's tree with this read, then opens THAT tree's writer,
 * and the write stays the single-tree act every other one is.
 */
export function locateTailScope(
  trees: ResolvedTrees,
  tailId: string,
  upcasters: UpcasterRegistry,
): Scope | undefined {
  for (const held of tailsHeldIn(trees, upcasters)) {
    if (held.tail === tailId) return held.scope;
  }
  return undefined;
}
