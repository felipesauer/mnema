/**
 * `mnema run end [<id>] --which <agent> [--outcome <text>]` — close a session on
 * the command line.
 *
 * The other half of {@link runRunStart}, and a leaner adapter: the run already
 * exists, so there is nothing to route — it resolves the same private tree the run
 * was born in and calls one core operation.
 *
 * The agent is REQUIRED, the way it is on the other half, and the reason is what
 * this verb is FOR rather than strictness: `run start`/`run end` are how an agent
 * driving the command line (a script, a CI step, an agent with no MCP server) gets
 * the session an MCP connection is given, and a person acting directly has no run
 * to open or close. Left optional, the close of a session opened `for claude` would
 * be recorded as the person's — which is what it was before, and exactly the
 * fiction naming the executor exists to close. So the refusal is the core's OWN
 * identity rule ({@link canonicalIdentity}), the same function the operation uses
 * to decide whether an agent was named, so the two cannot disagree about what
 * counts as one. (`endRun` would read a blank as "no agent" and record a close that
 * credits nobody.)
 *
 * The refusals are otherwise the core's own and each matters on an append-only log:
 * `UNKNOWN_RUN` (no `run.started` for this id here — including a run opened in
 * ANOTHER project, whose private tree this is not), `ALREADY_ENDED` (closing
 * twice would leave a duplicate nobody can retract) and `WHO_IS_WHICH` (an agent
 * cannot seal a session as the identity that authorized it). None is swallowed: a
 * close that silently does nothing would let a person believe a session was
 * sealed when it is still open.
 *
 * The id is taken as an argument here; where it comes from — the command line or
 * `MNEMA_RUN` — is the transport's business, not this adapter's.
 */

import { catalogUpcasters } from '@mnema/chain';
import { canonicalIdentity, chainRootForScope, type DiscoveryEnv, resolveTrees } from '@mnema/core';
import { endRun, openTreeForWriting } from '@mnema/core/write';
import { forwardReplacement, type Replacement } from '../recorded-content.js';

/** What the run-end command needs — injected so it is testable. */
export interface RunEndContext {
  /** The working directory to resolve the project from. */
  readonly cwd: string;
  /** The discovery environment (XDG/home). */
  readonly env: DiscoveryEnv;
}

/** The run was closed. */
export interface RunEnded extends Replacement {
  readonly ok: true;
  /** The run that was closed. */
  readonly id: string;
  /**
   * The agent AS RECORDED that closed it — screened, so the echo shows what
   * landed rather than what was typed. Absent only when the operation recorded
   * none, which this command's own guard makes unreachable from the CLI.
   */
  readonly agent?: string;
}

/** Closing the run was refused. */
export type RunEndRefused =
  /** There is no project here — a run lives in a project's private tree. */
  | { readonly ok: false; readonly reason: 'NO_PROJECT' }
  /** The core operation refused, or no agent was named. */
  | {
      readonly ok: false;
      readonly reason: 'REFUSED';
      readonly code: string;
      readonly message: string;
    };

/**
 * Closes the given run in the current project's private tree, for the named agent.
 * Refuses `NO_PROJECT` outside a project, `NO_AGENT` when no agent is named, and
 * forwards the core's own refusal otherwise. On success the tree is checkpointed,
 * so the close is signature-covered at once.
 */
export function runRunEnd(
  ctx: RunEndContext,
  input: { run: string; which: string; outcome?: string },
): RunEnded | RunEndRefused {
  // The core's rule for "was an agent named", applied before anything is opened —
  // the same guard, in the same place, as the half that opens the run. A blank one
  // would reach the chain as a close nobody executed, credited to the person.
  const which = canonicalIdentity(input.which);
  if (which === undefined) {
    return {
      ok: false,
      reason: 'REFUSED',
      code: 'NO_AGENT',
      message: 'a run is a session for an agent — name the one closing this session',
    };
  }

  const trees = resolveTrees(ctx.cwd, ctx.env);
  const root = chainRootForScope(trees, 'private');
  if (root === undefined) {
    return { ok: false, reason: 'NO_PROJECT' };
  }

  const writer = openTreeForWriting(trees, 'private');
  const ended = endRun(
    { writer, layout: { root }, upcasters: catalogUpcasters() },
    {
      run: input.run,
      which,
      ...(input.outcome !== undefined ? { outcome: input.outcome } : {}),
    },
  );
  if (!ended.ok) {
    return { ok: false, reason: 'REFUSED', code: ended.code, message: ended.message };
  }

  writer.checkpoint();

  return {
    ok: true,
    id: input.run,
    // The agent AS RECORDED, never as typed: echoing the input would print a
    // credential on the line above the one reporting it was replaced.
    ...(ended.agent !== undefined ? { agent: ended.agent } : {}),
    ...forwardReplacement(ended),
  };
}
