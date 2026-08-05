/**
 * The decision projection: fold an ordered event stream into current decision
 * state, and surface any collision of the citable `ADR-<n>` label.
 *
 * Like every projection this is a pure, deterministic replay — no validation,
 * no re-judging; it replays facts the gate already judged at write time. The
 * rule mirrors tasks:
 *   - a decision EXISTS once its `decision.recorded` is seen;
 *   - its STATE is the `to` of its last `decision.transitioned` (birth included);
 *   - its title, rationale, `alternatives` and `adr` label are read literally
 *     from the record.
 *
 * `alternatives` is projected only when the record carries one. A decision that
 * recorded none has NO key for it — not an empty string — so "did this decision
 * say what it turned down?" is answerable from the projection by the field's own
 * absence, which is the whole reason it is a named field rather than a convention
 * inside the rationale.
 *
 * A supersede is the one multi-entity fact: its subject is the SUPERSEDED
 * decision, and its `by` names the SUCCESSOR. The fold updates BOTH sides — the
 * subject records `supersededBy` (and moves to `superseded`), and the successor
 * records `supersedes` (the id it replaced) — so a query from either direction
 * is answerable without walking the stream again.
 *
 * A dangling `supersededBy` is possible only in a PARTIAL clone. A supersede's
 * successor must exist at write time (the operation refuses a dangling `by`), so
 * a complete chain always resolves both sides. But a clone that carries the
 * subject's tail and not the successor's projects a `supersededBy` pointing at a
 * decision not present — honest (the shared chain still holds it; a partial
 * checkout is a chosen local window, not a loss) but unsignalled. A consumer
 * that must resolve the link should verify it against the full chain rather than
 * trust a partial view.
 *
 * THE ADR LABEL IS NOT IDENTITY. The id is identity; `adr` is a citation label
 * frozen into the record at write time. Two clones working offline can mint the
 * same `ADR-7` for different decisions — the ids stay unique and the chain
 * converges, but the label now points at two decisions. That is a label
 * collision, not corruption and not a fatal constraint: {@link adrCollisions}
 * detects and reports it so a human can reconcile the label, exactly as the
 * chain's verifier reports (rather than fails on) a census anomaly.
 *
 * ONE CHAIN IS THE UNIT the number is minted in — not one in which it is unique,
 * which is the whole reason this file has a detector — and everything that reports a
 * collision has to be given exactly that. The number is minted from the writer's
 * view of ONE chain (`recordDecision`: `ADR-${decisions.size + 1}` over that
 * tree's projection), so two chains numbering their own first decision `ADR-1` is
 * how the product works rather than a defect in it — a project's public tree and
 * its private tree each hold an `ADR-1` the moment both have one decision, which
 * is why the document that carries the label is committed-only. Handing a fold of
 * SEVERAL chains to {@link adrCollisions} would report that arrangement as a
 * clash, and a report that fires on every project with a private rule is not a
 * report. What is genuinely broken is two decisions of ONE chain under one label:
 * the chain promises the number is sequential in it, and two tails minting
 * offline are how that promise breaks.
 */

import type { CatalogEvent } from '@mnema/chain';

/** Current projected state of one decision. */
export interface DecisionProjection {
  /** The decision's id (the event subject). */
  readonly id: string;
  /** The citable `ADR-<n>` label, frozen at write time. NOT identity. */
  readonly adr: string;
  readonly title: string;
  /** The why — the whole value of the record. */
  readonly rationale: string;
  /**
   * What was considered and turned down, and why not. ABSENT when the decision
   * recorded none — the absence is the fact, so it is never an empty string.
   */
  readonly alternatives?: string;
  /** The `to` of the last transition. */
  readonly state: string;
  /** The successor's id, when this decision was superseded. */
  readonly supersededBy?: string;
  /** The id this decision superseded, when it is a successor. */
  readonly supersedes?: string;
  /** `at` of the record (decision.recorded). */
  readonly createdAt: string;
  /** `at` of the last transition. */
  readonly updatedAt: string;
}

/** A collision of the `adr` label: one label held by two or more decisions. */
export interface AdrCollision {
  /** The colliding label, e.g. `ADR-7`. */
  readonly adr: string;
  /** The ids that all carry it, sorted for a stable report. */
  readonly ids: readonly string[];
}

/** Mutable accumulator; existence and state are tracked separately, then joined. */
interface DecisionAccumulator {
  adr?: string;
  title?: string;
  rationale?: string;
  alternatives?: string;
  state?: string;
  supersededBy?: string;
  supersedes?: string;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Folds ordered events into a map of decision id → projection. A decision is
 * projected only when it has BOTH a `decision.recorded` (existence) and at
 * least one transition (state) — birth emits the two together, so an intact
 * chain always has both; the guard matters only for a truncated tail.
 *
 * A supersede updates two accumulators: the subject's `supersededBy` and the
 * successor's `supersedes`. The successor's own record/transitions still decide
 * whether IT is projected — a supersede that names a `by` with no
 * `decision.recorded` links nothing (a dangling `by` is refused at write time;
 * a truncated tail is the only way it arrives, and the missing successor is
 * simply not projected).
 */
export function projectDecisions(events: readonly CatalogEvent[]): Map<string, DecisionProjection> {
  const acc = new Map<string, DecisionAccumulator>();

  for (const event of events) {
    if (event.kind === 'decision.recorded') {
      const entry = getOrInit(acc, event.subject);
      entry.adr = event.payload.adr;
      entry.title = event.payload.title;
      entry.rationale = event.payload.rationale;
      // Only when the record has one: assigning `undefined` would be the same
      // value, but reading it conditionally keeps the fold's shape the same as the
      // projection it builds — absent stays absent all the way through.
      if (event.payload.alternatives !== undefined) {
        entry.alternatives = event.payload.alternatives;
      }
      entry.createdAt = event.at;
    } else if (event.kind === 'decision.transitioned') {
      const entry = getOrInit(acc, event.subject);
      entry.state = event.payload.to;
      entry.updatedAt = event.at;
      if (event.payload.by !== undefined) {
        // Multi-entity: the subject is superseded BY the successor, and the
        // successor SUPERSEDES the subject. Record the link on both sides.
        entry.supersededBy = event.payload.by;
        getOrInit(acc, event.payload.by).supersedes = event.subject;
      }
    }
  }

  const result = new Map<string, DecisionProjection>();
  for (const [id, entry] of acc) {
    // Existence needs the record; state needs a transition. A subject missing
    // either is not a complete decision and is not projected — never given a
    // fabricated state. (An accumulator that only holds `supersedes`, set by a
    // supersede naming it, has no record of its own and is correctly dropped.)
    if (
      entry.adr === undefined ||
      entry.title === undefined ||
      entry.rationale === undefined ||
      entry.state === undefined ||
      entry.createdAt === undefined ||
      entry.updatedAt === undefined
    ) {
      continue;
    }
    const projection: Mutable<DecisionProjection> = {
      id,
      adr: entry.adr,
      title: entry.title,
      rationale: entry.rationale,
      state: entry.state,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    };
    if (entry.alternatives !== undefined) projection.alternatives = entry.alternatives;
    if (entry.supersededBy !== undefined) projection.supersededBy = entry.supersededBy;
    if (entry.supersedes !== undefined) projection.supersedes = entry.supersedes;
    result.set(id, projection);
  }
  return result;
}

/**
 * Reports every `adr` label carried by more than one decision. The label is a
 * citation aid, not identity, so a collision is a signal to reconcile — never
 * an error that fails a read. Returns an empty array when every label is
 * unique. Only projected decisions are considered (a dropped, incomplete one
 * has no label to collide).
 *
 * FEED IT ONE CHAIN'S DECISIONS. It groups by label and says nothing about where
 * the decisions came from, so the caller decides what the labels are compared
 * within — and the only unit in which the number claims to be unique is one chain
 * (see the module comment). Both readers of this pass exactly that:
 * {@link ProjectionCache.adrCollisions} is a cache over one chain, and the audit
 * folds each chain of a record on its own.
 *
 * THIS DOES NOT RENUMBER, and it is the only answer there is. Both labels were
 * frozen into signed events on two machines that could not see each other, so
 * there is no write that could have prevented them and no edit that could undo
 * one — the record treats changing one's mind as a new decision, never as a
 * rewrite of an old one. Detecting and declaring is the whole of the response.
 */
export function adrCollisions(decisions: Iterable<DecisionProjection>): AdrCollision[] {
  const byLabel = new Map<string, string[]>();
  for (const d of decisions) {
    const ids = byLabel.get(d.adr);
    if (ids === undefined) byLabel.set(d.adr, [d.id]);
    else ids.push(d.id);
  }
  const collisions: AdrCollision[] = [];
  for (const [adr, ids] of byLabel) {
    if (ids.length > 1) collisions.push({ adr, ids: [...ids].sort() });
  }
  // Stable order: by label, so a report reads the same on every rebuild.
  collisions.sort((a, b) => (a.adr < b.adr ? -1 : a.adr > b.adr ? 1 : 0));
  return collisions;
}

/** Local helper: build the readonly projection through a mutable shape. */
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

function getOrInit(acc: Map<string, DecisionAccumulator>, id: string): DecisionAccumulator {
  let entry = acc.get(id);
  if (entry === undefined) {
    entry = {};
    acc.set(id, entry);
  }
  return entry;
}
