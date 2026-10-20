/**
 * Where a command runs: the working directory and the discovery environment.
 *
 * Every verb resolves the same two values the same way, and it resolves them
 * INSIDE its action rather than when the program is built: a directory read at
 * registration time would be the directory the process started in, which is the
 * same one only by luck (a test that drives two projects in one process would see
 * the first one twice).
 *
 * It is a function and not a constant for exactly that reason.
 */

import type { DiscoveryEnv } from '@mnema/core';
import { agentKeyFromEnvironment, discoveryEnv } from '../env.js';
import { fact } from '../presentation/detail.js';
import type { Wiring } from './verb.js';

/** What every command adapter takes: where it runs, what it can discover, and the agent asked for. */
export interface Here {
  readonly cwd: string;
  readonly env: DiscoveryEnv;
  /**
   * The agent `MNEMA_AGENT_KEY` names, read here and never in a verb. It is the verbs that write a
   * fact an agent's key may sign that take it (see `write-as-the-agent.ts`); the others do not look.
   */
  readonly agentKey?: string;
}

/** Reads where this invocation is running, now. */
export function here(): Here {
  const agentKey = agentKeyFromEnvironment(process.env);
  return {
    cwd: process.cwd(),
    env: discoveryEnv(),
    ...(agentKey !== undefined ? { agentKey } : {}),
  };
}

/** Where a verb that writes runs, and the second stream it may speak on. */
export interface HereWriting extends Here {
  readonly say: (line: string) => void;
}

/** {@link here} for a verb that writes as an agent: what it has to tell goes to the error stream. */
export function hereWriting({ io, render }: Pick<Wiring, 'io' | 'render'>): HereWriting {
  return { ...here(), say: (line) => io.err(render(fact(line, 0))) };
}
