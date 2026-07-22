/**
 * The decision projection: fold an ordered event stream into current decision
 * state, and surface any collision of the citable `ADR-<n>` label.
 *
 * Like every projection this is a pure, deterministic replay — no validation,
 * no re-judging; it replays facts the gate already judged at write time. The
 * rule mirrors tasks:
 *   - a decision EXISTS once its `decision.recorded` is seen;
 *   - its STATE is the `to` of its last `decision.transitioned` (birth included);
 *   - its title, rationale, and `adr` label are read literally from the record.
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
