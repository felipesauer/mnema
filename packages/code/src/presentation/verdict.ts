/**
 * FORM C — a verdict: an assertion, and the evidence for it.
 *
 * Three of the CLI's readings are this form. `guard` answers ALLOWED or REFUSED
 * and says what would have happened; `verify` states what it could and could not
 * prove; `antipatterns` states a count per shape it found. None of them lists
 * items and none of them describes one entity — the answer IS the assertion, and
 * whatever follows is there to support it.
 *
 * The label carries the weight, so it comes first and it is separated by a colon:
 * a reader scanning a CI log for a refusal looks at the first word of the line, and
 * a verdict that buried it mid-sentence would make them read the sentence. That is
 * also why the refusal's code travels INSIDE the label (`REFUSED (MISSING_PROOF)`)
 * rather than in the detail — the code is part of what the verdict IS.
 *
 * Nothing here judges. `antipatterns` states "reopened tasks: 3" and stops: three
 * reopenings may be a team learning something or a task nobody understood, and the
 * reader has the context to tell, which is precisely why this surface exists. A
 * primitive that wrote "warning" would decide that for them.
 *
 * The EVIDENCE line is `fact` from form B, not a function of its own: an issue
 * indented under a verdict and a fact indented under a subject are the same line.
 */

import type { Line } from './line.js';

/**
 * The verdict line: a label, then what it is about. `detail` is optional because a
 * verdict sometimes IS the whole sentence — `verify` composes its own summary from
 * what it could prove, and the CLI prints it verbatim rather than re-wording a
 * guarantee.
 *
 * This is the one place on the surface where a call site already tells two fields of
 * a line apart, so it is the one place with two roles: the label leads and carries
 * the colon, the detail follows it. Where the verdict is the whole sentence there is
 * no detail and no colon — a bare label is a complete line.
 */
export function statement(label: string, detail?: string): Line {
  const parts: Line['parts'] =
    detail === undefined
      ? [{ role: 'label', text: label }]
      : [
          { role: 'label', text: label },
          { role: 'detail', text: detail },
        ];
  return { indent: 0, parts };
}
