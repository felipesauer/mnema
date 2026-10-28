/**
 * How a decision named by another decision's link is worded: the label, the title and the state
 * it is in now, or the plain statement that the trees read do not hold it.
 *
 * ONE wording for the two surfaces that print it, `show` (a fact line under the decision) and
 * the document a session opens with (one more field of the rule's line), so a replaced
 * decision cannot be called two things by two doors. Every value goes through {@link oneLine}
 * HERE: the title is text somebody typed, and a title that broke the line it rides on would add
 * a rule, or a fact, the project never made, to a file a model obeys.
 */

import type { NamedDecision } from '@mnema/context';
import { oneLine } from '../one-line.js';
import { asState } from './state.js';

/** `ADR-16: <title> (superseded)`, or `<id> (not in the trees read)`. */
export function namedDecisionText(named: NamedDecision): string {
  if (!named.found) return `${oneLine(named.id)} (not in the trees read)`;
  // The state is parenthesized in the ONE place that composes a state into a part, `asState`.
  const state = asState(oneLine(named.state)).text;
  return `${oneLine(named.adr)}: ${oneLine(named.title)} ${state}`;
}
