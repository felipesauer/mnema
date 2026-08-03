/**
 * The MCP session: the context a connection works inside.
 *
 * The protocol has no session of its own — it carries no session id and no
 * per-connection identity — so mnema mints one. When a client connects, the
 * server opens a session: it resolves which tree to work on (from the client's
 * roots, {@link resolveContext}), learns which OTHER projects the workspace holds
 * (so a write can name one), reads which agent connected (the client's name, the
 * `which`), and reads the anchor its work is authorized as. It does NOT open a
 * run. The first WRITE opens that, at {@link openWrite}; a connection that only
 * reads leaves nothing behind. When the connection ends, every run it opened is
 * closed.
 *
 * Runs are PLURAL because a workspace is. One conversation is regularly work in
 * two or three projects — a product being migrated into its successor, a fix made
 * in one codebase and normalized into two others — and each of those projects has
 * a record of its own. A write says which one it belongs to, and the run it pins
 * to is that project's: a fact in one project citing a run in another leaves the
 * first project's clone unable to resolve its own reference, and leaves the
 * chain's verdict `ok` while it does, which is the one kind of defect the proof
 * does not catch. So the run is per DESTINATION, opened at the first write that
 * lands there ({@link openWrite}) and closed with the connection.
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
 * operations ({@link startRun}, {@link endRun}) over the resolved trees. The
 * decisions it makes are the two the surface owns — WHICH trees (the cascade, plus
 * the other projects a write may name) and the DEFAULT scope a new write lands in
 * (the core's origin rule: an agent connection always carries a `which`, so a
 * project write defaults PRIVATE; outside a project it is the global tree). Both
 * are only defaults: a write tool may override the scope per call (the per-action
 * scope model) and may name the project per call (the same model, one dimension
 * out), so the session fixes where a write goes WHEN THE CALLER DOES NOT SAY, not
 * for every write. It holds no gate and no workflow; those are the core's, reached
 * through the operations.
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
import { resolveContext, type WorkspaceProject } from './context.js';

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
 * A run this connection opened, and the tree it lives in.
 *
 * It carries its own trees and scope rather than only its id, because the run has
 * to be CLOSED and closing it means appending to the tree it was opened in. A
 * connection that wrote to three projects holds three runs, and a close that had
 * to re-derive where each of them lives — from a list of projects, from the
 * session's own trees, from anything but the run itself — is a close that ends the
 * runs it can still find. A run nothing can reach is a run nothing can end, and
 * the record then says a session is still in flight forever.
 */
export interface OpenRun {
  /**
   * The run's id.
   *
   * For REPORTING — a log line, an honest answer about what is in flight. Never
   * hand it to a write: a write reaches its run through {@link openWrite}, which
   * opens one when the destination has none (see {@link openWrite}).
   */
  readonly id: string;
  /** The trees the run lives in — the destination's, not necessarily the session's own. */
  readonly trees: ResolvedTrees;
  /** The scope the run was opened in, within those trees. */
  readonly scope: Scope;
}

/**
 * A project a write can be routed to: where it lands, and the scope it lands in.
 *
 * The destination of a write is an ARGUMENT, never session state, and this is the
 * shape that argument resolves to. Nothing here changes over a connection's life:
 * the workspace is announced once, at the handshake, so a call that names a project
 * is picking out of a fixed list rather than moving something. That is what makes
 * two concurrent writes to two projects correct without a lock — there is no
 * "current project" for one of them to move while the other reads it.
 */
export interface WriteTarget extends WorkspaceProject {
  /**
   * The DEFAULT scope for a write routed here, and the scope its run opens in.
   *
   * The same value for every project of one workspace, and derived once: the origin
   * rule reads the connecting agent, and one connection is one agent. It is stored
   * per target anyway, so that the rule is applied where the session is built
   * instead of re-derived at each write — a second application of it is a second
   * place for it to be applied differently.
   */
  readonly scope: Scope;
}

/**
 * A live session: the resolved tree, the other projects a write may name, the agent
 * that connected, the human the work is authorized as, the runs a write has opened,
 * and the connection's warm caches. The tools read this to reach the right
 * writer/cache and to attribute a capture. Everything on it but
 * {@link Session.caches}, {@link Session.runs} and {@link Session.consulted} is
 * data; the caches are the one live resource a connection holds and the other two
 * are what fills in as it writes, and all three are held here because their
 * lifetime IS the connection's.
 */
export interface Session {
  /**
   * The trees this session's OWN writes go to — the cascade's answer (project
   * scopes absent when it landed on none), and where a write that names no project
   * still lands.
   */
  readonly trees: ResolvedTrees;
  /** Whether the session landed in a project (vs the global tree). */
  readonly inProject: boolean;
  /**
   * The project directory the cascade landed on, absent outside a project — the
   * answer to "where is this session writing", carried so the surface can say it
   * (see {@link ResolvedContext.project}).
   */
  readonly project?: string;
  /**
   * Every project this session can write to OR read from, its own among them — the
   * other half of the answer above (see {@link ResolvedContext.workspaceProjects}),
   * each paired with the scope a write routed there lands in.
   *
   * Read from as well as written to, and the two uses are not symmetric: a WRITE goes
   * to one of these, named per call, because a fact belongs somewhere; a READ KEYED BY
   * AN ID spans all of them at once, with nothing to name, because an id has one home
   * and the question does not know which. So this list is a menu for one and the whole
   * source for the other.
   *
   * Carried on the session because it is settled when the session opens and never
   * changes after: the roots are announced once, at the handshake. A reader that
   * wanted it later would have to re-probe the filesystem to learn something the
   * connection already knew — and a caller naming a project must be matched against
   * what the client announced, not against whatever is on disk by the time it asks.
   *
   * Empty for a session that landed on no project: there is nothing to name, and a
   * write that names something is refused rather than routed at a guess.
   */
  readonly workspaceProjects: readonly WriteTarget[];
  /**
   * The DEFAULT scope a new write routes to in the session's OWN trees (private
   * in-project, else global); a write tool may override it per call, and a write
   * routed to another project takes that project's default instead.
   */
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
   * This session's runs — the roots of authority its writes pin to — one per tree a
   * write has landed in, keyed by that tree's CHAIN ROOT.
   *
   * A MAP and not a value, because a run is the one thing on a session that comes
   * into being after the session does, and there is now one per destination: it
   * opens at the first write that lands in a tree and is shared by every write to
   * that tree after it. An ABSENT key is therefore a real state and not a gap — it
   * says this connection has not written there yet — and an empty map is the state a
   * read-only session stays in from the handshake to the close.
   *
   * Keyed by the chain root rather than by the project, because the chain root is
   * what identifies the tree a run lives in, and two spellings of one project (the
   * cascade's own answer, and the same project named by a caller) resolve to one
   * root. That is what makes naming the project the session is already in open no
   * second run: the key is the same, so the run is the same.
   *
   * Reading it asks "has this connection written there yet?" — see {@link OpenRun}.
   * A write does not read it: it reaches its run through {@link openWrite}.
   */
  readonly runs: Map<string, OpenRun>;
  /**
   * Whether this connection has ENDED — the one field on a session that flips.
   *
   * It exists because closing and serving a call can interleave. A host that
   * disconnects regularly closes the pipe while a request is still in flight, and the
   * close is synchronous: it runs to completion, and the tool's continuation resumes
   * after it. Without this, that continuation appended a fact pinned to the run the
   * close had just ended — measured, in a record that verified `ok`: `run.ended`
   * followed by a fact citing that run, which says work happened inside a session the
   * record says was over.
   *
   * So the close sets it and {@link openWrite} refuses on it. It is not a lock and
   * guards no data race (there is one thread); it is the session's LIFETIME, and a
   * write outside that lifetime has no run it could honestly pin to.
   */
  ended: boolean;
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
   * The skills already recorded as consulted, per RUN — the ids, not the facts,
   * grouped by the chain root of the run they were recorded against. A consultation
   * is recorded ONCE per (run, skill): reading a pattern three times in one run is
   * one run that used it, and three identical facts would inflate the record without
   * adding anything to it.
   *
   * Grouped by run and not by session, because a connection no longer has one run.
   * The invariant this enforces is per-run and always was — the sentence above says
   * so — and one set for the whole session only agreed with it while a session had a
   * single run to dedupe against. With one run per destination, a session-wide set
   * says "already recorded" about a run that recorded nothing, and the caller is
   * told `ok`: a fact this exists to capture, dropped where nothing would ever show
   * it was missing. Enforcing the invariant with a structure shaped like it is what
   * keeps that from depending on which destinations a consultation can reach today.
   *
   * Keyed by the run's chain root, the same key {@link Session.runs} uses, because
   * that key exists BEFORE the run does: this decides whether to write at all, and a
   * call that turns out to have nothing to record must not have opened a run to find
   * that out. Within one connection a tree holds at most one of its runs, so the root
   * names the run exactly.
   *
   * It lives in memory, and that is sufficient rather than a shortcut: the scope of
   * the deduplication is exactly the run, and every run here dies with this session.
   * Asking the chain "did I already record this?" would replay it to learn something
   * process memory already knows.
   */
  readonly consulted: Map<string, Set<string>>;
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
  const { trees, inProject, project, workspaceProjects } = resolveContext({
    env: input.env,
    ...(input.configProject !== undefined ? { configProject: input.configProject } : {}),
    ...(input.roots !== undefined ? { roots: input.roots } : {}),
  });

  // The DEFAULT scope for a new write, inside a project. The connection is an agent
  // (a `which` is always present), so the origin rule defaults its writes PRIVATE —
  // the machine's auto-memory, not the team's git. Applied ONCE and read twice, by
  // the session's own default below and by every project a write can be routed to:
  // the rule reads the agent, and one connection is one agent, so a second
  // application of it could only differ by being wrong.
  const projectScope = resolveScope({ which: input.clientName });
  // Outside a project there is no public/private to distinguish; it is the global
  // tree. A write tool may override this per call; this is only where a write goes
  // when the caller does not say.
  const scope: Scope = inProject ? projectScope : 'global';

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
    workspaceProjects: workspaceProjects.map((known) => ({ ...known, scope: projectScope })),
    scope,
    which: input.clientName,
    who,
    // Empty: the first write to a tree opens that tree's run (see `openWrite`). A
    // session that only reads carries this map to its close still empty, and that is
    // the honest state rather than a missing one.
    runs: new Map<string, OpenRun>(),
    ended: false,
    env: input.env,
    log: input.log ?? (() => {}),
    caches,
    consulted: new Map<string, Set<string>>(),
  };
}

/** What a write needs from its session: where to append, and what to pin it to. */
export interface SessionWrite {
  /** The write context over the tree the write is going to. */
  readonly ctx: WriteContext;
  /**
   * The run to pin the append to — the one open in the DESTINATION, always present
   * because reaching here opened it. It is the destination's own, so the fact and
   * the run it cites are in the same project's record, and a clone of that project
   * resolves the reference without the others.
   */
  readonly run: string;
}

/**
 * The door every MCP write goes through: the context to append through, and the
 * run to pin the append to — opening that run first if this is the first write to
 * where it is going.
 *
 * The DESTINATION is the `target` argument: the project a caller named, or the
 * session's own trees when it named none. It is an argument and never session
 * state, and that is what makes routing correct by construction rather than by
 * discipline — with nothing to move, two writes to two projects cannot see each
 * other half-moved, and a write that arrives during another cannot be redirected by
 * it. The scope is the argument beside it: which of the destination's trees.
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
 * The run opens in the DESTINATION's default scope, not the write's. A run is the
 * authority for a connection's work in a project, not for one fact, so a write that
 * overrides the scope still opens its run where that project's work lives.
 *
 * A write that arrives after the connection ENDED is refused here, before anything is
 * touched — see {@link Session.ended}. This is the first thing the door checks,
 * because building the context is itself a write (it ensures the project's
 * `.gitignore` and marks the cache stale) and the run it would pin to has just been
 * closed.
 */
export function openWrite(session: Session, scope: Scope, target?: WriteTarget): SessionWrite {
  // Before anything: a fact cites the run that authorizes it, and this connection's
  // runs are ended. Landing anyway would put work inside a session the record says
  // was already over — the shape a close and an in-flight call produce together.
  if (session.ended) {
    throw new Error(
      'this connection has ended; its session runs are closed and nothing more can be pinned to them',
    );
  }
  // The session's own trees when no project was named — which is the cascade's
  // answer, unchanged, and the whole of the non-regression: a call that says nothing
  // lands exactly where it landed before this parameter existed.
  const trees = target?.trees ?? session.trees;
  // Two statements, in this order, on purpose. Folding them into one object literal
  // would leave a load-bearing ordering to the evaluation order of its properties —
  // which is exactly the kind of thing a tidy-up reorders without knowing it mattered.
  const run = ensureRun(session, trees, target?.scope ?? session.scope);
  return { run, ctx: writeContext(trees, scope, session.caches) };
}

/**
 * Opens the run for a destination if it has none, and returns its id.
 *
 * Synchronous from the check to the assignment, and that is a requirement rather
 * than a convenience: `startRun` needs no `await`, so nothing can interleave
 * between reading the empty entry and filling it, and concurrent writes to one tree
 * cannot each open a run of their own. An `await` anywhere in here would give every
 * write in flight to that tree the same empty entry to fill, and a connection would
 * end up with one run per write, each holding a fragment of one project's work.
 * There is no lock to add: the guarantee is that this function never yields.
 *
 * Concurrent writes to DIFFERENT trees do each open a run, and that is the point
 * rather than the same defect at a larger grain: they are different projects'
 * records, and one run cannot be the authority in a tree it is not written in.
 */
function ensureRun(session: Session, trees: ResolvedTrees, scope: Scope): string {
  // The key exists before the run does, and identifies the tree the run will live
  // in. An absent tree has no root to key by; `writeContext` below is what refuses
  // it, so the honest error still comes from one place — and it throws before the
  // map is ever asked to hold a key that is not a chain root.
  const root = chainRootForScope(trees, scope) as string;
  const open = session.runs.get(root);
  if (open !== undefined) return open.id;

  const ctx = writeContext(trees, scope, session.caches);
  const started = startRun(ctx, { agent: session.which });
  if (!started.ok) {
    throw new Error(`could not open a session run: ${started.code} — ${started.message}`);
  }
  session.runs.set(root, { id: started.id, trees, scope });
  // The moment a reading connection became a writing one — in this tree, which the
  // line names, because a connection now opens a run per project it writes to and a
  // line that named only the run would leave a reader counting runs with no way to
  // tell which project each belongs to. Named with the agent AS RECORDED — the value
  // the operation reports it appended, never the announced one this session carries.
  // This is the only line that may name the agent at all: the handshake has nothing
  // screened to print, and printing the announced name would put a credential in the
  // host's log in a product that replaces one before writing it, and leave the log
  // and the chain naming two different agents for one session. Collapsed to one
  // line, because the log is read one event per line and a name — or a chain root —
  // holding a newline would write a second event nothing happened in.
  session.log(oneLine(`session run ${started.id} opened in ${root} for which=${started.agent}`));
  return started.id;
}

/** What a close recorded, and what it could not: every run the connection opened. */
export interface SessionClose {
  /** The runs whose end was recorded, in the order they were opened. */
  readonly closed: readonly string[];
  /**
   * The runs this close could not end — tolerated, and NAMED so the log can say
   * which. A run reported neither closed nor left open would be a run nothing
   * accounts for, which is the state the projection reads as work still in flight.
   */
  readonly leftOpen: readonly string[];
}

/**
 * Closes EVERY run this session opened and releases what the connection held,
 * best-effort. A clean close records the outcome; a refusal (an already-orphaned
 * run, say) is swallowed — a session ending is not a place to fail, and an unclosed
 * run is tolerated (the projection reads it as still open). Returns what it recorded
 * and what it did not, for the caller to log.
 *
 * Every run, and each one on its own attempt: a connection that wrote to three
 * projects opened three runs, and the two that CAN be ended must be ended even when
 * the first refuses or throws. A close that stopped at the first failure would leave
 * runs open in projects whose records are perfectly fine, and nothing afterwards
 * would ever come back to them — this connection is the only party that knows those
 * runs are its own.
 *
 * A session that never wrote has no run to close, and closing is where that
 * matters most: it is the last chance to write, and a session ending is exactly
 * when "record the end of something" would put a whole run — a founding, a start
 * and an end — into a project the connection only read from. So an empty run map
 * ends the session by releasing the caches and nothing else, which is what makes
 * the read-only connection leave no trace at all rather than almost none.
 *
 * The caches close in a `finally`: a session that cannot record its own end is
 * exactly the session whose database handles must not be left behind, so the
 * release does not depend on the writes succeeding.
 */
export function closeSession(session: Session): SessionClose {
  const closed: string[] = [];
  const leftOpen: string[] = [];
  // FIRST, before a single `run.ended` is appended: from here on this session has no
  // run a write could honestly pin to, and a call already in flight resumes after this
  // function returns (see {@link Session.ended}). Set even if the closes below fail —
  // a run this could not end is still not a run this connection may keep writing to.
  session.ended = true;
  try {
    // Each run reached through what it carries — its own trees and scope — never
    // through the session's. The session's trees are one destination of the several
    // a connection may have written to, and a close that assumed them would append
    // every `run.ended` into that one tree: the run of another project ended in a
    // record that never started it, and that project's own run still open.
    for (const run of session.runs.values()) {
      try {
        const ctx = writeContext(run.trees, run.scope, session.caches);
        // Closed BY the agent that connected — the same `which` every fact of this
        // session carries, and the same one the run was opened for, because on this
        // surface the connection is both. Taken from the session rather than asked
        // of the client: it is already in hand, and a close whose executor came from
        // the wire could name an agent other than the one that did the work.
        const ended = endRun(ctx, { run: run.id, which: session.which });
        (ended.ok ? closed : leftOpen).push(run.id);
      } catch {
        leftOpen.push(run.id);
      }
    }
  } finally {
    session.caches.closeAll();
  }
  return { closed, leftOpen };
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
