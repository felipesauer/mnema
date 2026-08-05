/**
 * What a verb's wiring receives, and what a verb's wiring IS.
 *
 * One shape for all twenty-five, so the program can register them in a list
 * instead of naming what each one needs: a verb takes the program to hang itself
 * on and the two things every verb may touch — where to write, and the session its
 * writes are pinned to.
 *
 * The reads take the same value and use half of it. That is deliberate: a read
 * that received a narrower context would say "a read cannot ask about the run" as
 * a type, and the day a read needs to report the pinned session it would be a
 * signature change across two dozen files. The honest statement lives in the code
 * that never calls it.
 */

import type { Command } from 'commander';
import type { CliIo } from './io.js';
import type { PinnedRun } from './run-pin.js';

/** What every verb's wiring is handed. */
export interface Wiring {
  /** Where the verb writes, and how it signals a non-zero exit. */
  readonly io: CliIo;
  /** The open session's run, resolved at most once per command. */
  readonly pinnedRun: PinnedRun;
}

/** A verb's wiring: it declares the command and hangs it on the program. */
export type Verb = (program: Command, wiring: Wiring) => void;
