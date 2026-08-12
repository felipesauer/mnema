/**
 * Locating the tree an entity lives in.
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

import type { CatalogEvent, UpcasterRegistry } from '@mnema/chain';
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

  for (const scope of SEARCH_ORDER) {
    const root = chainRootForScope(trees, scope);
    if (root === undefined) continue; // that tree is not present in this context
    if (holdsBirth(root, canonical)) return scope;
  }
  return undefined;
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
