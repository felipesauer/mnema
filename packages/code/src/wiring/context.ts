/**
 * Where a command runs: the working directory and the discovery environment.
 *
 * Every verb resolves the same two values the same way, and it resolves them
 * INSIDE its action rather than when the program is built — a directory read at
 * registration time would be the directory the process started in, which is the
 * same one only by luck (a test that drives two projects in one process would see
 * the first one twice).
 *
 * It is a function and not a constant for exactly that reason.
 */

import type { DiscoveryEnv } from '@mnema/core';
import { discoveryEnv } from '../env.js';

/** What every command adapter takes: where it runs, and what it can discover. */
export interface Here {
  readonly cwd: string;
  readonly env: DiscoveryEnv;
}

/** Reads where this invocation is running, now. */
export function here(): Here {
  return { cwd: process.cwd(), env: discoveryEnv() };
}
