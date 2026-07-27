/**
 * `mnema run end [<id>] [--outcome <text>]` — close a session on the command line.
 *
 * The other half of {@link runRunStart}, and a leaner adapter: the run already
 * exists, so there is nothing to route and nothing to name — it resolves the same
 * private tree the run was born in and calls one core operation.
 *
 * The refusals are the core's own and both matter on an append-only log:
 * `UNKNOWN_RUN` (no `run.started` for this id here — including a run opened in
 * ANOTHER project, whose private tree this is not) and `ALREADY_ENDED` (closing
 * twice would leave a duplicate nobody can retract). Neither is swallowed: a
 * close that silently does nothing would let a person believe a session was
 * sealed when it is still open.
 *
 * The id is taken as an argument here; where it comes from — the command line or
 * `MNEMA_RUN` — is the transport's business, not this adapter's.
 */

import { catalogUpcasters } from '@mnema/chain';
import { chainRootForScope, type DiscoveryEnv, resolveTrees } from '@mnema/core';
import { endRun, openTreeForWriting } from '@mnema/core/write';

/** What the run-end command needs — injected so it is testable. */
export interface RunEndContext {
  /** The working directory to resolve the project from. */
  readonly cwd: string;
  /** The discovery environment (XDG/home). */
  readonly env: DiscoveryEnv;
}

/** The run was closed. */
export interface RunEnded {
  readonly ok: true;
  /** The run that was closed. */
  readonly id: string;
}

/** Closing the run was refused. */
export type RunEndRefused =
  /** There is no project here — a run lives in a project's private tree. */
  | { readonly ok: false; readonly reason: 'NO_PROJECT' }
  /** The core operation refused (`UNKNOWN_RUN`, `ALREADY_ENDED`). */
  | {
      readonly ok: false;
      readonly reason: 'REFUSED';
      readonly code: string;
      readonly message: string;
    };

/**
 * Closes the given run in the current project's private tree. Refuses
 * `NO_PROJECT` outside a project and forwards the core's own refusal otherwise.
 * On success the tree is checkpointed, so the close is signature-covered at once.
 */
export function runRunEnd(
  ctx: RunEndContext,
  input: { run: string; outcome?: string },
): RunEnded | RunEndRefused {
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
      ...(input.outcome !== undefined ? { outcome: input.outcome } : {}),
    },
  );
  if (!ended.ok) {
    return { ok: false, reason: 'REFUSED', code: ended.code, message: ended.message };
  }

  writer.checkpoint();

  return { ok: true, id: input.run };
}
