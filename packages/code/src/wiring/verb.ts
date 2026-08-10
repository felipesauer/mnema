/**
 * What a verb's wiring receives, and what a verb's wiring IS.
 *
 * One shape for all twenty-eight, so the program can register them in a list
 * instead of naming what each one needs: a verb takes the program to hang itself
 * on and the three things every verb may touch — where to write, how a line becomes
 * bytes, and the session its writes are pinned to.
 *
 * The reads take the same value and use half of it. That is deliberate: a read
 * that received a narrower context would say "a read cannot ask about the run" as
 * a type, and the day a read needs to report the pinned session it would be a
 * signature change across two dozen files. What a verb may do to the record is
 * said instead by what it ANSWERS with ({@link RecordEffect}) — a declaration a
 * reader can find without walking the body, and one the wiring's uniform input
 * was never going to carry.
 *
 * A VERB DECLARES EAGERLY AND LOADS WHEN IT RUNS, and that split is the rule every
 * file in this directory keeps.
 *
 * commander needs every command, every option and every line of help DECLARED
 * before it can route a word or print `mnema --help`, so all of that is imported at
 * the top and costs what it costs. What it does NOT need is the work: the `runX`
 * behind the action, and the helpers that read the record to compose a line. Those
 * arrive through an `await import()` inside the action, because importing them at
 * the top imports the domain behind them — the chain, the projections, the
 * derivations — on EVERY invocation of EVERY verb, including the ones that read
 * nothing.
 *
 * It was measured before it was changed: the floor of the CLI (`mnema --version`,
 * which reads nothing at all) was 121 ms against 19 ms for an empty node, and the
 * slowest verb in the product was 169 ms. Seventy-two per cent of what a person
 * waited for was modules loading, and the work itself — 3 to 48 ms — was under the
 * threshold where anyone notices anything.
 *
 * The floor is guarded as a SHAPE, not as a stopwatch:
 * `the-floor-is-the-declaration.test.ts` walks the entry's eager imports and holds
 * the domain packages it reaches to a declared table. A timed test on a busy
 * machine is a flake somebody switches off, and then the floor grows back.
 *
 * Two things to get right when writing one:
 *   - AWAIT IT. An `import()` whose promise nobody waits for makes the action
 *     return before it has written anything, and the process can exit first — a
 *     verb that silently prints nothing and exits zero. commander awaits an action
 *     that returns a promise (the entry parses with `parseAsync`), so an `async`
 *     action is enough as long as every load inside it is awaited.
 *   - DO NOT MOVE A DECLARATION. If `mnema --help` changes by one byte, something
 *     the parser needed became lazy, and that is a regression the golden catches.
 */

import type { Command } from 'commander';
import type { Render } from '../presentation/render.js';
import type { CliIo } from './io.js';
import type { PinnedRun } from './run-pin.js';

/** What every verb's wiring is handed. */
export interface Wiring {
  /** Where the verb writes, and how it signals a non-zero exit. */
  readonly io: CliIo;
  /**
   * How a line becomes the bytes `io` receives — plain or styled, decided once at
   * the entry from the caller's flag, environment and terminal (see `color.ts`).
   *
   * It travels HERE rather than behind the port, because the port takes a string:
   * by the time a line reaches `io.out` there is nothing left to tell a label from
   * the value beside it. And it travels here rather than being imported, because a
   * verb that imported a renderer would be a verb that answered the question — which
   * is how the surface would end up with a hundred answers to it.
   */
  readonly render: Render;
  /** The open session's run, resolved at most once per command. */
  readonly pinnedRun: PinnedRun;
}

/**
 * What a verb can do to the RECORD, which every one of them declares.
 *
 * `mutates` says this verb CAN append an event to a chain or change this machine's key
 * material. `reads` says it cannot. The claim is about the POWER and never about the
 * exercise: a write refused for a missing project appended nothing and is still a
 * write, and a caller deciding what to allow has to know what a verb could do, not
 * what it happened to do last time.
 *
 * IT IS NOT "TOUCHES DISK", and the difference is not academic. Most reads open the
 * projection cache and rebuild it, which writes a file — and none of that reaches the
 * record a reader cites or a verifier rules on. The other direction is what makes the
 * wording earn its place: the `skills` TOOL on the MCP surface serves a pattern's body
 * and records that a run was served it, so a reading that mints a fact belongs on the
 * `mutates` side.
 *
 * WHY IT IS DECLARED RATHER THAN DERIVED. It was looked for first. `grep writer` over
 * the adapters names fifteen files, and six of them are reads — `show`, `timeline`,
 * `resume`, `next-actions`, `brief`, `accountability` — because the word is in their
 * PROSE, so the search answers with false positives rather than a set. `pinnedRun()` is
 * asked at eleven sites, and the three writes that stamp no session (`init`, `key`,
 * `run` itself) are not among them, so it answers "carries a run", which is a different
 * question (see `cli.ts`). Nothing in the code answered this one, so it is stated here,
 * next to the verb, by the verb.
 *
 * The declaration is per TOP-LEVEL verb, which is the unit commander routes and the unit
 * a caller gates. A group is classified by its most powerful member: no group mixes the
 * two today, and one that did would be `mutates` — the safe side for anything reading
 * this to decide what to run.
 *
 * `every-verb-says-if-it-writes.test.ts` is what keeps the declaration honest: it walks
 * the registered program so every verb is classified, and it EXERCISES each one in a
 * sandbox and counts what reached the chain, so a verb declared `reads` that writes is
 * accused by the record rather than by a review.
 */
export type RecordEffect = 'mutates' | 'reads';

/**
 * What registering a verb answers with: the command that was hung, and what that command
 * can do to the record.
 *
 * The command travels rather than its name, so no verb spells its own name twice — the
 * name a caller types is read off the declaration commander holds, which is the same
 * object it routes with.
 */
export interface Declared {
  /** The top-level command the verb hung on the program. */
  readonly command: Command;
  /** What it can do to the record. */
  readonly effect: RecordEffect;
}

/**
 * A verb's wiring: it declares the command, hangs it on the program, and says what the
 * command may do to the record.
 *
 * THE RETURN IS WHAT MAKES THE CLASSIFICATION TOTAL. A registrar that answers with
 * nothing is not a `Verb` and cannot enter {@link Wiring}'s list, so a verb added
 * tomorrow does not COMPILE until it has said which side it is on — the same shape the
 * core's routing table uses to keep an event kind from being written with no tree
 * (`core/src/topology/routing.ts`). A table of names kept somewhere else would have been
 * the thing that goes stale, silently, the one time it matters.
 */
export type Verb = (program: Command, wiring: Wiring) => Declared;

/**
 * The verb CAN change the record: it appends an event, or it touches key material.
 *
 * Used by the eleven writes, `mcp` among them — the server serves every write tool this
 * product has, so the verb that starts it can do everything they can.
 */
export function mutatesTheRecord(command: Command): Declared {
  return { command, effect: 'mutates' };
}

/**
 * The verb CANNOT change the record: nothing it does reaches a chain or a key.
 *
 * It is the honest answer for `completion` too, which reads no record at all: the
 * question has two sides, and "reads nothing" is on this one.
 */
export function readsTheRecord(command: Command): Declared {
  return { command, effect: 'reads' };
}
