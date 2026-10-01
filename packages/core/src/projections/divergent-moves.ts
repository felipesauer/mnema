/**
 * Two moves of one subject out of one state: the shape two machines leave when each moved a
 * decision (or a skill) the other had not seen move yet.
 *
 * WHY IT HAS TO BE SAID. A projection keeps the last `to` and never reads `from`
 * (`projections/decision.ts`), so a decision accepted on one machine and rejected on another,
 * both from `proposed`, reads as whichever move the merged order puts last — and nothing says
 * there were two. On ONE machine the second of two such moves is refused now (`STATE_MOVED`,
 * `workflow/as-the-record-stands.ts`); between machines nothing coordinates, both moves are
 * signed facts, and the only honest response is the one the `ADR-<n>` collision already gets:
 * detect it and say it, never re-judge or drop either move. `verify` is not asked: both
 * entries are well formed and signed, and its verdict does not change.
 *
 * WHY "THE SAME `from` TWICE" IS ENOUGH, AND WHERE IT IS NOT. In a machine with no cycle a
 * subject leaves each state at most once, so two transitions carrying one `from` can only be
 * two moves that did not see each other — whatever order the merge puts them in, and with no
 * clock compared. The decision and skill machines have no cycle, and the case that enumerates
 * their tables says so (`divergent-moves.test.ts`). The task machine HAS one (a reopened task
 * leaves `IN_PROGRESS` again), so this rule would accuse every honest reopen there; tasks are
 * not read here, and a task moved twice out of one state between machines stays silent.
 */

import type { CatalogEvent } from '@mnema/chain';

/** The machines this reading covers: the two whose tables have no cycle. */
export type DivergentKind = 'decision' | 'skill';

/** One subject that left one state more than once. */
export interface DivergentMove {
  readonly kind: DivergentKind;
  /** The decision or skill id (the events' subject). */
  readonly entityId: string;
  /** The state it left more than once. */
  readonly from: string;
  /** Every transition out of `from`, in stream order — the evidence. */
  readonly evidence: readonly CatalogEvent[];
}

/**
 * Every decision and skill with more than one transition out of the same state, ordered by
 * kind, then id, then state — total, so a record always reports the same way. The birth
 * (`from: null`) is not a move out of a state and is never counted. Empty when there is none.
 */
export function divergentMoves(events: Iterable<CatalogEvent>): DivergentMove[] {
  const out = new Map<
    string,
    { kind: DivergentKind; id: string; from: string; ev: CatalogEvent[] }
  >();
  for (const event of events) {
    const kind: DivergentKind | undefined =
      event.kind === 'decision.transitioned'
        ? 'decision'
        : event.kind === 'skill.transitioned'
          ? 'skill'
          : undefined;
    if (kind === undefined) continue;
    const from = (event.payload as { readonly from: string | null }).from;
    if (from === null) continue;
    const key = `${kind}\u0000${event.subject}\u0000${from}`;
    const seen = out.get(key);
    if (seen === undefined) out.set(key, { kind, id: event.subject, from, ev: [event] });
    else seen.ev.push(event);
  }
  return [...out.values()]
    .filter((m) => m.ev.length > 1)
    .map((m) => ({ kind: m.kind, entityId: m.id, from: m.from, evidence: m.ev }))
    .sort(
      (a, b) => order(a.kind, b.kind) || order(a.entityId, b.entityId) || order(a.from, b.from),
    );
}

function order(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
