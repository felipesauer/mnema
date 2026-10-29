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

/**
 * The most characters of a replaced decision's title a LINE THAT IS FITTED to a ceiling names.
 * The title is a field of 64 KB somebody typed, and a line that grew with it would stop fitting
 * and drop out of the text whole, so the rule in force would vanish for the length of a title of
 * another decision. A longer title is cut here and ends in an ellipsis; `show` and `read_record`
 * carry it whole.
 */
export const NAMED_TITLE_LIMIT = 120;

function cutTitle(title: string, limit: number): string {
  const chars = Array.from(title);
  return chars.length <= limit ? title : `${chars.slice(0, limit).join('')}…`;
}

/**
 * `ADR-16: <title> (superseded)`, or `<id> (not in the trees read)`. `titleLimit` caps the title,
 * in characters, for a line that has to fit a ceiling.
 */
export function namedDecisionText(named: NamedDecision, titleLimit?: number): string {
  if (!named.found) return `${oneLine(named.id)} (not in the trees read)`;
  // The state is parenthesized in the ONE place that composes a state into a part, `asState`.
  const state = asState(
    named.divergence === true ? 'not in force, divergence' : oneLine(named.state),
  ).text;
  return `${oneLine(named.adr)}: ${titleLimit === undefined ? oneLine(named.title) : cutTitle(oneLine(named.title), titleLimit)} ${state}`;
}
