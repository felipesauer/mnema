/**
 * Every move of a merged order, judged (FORMAT.md §6.7): which ones a reader does not apply.
 *
 * ONE PASS, FOR EVERY READER THAT HAS THE WHOLE ORDER. `verify` names what this returns in its
 * census; the projection's replay drops it from the stream it folds; the reading of one
 * subject's events drops it from what a gate folds. The rule itself is `judgeMove`
 * (`events/workflow.ts`); what is here is the standing a move is judged against, and nothing
 * else.
 *
 * THE STANDING. The state a subject is in at a move is the fold, in the merged order, of the
 * moves before it that were legal — so an illegal move is not applied by anything after it
 * either. When that state does not admit the move, the move is asked about the state its
 * writer saw: the same fold over only the moves its writer had read, which are the ones its
 * own tail holds before it and, on every other tail, the ones up to the last entry its tail
 * cites at or before it. The citations are the merge's own (`causalOrder`'s `held`), so a
 * citation of a hash the record does not hold reads as nothing seen, as it is nothing ordered.
 * When that sight holds nothing of the subject, the move is held to a state the subject had
 * been in before it: the moves applied so far, which this pass keeps anyway.
 *
 * THE COST is one step per event and one per move, plus a walk back over one subject's moves
 * for each move the merged state does not admit — a divergence, or an illegal move, both rare.
 */

import type { CatalogEvent } from '../events/catalog.js';
import {
  type IllegalMove,
  isMove,
  judgeMove,
  RUN_OPEN,
  stateAfter,
  type WORKFLOWS,
} from '../events/workflow.js';
import type { CitationHeld } from './causal-order.js';

/** An event of a merged order, and where it was read: its tail's index and its position there. */
export interface PlacedEvent {
  readonly event: CatalogEvent;
  readonly tail: number;
  readonly position: number;
}

/** A move that was applied, and where it is. */
interface Applied {
  readonly tail: number;
  readonly position: number;
  readonly to: string;
}

/**
 * The moves of `order` a reader does not apply, by their index in `order`, each with its rule.
 *
 * `order` is one tree's merged order (a citation resolves inside its own tree), and `held` the
 * citations that merge honoured, by the same tail indexes. `born` says whether the record holds
 * the birth of the decision a supersede names; left out, the births are the ones `order` holds,
 * which is the answer when `order` is the whole record. A reader of a few subjects hands its own.
 */
export function illegalMoves(
  order: readonly PlacedEvent[],
  held: readonly CitationHeld[],
  born?: (id: string) => boolean,
): Map<number, IllegalMove> {
  const saw = sightOf(held);
  const births = new Set<string>();
  if (born === undefined) {
    for (const { event } of order) {
      if (event.kind === 'decision.transitioned' && event.payload.from === null) {
        births.add(event.subject);
      }
    }
  }
  const isBorn = born ?? ((id: string) => births.has(id));
  const subjects = new Map<string, Applied[]>();
  const illegal = new Map<number, IllegalMove>();
  order.forEach((placed, index) => {
    const { event } = placed;
    if (event.kind === 'run.started') {
      const key = subjectKey('run', event.subject);
      if (!subjects.has(key)) subjects.set(key, [{ ...site(placed), to: RUN_OPEN }]);
      return;
    }
    if (!isMove(event)) return;
    const key = subjectKey(event.kind === 'run.ended' ? 'run' : event.kind, event.subject);
    const applied = subjects.get(key) ?? [];
    const ruling = judgeMove(event, {
      now: applied.at(-1)?.to,
      seen: () => {
        for (let at = applied.length - 1; at >= 0; at -= 1) {
          const move = applied[at] as Applied;
          if (saw(placed, move)) return move.to;
        }
        return undefined;
      },
      held: (state) => applied.some((move) => move.to === state),
      born: isBorn,
    });
    if (ruling !== undefined) {
      illegal.set(index, ruling);
      return;
    }
    applied.push({ ...site(placed), to: stateAfter(event) });
    subjects.set(key, applied);
  });
  return illegal;
}

/** Whether the workflow `kind` names is one of the format's, for the key of a subject. */
function subjectKey(family: keyof typeof WORKFLOWS | 'run', subject: string): string {
  return `${family}\u0000${subject}`;
}

function site(placed: PlacedEvent): { tail: number; position: number } {
  return { tail: placed.tail, position: placed.position };
}

/**
 * Whether the writer of `later` had read `earlier`: on one tail, whether `earlier` comes first;
 * across tails, whether `later`'s tail cites, at or before it, an entry of `earlier`'s tail at
 * or after it.
 */
export function sightOf(
  held: readonly CitationHeld[],
): (
  later: { tail: number; position: number },
  earlier: { tail: number; position: number },
) => boolean {
  const byTail = new Map<number, CitationHeld[]>();
  for (const citation of held) {
    const list = byTail.get(citation.tail) ?? [];
    list.push(citation);
    byTail.set(citation.tail, list);
  }
  return (later, earlier) => {
    if (later.tail === earlier.tail) return earlier.position < later.position;
    for (const citation of byTail.get(later.tail) ?? []) {
      if (citation.position > later.position) continue;
      if (citation.citedTail === earlier.tail && citation.citedPosition >= earlier.position) {
        return true;
      }
    }
    return false;
  };
}
