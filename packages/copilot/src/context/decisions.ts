/**
 * decisions: the calls that are in force, and the calls that await a judgement.
 *
 * A decision is the record's answer to "why is it like this", and until now no
 * read of the session context mentioned one. The record could hold every ADR a
 * project ever argued and the opening context would say nothing about them, which
 * is the same shape as an empty answer: an agent that is not told a decision
 * exists proceeds as if none did, and re-decides what was already settled.
 *
 * ONE TABLE SAYS WHICH IS WHICH. {@link DECISION_DISPOSITION} gives every state of
 * the machine a meaning — what governs, what waits for somebody, what is over —
 * and the two lists below are DERIVED from it. Neither states its own set beside
 * it: "which state governs" written twice in one module is the shape where the
 * second copy is the one a later edit amends, and the two readers then disagree in
 * silence about what the project has settled.
 *
 * IN FORCE IS `accepted`, AND ONE READ IS ENOUGH. Proposed is a call still on the
 * table, rejected is one that was refused, and superseded is one a later decision
 * replaced — none of the three governs anything. The workflow moves a replaced
 * decision INTO `superseded` (`DECISION_TRANSITIONS`: `supersede` reaches it from
 * both `proposed` and `accepted`), so filtering on the in-force states already
 * excludes a superseded one; no cross-check against the supersede edge is done
 * here, and that is deliberate. Two rules answering one question can come to
 * disagree, and the projected state is the one the chain proves. Asserted in
 * `decisions.test.ts` — "serves ONLY the accepted — proposed, rejected and
 * superseded are all absent" and "drops a decision the moment a successor
 * supersedes it".
 *
 * AWAITING A JUDGEMENT IS `proposed`, AND THE CRITERION IS NOT THE WORK LIST'S.
 * The work list's rule is "has at least one legal move", and it does not transport
 * to this machine: `supersede` is legal from `accepted` (`DECISION_TRANSITIONS`),
 * so a decision in force has a legal move FOREVER and that rule would report it as
 * a pendency that never clears. The rule here is narrower and it is about a person:
 * somebody has to accept or reject this before it means anything. Asserted in
 * `decisions.test.ts` — "an ACCEPTED decision is not awaiting anything, though
 * `supersede` is legal from it forever".
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

import {
  DECISION_STATES,
  type DecisionProjection,
  type DecisionState,
  type ProjectionCache,
} from '@mnema/core';
import { type Disposition, statesWith } from './disposition.js';

/**
 * What each state of the decision machine means to a reader — TOTAL, so a fifth
 * state cannot be added to the workflow without being classified here.
 *
 * Read against `DECISION_TRANSITIONS`, which is the source of truth for every
 * claim below:
 *   - `proposed` — `accept` and `reject` both leave from it, and both are a
 *     verdict a person owes. That is the whole of "awaiting a judgement".
 *   - `accepted` — it governs. `supersede` is still legal from it, which is
 *     precisely why "has a legal move" is the wrong criterion for the waiting
 *     list; being replaceable is not being pending.
 *   - `rejected`, `superseded` — terminal, no row leaves either. Nothing is
 *     pending and nothing governs.
 *
 * Exported so the claims above are CHECKABLE against the table they are read from,
 * rather than asserted in prose: `disposition.test.ts` cross-checks every row of
 * this against `DECISION_TRANSITIONS`. It is not on the package's public surface —
 * a consumer gets the two lists, not the classification behind them.
 */
export const DECISION_DISPOSITION: Readonly<Record<DecisionState, Disposition>> = {
  proposed: 'awaiting-judgement',
  accepted: 'in-force',
  rejected: 'closed',
  superseded: 'closed',
};

/** The states whose decisions govern — derived, never restated. */
const IN_FORCE = statesWith(DECISION_STATES, DECISION_DISPOSITION, 'in-force');

/** The states whose decisions are waiting on somebody — derived, never restated. */
const AWAITING_JUDGEMENT = statesWith(DECISION_STATES, DECISION_DISPOSITION, 'awaiting-judgement');

/** A decision in force, named but not spelled out — what an index is made of. */
export interface DecisionRef {
  /** The decision's id — the key that asks `readRecord` for the rationale. */
  readonly id: string;
  /**
   * The citable `ADR-<n>` label, frozen into the record at write time. It is how a
   * person cites the decision in a commit or a review, which is why it travels
   * beside the title; it is NOT identity (two offline clones can mint one label
   * twice), so it is never what a second read is asked by.
   *
   * A LIST OF THESE MAY HOLD THE SAME LABEL TWICE, and no reader of this type is
   * told otherwise. The number is minted within one chain, so a list built across
   * the trees an actor can see — which is what {@link decisionsInForce} answers —
   * carries a public `ADR-1` beside a private one as soon as both trees have a rule.
   * That is the design and not a clash, and the id beside it is why it costs
   * nothing: everything a consumer does with a decision, it does by id. The one
   * place a repeat IS a defect is a single chain, where the number claims to be
   * sequential, and the two answers that carry a label somewhere it will be cited
   * on its own — the committed document and the audit — report it there.
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
  for (const cache of caches) {
    for (const state of IN_FORCE) all.push(...cache.listDecisionsByState(state));
  }
  return all.sort(bySettledDesc).map(toRef);
}

/**
 * A decision nobody has ruled on yet — a name, plus the state that says WHICH
 * ruling is missing.
 *
 * It carries the same three name fields {@link DecisionRef} does, and never the
 * body: the `rationale` and the `alternatives` come from `readRecord`, asked about
 * the one call that turned out to matter. What it adds over a ref is the pair a
 * reader of a mixed list needs — the `kind`, which says which second read serves
 * this item, and the `state`, which says what is owed.
 */
export interface DecisionAwaitingJudgement {
  /**
   * Always `decision`: the discriminant, and what says the second read will hand
   * back an ARGUMENT — the `rationale` and the alternatives, through `readRecord`.
   */
  readonly kind: 'decision';
  /** The decision's id — the key `readRecord` takes. */
  readonly id: string;
  /** The citable `ADR-<n>` label — DISPLAY, never identity (see {@link DecisionRef.adr}). */
  readonly adr: string;
  /** The decision's title — the trigger a reader recognizes. */
  readonly title: string;
  /**
   * The state it is waiting in, which is what says what is owed: `proposed` is a
   * call somebody has to accept or reject. Typed as the workflow's own state
   * rather than a bare string, and it is the state the row was READ under (the
   * bucket the indexed lookup asked for), not a second reading of the projection.
   */
  readonly state: DecisionState;
  /** `at` of its last transition — what the composed list orders on. */
  readonly updatedAt: string;
}

/**
 * Every decision awaiting a judgement across `caches`, in no particular order.
 *
 * ORDERING IS THE CALLER'S HERE, and that is the one difference from
 * {@link decisionsInForce}. This answer is half of ONE list — decisions and skills
 * interleaved by when each last moved (see {@link bootstrap}) — so an order imposed
 * here would be an order the composition immediately discards, and a reader of this
 * function could take it for the answer's.
 *
 * The states come from {@link DECISION_DISPOSITION} and each is fetched by
 * `listDecisionsByState`, the INDEXED read. Listing every decision and filtering in
 * memory would read the whole table to throw almost all of it away, and the cost of
 * that grows with the record while this one grows with the answer.
 */
export function decisionsAwaitingJudgement(
  caches: readonly ProjectionCache[],
): DecisionAwaitingJudgement[] {
  const pending: DecisionAwaitingJudgement[] = [];
  for (const cache of caches) {
    for (const state of AWAITING_JUDGEMENT) {
      for (const decision of cache.listDecisionsByState(state)) {
        pending.push({
          kind: 'decision',
          id: decision.id,
          adr: decision.adr,
          title: decision.title,
          state,
          updatedAt: decision.updatedAt,
        });
      }
    }
  }
  return pending;
}

function toRef(decision: DecisionProjection): DecisionRef {
  return { id: decision.id, adr: decision.adr, title: decision.title };
}

/** Most recently settled first; ties keep a stable (id) order. */
function bySettledDesc(a: DecisionProjection, b: DecisionProjection): number {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
