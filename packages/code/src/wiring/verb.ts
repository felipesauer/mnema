/**
 * What a verb's wiring receives, and what a verb's wiring IS.
 *
 * One shape for all of them, so the program can register them in a list
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
import type { Declared as DeclaredAct } from '../record-effect.js';
import type { RenderingAt } from './color.js';
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
  /**
   * THE SAME ANSWER, ASKED FOR A WIDTH — how a line becomes bytes on a screen of a given
   * size, rather than on the one this process happens to be on (`color.ts`).
   *
   * ONE VERB TAKES IT AND THE REST ARE HANDED {@link render}, which is the difference
   * between a report and a PAGE. A verb prints and exits, so the terminal it read cannot
   * change under it; `repl` opens a session that outlives the window it opened in, and a
   * caller who maximises theirs is a caller whose next line has to fold to the new width.
   * It travels here rather than being built by the verb because the capability behind it is
   * this INVOCATION'S — the flag, the environment and the stream — read once at the entry
   * where the process is, and a session that resolved its own would answer with the defaults
   * of the program it builds per typed line.
   */
  readonly renderingAt: RenderingAt;
  /** The open session's run, resolved at most once per command. */
  readonly pinnedRun: PinnedRun;
}

/**
 * WHAT A VERB CAN DO TO THE RECORD is not decided here — it is the same question the MCP
 * surface's tools answer, and it is asked and worded in ONE place for both of them
 * (`record-effect.ts`). This file re-exports the three names so a verb's wiring imports
 * everything it needs from the module it already imports its own shape from; the rule,
 * the two words and the argument for declaring rather than deriving are over there.
 *
 * The declaration is per TOP-LEVEL verb, which is the unit commander routes and the unit
 * a caller gates. A group is classified by its most powerful member: no group mixes the
 * two today, and one that did would be `mutates` — the safe side for anything reading
 * this to decide what to run. The MCP surface has no groups at all, so it does not
 * inherit this limit; a tool is one act with one input object.
 *
 * `every-verb-says-if-it-writes.test.ts` is what keeps THIS surface's declarations
 * honest: it walks the registered program so every verb is classified, and it EXERCISES
 * each one in a sandbox and counts what reached the chain, so a verb declared `reads`
 * that writes is accused by the record rather than by a review.
 */
export type { RecordEffect } from '../record-effect.js';
export { mutatesTheRecord, readsTheRecord } from '../record-effect.js';

/**
 * What registering a verb answers with: the command that was hung, and what that command
 * can do to the record.
 *
 * It is {@link DeclaredAct} over a `Command` and nothing more — the same shape a tool's
 * declaration has, so neither surface can drift into a classification of its own.
 */
export type Declared = DeclaredAct<Command>;

/**
 * A verb's wiring: it declares the command, hangs it on the program, and says what the
 * command may do to the record.
 *
 * THE RETURN IS WHAT MAKES THE CLASSIFICATION TOTAL. A registrar that answers with
 * nothing is not a `Verb` and cannot enter {@link Wiring}'s list, so a verb added
 * tomorrow does not COMPILE until it has said which side it is on — the same shape the
 * core's routing table uses to keep an event kind from being written with no tree
 * (`core/src/topology/routing.ts`), and the same shape the MCP's registrar has for its
 * tools (`mcp/server.ts`). A table of names kept somewhere else would have been the
 * thing that goes stale, silently, the one time it matters.
 */
export type Verb = (program: Command, wiring: Wiring) => Declared;
