/**
 * WHAT AN ACT OF EITHER SURFACE CAN DO TO THE RECORD — one rule, one type, two words,
 * for the command line and for the MCP alike.
 *
 * This product has two doors onto the same record. The command line is the AUDIT
 * surface, and every one of its verbs has declared its side of this question for as long
 * as `mnema repl` has existed. The MCP is the AGENT surface — the one the work actually
 * goes through — and it declared nothing anywhere, so nothing distinguished a tool that
 * reads from one that writes: not for whoever reviews a pull request, not for a guard,
 * not for anyone deciding what a read-only session may call.
 *
 * IT LIVES HERE, ABOVE BOTH SURFACES, BECAUSE THE ANSWER MUST BE ONE ANSWER. Two
 * modules each naming their own words is the shape that lets `mutates` come to mean
 * "touches the disk" on one surface and "appends an event" on the other, and the two
 * readings would be indistinguishable from agreement until the day they disagreed about
 * a real act. So the type is declared once, both constructors are declared once, and
 * each surface's declaration is a call to the same function with its own subject — a
 * `Command` on one side, a tool's name on the other. `every-tool-says-if-it-writes.test.ts`
 * holds the other half of that: no file of either surface may build one of these by
 * hand.
 *
 * WHY IT IS DECLARED RATHER THAN DERIVED. It was looked for first, on the command line,
 * and it is not in the code. `grep writer` over the adapters names FIFTEEN files and six
 * of them are reads — `show`, `timeline`, `resume`, `next-actions`, `brief`,
 * `accountability` — because the word is in their PROSE, so the search answers with
 * false positives rather than a set. `pinnedRun()` is asked at eleven sites, and the
 * three writes that stamp no session (`init`, `key`, `run` itself) are not among them,
 * so it answers "carries a run", which is a different question. Nothing in the code
 * answered this one, so each act states it, next to itself, in its own voice.
 *
 * The MCP surface has a discriminant the command line lacks — every write there goes
 * through one door (`mcp/session.ts`'s `openWrite`) — and it is still declared rather
 * than derived, for two reasons. The first is this file: a rule read one way here and
 * another way there is the whole defect. The second is that a derivation would answer
 * about the code as it is, and the claim is about POWER: a tool that opens no writer
 * TODAY and is meant to is a tool whose declaration should already say so.
 */

/**
 * What an act can do to the RECORD. Two answers, and every act of both surfaces gives
 * one of them.
 *
 * `mutates` says the act CAN change the record: append an event to a chain, change this
 * machine's key material, or alter what a verifier rules on. `reads` says it cannot. The
 * claim is about the POWER and never about the exercise: a write refused for a missing
 * project appended nothing and is still a write, and a caller deciding what to allow has
 * to know what an act could do, not what it happened to do last time.
 *
 * THE THIRD CLAUSE ARRIVED WITH A COUNTEREXAMPLE. This said "append an event or touch
 * key material" for as long as those were the only two ways to change anything, and
 * `mnema witness` is neither: it writes an external attestation beside a tail's
 * checkpoints, appends nothing, mints nothing, and moves `verify` from `not-covered` to
 * `covered`. Under the old wording it would have classified as a READ — which is the
 * unsafe side — so the wording widened to the thing all three have in common, which is
 * what a verifier would afterwards say.
 *
 * IT IS NOT "TOUCHES DISK", and the difference is not academic. Most reads open the
 * projection cache and rebuild it, which writes a file — and none of that reaches the
 * record a reader cites or a verifier rules on. The other direction is what makes the
 * wording earn its place, and it is the sharpest case on either surface: the `skills`
 * TOOL serves a pattern's body and records that a run was served it, so a reading that
 * mints a fact belongs on the `mutates` side. Its namesake on the command line,
 * `mnema skills`, lists patterns and records nothing, and is a `reads`. The two are not
 * one act under two names, and the classification is what says so out loud.
 *
 * TWO FILES KEEP THE DECLARATIONS HONEST, one per surface, and both do it the same way:
 * they enumerate what is registered from the thing that registers it, and then EXERCISE
 * every act in a sandbox and count what reached the chain — so an act declared `reads`
 * that writes is accused by the record rather than by a review
 * (`every-verb-says-if-it-writes.test.ts`, `every-tool-says-if-it-writes.test.ts`).
 */
export type RecordEffect = 'mutates' | 'reads';

/**
 * One act of a surface, and what it can do to the record.
 *
 * The ACT travels rather than its name, so nothing spells its own name twice: a verb
 * carries the `Command` commander routes it with, and a tool carries the name the
 * protocol serves it under — the same value each surface registered.
 */
export interface Declared<Act> {
  /** The act itself: a verb's command, or a tool's name. */
  readonly act: Act;
  /** What invoking it can do to the record. */
  readonly effect: RecordEffect;
}

/**
 * The act CAN change the record: it appends an event, it touches key material, or it
 * alters what a verifier rules on.
 *
 * Used by every write of the command line, `mcp` among them — the server serves every
 * write TOOL there is, so the verb that starts it can do everything they can. That is
 * not everything this product can do: `tail prune` has no tool and never will, so the
 * MCP's reach is the tools' and that verb's classification is about the tools it serves.
 */
export function mutatesTheRecord<Act>(act: Act): Declared<Act> {
  return { act, effect: 'mutates' };
}

/**
 * The act CANNOT change the record: nothing it does reaches a chain, a key, or a
 * verdict.
 *
 * It is the honest answer for `completion` too, which reads no record at all: the
 * question has two sides, and "reads nothing" is on this one.
 */
export function readsTheRecord<Act>(act: Act): Declared<Act> {
  return { act, effect: 'reads' };
}
