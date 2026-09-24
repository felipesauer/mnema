/**
 * Reading the discovery environment off the running process.
 *
 * The core's resolution (`resolveTrees`) takes an injected {@link DiscoveryEnv} so
 * it stays pure and testable. This is the one place the surface reads the REAL
 * process environment to build that value — a transport concern, not domain logic.
 * A command never touches `process.env` itself; it receives the resolved env, so a
 * test drives it with a sandbox env instead.
 */

import { homedir, userInfo } from 'node:os';
import type { DiscoveryEnv } from '@mnema/core';

/**
 * Builds the discovery environment from a process environment map (defaulting to this
 * process's): `$HOME`, `$MNEMA_HOME` when it is set, and the account's home from the password
 * database. What each of them decides is the core's (`resolve.ts`): the walk stops at `$HOME`,
 * the data directory is `$MNEMA_HOME` or `~/.mnema`, and the account's home is where that goes
 * when `$HOME` names no directory.
 *
 * `$XDG_DATA_HOME` is NOT read, and that is a reversal: it used to decide where the key root
 * lived, which made the key that signs a fact depend on which program had launched the process
 * (`appDataDir` in `resolve.ts` has the measurement). `the-key-lives-in-one-place.test.ts` runs
 * the binary under two of them and counts one author.
 *
 * The account's home is read here and not left to `os.homedir()` in the core, for the two
 * things this module is for: the core stays pure, and a case can hand it a sandbox. It is read
 * every time, because asking the password database is cheaper than being wrong about whether it
 * will be needed; a system with no entry for the account answers nothing, and the core says so
 * when that is the only home there was.
 */
export function discoveryEnv(processEnv: NodeJS.ProcessEnv = process.env): DiscoveryEnv {
  const relocated = processEnv.MNEMA_HOME;
  const account = accountHome();
  return {
    home: processEnv.HOME ?? homedir(),
    ...(relocated !== undefined ? { mnemaHome: relocated } : {}),
    ...(account !== undefined ? { accountHome: account } : {}),
  };
}

/** The account's home from the password database, or undefined where it has none. */
function accountHome(): string | undefined {
  try {
    return userInfo().homedir;
  } catch {
    return undefined;
  }
}
