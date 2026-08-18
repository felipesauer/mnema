/**
 * How a refusal names the record it did NOT find — one sentence, one place, every
 * verb that has one.
 *
 * A REFUSAL IS READ AS ONE LINE, and the value on it comes from outside. The id is
 * whatever was typed after the verb; nothing upstream stops a newline in it (an id is
 * canonicalized — NFC, chain-representable — and a break survives that), so an
 * argument that holds one used to write a SECOND line, well-formed, refusing an id
 * nobody asked about. That is the defect already measured on a project's directory
 * name in `one-line.ts`, reached here through the shortest door there is: the
 * command line. So the name goes through {@link oneLine}, in this function, and no
 * caller passes it through anything of its own.
 *
 * THE VICTIM IS WEAKER HERE THAN ON A PATH, AND THE RULE HAS NO EXCEPTION FOR THAT. A
 * directory name comes off the disk — a checkout, an archive, a dependency can carry
 * one, and nobody typed it. An id comes from the person or the agent running the
 * command, so a forged line is a line forged for its own author. The reason it is
 * closed anyway is that the rule is about A VALUE FROM OUTSIDE ON A LINE, and an
 * exception granted for an improbable victim is how the rule grows a hole that the
 * next value walks through.
 *
 * ONE FUNCTION AND EVERY SITE. The sites are EIGHT, in seven files — `guard`,
 * `next-actions`, `show`, `task move`, `skill move`, `skill export`, `tail prune`, and
 * the one `decision move` and `decision supersede` share. THE COUNT WAS DECLARED AS
 * SIX when this was left as debt, and what it missed is the shape the miss always
 * takes: a hand-written list of ADDRESSES. It named one refusal per file and there are
 * two in `skill.ts`, and it did not have `decision.ts` at all — so the sites were found
 * by re-running the discriminant over the source rather than by reading that list, and
 * `tests/a-refusal-is-one-line.test.ts` enumerates them from the source on every run so
 * the ninth cannot be born outside the count.
 *
 * The sentence itself did not change: it is the wording eight places already print, and
 * what moved is only WHERE the id passes on its way to it. A refusal is worded to be
 * read once and acted on, so the two closest things to it — the code the funnel prints
 * (`UNKNOWN_TASK`, `UNKNOWN_SKILL`, …) and the phrasing — stay exactly as they were.
 *
 * The twin of this module is `moved-record.ts`, which does the same for the echo of a
 * MOVE: a total table over the kinds, and every value an actor wrote through `oneLine`.
 * That one is still loaded when a verb RUNS, because it reads the record it echoes and
 * so reaches `@mnema/core`. This one is not, and it used to be loaded later still —
 * inside the branch that REFUSES, at all eight sites — because `served-patterns.ts`
 * reaches `@mnema/copilot`, so a static import would have put the copilot's own edge on
 * the floor of every invocation of every verb (the shape guard in
 * `tests/the-floor-is-the-declaration.test.ts` is what said so). The rule of the line
 * lives in `one-line.ts` now and imports nothing, so this module imports nothing but
 * that, and the eight sites name it the way they name every other word this surface says.
 */

import { oneLine } from '../one-line.js';

/** The five kinds of record a verb of this surface refuses to find. */
export type NoSuchKind = 'task' | 'decision' | 'skill' | 'record' | 'tail';

/**
 * Where each kind's refusal says it looked — the clause after the name, TOTAL over the
 * kinds, so a sixth does not compile until it has one.
 *
 * Four of them say `here`, which on this surface means the trees this project can see.
 * A tail says more because its absence is two facts at once: no tree holds that tail,
 * OR one does and it holds no events — and a waiver over nothing is not a cut. That is
 * the one wording that was already different before this module existed, and it is
 * carried rather than levelled: the sentence a reader met yesterday is the sentence
 * they meet today.
 */
const WHERE_IT_LOOKED: Readonly<Record<NoSuchKind, string>> = {
  task: 'here',
  decision: 'here',
  skill: 'here',
  record: 'here',
  tail: 'holds events in any tree here',
};

/**
 * The one sentence a verb refuses an unknown id with.
 *
 * The KIND is the noun, rather than a second word held beside it: on this surface the
 * two are the same five words, and a table that repeated them would be a place for the
 * noun and the kind to come apart. (`moved-record.ts` does hold a label of its own,
 * because a move's echo capitalizes it and a kind is not a display.)
 *
 * `named` is whatever the caller typed — an id for four kinds, a
 * `<fingerprint>-<installation>` for a tail — and it is the only value on the line the
 * product did not write.
 */
export function noSuchRecord(kind: NoSuchKind, named: string): string {
  return `No ${kind} ${oneLine(named)} ${WHERE_IT_LOOKED[kind]}.`;
}
