/**
 * Which writing of a decision is its text (FORMAT.md section 6.8), over a merged order.
 *
 * ONE PASS, FOR EVERY READER THAT HAS THE ORDER. The projection's replay leaves out of the stream
 * it folds every writing that comes before the text; the reading of one subject's events does the
 * same for a gate; `verify` names every writing that is not the text in its census. They ask this,
 * so they cannot disagree about which writing a decision is.
 *
 * THE RULE. A judgment (an accept, a rejection, a supersede: every move out of a state the
 * decision was born in or reached) is made on the text its writer was shown, so the text is bound
 * there: it is the FIRST writing in the merged order among those the writer of the decision's
 * first applied judgment had read, by the sight section 6.7 judges a move with (its own tail
 * before it, and on every other tail up to the last entry its tail cites at or before it). That
 * sight is the writer's signed word, so a writing dated back on a tail the judgment never cited is
 * not what was judged, whatever its clock says. Before any judgment, and for a judgment that saw
 * no writing (a record written before citations), it is the first writing in the merged order.
 *
 * A writing after the first judgment is never the text: the judgment cannot have read it, since
 * the order takes nothing before what it cites.
 */

import type { CitationHeld } from './causal-order.js';
import { type PlacedEvent, sightOf } from './moves.js';

/**
 * By decision id, the index in `order` of the `decision.recorded` that is the decision's text.
 *
 * `order` is one tree's merged order, `held` the citations it honoured, and `notApplied` the
 * moves it does not apply ({@link illegalMoves}, by their index in `order`): a move the workflow
 * refuses judges nothing, so it binds no text.
 */
export function decisionTexts(
  order: readonly PlacedEvent[],
  held: readonly CitationHeld[],
  notApplied: ReadonlyMap<number, unknown>,
): Map<string, number> {
  const saw = sightOf(held);
  const writings = new Map<string, number[]>();
  const text = new Map<string, number>();
  const judged = new Set<string>();
  order.forEach((placed, index) => {
    const { event } = placed;
    if (event.kind === 'decision.recorded') {
      const seen = writings.get(event.subject);
      if (seen === undefined) {
        writings.set(event.subject, [index]);
        text.set(event.subject, index);
      } else {
        seen.push(index);
      }
      return;
    }
    if (event.kind !== 'decision.transitioned' || event.payload.from === null) return;
    if (judged.has(event.subject) || notApplied.has(index)) return;
    judged.add(event.subject);
    const shown = (writings.get(event.subject) ?? []).find((at) =>
      saw(placed, order[at] as PlacedEvent),
    );
    if (shown !== undefined) text.set(event.subject, shown);
  });
  return text;
}

/**
 * Whether the event at `index` of an order is a writing of a decision that comes before that
 * decision's text: what a fold must not be handed, since it takes the first writing it meets.
 * Every later writing stays in what a fold is handed and is not applied by it, so a cache brought
 * forward over arrivals and a replay of the whole order fold the same events.
 */
export function precedesItsText(
  placed: PlacedEvent,
  index: number,
  texts: ReadonlyMap<string, number>,
): boolean {
  const { event } = placed;
  return event.kind === 'decision.recorded' && index < (texts.get(event.subject) ?? index);
}
