/**
 * What the bare name `mnema` says: a short summary of where this project stands and what is
 * off, with the verbs that come next. A read: it writes nothing and opens no writer.
 *
 * Each fact is read from the record or the machine, and a fact that cannot be read is left
 * out, never replaced by a guess: the summary is a door, and a door that fails would hide the
 * very `--help` it points to.
 */

import type { DiscoveryEnv } from '@mnema/core';
import type { SwitchableChannel } from '../record-framing.js';
import { proposalsToReview } from './decision-review.js';
import { channelsOff } from './switch.js';

/** What the summary rests on. `waiting` is absent outside a project and where the record cannot be read. */
export interface Summary {
  /** Whether there is a project here. */
  readonly founded: boolean;
  /** How many decisions await a judgement, when it could be read. */
  readonly waiting?: number;
  /** The channels that are off on this machine, in the product's order. */
  readonly off: readonly SwitchableChannel[];
}

/** Reads the summary for the project at `ctx.cwd`. */
export function summaryHere(ctx: { readonly cwd: string; readonly env: DiscoveryEnv }): Summary {
  let founded = false;
  let waiting: number | undefined;
  try {
    const read = proposalsToReview(ctx);
    founded = read.ok;
    if (read.ok) waiting = read.proposals.length;
  } catch {
    // The record could not be read: nothing is said about it, and `mnema verify` is where that is said.
  }
  let off: readonly SwitchableChannel[] = [];
  try {
    off = channelsOff(ctx);
  } catch {
    // The switches could not be read: nothing is said of them.
  }
  return { founded, ...(waiting === undefined ? {} : { waiting }), off };
}
