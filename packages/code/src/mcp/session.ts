/**
 * The MCP session: the context a connection works inside.
 *
 * The protocol has no session of its own — it carries no session id and no
 * per-connection identity — so mnema mints one. When a client connects, the
 * server opens a session: it resolves which tree to work on (from the client's
 * roots, {@link resolveContext}), reads which agent connected (the client's
 * name, the `which`), and opens a run — the root of authority for everything
 * the connection does. When the connection ends, it closes that run.
 *
 * This is the session ADAPTER, not domain logic: it composes the core's own
 * operations ({@link startRun}, {@link endRun}) over the resolved tree. The
 * decisions it makes are the two the surface owns — WHICH tree (the cascade)
 * and the DEFAULT scope a new write lands in (the core's origin rule: an agent
 * connection always carries a `which`, so a project write defaults PRIVATE;
 * outside a project it is the global tree). That scope is only the default: a
 * write tool may override it per call (the per-action scope model), so the
 * session fixes where a write goes WHEN THE CALLER DOES NOT SAY, not for every
 * write. It holds no gate and no workflow; those are the core's, reached through
 * the operations.
 *
 * `who` (the authorizing anchor) is the machine's key, read off the writer —
 * never the client. `which` is the client's name. who != which is trivially
 * true (an anchor hash is never an agent name), and `startRun` checks it anyway.
 */

import { catalogUpcasters } from '@mnema/chain';
import {
  chainRootForScope,
  type DiscoveryEnv,
  type ResolvedTrees,
  resolveScope,
  type Scope,
} from '@mnema/core';
import { endRun, openTreeForWriting, startRun, type WriteContext } from '@mnema/core/write';
import { resolveContext } from './context.js';

/** What the server hands the session opener from the handshake. */
export interface OpenSessionInput {
  /** The connecting client's name (`clientInfo.name`) — the session's `which`. */
  readonly clientName: string;
  /** The client's workspace roots as `file://` URIs, if it exposed any. */
  readonly roots?: readonly string[] | undefined;
  /** An explicit project directory the server was configured with, if any. */
  readonly configProject?: string | undefined;
  /** The discovery environment (XDG/home). */
  readonly env: DiscoveryEnv;
}

/**
 * A live session: the resolved tree, the agent that connected, the human the
 * work is authorized as, and the open run. The tools read this to open the
 * right writer/cache and to attribute a capture. It is data, not behavior — the
 * tools do the work.
 */
export interface Session {
  /** The trees this session operates on (project scopes absent when global). */
  readonly trees: ResolvedTrees;
  /** Whether the session landed in a project (vs the global tree). */
  readonly inProject: boolean;
  /** The DEFAULT scope a new write routes to (private in-project, else global); a write tool may override it per call. */
  readonly scope: Scope;
  /** The connecting agent (the `which` stamped on this session's events). */
  readonly which: string;
  /** The authorizing anchor (the machine's key) — the `who` and the bootstrap actor. */
  readonly who: string;
  /** The open run's id — the root of authority the tools pin their writes to. */
  readonly runId: string;
  /** The discovery environment, carried for reads (e.g. rebuilding the cache). */
  readonly env: DiscoveryEnv;
}

/**
 * Opens a session for a connection: resolves the tree, opens its writer, and
 * starts a run authored by the machine's anchor for the connecting agent. The
 * run's id and the anchor (`who`) are captured so the tools reuse them without
 * reopening the writer just to read the anchor. Throws only if starting the run
 * is refused — which for a real client cannot happen (who != which holds by
 * construction), but is surfaced honestly rather than swallowed.
 */
export function openSession(input: OpenSessionInput): Session {
  const { trees, inProject } = resolveContext({
    env: input.env,
    ...(input.configProject !== undefined ? { configProject: input.configProject } : {}),
    ...(input.roots !== undefined ? { roots: input.roots } : {}),
  });

  // The session's DEFAULT scope for new writes. In a project the connection is
  // an agent (a `which` is always present), so the origin rule defaults its
  // writes PRIVATE — the machine's auto-memory, not the team's git. Outside a
  // project there is no public/private to distinguish; it is the global tree. A
  // write tool may override this per call; this is only where a write goes when
  // the caller does not say.
  const scope: Scope = inProject ? resolveScope({ which: input.clientName }) : 'global';

  const ctx = writeContext(trees, scope);
  const who = ctx.writer.anchor;

  const started = startRun(ctx, { agent: input.clientName });
  if (!started.ok) {
    throw new Error(`could not open a session run: ${started.code} — ${started.message}`);
  }

  return {
    trees,
    inProject,
    scope,
    which: input.clientName,
    who,
    runId: started.id,
    env: input.env,
  };
}

/**
 * Closes a session's run, best-effort. A clean close records the outcome; a
 * refusal (an already-orphaned run, say) is swallowed — a session ending is not
 * a place to fail, and an unclosed run is tolerated (the projection reads it as
 * still open). Returns whether the close was recorded, for the caller to log.
 */
export function closeSession(session: Session): boolean {
  try {
    const ctx = writeContext(session.trees, session.scope);
    const ended = endRun(ctx, { run: session.runId });
    return ended.ok;
  } catch {
    return false;
  }
}

/**
 * Builds a write context for a session's tree and scope — the same shape the
 * CLI commands build: the scope's writer, its chain layout, and the catalog's
 * upcasters. Opening the writer ensures the project's `.gitignore` is in place
 * before any write (the core's own hygiene).
 */
export function writeContext(trees: ResolvedTrees, scope: Scope): WriteContext {
  return {
    writer: openTreeForWriting(trees, scope),
    layout: { root: chainRootForScope(trees, scope) as string },
    upcasters: catalogUpcasters(),
  };
}
