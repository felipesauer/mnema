/**
 * When a person corrects the agent, as a rule a reader can check — no model, and no guess about
 * what a sentence means.
 *
 * WHAT IT IS FOR. A correction is a moment where somebody decided how a thing is done here and
 * nobody recorded it: the agent did X, the person said "no, use Y". It is the decision
 * `recording-decisions` asks an agent to record, made by the one who ruled it, and the agent is
 * the one least likely to write it down. This finds those moments in a transcript by SHAPE — a
 * handful of openings that say *no*, *stop*, *that is wrong*, *use this instead*, each written
 * down with the probe that proves it matches — so the same transcript always yields the same
 * corrections, and a reader can see every opening there is.
 *
 * WHAT IT DOES NOT CLAIM. A sentence that opens with "no," may be an answer to a question the
 * agent asked and not a correction at all; the shapes are a net that is wide on purpose and
 * recorded as `proposed`, which is the state that exists for a person to rule on. Nothing here
 * says a correction is right, and nothing is in force until a person accepts it.
 *
 * IT LOOKS AT THE OPENING OF A PROMPT ONLY — its first {@link OPENING} characters — because a
 * correction is said first, and a long prompt that mentions "wrong" in its fifth paragraph is
 * about something else.
 */

import type { WhatThePersonSaid } from './what-the-session-did.js';

/** How much of a prompt is read for an opening, and the most of it that is ever quoted. */
export const OPENING = 280;

/** One shape of correction: its name, and the pattern that is tried against the opening. */
export interface CorrectionShape {
  readonly name: string;
  readonly pattern: RegExp;
}

/**
 * Every opening this reader knows, in English and Portuguese — the two the person who wrote it
 * types in. A table and not a list in a function, so a reader of the record can name the shape a
 * proposal came from, and so a shape added is a line somebody has to write a probe for.
 */
export const CORRECTION_SHAPES: readonly CorrectionShape[] = [
  { name: 'no, …', pattern: /^\s*(no|nope|não|nao)\s*[,.!;:—-]/i },
  { name: 'stop …', pattern: /^\s*(stop|pare|para)\s+(doing|using|de|with|it)\b/i },
  {
    name: 'do not …',
    pattern: /^\s*(don'?t|do not|never|nunca|não\s+(faça|use|fa[cç]a)|nao\s+(faca|use))\b/i,
  },
  {
    name: 'that is wrong',
    pattern:
      /\b(that'?s|that is|this is|isso (está|esta|é)|está|esta)\s+(wrong|incorrect|not right|errado|incorreto)\b/i,
  },
  { name: 'use … instead', pattern: /\b(use|usa)\b.{1,80}\b(instead|em vez de|ao invés de)\b/i },
];

/** One correction found: where, the shape it matched, and the sentence it opens with. */
export interface Correction {
  /** The line of the transcript, counted from 1. */
  readonly line: number;
  /** The host's id for the line, when it wrote one. */
  readonly uuid: string | undefined;
  /** The session it belongs to, when the line says. */
  readonly session: string | undefined;
  /** The name of the shape that matched. */
  readonly shape: string;
  /** The opening sentence — at most {@link OPENING} characters, whitespace collapsed. */
  readonly sentence: string;
}

/** The opening of a prompt: its first sentence or line, within {@link OPENING}, on one line. */
function openingOf(text: string): string {
  const flat = text.trim().replace(/\s+/g, ' ').slice(0, OPENING);
  const end = flat.search(/[.!?](\s|$)/);
  return end === -1 ? flat : flat.slice(0, end + 1);
}

/** The corrections among what a person said, in the order they said them. */
export function correctionsIn(said: readonly WhatThePersonSaid[]): readonly Correction[] {
  const found: Correction[] = [];
  for (const one of said) {
    const sentence = openingOf(one.text);
    const shape = CORRECTION_SHAPES.find((candidate) => candidate.pattern.test(sentence));
    if (shape === undefined) continue;
    found.push({
      line: one.line,
      uuid: one.uuid,
      session: one.session,
      shape: shape.name,
      sentence,
    });
  }
  return found;
}
