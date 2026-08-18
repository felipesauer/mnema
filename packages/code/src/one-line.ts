/**
 * The rule of the LINE, as this surface reaches it — and the one word that is this
 * surface's own.
 *
 * The rule itself is `@mnema/chain/one-line`, under everything. It used to be this file,
 * and moving it was not tidying: `@mnema/chain` words the verifier's issues and
 * `@mnema/core` words every refusal the domain returns, and a surface cannot apply a
 * rule to the inside of a sentence another package already joined. A sentence is one
 * line where it is WRITTEN or it is not one line anywhere. So the rule went to the only
 * package the other two can both reach, and this file stayed as the address the
 * twenty-three modules here already import — none of which has any reason to know it
 * moved.
 *
 * IT RE-EXPORTS THE SUBPATH AND NOT THE INDEX, and that is the whole floor argument.
 * `wiring/no-such-record.ts` and `presentation/runs.ts` are loaded by commander before
 * it has routed a word, so whatever arrives through this file is on the floor of `mnema
 * --version`. Through `@mnema/chain` that would be the proof engine; through
 * `@mnema/chain/one-line` it is one file that imports nothing, which
 * `chain/src/one-line.test.ts` asserts over the source and
 * `tests/the-floor-is-the-declaration.test.ts` declares as the edge it is.
 *
 * WHAT STAYED IS WHAT HAS A MOUTH. {@link A_PERSON} is how a reading SPEAKS about an act
 * with no agent on its envelope, and the proof engine neither speaks to a person nor
 * knows there is one. A rule about a string travels; a word does not.
 */

export { oneLine } from '@mnema/chain/one-line';

/**
 * How an act with no agent on its envelope is said out loud, on both surfaces.
 *
 * An absent `which` means a person acted directly — a fact, not a missing value —
 * and it is written once for the same reason the record contract is: the MCP
 * reply and the command line's report would drift into two different words for one
 * thing, and then a reader would have to learn which of them means what.
 */
export const A_PERSON = 'a person';
