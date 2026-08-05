/**
 * What a verb's wiring receives, and what a verb's wiring IS.
 *
 * One shape for all twenty-five, so the program can register them in a list
 * instead of naming what each one needs: a verb takes the program to hang itself
 * on and the three things every verb may touch — where to write, how a line becomes
 * bytes, and the session its writes are pinned to.
 *
 * The reads take the same value and use half of it. That is deliberate: a read
 * that received a narrower context would say "a read cannot ask about the run" as
 * a type, and the day a read needs to report the pinned session it would be a
 * signature change across two dozen files. The honest statement lives in the code
 * that never calls it.
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
