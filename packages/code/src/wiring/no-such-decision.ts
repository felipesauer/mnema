/**
 * The wording of the two refusals the verbs that take a decision answer with: a word that names no
 * decision here, and a label that more than one decision carries.
 *
 * A label is numbered inside one tree, so two trees can each hold an `ADR-1`; the second refusal
 * lists the ids that carry it and picks none. It is handed to the shared refusal as its `said`
 * table, so the sentence is worded here once and looks like every other no on the surface.
 */

import { oneLine } from '../one-line.js';
import { noSuchRecord } from './no-such-record.js';

/** The refusals of a decision that was asked for by name. */
export type NameRefused =
  | { readonly reason: 'NO_SUCH_DECISION'; readonly typed: string }
  | {
      readonly reason: 'AMBIGUOUS_LABEL';
      readonly typed: string;
      readonly ids: readonly string[];
    };

/** The sentence for the refusal, keyed by its reason as the shared funnel reads it. */
export function nameRefusals(refusal: NameRefused): Record<string, string> {
  return refusal.reason === 'NO_SUCH_DECISION'
    ? { NO_SUCH_DECISION: noSuchRecord('decision', refusal.typed) }
    : {
        AMBIGUOUS_LABEL:
          `${oneLine(refusal.typed)} is carried by ${refusal.ids.length} decisions here ` +
          `(${refusal.ids.map((id) => oneLine(id)).join(', ')}). Use the id of the one you mean.`,
      };
}
