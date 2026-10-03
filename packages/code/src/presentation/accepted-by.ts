/**
 * How a rule says WHO ACCEPTED IT — written once, for every place that tells a rule.
 *
 * The opening document, the rules a push hands over at an edit and the answer to `governing_rules`
 * all carry the same reading of the same fact (`Acceptance`, `@mnema/context`), and the words for
 * it live here so they cannot come to differ: `accepted by mnid:ab12cd34 (a person)`, or
 * `(agent claude-code)`, and `; unconfirmed` where the record has somebody who could have
 * confirmed it and nobody did. Every value goes through {@link oneLine}: the identity and the agent
 * name are the record's, and a break in either would start a line that reads as a rule.
 */

import type { Acceptance } from '@mnema/context';
import { A_PERSON, oneLine } from '../one-line.js';

/** `accepted by mnid:ab12cd34 (a person)`, `(agent claude-code; unconfirmed)`. */
export function acceptedBy(acceptance: Acceptance): string {
  const act = acceptance.agent === undefined ? A_PERSON : `agent ${oneLine(acceptance.agent)}`;
  const mark = acceptance.unconfirmed ? '; unconfirmed' : '';
  return `accepted by ${oneLine(acceptance.by)} (${act}${mark})`;
}
