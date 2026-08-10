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

import type { CatalogEvent } from '@mnema/chain';
import { A_PERSON, oneLine } from '../served-patterns.js';
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
