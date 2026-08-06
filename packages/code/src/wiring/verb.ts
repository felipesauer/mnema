/**
 * What a verb's wiring receives, and what a verb's wiring IS.
 *
 * One shape for all twenty-six, so the program can register them in a list
 * instead of naming what each one needs: a verb takes the program to hang itself
 * on and the three things every verb may touch — where to write, how a line becomes
 * bytes, and the session its writes are pinned to.
 *
 * The reads take the same value and use half of it. That is deliberate: a read
 * that received a narrower context would say "a read cannot ask about the run" as
 * a type, and the day a read needs to report the pinned session it would be a
 * signature change across two dozen files. The honest statement lives in the code
 * that never calls it.
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

/** A verb's wiring: it declares the command and hangs it on the program. */
export type Verb = (program: Command, wiring: Wiring) => void;
