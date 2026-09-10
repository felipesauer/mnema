/**
 * WHAT A TRANSITION CARRIED, as text — the one reading of a move's proof.
 *
 * A transition's `fields` are the words somebody wrote to justify a move: why a task
 * was canceled, what was done on completing it, what has to change when a review sends
 * it back, the pull request, the links. They enter the signed chain and they are the
 * only prose a task or a skill ever holds.
 *
 * MEASURED, AND THIS MODULE IS WHY IT EXISTS: that prose came out of exactly one read.
 * `mnema timeline --json` serves the whole event verbatim, so a `--note` was there; and
 * `mnema timeline` without the flag, `mnema show`, and `mnema search <the words of the
 * note>` all had nothing. A fact in the chain that the human read and the index cannot
 * reach is a fact written for a flag.
 *
 * ONE FUNCTION, because three surfaces and three state machines want it. Task, decision
 * and skill each carry the same `TransitionFields`, and each of `show`, `timeline` and
 * the full-text index has to turn one into text. Six spellings of "what did this move
 * say" is the shape that produces surfaces disagreeing about the same bytes, and this
 * repository has paid for that class more than once.
 *
 * TOTAL IN THE TYPE, and deliberately in `src` rather than in a test: {@link
 * PROOF_FIELD_RANK} is a mapped type over every key of `TransitionFields`, so a sixth
 * field added to the catalog DOES NOT COMPILE until it says where it belongs. A type
 * check written in a `.test.ts` would be vacuous here — the build excludes tests and the
 * runner erases types without checking them — so the guard has to live beside the value.
 */

import type { CatalogEvent, TransitionFields } from './catalog.js';

/**
 * An event that MOVES something: the arms of the catalog whose payload carries an
 * `action`, which is exactly the three transitions and nothing else.
 *
 * It is filtered on `action` and not on `fields`, and the difference is the whole
 * reason this line has a comment: `fields` is OPTIONAL, so every arm of the union
 * satisfies `{ payload: { fields?: … } }` — absence satisfies an optional — and the
 * filter would keep the catalog entire. `action` is required on the three and absent
 * from the rest.
 */
type ATransition = Extract<CatalogEvent, { readonly payload: { readonly action: string } }>;

/**
 * The kinds that carry a move's proof — the totality guard for {@link proofFields}.
 *
 * A mapped type over every transition kind, so a FOURTH state machine added to the
 * catalog does not compile until it says whether its moves carry proof. That is the
 * shape A1 asks for when the domain is a closed union, and it is here in `src` rather
 * than in a test because the build excludes tests: a type error declared in a
 * `.test.ts` leaves both the build and the suite green.
 */
const KINDS_WITH_PROOF: { readonly [K in ATransition['kind']]: true } = {
  'task.transitioned': true,
  'decision.transitioned': true,
  'skill.transitioned': true,
};

/**
 * The proof one event carries, or undefined when it is not a move at all.
 *
 * The narrowing is a cast rather than a switch, and it is the map above that earns it:
 * the check immediately to its left is `in KINDS_WITH_PROOF`, whose keys the compiler
 * requires to be exactly the kinds of `ATransition`. A switch would narrow with no cast
 * and would list the same three kinds a second time, where a fourth could be forgotten
 * in silence.
 */
export function proofFields(event: CatalogEvent): TransitionFields | undefined {
  return event.kind in KINDS_WITH_PROOF ? (event as ATransition).payload.fields : undefined;
}

/**
 * Every field a transition can carry, ranked by the order a reader meets them.
 *
 * The rank is what makes the order a property of this module rather than of whichever
 * order a writer happened to serialize the object in — two records holding the same
 * proof read the same way. `reason` and `feedback` lead because they are what a reader
 * chasing a refusal or a send-back came for; `pr_url` and `links` trail because they
 * are locators rather than words.
 *
 * The mapped type is the guard: every key of `TransitionFields`, with no key missing
 * and none invented.
 */
const PROOF_FIELD_RANK: { readonly [K in keyof Required<TransitionFields>]: number } = {
  reason: 0,
  note: 1,
  feedback: 2,
  pr_url: 3,
  links: 4,
};

/** The fields of a transition's proof, in reading order, derived from the rank. */
export const PROOF_FIELDS = (Object.keys(PROOF_FIELD_RANK) as (keyof TransitionFields)[]).sort(
  (a, b) => (PROOF_FIELD_RANK[a] as number) - (PROOF_FIELD_RANK[b] as number),
);

/**
 * The proof a transition carried, as `name: value` lines — empty when it carried none.
 *
 * EMPTY RATHER THAN A PLACEHOLDER, because absence is a fact here: most transitions
 * carry nothing, and a caller that got `"note: "` back could not tell a move that said
 * nothing from one that said the empty string. Every caller treats `''` as "no proof",
 * and none of them prints a heading over it.
 *
 * `links` is joined with a space rather than listed, for the two consumers that decide
 * it: the index tokenizes whitespace either way, and a reader of one line needs one
 * line. A caller that wants the array reads the event, which `timeline --json` serves
 * whole and always did.
 */
export function transitionProse(fields: TransitionFields | undefined): string {
  if (fields === undefined) return '';
  const said: string[] = [];
  for (const name of PROOF_FIELDS) {
    const value = fields[name];
    if (value === undefined) continue;
    const text = Array.isArray(value) ? value.join(' ') : String(value);
    if (text.length === 0) continue;
    said.push(`${name}: ${text}`);
  }
  return said.join('\n');
}
