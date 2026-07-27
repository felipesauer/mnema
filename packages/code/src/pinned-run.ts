/**
 * The run a command's writes are pinned to, taken from `MNEMA_RUN` — and proven
 * before anything is written.
 *
 * A `run` on an envelope is a claim of AUTHORIZATION: "this fact belongs to the
 * session that human opened for that agent". The MCP surface fills it from the
 * session the server itself opened, so there is nothing to doubt. On the command
 * line it arrives from OUTSIDE, in an environment variable anyone can type — and
 * a fact stamped with a run that does not exist is a broken chain of
 * authorization inside an append-only log, which no later command can retract.
 * So the value is checked against the record, once, before the write.
 *
 * WHY ONCE, HERE, AND NOT IN EVERY OPERATION. Validating per write would mean
 * replaying the run projection on every append — paid on the MCP path too, where
 * the run came from the server's own session and there is nothing to learn. What
 * needs a guard is the value that enters from outside, and it enters once per
 * command. With no variable set this returns before touching the disk at all, so
 * a person who never heard of runs pays nothing.
 *
 * WHICH TREE IT IS PROVEN AGAINST. The PRIVATE tree of the project the command is
 * run in — where runs are born and where `focus`/`resume` read them. The fact
 * being written may land in another tree (a public task, a global memory); the
 * run is still the machine's session in THIS project. A run opened in another
 * project is therefore unknown here, which is the answer that keeps a session
 * from vouching for work in a repository it never saw.
 */

import { catalogUpcasters } from '@mnema/chain';
import {
  canonicalId,
  chainRootForScope,
  type DiscoveryEnv,
  ProjectionCache,
  resolveTrees,
} from '@mnema/core';

/** What resolving a pinned run needs — injected so it is testable. */
export interface PinnedRunContext {
  /** The working directory to resolve the project from. */
  readonly cwd: string;
  /** The discovery environment (XDG/home). */
  readonly env: DiscoveryEnv;
}

/** The pin resolved: the run to stamp, or none when the variable is unset. */
export interface PinnedRunOk {
  readonly ok: true;
  /** The run id to stamp, as the projection stores it; absent when unpinned. */
  readonly run?: string;
}

/** The pin names a run this project cannot vouch for — nothing may be written. */
export interface PinnedRunRefused {
  readonly ok: false;
  /**
   * `UNPROVEN_RUN` — there is no project here to prove the value against;
   * `UNKNOWN_RUN` — no run by that id in this project;
   * `RUN_ENDED` — the session it names is already closed.
   */
  readonly code: 'UNPROVEN_RUN' | 'UNKNOWN_RUN' | 'RUN_ENDED';
  readonly message: string;
}

/** How to open a session, quoted in every refusal so the reader has the way out. */
const HOW_TO_OPEN = 'open one with `mnema run start --which <agent>`, or unset MNEMA_RUN';

/**
 * Resolves the run a write should be pinned to from the raw `MNEMA_RUN` value.
 *
 * An absent, empty or whitespace-only value means UNPINNED — the reading a shell
 * gives `MNEMA_RUN=` (a partial unset), and the same reading `--which ""` gets.
 * It returns immediately, with no tree resolved and no projection replayed.
 *
 * A real value is proven against the project's private tree: it must name a run
 * that EXISTS and is still OPEN. What comes back is the projection's own id — not
 * the text of the variable — so the value stamped on the event is always the key
 * the record knows. Surrounding whitespace is trimmed before the lookup (an id
 * never carries any, and a stray space in an export is not worth a refusal).
 */
export function resolvePinnedRun(
  ctx: PinnedRunContext,
  value: string | undefined,
): PinnedRunOk | PinnedRunRefused {
  const raw = value?.trim();
  if (raw === undefined || raw.length === 0) return { ok: true };

  const trees = resolveTrees(ctx.cwd, ctx.env);
  const root = chainRootForScope(trees, 'private');
  if (root === undefined) {
    return {
      ok: false,
      code: 'UNPROVEN_RUN',
      message:
        `MNEMA_RUN names run "${raw}", but there is no mnema project here to prove it ` +
        'against — a run belongs to the project it was opened in. Work inside that ' +
        'project, or unset MNEMA_RUN',
    };
  }

  const id = canonicalId(raw);
  const cache = ProjectionCache.open(root, { upcasters: catalogUpcasters() });
  cache.rebuild();
  const found = id === undefined ? null : cache.getRun(id);
  if (found === null) {
    return {
      ok: false,
      code: 'UNKNOWN_RUN',
      message: `MNEMA_RUN names run "${raw}", which this project has no record of — ${HOW_TO_OPEN}`,
    };
  }
  if (!found.open) {
    return {
      ok: false,
      code: 'RUN_ENDED',
      message: `MNEMA_RUN names run "${raw}", whose session already ended — ${HOW_TO_OPEN}`,
    };
  }
  return { ok: true, run: found.id };
}
