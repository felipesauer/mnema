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
 * Runs are PLURAL because a record is. One conversation is regularly work in two or
 * three projects — a product being migrated into its successor, a fix made in one
 * codebase and normalized into two others — and it is regularly work of two KINDS
 * inside one project, which land in two different trees. Either way the run a fact
 * pins to is the one in ITS OWN tree: a fact citing a run somewhere else leaves a
 * clone of its record unable to resolve its own reference, and leaves the chain's
 * verdict `ok` while it does, which is the one kind of defect the proof does not
 * catch. So the run is per TREE, opened at the first write that lands there
 * ({@link openWrite}) and closed with the connection.
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
 * operations ({@link startRun}, {@link endRun}) over the resolved trees. The one
 * decision it makes is WHICH trees — the cascade, plus the other projects a write may
 * name. It no longer holds a default SCOPE, and that field's absence is load-bearing:
 * the tree a write lands in follows what the write IS, and the kind exists at the
 * tool, not at the handshake. A per-session default was therefore a default settled
 * before anything was known about what it would route, and it routed a project's
 * decisions into the one tree that never leaves the machine. Where a write goes is
 * now decided per call, from the kind and the caller's own override
 * ({@link routeWrite}). It holds no gate and no workflow; those are the core's,
 * reached through the operations.
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
  agentSignsIn,
  chainRootForScope,
  type DiscoveryEnv,
  IdentityUnavailableError,
  keyChoiceIn,
  type PassedOverTree,
  type ReplacedClass,
  type ResolvedTrees,
  reachableTrees,
  type Scope,
  treeWords,
  withAgentKey,
} from '@mnema/core';
import {
  authorizingAnchor,
  endRun,
  openTreeForWriting,
  prepareRun,
  signerHeldFor,
  type WriteContext,
} from '@mnema/core/write';
import { FoundingWatch } from '../a-new-identity.js';
import { oneLine } from '../one-line.js';
import { replacementNotice } from '../recorded-content.js';
import { type CacheRegistry, createCacheRegistry } from './cache-registry.js';
import {
  type ClientWorkspace,
  type ContextInput,
  type Rung,
  resolveContext,
  type WorkspaceProject,
} from './context.js';

/**
 * What the server hands the session opener from the handshake: who connected, and what
 * the client said about its workspace — the roots it listed, or, for a client that
 * declared no `roots` capability, the directory the host started the server in (see
 * {@link ClientWorkspace}).
 */
export type OpenSessionInput = ClientWorkspace & {
  /** The connecting client's name (`clientInfo.name`) — the session's `which`. */
  readonly clientName: string;
  /** An explicit project directory the server was configured with, if any. */
  readonly configProject?: string | undefined;
  /**
   * The agent this server signs as where the record enrols its key — the name of the folder its
   * key lives in under the data directory (`mnema mcp --agent-key`). Absent, the server signs
   * with the person's key and the session's `which` is what the client announced.
   */
  readonly agentKey?: string | undefined;
  /** The discovery environment (`$HOME`, `$MNEMA_HOME`). */
  readonly env: DiscoveryEnv;
  /**
   * Where to write diagnostics, if the caller has somewhere to write them.
   * Defaults to discarding them, so a caller with no log (a test, a tool driven
   * directly) needs none.
   */
  readonly log?: ((line: string) => void) | undefined;
};

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
 * A project a write can be routed to.
 *
 * The destination of a write is an ARGUMENT, never session state, and this is the
 * shape that argument resolves to: a call that names a project is picking out of a
 * list rather than moving something. That is what makes two concurrent writes to two
 * projects correct without a lock — there is no "current project" for one of them to
 * move while the other reads it.
 *
 * THE LIST IS NO LONGER FIXED, and the sentence here used to rest on its being so
 * (*"the workspace is announced once, at the handshake"*). It is re-read whenever the
 * client says the workspace changed ({@link refreshWorkspace}), which falsified that.
 * What holds the argument up instead is that the list only ever GROWS and that every
 * tool adapter is synchronous: a re-read runs between calls and never inside one, so
 * no call ever sees two lists, and a name that resolved before a re-read resolves to
 * the same project after it. `tests/the-session-learns-where-it-is.test.ts` asserts
 * both halves.
 *
 * It carries NO scope, and losing that field is the point rather than a tidy-up. A
 * destination used to hold the default tree for writes routed to it, settled at the
 * handshake from the connecting agent — a default that could not know what it was
 * routing, since the kind only exists at the tool. Now the tree comes from the kind
 * and the caller's override ({@link routeWrite}), so a project is a place and nothing
 * more, and there is no per-project copy of a rule to fall out of step.
 */
export type WriteTarget = WorkspaceProject;

/**
 * A live session: the resolved tree, the other projects a write may name, the agent
 * that connected, the human the work is authorized as, the runs a write has opened,
 * and the connection's warm caches. The tools read this to reach the right
 * writer/cache and to attribute a capture. Everything on it but
 * {@link Session.caches}, {@link Session.runs}, {@link Session.consulted} and
 * {@link Session.served} is data; the caches are the one live resource a connection
 * holds and the other three are what fills in as it writes, and all four are held here
 * because their lifetime IS the connection's.
 */
export interface Session {
  /**
   * The trees this session's OWN writes go to — the cascade's answer (project
   * scopes absent when it landed on none), and where a write that names no project
   * still lands.
   *
   * MUTABLE, and it is the second field on a session that moves (after
   * {@link Session.ended}). The workspace a client announces is not settled at the
   * handshake: the protocol has `notifications/roots/list_changed` for exactly the
   * case where it grows, and until this slice the server did not listen — so a
   * connection whose workspace gained a project went on being served, and WRITING,
   * out of the record it resolved once. It moves through one function
   * ({@link refreshWorkspace}) and nowhere else.
   */
  trees: ResolvedTrees;
  /** Whether the session landed in a project (vs the global tree) — see {@link Session.trees}. */
  inProject: boolean;
  /**
   * The rung of the cascade the landing came from (see {@link Rung}) — moved, with the
   * trees, by {@link refreshWorkspace} and by nothing else.
   */
  rung: Rung;
  /**
   * The project directory the cascade landed on, absent outside a project — the
   * answer to "where is this session writing", carried so the surface can say it
   * (see {@link ResolvedContext.project}).
   *
   * It can be FILLED IN by a re-read and never emptied or replaced, and that is a
   * property of the union {@link refreshWorkspace} resolves over rather than a rule
   * written here: the roots already seen keep their places, so the first one that
   * resolves to a project keeps resolving to the same one.
   */
  project?: string;
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
   * Carried on the session because it is what the CLIENT announced, which is not the
   * same question as what is on disk: a caller naming a project must be matched
   * against the folders somebody opened, never against whatever a walk of the
   * filesystem would turn up.
   *
   * It used to be carried on the further premise that it *"is settled when the
   * session opens and never changes after: the roots are announced once, at the
   * handshake"*. That was false of the protocol the whole time — `roots/list_changed`
   * exists for the case where it is not — and the server simply did not listen. It
   * does now ({@link refreshWorkspace}), and this list GROWS, in the order the client
   * announced the roots. It never shrinks and never reorders, which is what keeps
   * every reader of it (a match by name, a print, a read that spans all of them) from
   * having to care that it moved.
   *
   * Empty for a session that landed on no project: there is nothing to name, and a
   * write that names something is refused rather than routed at a guess.
   */
  workspaceProjects: readonly WriteTarget[];
  /**
   * Every `.mnema/` the cascade's walks passed over when this session OPENED — a home's,
   * a machine's data directory (see {@link ResolvedContext.passedOver}).
   *
   * Read once, by the log line the server writes when the session opens, and it stays the
   * opening's: a re-read ({@link refreshWorkspace}) moves where the session writes and not
   * what was said about how it got there.
   */
  readonly passedOver: readonly PassedOverTree[];
  /**
   * The workspace roots this connection has been told about, as `file://` URIs, in
   * the order they were first announced.
   *
   * Carried because a re-read resolves over the UNION of what was announced before
   * and what is announced now, never over the latest list alone. That is what makes
   * this slice additive: a root cannot leave, so the cascade cannot walk from one
   * project to another under a session's feet, and a workspace that SHRANK is a case
   * this deliberately does not implement (see {@link refreshWorkspace}).
   */
  roots: readonly string[];
  /**
   * The explicit project the server was configured with, if any — carried so a
   * re-read runs the SAME cascade the handshake ran.
   *
   * Without it the re-read would be a second reading of the rule, and the two would
   * disagree on the one rung that refuses: a configured project would win at the
   * handshake and be silently dropped afterwards.
   */
  readonly configProject?: string;
  /**
   * The directory the host started the server in — present exactly when the client
   * declared no `roots` capability, and carried for the reason {@link Session.configProject}
   * is: so a re-read runs the SAME cascade the handshake ran.
   *
   * Without it a re-read of a session that landed by the working directory would resolve
   * over an empty root list and nothing else, find no project, and move the session onto
   * the global tree in silence — the landing walking away from the project its writes
   * were going to, which is the one move {@link refreshWorkspace} exists never to make.
   * A client with no `roots` capability is never asked for roots, so this session's
   * {@link Session.roots} stays empty and this is the whole of what it re-reads.
   */
  readonly cwd?: string;
  /**
   * How many times the client has told this session its workspace changed — counting
   * the times nothing came of it.
   *
   * It is reported ALWAYS, zero included, because a re-read that happened silently
   * and one that never happened are the same connection from the outside. That is
   * the rule the whole slice is an instance of, applied to the product against
   * itself.
   */
  refreshes: number;
  /**
   * The connecting agent as the committed tree reads it — the client's announcement, or the name the
   * record gives the agent key there. It routes (it is present for any agent) and nothing else: what
   * a write STAMPS is {@link SessionWrite.which}, read per write from the tree it lands in, because
   * the key is chosen per tree and the name has to be the one that tree's record gives that key.
   *
   * Where the client's name is stamped it is the value handed to the write, where the content door
   * screens it.
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
  which: string;
  /**
   * What the client announced about itself (`clientInfo.name`, defaulted) — kept because `which`
   * is not always it: where the record enrols this server's agent key, `which` is the name that
   * enrolment gave the key ({@link agentKey}), and the announcement is no longer what the facts
   * say.
   */
  readonly clientName: string;
  /**
   * The agent this server was asked to sign as (`openSession`), whatever the name: one the record
   * enrols, one it does not, and one that is no agent name at all (`agentNameRefusal`), whose
   * trees refuse every write. The trees carry it for the choice of key (`agentSignsIn`); it is
   * kept here to build the trees of a re-read the same way, and to say, for each tree, when it is
   * not in force.
   */
  readonly agentKey?: string;
  /**
   * The authorizing anchor (the machine's key) — the `who` and the bootstrap actor.
   *
   * ABSENT where no tree of the session has a key that signs without being made: a machine with
   * no key of its own, a host asked for an agent no tree enrols and a person who holds no key, a
   * retired key, a key the record proves a member of two identities. The session still opens and
   * reads, and each write is refused in its own tree (the refusal comes from the write); the first
   * write on a machine with no key makes it, and {@link ensureRun} asks again once it has.
   *
   * Mutable for two cases: a session that landed on the global tree and then
   * learned of a project reads its anchor from the project's private tree, which is
   * the tree the question is asked of there. An installation records the anchor it
   * serves PER TREE, so a `who` left over from the global tree would attribute the
   * project's work to the answer another tree gave. And the one above: the first write.
   */
  who?: string | undefined;
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
   * What this connection's writes founded, owed to the next reply. A session writes into a tree
   * for the first time through {@link ensureRun} — its run is the first fact there, after the
   * founding it needs — and that is the one write that can found an identity; the watch is armed
   * there and emptied where a reply is composed (`replied` and `refused` in `server.ts`, and the
   * hook's reply in `tools.ts`). A refusal is one of those replies, and says a founding only when
   * one landed: the run is written once the operation has decided to write, so a first write the
   * operation refuses founds nothing. See `a-new-identity.ts` for what is said.
   */
  readonly founding: FoundingWatch;
  /**
   * What the content door replaced in the facts this connection records ON ITS OWN, owed to the
   * next reply — the run it opens ({@link ensureRun}) and what the edit hook appends
   * (`channel.asked`, `channel.served`). No tool call asked for those, so no tool's own reply
   * carries their report, and each of those sites used to drop it: a credential in the name the
   * client announced was replaced in the run's `run.started` and nobody was told. Emptied where a
   * reply is composed, beside {@link founding}. Of those sites only the asking can replace
   * anything today — its `path` is a body; the run's agent and every `which` are names, refused
   * rather than redacted — and `what-a-session-records-on-its-own-it-reports.test.ts` asks it.
   */
  readonly replacementsOwed: ReplacementsOwed;
  /**
   * The chain roots this connection BEGAN writing to — {@link ensureRun} adds one before the
   * run's own append, whether or not the run then opens. A run's opening is two writes when
   * the key has no anchor there (the founding, then `run.started`), so a connection whose run
   * failed to open may still have written the first. A write refused before its first fact
   * begins nothing here. The close's log line reads this rather than
   * the run map alone, which is how it came to say "nothing was written" over a founding.
   */
  readonly writesBegun: Set<string>;
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
  /**
   * The channels already recorded as having SERVED, per RUN — the names, not the facts.
   *
   * It is {@link Session.consulted} for the other half of the axis, and it is a second map
   * rather than a second use of that one because the two dedupe different vocabularies: a
   * skill id and a channel name would share a set and could, in principle, collide. Keyed
   * by the run's chain root for the same reason, and for the reason that matters most on
   * this path: it decides whether to write AT ALL, and the channel it guards fires on every
   * edit of every session — a call that has nothing to record must not have opened a run to
   * find that out.
   *
   * WHY A CHANNEL IS RECORDED ONCE AND AN ASKING EVERY TIME. Serving is continuous — a
   * reader needs to know the push was live at the edits of that run, which one fact carries — while
   * asking is a discrete exercise of authority over one call at one path, and every one of
   * them is a fact of its own. So the asking has no map here: nothing about it is
   * deduplicated, and that is the granularity of the power rather than an omission.
   *
   * In memory, and sufficient rather than a shortcut: the scope is exactly the run, and
   * every run here dies with this session.
   */
  readonly served: Map<string, Set<string>>;
  /**
   * The paths whose FIRST write this connection has already held (`edit-first-write-gate`), each by
   * the path the record compared — so the same write, repeated, is let through. In memory and
   * sufficient for the reason {@link Session.served} is: the connection is the session, so a
   * server that restarts holds a file's first write again, once, and that is stated where the
   * channel is described rather than hidden.
   */
  readonly held: Set<string>;
  /**
   * How many times each rule has been told to the agent as a refusal or an asking on this
   * connection (`<grade>:<rule id>`), so the same rule said again is shorter (see
   * `reasonTold`).
   */
  readonly told: Map<string, number>;
}

/**
 * Opens a session for a connection: resolves the trees, settles the default scope,
 * and reads the anchor this machine authorizes as. It appends NOTHING — no run, no
 * identity founding — so a client that connects and never calls a write leaves the
 * project exactly as it found it.
 *
 * Throws in ONE condition, and in no other: the operator configured a project that is
 * relative or is no project ({@link configuredProject}) — the server was told what to
 * serve and will not serve something else. It fires BEFORE anything is touched: the
 * trees resolve first. It never throws for a key: where nobody signs, the session opens
 * with no `who` and reads, and it is each write that is refused, in its own tree.
 *
 * "EXACTLY AS IT FOUND IT" WAS FALSE UNTIL THE ANCHOR STOPPED BEING READ OFF A WRITER.
 * It was decided through {@link writeContext}, which opens one, and opening one touches
 * the tree before anything is appended. Measured over the binary, a connection whose one
 * call was `audit_accountability` gave the PRIVATE tree this key's public half, an
 * installation id and a tail with its proof — on the first connection of every key, the
 * key that founded the project included. Nothing was appended, and the claim was about
 * files. The anchor is asked of the signer now ({@link anchorIn}), which opens nothing
 * and makes no key: a machine with no key has no anchor until its first write.
 * `a-refusal-leaves-nothing.test.ts` digests the tree around a connection that reads.
 */
export function openSession(input: OpenSessionInput): Session {
  const resolved = resolveContext(
    cascadeInput(
      input.env,
      input.configProject,
      input.cwd !== undefined ? { cwd: input.cwd } : { roots: input.roots },
    ),
  );
  const { inProject, project, rung, passedOver } = resolved;
  const log = input.log ?? (() => {});
  const agentKey = input.agentKey;
  const workspaceProjects = withTheAgentIn(resolved.workspaceProjects, input.env, agentKey);
  const trees = withTheAgent(resolved.trees, input.env, agentKey);

  // WHERE THE ANCHOR IS READ FROM, and nothing else. This is not a write default —
  // there is none on a session any more (see {@link WriteTarget}); it is the one tree
  // the opening question below has to be asked of. An installation records the anchor
  // it serves PER TREE, so "who is this machine here" has one answer per tree and the
  // question needs one named. The private tree in a project, the global tree outside
  // one: the same tree this was asked of before the routing rule changed, so the `who`
  // a session reports is unchanged by that change.
  const anchorTree: Scope = inProject ? 'private' : 'global';

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
  const who = sessionAnchor(trees, anchorTree, log);
  // SAID PER TREE, because the person needs to hear it somewhere and the key is chosen per tree: a
  // server asked to sign as an agent that signs as the person in one tree, or is refused there, is
  // the one thing a plugin update must not do in silence.
  if (agentKey !== undefined) {
    sayWhereTheAgentIsNotInForce(
      trees,
      agentKey,
      reachableTrees(trees).map((tree) => tree.scope),
      log,
    );
  }

  return {
    trees,
    inProject,
    rung,
    ...(project !== undefined ? { project } : {}),
    workspaceProjects,
    passedOver,
    // A COPY, and in the order the client announced them. The array belongs to the
    // caller, and this one is the base every later union is built on: a re-read that
    // resolved over a list somebody else could have changed would resolve over a
    // workspace nobody announced. Empty for a client that declared no `roots`.
    roots: [...(input.roots ?? [])],
    ...(input.configProject !== undefined ? { configProject: input.configProject } : {}),
    ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
    // Zero, and it is REPORTED as zero — see {@link Session.refreshes}.
    refreshes: 0,
    which: whichOf(trees, input.clientName),
    clientName: input.clientName,
    ...(agentKey !== undefined ? { agentKey } : {}),
    who,
    // Empty: the first write to a tree opens that tree's run (see `openWrite`). A
    // session that only reads carries this map to its close still empty, and that is
    // the honest state rather than a missing one.
    runs: new Map<string, OpenRun>(),
    ended: false,
    env: input.env,
    log,
    caches,
    founding: new FoundingWatch(),
    replacementsOwed: new ReplacementsOwed(),
    writesBegun: new Set<string>(),
    consulted: new Map<string, Set<string>>(),
    served: new Map<string, Set<string>>(),
    held: new Set<string>(),
    told: new Map<string, number>(),
  };
}

/**
 * What a re-read of the workspace changed, so the connection can SAY it.
 *
 * Every field is reported even when it is empty, which is the whole shape of this
 * type: a re-read that found nothing and a re-read that never ran are the same
 * session from the outside, and that indistinguishability is the defect this slice
 * exists against. The counts are on {@link Session.refreshes}; this is what THIS one
 * did.
 */
export interface WorkspaceRefresh {
  /** The roots announced now that this session had not been told about before. */
  readonly gained: readonly string[];
  /** The project directories that entered {@link Session.workspaceProjects}. */
  readonly learned: readonly string[];
  /**
   * The project the cascade landed on, when this re-read is what made it land at
   * all — absent when the landing did not move, which is every other case.
   */
  readonly landedOn?: string;
}

/**
 * Re-runs the cascade over everything this connection has been told about, and moves
 * the session onto the answer. The ONE place a session's landing changes.
 *
 * ## Why it exists
 *
 * {@link resolveContext} had exactly one caller — {@link openSession}, at the
 * handshake — so the trees, the project and the list of the workspace's projects were
 * resolved once and never again. The protocol says otherwise: a client that gains a
 * folder sends `notifications/roots/list_changed`, and a server that does not listen
 * goes on serving, and WRITING INTO, the record it happened to resolve first. That is
 * not a missing feature, it is a correctness defect with a measured precedent — a
 * session rooted in a home directory answered about another project, and the wrong
 * answer went on to support a choice.
 *
 * ## It resolves over the UNION, and that is what makes it additive
 *
 * The notification carries nothing: the server has to ask for the list again, and
 * what comes back is the client's CURRENT list, which may have dropped a root as
 * easily as gained one. Resolving over that list alone would let the cascade walk
 * from one project to another mid-session — every open run, every warm cache and any
 * write in flight would then belong to a project the session no longer claims to be
 * in. So the roots already seen keep their places and the new ones are appended, and
 * two properties follow from the shape rather than from a rule anybody has to
 * remember:
 *
 *   - a session that landed in a project STAYS in it. The cascade returns at the
 *     first root that resolves, and that root is still first;
 *   - a session that landed on the global tree can land in a project, because no
 *     earlier root resolved to one. It is the only way the landing ever moves.
 *
 * A workspace that SHRANK is therefore declared and not implemented. Retiring a tree
 * mid-session raises what to do with a run open in it, with its caches and with a
 * write in flight, and that is product design rather than anything derivable here.
 *
 * ## It re-probes even when no root is new
 *
 * A list that came back identical is not the same as nothing having changed: `mnema
 * init` in a folder the client already announced turns a root that was no project
 * into one, and the client has no reason to renumber its roots for it. So the
 * cascade runs on every notification, and the cost of that is a walk-up per root
 * over paths already in hand.
 *
 * ## What it does NOT touch
 *
 * The runs, the warm caches and the recorded consultations are all keyed by chain
 * root, so they are additive already: a tree that enters the workspace simply has no
 * entry yet, and a tree that was written to keeps the one it has. Nothing here has to
 * migrate them, and nothing here may drop them — the run in a tree this session wrote
 * to is still the authority for that work.
 *
 * The `who` moves in exactly one case, and only because the landing did: the anchor
 * is recorded per tree, so a session that walks from the global tree into a project
 * asks the project's private tree the question it used to ask the global one. Read
 * BEFORE anything is assigned, so a session is never half-moved: and where nobody signs
 * in the project it lands on, the answer is none, as at the opening.
 */
export function refreshWorkspace(session: Session, roots: readonly string[]): WorkspaceRefresh {
  // Counted first, and counted even when the answer below is "nothing": the count is
  // the evidence that the server heard the client at all.
  session.refreshes += 1;

  // A session whose client declared no `roots` capability re-reads the one signal it
  // opened with — the working directory — and has no list to grow: such a client is
  // never asked for roots, so anything handed here in its name is not a workspace it
  // announced.
  const gained =
    session.cwd !== undefined ? [] : roots.filter((root) => !session.roots.includes(root));
  const union = gained.length === 0 ? session.roots : [...session.roots, ...gained];
  const resolved = resolveContext(
    cascadeInput(
      session.env,
      session.configProject,
      session.cwd !== undefined ? { cwd: session.cwd } : { roots: union },
    ),
  );

  const known = new Set(session.workspaceProjects.map((project) => project.dir));
  const learned = resolved.workspaceProjects
    .map((project) => project.dir)
    .filter((dir) => !known.has(dir));
  const landed = resolved.inProject && !session.inProject;
  // Before a single field moves, and never refused for a key: a session left holding a
  // project's trees with the global tree's `who` would attribute that project's work to an
  // answer another tree gave, and one that has no `who` there says so, as at the opening.
  const who = landed
    ? sessionAnchor(
        withTheAgent(resolved.trees, session.env, session.agentKey),
        'private',
        session.log,
      )
    : session.who;

  const trees = withTheAgent(resolved.trees, session.env, session.agentKey);
  session.roots = union;
  session.trees = trees;
  // The session now reaches the project's trees, which it did not: said once, as at the opening.
  if (landed && session.agentKey !== undefined) {
    sayWhereTheAgentIsNotInForce(
      trees,
      session.agentKey,
      reachableTrees(trees)
        .map((tree) => tree.scope)
        .filter((scope) => scope !== 'global'),
      session.log,
    );
  }
  session.which = whichOf(trees, session.clientName);
  session.inProject = resolved.inProject;
  session.rung = resolved.rung;
  if (resolved.project !== undefined) session.project = resolved.project;
  session.workspaceProjects = withTheAgentIn(
    resolved.workspaceProjects,
    session.env,
    session.agentKey,
  );
  session.who = who;

  return {
    gained,
    learned,
    ...(landed && resolved.project !== undefined ? { landedOn: resolved.project } : {}),
  };
}

/**
 * One line for each of `scopes` where the agent this server was asked to sign as is not the one
 * that signs: in that tree the person's key signs instead, and what the facts name is declared, not
 * attested — or, where the person's key cannot be opened without a terminal, the write is refused.
 * Neither says anything about a passphrase: the way out is the verb a person runs at a terminal.
 */
function sayWhereTheAgentIsNotInForce(
  trees: ResolvedTrees,
  agentKey: string,
  scopes: readonly Scope[],
  log: (line: string) => void,
): void {
  for (const scope of scopes) {
    const choice = keyChoiceIn(trees, scope);
    if (choice === undefined || choice.signs === 'agent') continue;
    const where = treeWords(scope);
    log(
      choice.signs === 'nobody'
        ? oneLine(`agent key "${agentKey}" is not in force in ${where}: ${choice.refusal.message}`)
        : `agent key "${agentKey}" is not in force in ${where} — this machine holds no key under that name, or the record there does not enrol it as "${agentKey}": a write there is signed with the person's key, so the agent the facts name is declared, not attested. \`mnema key enroll --agent ${agentKey}\` where you hold your own key puts it in force (\`mnema key request --agent ${agentKey} --anchor <identity>\` first, if this machine holds no key under that name)`,
    );
  }
}

/** `trees`, told which agent to sign as where the record enrols it, when one is configured. */
function withTheAgent(
  trees: ResolvedTrees,
  env: DiscoveryEnv,
  agentKey: string | undefined,
): ResolvedTrees {
  return agentKey === undefined ? trees : withAgentKey(trees, env, agentKey);
}

/**
 * The projects of the workspace, each with its trees told which agent to sign as. A write can be
 * routed to any of them — by the `project` argument, or by an id only one holds — and the trees of
 * a project that were not given the agent would sign there with the person's root: minting a key on
 * a machine that holds only the agent's, or signing as the person, in silence, where the project
 * enrols the agent.
 */
function withTheAgentIn(
  projects: readonly WriteTarget[],
  env: DiscoveryEnv,
  agentKey: string | undefined,
): WriteTarget[] {
  return projects.map((project) => ({
    ...project,
    trees: withTheAgent(project.trees, env, agentKey),
  }));
}

/**
 * The `which` a connection stamps on what it writes: the name the record enrols the agent key
 * under, where that key signs in the project's committed tree — read from the record, never from
 * what the client said, because the record holds a fact to exactly that name — and what the client
 * announced everywhere else.
 */
function whichOf(trees: ResolvedTrees, clientName: string): string {
  return agentSignsIn(trees, 'public')?.name ?? clientName;
}

/**
 * The `which` of a write into `scope`'s tree of `trees`: the name the record of THAT tree gives the
 * key that signs there, and what the client announced where the person's key signs. Asked per
 * write and per tree because the key is chosen per tree: one connection can sign a project's
 * committed tree as the person and the machine's global tree as the agent, and a `which` read from
 * the committed tree alone would stamp the second with a name its record does not give the key.
 */
function whichIn(trees: ResolvedTrees, scope: Scope, session: Pick<Session, 'clientName'>): string {
  return agentSignsIn(trees, scope)?.name ?? session.clientName;
}

/** {@link whichIn} for a write that has not been opened yet, to the destination it will be routed to. */
export function whichOfWrite(session: Session, scope: Scope, target?: WriteTarget): string {
  return whichIn(target?.trees ?? session.trees, scope, session);
}

/**
 * The cascade's input, built from what a connection said at the handshake — ONE builder
 * for {@link openSession} and for every {@link refreshWorkspace}, so the two cannot come
 * to run different cascades.
 *
 * It is the reason {@link Session.configProject} and {@link Session.cwd} are carried at
 * all: a re-read that rebuilt its input from less than the handshake had would be a
 * second reading of where the session is, and the first place the two disagreed would
 * be a session moved out of its project by a notification that changed nothing.
 */
function cascadeInput(
  env: DiscoveryEnv,
  configProject: string | undefined,
  workspace: ClientWorkspace,
): ContextInput {
  return { ...workspace, env, ...(configProject !== undefined ? { configProject } : {}) };
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
  /**
   * The agent every fact of this write names: the name the record gives the key that signs in
   * THIS tree, and what the client announced where the person's key signs ({@link whichIn}).
   */
  readonly which: string;
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
 * The run opens in the WRITE'S OWN scope, and that is a reversal. It used to open in
 * the destination's default: a run is the authority for a connection's work in a
 * project rather than for one fact, so a write that overrode its scope still opened
 * its run where that project's work lived. The reasoning held while the two could
 * only differ on an explicit override — and stopped holding when the tree became a
 * function of the KIND, which made divergence the ORDINARY path: one connection
 * recording a decision and a memory writes to two trees by design.
 *
 * What the old choice then cost fell on the tree that travels. Every event carries
 * its `run` on the envelope, so a public decision would cite the private run, and a
 * clone — which has the decision and no private tree at all — would read a fact
 * pointing at an authority that exists nowhere it can look. The chain still verifies
 * `ok` while it does, which is the one class of defect the proof does not catch. A
 * reference may point at a tree that travels FURTHER than its own (a private fact
 * citing a public run is resolvable wherever the private fact is readable at all);
 * it may never point the other way.
 *
 * So the run is per TREE, not per project: `session.runs` is keyed by chain root and
 * a connection holds one run per tree it has written to. Two runs in one project is
 * the honest shape of a session that recorded a team decision and a private note.
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
  const which = whichIn(trees, scope, session);
  const open = session.runs.get(chainRootForScope(trees, scope) as string);
  if (open !== undefined)
    return { run: open.id, ctx: writeContext(trees, scope, session.caches), which };
  // No run here yet: one is PREPARED, and written by the operation's own first fact, on the
  // context the operation writes through — so a first call the operation refuses leaves no run,
  // no founding and no key behind it (see `ensureRun`).
  const ctx = writeContext(trees, scope, session.caches);
  const pending = ensureRun(session, trees, scope, ctx);
  return {
    run: pending.id,
    ctx: { ...ctx, beforeTheFirstFact: pending.start, askedBeforeFounding: pending.ask },
    which,
  };
}

/**
 * What the content door replaced in facts no tool call asked for, held for the next reply.
 *
 * The wording is the one every write already uses ({@link replacementNotice}), under a line
 * saying which facts it is about — they are not the fact the reply acknowledges.
 */
export class ReplacementsOwed {
  private held: ReplacedClass[] = [];

  /** Holds what a write the connection made on its own replaced, when it replaced anything. */
  add(replaced: readonly ReplacedClass[] | undefined): void {
    if (replaced !== undefined) this.held.push(...replaced);
  }

  /** The block owed since the last take — none when nothing was replaced — and forgets it. */
  take(): string[] {
    const was = this.held;
    this.held = [];
    if (was.length === 0) return [];
    return [
      [
        'What this connection recorded on its own — its session run, the edit hook’s facts:',
        ...replacementNotice(was),
      ].join('\n'),
    ];
  }
}

/**
 * Prepares the run for a destination that has none: its id now, and `start`, which the write's
 * own first fact calls (`WriteContext.beforeTheFirstFact`, from `ensureFounded`) to write it.
 *
 * THE RUN OPENED BEFORE THE OPERATION DECIDED, and a first call the operation refused founded
 * anyway: measured on the binary from an empty HOME, `task_transition cancel` with no reason was
 * refused (`MISSING_PROOF`) and left a key, an anchor and a tail holding `identity.founded` and
 * `run.started`, and the refusal said "This key founded an identity of its own". So the run is
 * written by the write that needs it, after the operation's last refusal, under its hold of the
 * tail's lock, and the founding comes with it; the id the operation pins is minted beforehand.
 *
 * Synchronous from the check to the assignment, and that is a requirement rather
 * than a convenience: nothing between `openWrite` and the operation's append awaits,
 * so nothing can interleave between reading the empty entry and filling it, and
 * concurrent writes to one tree cannot each open a run of their own. An `await`
 * anywhere on that path would give every write in flight to that tree the same empty
 * entry to fill, and a connection would end up with one run per write, each holding
 * a fragment of one project's work. There is no lock to add: the guarantee is that
 * the path never yields.
 *
 * Concurrent writes to DIFFERENT trees do each open a run, and that is the point
 * rather than the same defect at a larger grain: they are different projects'
 * records, and one run cannot be the authority in a tree it is not written in.
 */
function ensureRun(
  session: Session,
  trees: ResolvedTrees,
  scope: Scope,
  ctx: WriteContext,
): {
  readonly id: string;
  readonly start: () => void;
  readonly ask: NonNullable<WriteContext['askedBeforeFounding']>;
} {
  // The key exists before the run does, and identifies the tree the run will live
  // in. An absent tree has no root to key by; `writeContext` is what refuses it, and
  // the caller has already built it.
  const root = chainRootForScope(trees, scope) as string;

  // THE WATCH IS ARMED HERE, before the first thing this connection may append to the tree: a
  // key with no anchor in the tree founds on its way to the run. What the tree's anchors were a
  // moment before is what the next reply compares with — and a write refused before it founds
  // leaves them as they were, so the reply says nothing.
  session.founding.opened(root, scope);
  const prepared = prepareRun(ctx, { agent: whichIn(trees, scope, session) });
  if (!prepared.ok) {
    throw new Error(`could not open a session run: ${prepared.code} — ${prepared.message}`);
  }
  let started = false;
  const start = (): void => {
    // Once: `ensureFounded` runs before every fact of the operation, and before the run's own.
    if (started) return;
    started = true;
    session.writesBegun.add(root);
    const opened = prepared.start();
    if (!opened.ok) {
      throw new Error(`could not open a session run: ${opened.code} — ${opened.message}`);
    }
    // SIGNED HERE, because opening a run is an act of writing and every act of writing
    // signs what it wrote. Nothing after this guarantees a later one: an operation whose
    // own append is then refused checkpoints nothing (by design — see the tools), so the
    // founding and this `run.started` would rest on the hash chain alone with no writer
    // ever coming back for them. Measured before this line existed: a session whose
    // first tool call was refused left the tree at `hash-chain-only` with 2 events
    // uncovered. It costs ONE checkpoint per session per tree, not one per call: a tree
    // with a run gets no `start`. See `every-write-signs-what-it-wrote.test.ts`.
    ctx.writer.checkpoint();
    session.runs.set(root, { id: opened.id, trees, scope });
    // A machine that had no key made one to write this: the session has someone to speak for now.
    if (session.who === undefined) {
      session.who = sessionAnchor(
        session.trees,
        session.inProject ? 'private' : 'global',
        () => {},
      );
    }
    // The run is this connection's own fact, and the name it carries is the one the client
    // announced — the value the door screens. What it replaced is owed to the reply that
    // caused the opening, which is the first reply able to say it.
    session.replacementsOwed.add(opened.replaced);
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
    session.log(oneLine(`session run ${opened.id} opened in ${root} for which=${opened.agent}`));
  };
  return { id: prepared.id, start, ask: prepared.ask };
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
  /**
   * What the content door replaced in the `run.ended` facts this close wrote. A close answers
   * no tool call, so the host's log is the one place it can be said; the same name was
   * already reported to the agent when the run opened ({@link ReplacementsOwed}).
   */
  readonly replaced: readonly ReplacedClass[];
  /** The roots a write began in with no run to show for it — see {@link Session.writesBegun}. */
  readonly begunWithNoRun: readonly string[];
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
  const replaced: ReplacedClass[] = [];
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
        // Closed BY the agent that connected, named as the record names it NOW: the key that
        // signs this close is chosen here, not when the run opened, and a person who enrolled
        // the agent while the host was open would otherwise have it sign a `run.ended` whose
        // `which` is the client's — the one disagreement `verify` reads as a break. Taken from
        // the session, never asked of the client.
        const ended = ctx.writer.exclusively(() => {
          const closing = endRun(ctx, {
            run: run.id,
            which: whichIn(run.trees, run.scope, session),
          });
          if (closing.ok) ctx.writer.checkpoint();
          return closing;
        });
        // Signed here, and this is the last chance anything has: the connection is
        // over, so no later write will come back to cover this `run.ended`. Measured
        // before this line existed: a session that recorded a task and then closed
        // left the tree at `signed-through-last-checkpoint` with the end of its own
        // run uncovered — a record that had been fully signed a moment earlier, put
        // back below that by the act of closing, permanently and silently. Signing
        // only what landed: a refused close leaves nothing pending, so this is a
        // no-op there rather than a second signature over the same range.
        if (ended.ok) replaced.push(...(ended.replaced ?? []));
        (ended.ok ? closed : leftOpen).push(run.id);
      } catch {
        leftOpen.push(run.id);
      }
    }
  } finally {
    session.caches.closeAll();
  }
  const opened = new Set(session.runs.keys());
  const begunWithNoRun = [...session.writesBegun].filter((root) => !opened.has(root));
  return { closed, leftOpen, replaced, begunWithNoRun };
}

/**
 * The anchor this machine authorizes as in one of the session's trees — DECIDED, as a write
 * decides it (a key another machine enrolled serves the identity it joined), and asked of the
 * SIGNER rather than of a writer, so asking touches nothing and makes nothing.
 *
 * Undefined where no key of this machine signs in the tree without being made. It throws what
 * {@link authorizingAnchor} and the choice of key throw — a key the record proves belongs to two
 * identities, one the record retired, an agent the tree does not enrol — and the caller decides
 * what a session does with it.
 */
export function anchorIn(trees: ResolvedTrees, scope: Scope): string | undefined {
  const writer = signerHeldFor(trees, scope);
  if (writer === undefined) return undefined;
  return authorizingAnchor({
    writer,
    layout: { root: chainRootForScope(trees, scope) as string },
    upcasters: catalogUpcasters(),
  });
}

/**
 * {@link anchorIn} for the session's own `who`: of `first`, and — where nobody signs there — of the
 * next tree that has someone to sign, so a session whose agent is enrolled in the committed tree
 * alone still has an anchor, and its writes to the other trees are the ones refused.
 *
 * It never throws for a key. Where no tree has anyone, the session has no anchor and opens all the
 * same: the refusal belongs to the write, in the tree the write is for. What stopped the question,
 * where the person was asked for and no agent explains it, is said once in the log.
 */
function sessionAnchor(
  trees: ResolvedTrees,
  first: Scope,
  log: (line: string) => void,
): string | undefined {
  let unanswered: IdentityUnavailableError | undefined;
  for (const scope of [first, 'public', 'global'] as const) {
    if (chainRootForScope(trees, scope) === undefined) continue;
    try {
      const anchor = anchorIn(trees, scope);
      if (anchor !== undefined) return anchor;
    } catch (error) {
      if (!(error instanceof IdentityUnavailableError)) throw error;
      unanswered ??= error;
    }
  }
  if (unanswered !== undefined && trees.agent === undefined) {
    log(oneLine(`no identity to open the session as here: ${unanswered.message}`));
  }
  return undefined;
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
 *
 * AND IT IS WHERE A WRITE LEARNS WHOSE KEYS THE RECORD COUNTS, from the same registry. Every
 * append first asks whether the identity this checkout recorded still counts its key (the
 * core's `ensureFounded`), and asked of a replay that is linear in the record — on every write
 * an agent makes. The context hands the core the session's cheaper reading instead: the order the
 * tree's cache retained plus what arrived since, which is the chain as it is now and not the
 * tables (`CacheRegistry.rosterAsOfNow`). A tree this connection never read has no cache, and
 * the core replays it. `mcp-write-reads-the-roster-it-holds.test.ts` holds that it reaches.
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
    roster: (anchor) => caches.rosterAsOfNow(root as string, anchor),
  };
}
