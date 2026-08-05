/**
 * decisions: the calls that are in force — what governs the work here.
 *
 * A decision is the record's answer to "why is it like this", and until now no
 * read of the session context mentioned one. The record could hold every ADR a
 * project ever argued and the opening context would say nothing about them, which
 * is the same shape as an empty answer: an agent that is not told a decision
 * exists proceeds as if none did, and re-decides what was already settled.
 *
 * ONLY `accepted`, AND ONE READ IS ENOUGH. Proposed is a call still on the table,
 * rejected is one that was refused, and superseded is one a later decision
 * replaced — none of the three governs anything. The workflow moves a replaced
 * decision INTO `superseded` (`DECISION_TRANSITIONS`: `supersede` reaches it from
 * both `proposed` and `accepted`), so filtering on `accepted` already excludes a
 * superseded one; no cross-check against the supersede edge is done here, and that
 * is deliberate. Two rules answering one question can come to disagree, and the
 * projected state is the one the chain proves. Asserted in `decisions.test.ts` —
 * "serves only the decisions in force, and no other state" and "drops a decision
 * the moment a successor supersedes it".
 *
 * NAMES, NEVER BODIES — the rule this layer already had, applied to the one entity
 * whose body is the longest. A decision's BODY is now two fields — the `rationale`
 * that argues it and the `alternatives` it turned down — and twenty of those in
 * every session's opening context would bury what matters and charge for what
 * rarely applies. What comes back is the NAME: the title a reader recognizes, the
 * `adr` label they cite it by, and the id that asks for the rest. Both halves of the
 * body come from a second read (`readRecord`, the `read_record` tool), asked about
 * the one decision that turned out to bear on the task at hand. Asserted in
 * `decisions.test.ts` — "never carries the RATIONALE".
 *
 * The instant is NOT served, and it is what the order is made of. A decision in
 * force was last moved by its acceptance, so `updatedAt` is when it came into
 * force — freshest first is "most recently settled first". Serving it would be a
 * fourth line per item for a fact no consumer acts on: an agent does not choose
 * which decision to obey by date, and a person auditing the sequence has
 * `audit_timeline`, which shows the events themselves.
 *
 * ACROSS THE TREES the caller can see, like the patterns and for the same reason.
 * The team's decisions are committed to the public tree, a machine's own to the
 * private one, a personal convention to the global one — and all three govern
 * whatever is being done here. Reading per-tree projections and concatenating is
 * not an approximation of reading the union: a decision's whole history lands in
 * ONE tree (a move follows the entity), so the per-tree fold and the union fold
 * see the same events for it.
 */

import type { DecisionProjection, DecisionState, ProjectionCache } from '@mnema/core';

/** The one state whose decisions govern — typed, so a typo fails the build. */
const IN_FORCE: DecisionState = 'accepted';

/** A decision in force, named but not spelled out — what an index is made of. */
export interface DecisionRef {
  /** The decision's id — the key that asks `readRecord` for the rationale. */
  readonly id: string;
  /**
   * The citable `ADR-<n>` label, frozen into the record at write time. It is how a
   * person cites the decision in a commit or a review, which is why it travels
   * beside the title; it is NOT identity (two offline clones can mint one label
   * twice), so it is never what a second read is asked by.
   */
  readonly adr: string;
  /** The decision's title — DISPLAY, and the trigger a reader recognizes. */
  readonly title: string;
}

/**
 * Every decision in force across `caches`, most recently settled first, ties
 * broken by id so the order is total.
 *
 * The order is a property of the CONTENT (when the decision came into force, then
 * its id), never of the tree it happens to live in — so adding a tree to the list,
 * or reading them in a different order, cannot reshuffle the answer. Callers put
 * this in a prompt, and a stable order is what keeps the host's cache of that
 * prefix valid; the same argument the search's ordering is written on.
 *
 * ONE function, and both consumers exist now. The opening context ({@link bootstrap})
 * serves the first page of this list; the per-prompt brief ({@link brief}) serves the
 * whole of it, uncut, into a file. "In force" written in two places is two rules that
 * can come to disagree about which decisions govern, which is the one thing this
 * answer must never be uncertain about — and the disagreement would be silent, since
 * each reader would simply obey its own set.
 *
 * The two consumers ask over DIFFERENT trees, and neither of them narrows this
 * function to do it: the brief is asked about the tree that travels alone, because
 * its answer becomes a committed file, and it filters its own sources before calling
 * here (see {@link brief}). Which is the shape this rule has to keep — a filter
 * pushed down into this function to satisfy one consumer would silently shrink the
 * other's answer, and an opening context that stops mentioning a decision says
 * nothing about having stopped.
 */
export function decisionsInForce(caches: readonly ProjectionCache[]): DecisionRef[] {
  const all: DecisionProjection[] = [];
  for (const cache of caches) all.push(...cache.listDecisionsByState(IN_FORCE));
  return all.sort(bySettledDesc).map(toRef);
}

function toRef(decision: DecisionProjection): DecisionRef {
  return { id: decision.id, adr: decision.adr, title: decision.title };
}

/** Most recently settled first; ties keep a stable (id) order. */
function bySettledDesc(a: DecisionProjection, b: DecisionProjection): number {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
