/**
 * What `mnema decision review` shows: the decision a person is about to rule on, and the count
 * the session ends with.
 *
 * Each field is one line of the renderer's (`fact`), so the width rule is the CLI's: a long
 * reason is folded between words at the terminal's width and never cut. The text of a field
 * goes through the rule of the line, so a reason with a newline in it is one line here.
 */

import { oneLine } from '../one-line.js';
import { fact, subjectLine } from './detail.js';
import type { Line } from './line.js';

/** A decision as the review shows it. */
export interface Shown {
  readonly adr: string;
  readonly id: string;
  readonly title: string;
  readonly rationale: string;
  readonly alternatives?: string;
}

/** The lines for the decision at `position` of `total`, in the order a person reads them. */
export function proposalLines(shown: Shown, position: number, total: number): Line[] {
  return [
    subjectLine(`${shown.adr} (${shown.id})`, `${position} of ${total}`),
    fact(`Title: ${oneLine(shown.title)}`),
    fact(`Why: ${oneLine(shown.rationale)}`),
    ...(shown.alternatives !== undefined
      ? [fact(`Turned down: ${oneLine(shown.alternatives)}`)]
      : []),
  ];
}

/** The line a review ends with: what was ruled, and what was left. */
export function reviewedSummary(counts: {
  readonly accepted: number;
  readonly rejected: number;
  readonly skipped: number;
}): string {
  return `Reviewed: ${counts.accepted} accepted, ${counts.rejected} rejected, ${counts.skipped} skipped.`;
}
