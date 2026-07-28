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
 *
 * The session also owns the connection's warm projection caches
 * ({@link CacheRegistry}). A cache is per-CONNECTION state exactly as the run
 * is — it lives as long as the client is attached and is thrown away with it —
 * so this is where it belongs. It is retained here for one reason: the server
 * does not exit between calls, and re-replaying the chain on every read was the
 * agent's largest cost. The invalidation that keeps it honest lives in
 * {@link writeContext}, the single door every MCP write goes through.
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
import { type CacheRegistry, createCacheRegistry } from './cache-registry.js';
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
 * work is authorized as, the open run, and the connection's warm caches. The
 * tools read this to reach the right writer/cache and to attribute a capture.
 * Everything on it but {@link Session.caches} is data; the caches are the one
 * live resource a connection holds, and they are held here because their
 * lifetime IS the connection's.
 */
export interface Session {
  /** The trees this session operates on (project scopes absent when global). */
  readonly trees: ResolvedTrees;
  /** Whether the session landed in a project (vs the global tree). */
  readonly inProject: boolean;
  /** The DEFAULT scope a new write routes to (private in-project, else global); a write tool may override it per call. */
  readonly scope: Scope;
  /**
   * The connecting agent as the client ANNOUNCED it (`clientInfo.name`) — the
   * value handed to every write, where the content door screens it.
   *
   * It is deliberately the announced name and not the screened one. If the
   * announced name holds a credential, the door replaces it and REPORTS what it
   * replaced, and that report is the only way the agent learns its own name
   * carried one — the handshake has no channel to say so. Screening once here and
   * storing the clean value would record exactly the same facts and tell nobody.
   * So what a fact records is {@link Session.recordedWhich}, not this.
   */
  readonly which: string;
  /**
   * The same agent AS RECORDED: the screened label the run's own fact carries.
   *
   * For ECHO only — a log line, a reply. What a reader is shown has to be what
   * the chain holds, or the record and the report disagree about who acted, which
   * in a product built to answer that question is the defect and not the detail.
   * Never hand it to a write: the door has to see the announced value to report
   * what it took out.
   */
  readonly recordedWhich: string;
  /** The authorizing anchor (the machine's key) — the `who` and the bootstrap actor. */
  readonly who: string;
  /** The open run's id — the root of authority the tools pin their writes to. */
  readonly runId: string;
  /** The discovery environment, carried for reads (e.g. rebuilding the cache). */
  readonly env: DiscoveryEnv;
  /**
   * The connection's projection caches, one per tree it has read. Every read
   * tool asks this instead of opening its own, so the chain is replayed when a
   * write made it necessary and not once per call.
   */
  readonly caches: CacheRegistry;
  /**
   * The skills already recorded as consulted in this run — the ids, not the
   * facts. A consultation is recorded ONCE per (run, skill): reading a pattern
   * three times in one session is one session that used it, and three identical
   * facts would inflate the record without adding anything to it.
   *
   * It lives in memory, and that is sufficient rather than a shortcut: the scope
   * of the deduplication is exactly the run, and the run dies with this session.
   * Asking the chain "did I already record this?" would replay it to learn
   * something process memory already knows.
   */
  readonly consulted: Set<string>;
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

  // The caches are created BEFORE the first write so that write invalidates
  // through the same door as every later one — there is no window in which a
  // write happens with no registry to tell.
  const caches = createCacheRegistry();
  const ctx = writeContext(trees, scope, caches);

  const started = startRun(ctx, { agent: input.clientName });
  if (!started.ok) {
    throw new Error(`could not open a session run: ${started.code} — ${started.message}`);
  }
  // Read AFTER the run is recorded, never before. The first write to a tree is
  // what settles which identity this machine serves there — its own, or one the
  // record proves its key joined — and only then is the answer on disk. Reading
  // first would hand the session an identity that the very next write corrects.
  const who = ctx.writer.anchor;

  return {
    trees,
    inProject,
    scope,
    which: input.clientName,
    // The label the run's fact HOLDS, reported by the operation that wrote it —
    // the same value the CLI echoes after `run start`. Taking it from the write
    // rather than screening it again here is what keeps the door the only screen.
    recordedWhich: started.agent,
    who,
    runId: started.id,
    env: input.env,
    caches,
    consulted: new Set<string>(),
  };
}

/**
 * Closes a session's run and releases what the connection held, best-effort. A
 * clean close records the outcome; a refusal (an already-orphaned run, say) is
 * swallowed — a session ending is not a place to fail, and an unclosed run is
 * tolerated (the projection reads it as still open). Returns whether the close
 * was recorded, for the caller to log.
 *
 * The caches close in a `finally`: a session that cannot record its own end is
 * exactly the session whose database handles must not be left behind, so the
 * release does not depend on the write succeeding.
 */
export function closeSession(session: Session): boolean {
  try {
    const ctx = writeContext(session.trees, session.scope, session.caches);
    const ended = endRun(ctx, { run: session.runId });
    return ended.ok;
  } catch {
    return false;
  } finally {
    session.caches.closeAll();
  }
}

/**
 * Builds a write context for a session's tree and scope — the same shape the
 * CLI commands build: the scope's writer, its chain layout, and the catalog's
 * upcasters. Opening the writer ensures the project's `.gitignore` is in place
 * before any write (the core's own hygiene).
 *
 * This is also where the session's warm caches learn they are behind. Every MCP
 * write reaches the chain through a context built here, so invalidating the
 * written tree's cache at this one door is what makes the reuse safe: no tool
 * has to remember, and a write operation added later inherits the invalidation
 * by construction. The registry is a required argument for that reason — an
 * optional one would let a caller build a write context that silently skips it.
 *
 * The mark goes up BEFORE the writer is opened. Opening a tree already touches
 * disk (it ensures the project's `.gitignore`, and a first write founds the
 * identity), and a context is built to write — so the cache is treated as
 * behind from the moment the intent exists. Marking a tree that then fails to
 * open costs one replay; marking it after a write that already landed would
 * cost correctness.
 */
export function writeContext(
  trees: ResolvedTrees,
  scope: Scope,
  caches: CacheRegistry,
): WriteContext {
  const root = chainRootForScope(trees, scope);
  // An absent tree has no cache to invalidate; `openTreeForWriting` below is
  // what refuses it, so the honest error still comes from one place.
  if (root !== undefined) caches.invalidate(root);
  return {
    writer: openTreeForWriting(trees, scope),
    layout: { root: root as string },
    upcasters: catalogUpcasters(),
  };
}
