/**
 * The MCP session: the context a connection works inside.
 *
 * The protocol has no session of its own — it carries no session id and no
 * per-connection identity — so mnema mints one. When a client connects, the
 * server opens a session: it resolves which tree to work on (from the client's
 * roots, {@link resolveContext}), reads which agent connected (the client's name,
 * the `which`), and reads the anchor its work is authorized as. It does NOT open a
 * run. The first WRITE opens that, at {@link openWrite}; a connection that only
 * reads leaves nothing behind. When the connection ends, the run is closed if one
 * was ever opened.
 *
 * Connecting used to write, and that is the defect this shape exists to remove.
 * The run opened as soon as the handshake finished, so a client that attached and
 * called nothing still appended two facts — an identity founding and a run — into
 * whichever project the cascade chose on its own. A record is answerable for what
 * it says happened, and a run nobody worked in says a session happened; deferring
 * it to the write it is the authority FOR is what makes the record's silence mean
 * silence. It also fixes the reading a session opens with: "where did I leave off"
 * used to answer with the empty run the asking session had just opened, and now
 * answers with the run the work actually happened in.
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
 * `who` (the authorizing anchor) is the machine's key, decided from the record —
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
import {
  authorizingAnchor,
  endRun,
  openTreeForWriting,
  startRun,
  type WriteContext,
} from '@mnema/core/write';
import { oneLine } from '../served-patterns.js';
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
  /**
   * Where to write diagnostics, if the caller has somewhere to write them.
   * Defaults to discarding them, so a caller with no log (a test, a tool driven
   * directly) needs none.
   */
  readonly log?: ((line: string) => void) | undefined;
}

/**
 * Where a session keeps its run.
 *
 * A CELL and not a value, because the run is the one thing on a session that comes
 * into being AFTER the session does: it opens at the first write and is shared by
 * every write after it. `undefined` is therefore a real state and not a gap — it
 * says this connection has not written yet — and it is the state a read-only
 * session stays in from the handshake to the close.
 */
export interface SessionRun {
  /**
   * The open run's id, or `undefined` while the session has only read.
   *
   * For REPORTING — a log line, an honest answer about what is in flight. Never
   * hand it to a write: a write reaches its run through {@link openWrite}, which
   * opens one when there is none, and its `string | undefined` is what stops it
   * being passed to an operation that needs a run (see {@link openWrite}).
   */
  id: string | undefined;
}

/**
 * A live session: the resolved tree, the agent that connected, the human the
 * work is authorized as, the run once a write has opened one, and the
 * connection's warm caches. The tools read this to reach the right writer/cache
 * and to attribute a capture. Everything on it but {@link Session.caches} and
 * {@link Session.run} is data; the caches are the one live resource a connection
 * holds and the run is the one field that fills in later, and both are held here
 * because their lifetime IS the connection's.
 */
export interface Session {
  /** The trees this session operates on (project scopes absent when global). */
  readonly trees: ResolvedTrees;
  /** Whether the session landed in a project (vs the global tree). */
  readonly inProject: boolean;
  /**
   * The project directory the cascade landed on, absent outside a project — the
   * answer to "where is this session writing", carried so the surface can say it
   * (see {@link ResolvedContext.project}).
   */
  readonly project?: string;
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
   * So what a fact records is what the write REPORTS it recorded, not this — and
   * nothing that leaves mnema (a log line, a reply) may echo this value, because
   * the record and the report would then name two different agents for one session,
   * and one of the two names would be a credential.
   */
  readonly which: string;
  /** The authorizing anchor (the machine's key) — the `who` and the bootstrap actor. */
  readonly who: string;
  /**
   * This session's run — the root of authority its writes pin to, once one of them
   * has opened it. See {@link SessionRun}: reading it asks "has this connection
   * written yet?", and until it has, the answer is `undefined`.
   */
  readonly run: SessionRun;
  /** The discovery environment, carried for reads (e.g. rebuilding the cache). */
  readonly env: DiscoveryEnv;
  /**
   * Where this connection's diagnostics go. It is on the session because the one
   * event worth a line that the server cannot see is the run opening: it happens
   * inside a write, long after the handshake the server logs, and it is the moment
   * a read-only connection became a writing one.
   */
  readonly log: (line: string) => void;
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
 * Opens a session for a connection: resolves the trees, settles the default scope,
 * and reads the anchor this machine authorizes as. It appends NOTHING — no run, no
 * identity founding — so a client that connects and never calls a write leaves the
 * project exactly as it found it. Throws only if the anchor is unanswerable (the
 * record proves this key belongs to two identities, or to one that retired it),
 * which is the one condition under which no honest session exists.
 */
export function openSession(input: OpenSessionInput): Session {
  const { trees, inProject, project } = resolveContext({
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

  // The anchor is DECIDED, not read off the writer. The writer's own anchor is the
  // one its key derives, and that is the wrong answer for a key the record proves
  // another machine enrolled: such a key serves the identity it joined. The
  // decision consults the record and reaches the same answer a write would, which
  // is the whole point — it used to be taken after the run had been appended
  // precisely because founding had settled it, and there is no run to take it after
  // any more. It appends nothing.
  const who = authorizingAnchor(writeContext(trees, scope, caches));

  return {
    trees,
    inProject,
    ...(project !== undefined ? { project } : {}),
    scope,
    which: input.clientName,
    who,
    // Empty: the first write opens the run (see `openWrite`). A session that only
    // reads carries this cell to its close still empty, and that is the honest
    // state rather than a missing one.
    run: { id: undefined },
    env: input.env,
    log: input.log ?? (() => {}),
    caches,
    consulted: new Set<string>(),
  };
}

/** What a write needs from its session: where to append, and what to pin it to. */
export interface SessionWrite {
  /** The write context over the tree the write is going to. */
  readonly ctx: WriteContext;
  /** The session's run id — always present, because reaching here opened one. */
  readonly run: string;
}

/**
 * The door every MCP write goes through: the context to append through, and the
 * run to pin the append to — opening that run first if this is the session's
 * first write.
 *
 * The run opens HERE and nowhere else, and the order inside this function is the
 * reason the door exists. A write's context is built BEFORE the run is needed at
 * every call site, so opening the run at the point of USE — a lazy accessor on the
 * session, read while composing the operation's input — would open a SECOND writer
 * over a tree whose first writer is already alive and holding the head it read.
 * The run's fact would land behind that writer's back, and the write itself would
 * then append with a stale predecessor: the same events, the same count, a chain
 * that no longer verifies. Opening the run before the context exists is what keeps
 * the two writers sequential, and returning the id from here — rather than letting
 * anything read it off the session — is what keeps every write on this path.
 *
 * The run opens in the SESSION's scope, not the write's. A run is the authority for
 * a connection's work, not for one fact, so a session whose first write overrides
 * the scope still opens its run where the session lives.
 */
export function openWrite(session: Session, scope: Scope): SessionWrite {
  // Two statements, in this order, on purpose. Folding them into one object literal
  // would leave a load-bearing ordering to the evaluation order of its properties —
  // which is exactly the kind of thing a tidy-up reorders without knowing it mattered.
  const run = ensureRun(session);
  return { run, ctx: writeContext(session.trees, scope, session.caches) };
}

/**
 * Opens the session's run if it has none, and returns its id.
 *
 * Synchronous from the check to the assignment, and that is a requirement rather
 * than a convenience: `startRun` needs no `await`, so nothing can interleave
 * between reading the empty cell and filling it, and concurrent writes cannot each
 * open a run of their own. An `await` anywhere in here would give every write in
 * flight the same empty cell to fill, and a connection would end up with one run
 * per write, each holding a fragment of one session's work. There is no lock to
 * add: the guarantee is that this function never yields.
 */
function ensureRun(session: Session): string {
  const open = session.run.id;
  if (open !== undefined) return open;

  const ctx = writeContext(session.trees, session.scope, session.caches);
  const started = startRun(ctx, { agent: session.which });
  if (!started.ok) {
    throw new Error(`could not open a session run: ${started.code} — ${started.message}`);
  }
  session.run.id = started.id;
  // The moment a reading connection became a writing one, named with the agent AS
  // RECORDED — the value the operation reports it appended, never the announced one
  // this session carries. This is the only line that may name the agent at all: the
  // handshake has nothing screened to print, and printing the announced name would
  // put a credential in the host's log in a product that replaces one before writing
  // it, and leave the log and the chain naming two different agents for one session.
  // Collapsed to one line, because the log is read one event per line and a name
  // holding a newline would write a second event nothing happened in.
  session.log(`session run ${started.id} opened for which=${oneLine(started.agent)}`);
  return started.id;
}

/**
 * Closes a session's run and releases what the connection held, best-effort. A
 * clean close records the outcome; a refusal (an already-orphaned run, say) is
 * swallowed — a session ending is not a place to fail, and an unclosed run is
 * tolerated (the projection reads it as still open). Returns whether the close
 * was recorded, for the caller to log.
 *
 * A session that never wrote has no run to close, and closing is where that
 * matters most: it is the last chance to write, and a session ending is exactly
 * when "record the end of something" would put a whole run — a founding, a start
 * and an end — into a project the connection only read from. So an empty run cell
 * ends the session by releasing the caches and nothing else, which is what makes
 * the read-only connection leave no trace at all rather than almost none.
 *
 * The caches close in a `finally`: a session that cannot record its own end is
 * exactly the session whose database handles must not be left behind, so the
 * release does not depend on the write succeeding.
 */
export function closeSession(session: Session): boolean {
  const open = session.run.id;
  if (open === undefined) {
    session.caches.closeAll();
    return false;
  }
  try {
    const ctx = writeContext(session.trees, session.scope, session.caches);
    const ended = endRun(ctx, { run: open });
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
 * A session's write does not call this directly — {@link openWrite} does, after
 * opening the run. This stays reachable on its own for the context that belongs to
 * no session: closing a run, and a caller seeding a tree it has no connection to.
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
