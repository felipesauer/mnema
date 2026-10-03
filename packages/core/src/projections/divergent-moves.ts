/**
 * Two moves of one subject out of one state: the shape two machines leave when each moved a
 * decision, a skill or a task the other had not seen move yet.
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
 * leaves `IN_PROGRESS` again), so this rule would accuse every honest reopen there.
 *
 * TASKS ARE READ BY ANOTHER RULE, AND IT LEANS ON THE ORDER. This said "tasks are not read
 * here, and a task moved twice out of one state between machines stays silent", and that
 * silence was the defect this reading exists for, left standing for one machine of three. A
 * task's moves are read in the record's order instead, and a move whose `from` is not the
 * state the record had the task in at that point — a move judged on a state another machine
 * had already moved it out of — is the divergence; the evidence is the move that left that
 * state before it, and this one. An honest reopen is not one: its `from` is where the task
 * stood. What this rule takes on is the merged order across tails, which is by each event's
 * own `at` (`order.ts`): a machine whose clock ran behind, moving a task right after pulling
 * another machine's move of it, can sort its move first and be said to have diverged when it
 * did not. Decisions and skills keep the rule that compares no clock.
 */

import type { CatalogEvent } from '@mnema/chain';

/** The machines this reading covers: the two whose tables have no cycle, and tasks by their order. */
export type DivergentKind = 'decision' | 'skill' | 'task';

/** One subject that left one state more than once. */
export interface DivergentMove {
  readonly kind: DivergentKind;
  /** The decision, skill or task id (the events' subject). */
  readonly entityId: string;
  /** The state it left more than once. */
  readonly from: string;
  /**
   * Every transition out of `from`, in stream order — the evidence. For a task, the move that
   * left `from` and the move or moves that were judged on it afterwards.
   */
  readonly evidence: readonly CatalogEvent[];
  /**
   * The state each move of {@link evidence} went to, in the same order — what a reader is told,
   * read here once so no surface has to take a transition apart to say it.
   */
  readonly to: readonly string[];
}

/**
 * Every decision and skill with more than one transition out of the same state, and every task
 * with a move out of a state the record no longer had it in, ordered by kind, then id, then
 * state — total, so a record always reports the same way. The birth (`from: null`) is not a
 * move out of a state and is never counted. Empty when there is none.
 *
 * `events` must be in the record's order (`orderedEvents`) for the task rule to mean anything.
 */
export function divergentMoves(events: Iterable<CatalogEvent>): DivergentMove[] {
  const out = new Map<
    string,
    { kind: DivergentKind; id: string; from: string; ev: CatalogEvent[] }
  >();
  const tasks = new TaskMoves();
  // A move repeated byte for byte is ONE move read twice — what a tail whose last entry was
  // duplicated holds, and what the link-break notice already reports as a record that does not
  // chain — never two moves that did not see each other. Two machines' moves differ at least
  // in who signed them.
  const read = new Set<string>();
  for (const event of events) {
    if (event.kind.endsWith('.transitioned')) {
      const bytes = JSON.stringify(event);
      if (read.has(bytes)) continue;
      read.add(bytes);
    }
    if (event.kind === 'task.transitioned') {
      tasks.read(event);
      continue;
    }
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
  return sortDivergent([
    ...[...out.values()]
      .filter((m) => m.ev.length > 1)
      .map((m) => ({
        kind: m.kind,
        entityId: m.id,
        from: m.from,
        evidence: m.ev,
        to: m.ev.map(movedTo),
      })),
    ...tasks.divergent().map((m) => ({ ...m, to: m.evidence.map(movedTo) })),
  ]);
}

/**
 * Puts divergent moves in the order they are reported in: by kind, then entity, then the state
 * they left. It is a property of the CONTENT, which is what lets a cache that keeps the moves one
 * entity at a time hand them back in the order the whole-record reading gives — and it is ONE
 * function, so the two cannot come to order them differently.
 */
export function sortDivergent(moves: DivergentMove[]): DivergentMove[] {
  return moves.sort(compareDivergent);
}

function compareDivergent(a: DivergentMove, b: DivergentMove): number {
  return order(a.kind, b.kind) || order(a.entityId, b.entityId) || order(a.from, b.from);
}

/**
 * The task rule: a task's state as the record has it so far, the move that last left each
 * state, and every move judged on a state the task was no longer in — grouped by the move it
 * came after, so two stale moves out of one state the record had already left once are one
 * report with three moves in it.
 */
class TaskMoves {
  private readonly state = new Map<string, string>();
  private readonly leftBy = new Map<string, CatalogEvent>();
  private readonly found = new Map<
    CatalogEvent,
    Omit<DivergentMove, 'to'> & { evidence: CatalogEvent[] }
  >();

  read(event: CatalogEvent): void {
    if (event.kind !== 'task.transitioned') return;
    const { from, to } = event.payload;
    const id = event.subject;
    const now = this.state.get(id);
    if (from !== null && now !== undefined && from !== now) {
      const before = this.leftBy.get(`${id}\u0000${from}`);
      if (before !== undefined) {
        const seen = this.found.get(before);
        if (seen === undefined) {
          this.found.set(before, { kind: 'task', entityId: id, from, evidence: [before, event] });
        } else {
          seen.evidence.push(event);
        }
      }
    }
    if (from !== null && from === now) this.leftBy.set(`${id}\u0000${from}`, event);
    this.state.set(id, to);
  }

  divergent(): Omit<DivergentMove, 'to'>[] {
    return [...this.found.values()];
  }
}

function order(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The state a transition went to — its `to`. The evidence holds only transitions. */
function movedTo(event: CatalogEvent): string {
  return event.kind === 'decision.transitioned' ||
    event.kind === 'skill.transitioned' ||
    event.kind === 'task.transitioned'
    ? event.payload.to
    : event.kind;
}
