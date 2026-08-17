/**
 * How a line this surface prints on SUCCESS carries a value that came from outside —
 * one tag, at every site that words such a line, and the collapse in one place.
 *
 * THE FAMILY IS THE SUCCESS LINE, and it is the third of this class to be closed. A
 * pattern's NAME was closed in `served-patterns.ts`, a project's DIRECTORY in
 * `verify --workspace`, and the id in a REFUSAL in `no-such-record.ts`. What was left is
 * the line a verb prints when it FOUND what it was asked for, and it is the worst of the
 * four rather than the mildest: `next-actions` writes `Task <id> — 2 legal move(s):` and
 * then one line per move UNDER it, which is exactly the shape `oneLine`'s own doc names
 * as the one a reader mis-attributes. A break in that id does not produce a stray line —
 * it produces a HEADING with items beneath it, about a task nobody named.
 *
 * THE DISCRIMINANT IS THE ORIGIN OF THE VALUE, NEVER THE PHRASE. This family has no
 * sentence in common: `Linked a —rel→ b`, `Recorded observation <id> about <x>`,
 * `Initialized mnema project at <path>` share nothing but the question — CAN THIS VALUE
 * HOLD A NEWLINE? A value this product minted cannot: a uuid, an alias
 * (`<prefix>-<hex>`), an `ADR-<n>`, a fingerprint, an anchor (`mnid:` and 64 hex, which
 * `resolveAnchorPrefix` is what makes true), a hash, a count, a word of a closed
 * transition table. A value that arrived through the argv or came back out of the record
 * can, and every one of those goes through this tag. Which site is which is written down
 * rather than left to be re-derived: `tests/a-line-of-success-is-one-line.test.ts` holds
 * the classification of every line this wiring prints, reconciled against the source in
 * both directions, so a line added next year is unclassified and red rather than
 * unnoticed.
 *
 * WHY A TAG AND NOT `oneLine` AT THE CALL SITE. `oneLine` applied by hand is a rule the
 * call site can forget one FIELD of — and a line is forged by whichever field was
 * forgotten, so a site that collapses two of its three values is a site with the defect
 * still in it. A tag takes the whole template: every interpolated value goes through the
 * collapse by construction, and the literal chunks between them — which are this
 * surface's own words — are untouched. There is nothing to remember, and the guard can
 * SEE the difference, because "is this template tagged" is decidable by reading the
 * source where "did this site collapse every field" is not.
 *
 * THE LITERAL CHUNKS ARE THE PRODUCT'S WORDS, AND THE SPACES IN THEM MATTER. `oneLine`
 * trims, so a fragment composed before it reaches an interpolation loses the space it
 * opens with: `for ${agent}${goal === undefined ? '' : ` — ${goal}`}` printed
 * `for a — g` and would print `for a— g`. The rule that follows is the one the call
 * sites now hold — INTERPOLATE THE VALUE, never a fragment that carries its own
 * punctuation — and the two sites that used to (`run start`, `focus`) were rewritten so
 * the ` — ` is a chunk of a template rather than the head of a value. Those two are the
 * ones `tests/a-line-of-success-is-one-line.test.ts` compares byte for byte against the
 * literal they printed before; every OTHER line of every touched verb is held by the
 * suite it already had, and by the goldens, which were not regenerated.
 *
 * IT IS LOADED WHERE IT IS USED, INSIDE THE ACTION, for the reason `no-such-record.ts`
 * is: this module reaches `served-patterns.ts`, which reaches `@mnema/copilot`. A static
 * import would put a second declared edge to the copilot in the floor of every
 * invocation of every verb, and the argument for admitting it would be "it is free,
 * because `wiring/refs.ts` already pays" — which is the ratchet
 * `tests/the-floor-is-the-declaration.test.ts` exists to refuse. That guard reports the
 * same 55 modules it did before this module existed. What the SUCCESS path pays is two
 * small module loads, and the copilot they reach is already resident: measured on the
 * real binary in alternating order, 15 invocations of `mnema observe` per arm came back
 * 24 · 25 · 24 · 23 ms — the spread inside one arm is wider than the gap between them.
 *
 * WHAT IT DOES NOT REACH is what `oneLine`'s doc already says it does not: the control
 * characters a terminal interprets — an ANSI escape, or U+0085 NEL, which is not `\s`.
 * That class is the product's and it is open on every read that prints recorded text;
 * closing it one call site at a time would look like coverage that is not there.
 */

import { oneLine } from '../served-patterns.js';

/**
 * The line, with every value on it collapsed to one line and every word of it left
 * exactly as this surface wrote it.
 *
 * Used as a template tag — ``onOneLine`Task ${id} — ${n} legal move(s):` `` — so the two
 * halves are told apart by the syntax itself: what is between the interpolations is the
 * product speaking, and what is inside them came from somewhere else.
 *
 * A value is stringified the way a template literal would stringify it, and then
 * collapsed. For a number, an instant or an id that is what it already was — `oneLine`
 * over a value with no whitespace in it is that value — so the only bytes that can move
 * are those of a value that carries whitespace a line cannot survive.
 */
export function onOneLine(words: TemplateStringsArray, ...values: readonly unknown[]): string {
  let line = words[0] ?? '';
  for (const [index, value] of values.entries()) {
    line += oneLine(String(value)) + (words[index + 1] ?? '');
  }
  return line;
}
