/**
 * WHAT JUST HAPPENED TO THE RECORD, as one line: when, what happened, which record
 * it happened to, and who did it.
 *
 * It is the counterpart of `timeline`'s line and it is deliberately the same shape —
 * an instant, a kind, the record, the actor — because they answer the same question
 * about the same facts and differ only in WHEN they are asked. One is a history a
 * reader asks for; this is the same history arriving while they watch. Two shapes for
 * that would be two ideas of what an event reads like, and this surface has spent five
 * deliveries collapsing exactly that kind of pair.
 *
 * WHO DID IT IS THE AGENT, and that is the whole reason this line exists. The console
 * refuses every verb that writes (`repl/gate.ts`), so nothing a caller types can produce
 * an occurrence: every line this composes is somebody ELSE's append, and in the ordinary
 * case that somebody is an agent working through the other surface. An event with no
 * agent reads as a person — the same word the served pattern and the provenance report
 * use for the same absence, because an absent `which` is a fact (someone acted directly)
 * rather than a gap in the record.
 *
 * ONE LINE PER OCCURRENCE, and here the rule is sharper than in a list. Elsewhere a
 * broken field forges an extra row under a header that says how many there are; here
 * there is no header and no list — a second line would be an occurrence that never
 * happened, landing in the caller's scrollback while they watch, indistinguishable from
 * one that did. So every field of the line is collapsed, including the ones a parser
 * ought to make impossible: what makes a kind or an instant well-formed is a validator
 * somewhere else, and this rule does not depend on one holding
 * (`tests/what-the-agent-just-did.test.ts`).
 */

import { type CatalogEvent, proofFields, transitionProse } from '@mnema/chain';
import { A_PERSON, oneLine } from '../one-line.js';
import { fact } from './detail.js';
import { asId, asWhen, itemLine } from './items.js';
import type { Line } from './line.js';

/** How the actor is named on the line — what precedes the agent, or the person. */
const BY = 'by';

/** One occurrence, as the line a reader sees it arrive on. */
export function occurrenceLine(event: CatalogEvent): Line {
  return itemLine([
    asWhen(oneLine(event.at)),
    oneLine(event.kind),
    asId(oneLine(event.subject)),
    `${BY} ${oneLine(event.which ?? A_PERSON)}`,
  ]);
}

/**
 * ONE EVENT OF A HISTORY, as `mnema timeline` prints it: when, what kind, the role by
 * which the queried entity appears in it, and who authorized it.
 *
 * It moved here from the verb's own wiring, and the reason is the rule this layer
 * exists for. The wiring may not collapse a value on its own — the two files that still
 * do are named as exceptions with an open question over each — and a history line has
 * to collapse, for the same reason {@link occurrenceLine} does: a list where every line
 * is one event lets a value holding a newline forge an event that never happened. The
 * doc above already argued the two lines are one idea; now they are one module.
 *
 * The `who` is written through its anchor by the caller, because how short an identity
 * may be spelled depends on every identity the RECORD knows, which is not this line's
 * question.
 */
export function historyLine(
  entry: { readonly at: string; readonly kind: string; readonly role: string },
  who: string,
): Line {
  return itemLine([
    asWhen(oneLine(entry.at)),
    oneLine(entry.kind),
    `[${oneLine(entry.role)}]`,
    who,
  ]);
}

/**
 * WHAT THAT MOVE SAID, as the annotation indented under its own event line — absent
 * when the event carried no proof, and when it is not a move at all.
 *
 * The words are in the signed chain and, measured before this existed, they came out of
 * `mnema timeline --json` and out of nothing else. The whole point of a history is the
 * words beside each step, and a list that shows only the shape of a step sends its
 * reader to a flag.
 *
 * IT IS COLLAPSED, and `show` serves the same value WHOLE. That is not two rules: there
 * the proof is a body under one record, with no list around it for a second line to
 * imitate; here it is an annotation inside a list whose every line is an event, so a
 * `note` holding a newline could otherwise write a second, well-formed history entry
 * about something that never happened.
 */
export function saidLine(event: CatalogEvent): Line | undefined {
  const said = transitionProse(proofFields(event));
  return said === '' ? undefined : fact(oneLine(said));
}
