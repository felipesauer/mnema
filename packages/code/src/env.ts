/**
 * Reading the discovery environment off the running process.
 *
 * The core's resolution (`resolveTrees`, the project index) takes an injected
 * {@link DiscoveryEnv} so it stays pure and testable. This is the one place the
 * surface reads the REAL process environment to build that value — a transport
 * concern, not domain logic. A command never touches `process.env` itself; it
 * receives the resolved env, so a test drives it with a sandbox env instead.
 */

import { homedir } from 'node:os';
import type { DiscoveryEnv } from '@mnema/core';

/**
 * Builds the discovery environment from a process environment map (defaulting to
 * this process's), following the same XDG rule the core resolves against:
 * `$XDG_DATA_HOME` when set, and the user's home directory for the fallback.
 */
export function discoveryEnv(processEnv: NodeJS.ProcessEnv = process.env): DiscoveryEnv {
  const xdg = processEnv.XDG_DATA_HOME;
  return {
    home: processEnv.HOME ?? homedir(),
    ...(xdg !== undefined ? { xdgDataHome: xdg } : {}),
  };
}
