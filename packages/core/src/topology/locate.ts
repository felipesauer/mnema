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
 * Cost: it replays every present tree until it finds the birth (short-circuiting
 * on the first match). There are at most three trees and the replay is the same
 * a projection already runs, so this is acceptable; if it ever became hot a
 * caller could pass a narrower tree set, but no cache is warranted here.
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
 * Finds the scope of the tree the entity with `id` was born in, or undefined
 * when no present tree holds its birth (it is not visible here — a partial
 * clone, or an id that never existed). Generic across entity kinds: it matches
 * ANY birth event (task/decision/skill) whose subject is the id, so the same
 * read serves every workflow entity.
 *
 * The id is compared in its canonical form — the same form a birth's subject is
 * stored in — so a composition variant of the id cannot false-miss (the write
 * operations look tasks up the same way).
 */
export function locateEntityScope(
  trees: ResolvedTrees,
  id: string,
  upcasters: UpcasterRegistry,
): Scope | undefined {
  const canonical = canonicalId(id);
  if (canonical === undefined) return undefined;

  for (const scope of SEARCH_ORDER) {
    const root = chainRootForScope(trees, scope);
    if (root === undefined) continue; // that tree is not present in this context
    const events = orderedEvents({ root }, upcasters);
    if (events.some((event) => BIRTH_KINDS.has(event.kind) && event.subject === canonical)) {
      return scope;
    }
  }
  return undefined;
}
