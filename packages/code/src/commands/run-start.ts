/**
 * `mnema run start --which <agent>` — open a session on the command line.
 *
 * A run is the unit of AUTHORIZATION: it records that a human opened a session
 * for an agent, and every fact written inside it inherits that chain. Over MCP
 * the server opens one per connection; on the command line there was no way to
 * open one at all, so an agent driving the CLI produced facts with nothing
 * standing behind them. This is that missing half.
 *
 * The agent is REQUIRED, and that is the whole point rather than a strictness
 * knob: a run with no agent proves no delegation — it is the "run as a
 * correlation id" the design rejected. The surface therefore refuses a blank
 * agent with the core's OWN identity rule ({@link canonicalIdentity}), the same
 * function the operations use to decide whether an agent was named, so the two
 * cannot disagree about what counts as one. (`startRun` would read a blank as
 * "no agent" and happily record a run whose payload names nobody.)
 *
 * It is born in the PRIVATE tree, with no `--scope` to move it: a work session
 * is local by nature, and it is where `focus`/`resume` read from. Outside a
 * project it refuses rather than falling back to the global tree — a run there
 * would be one no CLI read could ever surface, and a session nothing can resume
 * is worse than a refusal.
 */

import { catalogUpcasters } from '@mnema/chain';
import { canonicalIdentity, chainRootForScope, type DiscoveryEnv, resolveTrees } from '@mnema/core';
import { openTreeForWriting, startRun } from '@mnema/core/write';
import { forwardReplacement, type Replacement } from '../recorded-content.js';

/** What the run-start command needs — injected so it is testable. */
export interface RunStartContext {
  /** The working directory to resolve the project from. */
  readonly cwd: string;
  /** The discovery environment (XDG/home). */
  readonly env: DiscoveryEnv;
}

/** A run was opened. */
export interface RunStarted extends Replacement {
  readonly ok: true;
  /** The minted run id — the value callers pin their writes to. */
  readonly id: string;
  /** The agent the session is for, in the canonical form recorded. */
  readonly agent: string;
  /** The goal AS RECORDED — screened, absent when none was stated. */
  readonly goal?: string;
}

/** Opening the run was refused. */
export type RunStartRefused =
  /** There is no project here — a run belongs to a project's private tree. */
  | { readonly ok: false; readonly reason: 'NO_PROJECT' }
  /** The core operation refused, or no agent was named. */
  | {
      readonly ok: false;
      readonly reason: 'REFUSED';
      readonly code: string;
      readonly message: string;
    };

/**
 * Opens a run in the current project's private tree, for the named agent.
 * Refuses `NO_PROJECT` outside a project, `NO_AGENT` when no agent is named, and
 * forwards the core's own refusal otherwise. On success the tree is
 * checkpointed, so the new run is signature-covered at once.
 */
export function runRunStart(
  ctx: RunStartContext,
  input: { agent: string; goal?: string },
): RunStarted | RunStartRefused {
  // The core's rule for "was an agent named", applied before anything is opened:
  // a blank one would reach the chain as a run that names nobody.
  const agent = canonicalIdentity(input.agent);
  if (agent === undefined) {
    return {
      ok: false,
      reason: 'REFUSED',
      code: 'NO_AGENT',
      message: 'a run is a session for an agent — name the one this session is for',
    };
  }

  const trees = resolveTrees(ctx.cwd, ctx.env);
  const root = chainRootForScope(trees, 'private');
  if (root === undefined) {
    return { ok: false, reason: 'NO_PROJECT' };
  }

  const writer = openTreeForWriting(trees, 'private');
  const started = startRun(
    { writer, layout: { root }, upcasters: catalogUpcasters() },
    {
      agent,
      ...(input.goal !== undefined ? { goal: input.goal } : {}),
    },
  );
  if (!started.ok) {
    return { ok: false, reason: 'REFUSED', code: started.code, message: started.message };
  }

  // Checkpoint so the run is signature-covered at once — the same posture every
  // other writing verb leaves the tree in.
  writer.checkpoint();

  return {
    ok: true,
    id: started.id,
    // The label and goal AS RECORDED — screened, so the echo shows what landed.
    agent: started.agent,
    ...(started.goal !== undefined ? { goal: started.goal } : {}),
    ...forwardReplacement(started),
  };
}
