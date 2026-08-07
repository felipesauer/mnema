/**
 * FORM C — a verdict: an assertion, and the evidence for it.
 *
 * Three of the CLI's readings are this form. `guard` answers ALLOWED or REFUSED
 * and says what would have happened; `verify` names a tree and gives the chain's
 * verdict over it; `antipatterns` states a count per shape it found. None of them lists
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
 * primitive that decided one of those was a "warning" would decide that for them — and
 * that is still true of a count now that a severity has a middle value, because what a
 * call site may hand over is news it KNOWS, never news a primitive inferred.
 *
 * The EVIDENCE line is `fact` from form B, not a function of its own: an issue
 * indented under a verdict and a fact indented under a subject are the same line.
 */

import type { Line, Part, Severity } from './line.js';

/**
 * The verdict line: a label, then what it is about. `detail` is optional because a
 * verdict sometimes IS the whole sentence, and because the head of a verdict whose
 * sentence arrives in clauses is a label with nothing after it yet
 * (see {@link clauseStatement}).
 *
 * This is where a call site already tells two fields of a line apart, so it is where
 * the two roles are: the label leads and carries the colon, the detail follows it.
 * With no detail there is no colon — a bare label is a complete line.
 *
 * `severity` IS OPTIONAL, AND THAT IS MEASURED RATHER THAN CAUTIOUS. This form serves
 * three different things across its call sites: a verdict that really is one (`guard`
 * answering ALLOWED or REFUSED, a refusal funnelled through `wiring/report.ts`), a
 * named COUNT (`antipatterns` stating "reopened tasks: 3") and a per-tree label
 * (`verify` naming a tree, whose verdict then arrives as clauses). Only the first knows
 * whether its news is good or bad. Made required, the argument would force two dozen
 * sites to declare something they do not know, and the ones with nothing to say would
 * answer with whatever value read as neutral — which is how a surface ends up calling
 * a count bad. Absent means what it meant before: weight, no hue.
 *
 * It rides the LABEL and not the line, because HERE the label is the word that says it.
 * `REFUSED (MISSING_PROOF)` is what a reader scanning for the answer looks at; the
 * detail after the colon is the evidence, and evidence is not good or bad news, it is
 * what the news was about. Where the answer is NOT the label — `verify`'s label is a
 * tree's name, and painting it would say the tree was bad — the news rides the clause
 * that carries it instead (see {@link clauseStatement}).
 *
 * `depth` IS THE LINE'S, exactly as it is on form B's `fact`, and zero is what every
 * reading of this surface asks for: a verdict is the answer, and an answer sits at the
 * left edge. The one caller that asks for a level is the console's opening panel, where
 * the verdict of each tree is written UNDER a heading that names the section — which is
 * form B's nesting and not a rank of its own. Passed rather than decided here, because
 * how deep a line sits is a property of the report it is in, and a primitive that chose
 * would be choosing for both.
 */
export function statement(label: string, detail?: string, severity?: Severity, depth = 0): Line {
  const head: Part = {
    role: 'label',
    text: label,
    ...(severity !== undefined ? { severity } : {}),
  };
  const parts: Line['parts'] =
    detail === undefined ? [head] : [head, { role: 'detail', text: detail }];
  return { indent: depth, parts };
}

/**
 * One clause of a verdict that arrives in several: what it says, and the news it carries
 * where the call site knows.
 *
 * Most clauses carry none, and that is the shape of the thing rather than caution: a
 * verdict's clauses QUALIFY it — how many tails, what the events rest on, what the
 * census saw — and a qualification is not good or bad news, it is what the news was
 * about. Exactly one of `verify`'s clauses is the answer.
 */
export interface Clause {
  /** What it says, verbatim. The caller received these words; it does not word them. */
  readonly text: string;
  /** How bad this clause's news is, where the call site knows. Absent is the norm. */
  readonly severity?: Severity;
}

/**
 * The verdict line whose sentence arrives in CLAUSES: a label, then each clause after
 * the one before it.
 *
 * It exists because `verify`'s verdict is not the surface's to word and is not one thing
 * to look at either. The chain hands over the clauses of its one-line verdict; the first
 * of them is the level, which is the only one that is good or bad news, and the rest
 * qualify it. Handed to {@link statement} as a single detail — which is what happened
 * until now — the whole sentence became one part, and anything that wanted to say which
 * word was the answer had to search the string for it.
 *
 * IT IS THE SAME FORM, NOT A SECOND ONE. The label and the depth come from
 * {@link statement}, so the colon after the label and the level a verdict sits at cannot
 * be decided twice; the first clause takes the `detail` role it would have had, and each
 * one after it takes `clause`, whose separator is the `; ` the chain's own sentence uses
 * (see `plain.ts`). Rendered plain, this line is therefore the label, a colon, and the
 * chain's `summary` — which is the whole of what makes composing here safe on a surface
 * that must never upgrade a guarantee.
 *
 * The list is non-empty BY TYPE. A verdict with no clause would be a label alone, which
 * is what {@link statement} already is; asking this function for one would be asking it
 * to invent the sentence.
 *
 * `depth` is {@link statement}'s and it is handed straight through, which is the point
 * of taking it at all: the two shapes are ONE form, so a caller that indents a verdict
 * must not have to know which of the two functions built the line it indented.
 */
export function clauseStatement(
  label: string,
  said: readonly [Clause, ...Clause[]],
  depth = 0,
): Line {
  const [lead, ...rest] = said;
  const head = statement(label, undefined, undefined, depth);
  return {
    indent: head.indent,
    parts: [
      ...head.parts,
      clausePart('detail', lead),
      ...rest.map((clause) => clausePart('clause', clause)),
    ],
  };
}

/** One clause as a part of its line: the role it takes, its words, and its news if any. */
function clausePart(role: 'detail' | 'clause', clause: Clause): Part {
  return {
    role,
    text: clause.text,
    ...(clause.severity !== undefined ? { severity: clause.severity } : {}),
  };
}
