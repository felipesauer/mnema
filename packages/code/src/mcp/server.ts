/**
 * The mnema MCP server: a thin transport over the session and the tool adapters.
 *
 * The SDK does the protocol — the handshake, the tool dispatch, the JSON-RPC
 * envelope; this file only wires. It builds the server, registers the tools
 * (each delegating to a pure adapter in {@link ./tools.js}), opens a session
 * once the handshake has run (so `clientInfo` and the client's roots are
 * available), and closes that session's run when the connection ends. There is
 * no domain logic here and none in the tools — the logic is the core's gate and
 * operations, reached through the session and the adapters. Each registered tool
 * (capture_memory, record_observation, record_handoff, link_knowledge,
 * create_task, task_transition, record_decision, decision_transition, create_skill,
 * skill_transition, bootstrap, focus, resume, next_actions, guard, skills,
 * search, read_record, and the
 * five `audit_*` intelligence reads — audit_timeline, audit_refs,
 * audit_accountability, audit_antipatterns, audit_exposure) delegates to a pure
 * adapter in {@link ./tools.js}. The
 * reads (focus/resume/next_actions/guard/search/read_record, like bootstrap) are READ-ONLY — they
 * derive from the session's projection cache; they open no writer. `guard` is a
 * dry-run of the gate: it simulates a move and returns the verdict, having
 * written nothing. `skills` is the one read that also writes: it serves the
 * adopted patterns AND records the consultation, a fact nothing else could
 * recover afterwards.
 * The `audit_*` reads are read-only too, and they are the AUDITOR's view: every
 * tree the session can see. Three of them read the session's warm caches like the
 * rest; `audit_antipatterns` folds the raw event stream, because it asks which
 * events have a given SHAPE rather than which touch a given entity; and
 * `audit_exposure` folds the trees SEPARATELY, because its answer has to say which
 * tree a finding is in — a merge is exactly what would lose that.
 *
 * HOW MANY PROJECTS a call covers is decided by the question, not by an argument.
 * Everything keyed by an ID reaches every project of the workspace — `read_record`,
 * the five `audit_*` reads, and the five keyed by an ENTITY (the three transitions,
 * `next_actions`, `guard`) — because an id is minted once, so which project holds it
 * is a fact to be found rather than a filter the caller meant to apply; `search` and
 * `skills` reach every tree for the neighbouring reason (words and capabilities are
 * not scoped to a project); and what stays with the session's own project is where
 * NEW work is born, which is the one thing that has no id to be found by. No tool
 * takes a flag for it: the caller has no better information than the tool does about
 * which kind its own question is.
 *
 * That is why the five entity-keyed tools take no `project` while every write verb
 * does. A birth is told where it belongs because there is no id yet to ask; a move
 * asks the id, and lands where the answer is — including in a sibling project, which
 * a birth routed there could produce and a move could not follow.
 *
 * The session is resolved lazily and once: `oninitialized` opens it as soon as
 * the client is known, and every tool call ensures it too, so a call that races
 * ahead of the initialized callback still finds a session rather than failing.
 * A failure to open the session is surfaced honestly as a tool error, never a
 * silent no-op. Opening it appends NOTHING: the run opens at the first write (see
 * `openWrite`), so a connection that only reads leaves the project untouched, and
 * the reads say so rather than reporting an absent run as an idle one.
 *
 * A session holds live resources — the warm projection caches its reads share, and
 * a run once a write has opened one — so the connection ending has to release them.
 * `closeSession` does that, and what CALLS it is the process learning its connection
 * ended: stdin reaching its end, or a catchable signal (see {@link ./lifecycle.js}).
 * The transport's own `onclose` stays wired and is not the mechanism — the SDK's
 * server side never fires it.
 */

import { REFERENCE_DEFAULT_DEPTH, REFERENCE_MAX_DEPTH } from '@mnema/copilot';
import {
  canonicalIdentity,
  type DiscoveryEnv,
  SEARCH_DEFAULT_LIMIT,
  SEARCH_KINDS,
  SEARCH_MAX_LIMIT,
} from '@mnema/core';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { discoveryEnv } from '../env.js';
import { RECORD_CONTRACT, type Replacement, replacementNotice } from '../recorded-content.js';
import { oneLine, SERVED_PATTERN_CONTRACT, servedPatternsFraming } from '../served-patterns.js';
import { armSessionClose, type Lifecycle } from './lifecycle.js';
import { namedProjects } from './route.js';
import { closeSession, openSession, type Session } from './session.js';
import {
  runAccountabilityTool,
  runAntipatternsTool,
  runBootstrap,
  runCaptureMemory,
  runCreateSkill,
  runCreateTask,
  runDecisionTransition,
  runExposureTool,
  runFocusTool,
  runGuardTool,
  runLinkKnowledge,
  runNextActionsTool,
  runReadRecordTool,
  runRecordDecision,
  runRecordHandoff,
  runRecordObservation,
  runReferencesTool,
  runResumeTool,
  runSearchTool,
  runSkillsTool,
  runSkillTransition,
  runTaskTransition,
  runTimelineTool,
} from './tools.js';

/** The name the server announces itself as (its own identity, not the client's). */
const SERVER_NAME = 'mnema';
const SERVER_VERSION = '0.0.0';

/**
 * The `project` argument every WRITE carries: which of the workspace's projects the
 * fact belongs to.
 *
 * One schema, shared by all seven, and that is not only economy. The agent reads
 * these descriptions and nothing else; seven descriptions of one routing rule are
 * seven chances for the rule the agent believes to drift from the rule the server
 * applies, and the ones that drifted would be indistinguishable from the ones that
 * did not. The rule itself lives in one function for the same reason.
 *
 * It names both accepted spellings and says what omitting it does, because the
 * silent default is the thing an agent has to be able to predict: a call that says
 * nothing lands where the session landed, which is right when the work is there and
 * wrong when it is not — and only the caller knows which.
 */
const PROJECT_ARG = z
  .string()
  .min(1)
  .optional()
  .describe(
    'Which project of this workspace the fact belongs to — its full path, or the ' +
      'name of its directory. Omitted, it lands in the project this session ' +
      'resolved to (the one `bootstrap` names). Pass it whenever the work being ' +
      'recorded happened in a different project of this workspace.',
  );

/**
 * What the fields on a reported run MEAN — appended to the description of every read
 * that lists one.
 *
 * One text, four uses, and for the same reason `PROJECT_ARG` is one schema: the agent
 * reads these descriptions and nothing else, so four spellings of one rule are four
 * chances for the rule it believes to drift from the rule the server applies. This
 * one has to be said somewhere an agent can read it, because the fields answer a
 * question the record cannot — whether an open run is still being worked in — and the
 * answer is a comparison, not a verdict.
 *
 * The absence of `idleSeconds` is stated explicitly. It is the one field whose being
 * missing MEANS something (a run that recorded nothing at all), and a reader left to
 * infer that from silence would infer whatever it already believed.
 *
 * And it says what none of this proves. An open run is not evidence of a live
 * session: nothing in the record says a process is running, so a run left behind by
 * a session that was killed is indistinguishable from one an agent is idle inside.
 * The reads report; the person or the agent decides, and `mnema run end <id>` is how
 * a decision gets recorded.
 */
const OPEN_RUN_CONTRACT =
  ' Each run reported carries `thisSession` — true when THIS connection opened it, ' +
  'false when it came from elsewhere (another session on this machine, live or ' +
  'abandoned): every session on a machine shares one authorizing identity, so the ' +
  'record alone cannot tell them apart. An OPEN run also carries `ageSeconds` (since ' +
  'it started) and, when anything has been recorded in it, `idleSeconds` (since its ' +
  'last recorded fact); NO `idleSeconds` means the run has recorded nothing at all. ' +
  "Both compare this machine's clock with the writer's, so a run written on another " +
  'machine reports whatever those two clocks differ by. None of this says a ' +
  'run is dead — nothing in the record speaks about a process — so an old idle run ' +
  'may be abandoned or may be a session waiting; closing one is `mnema run end <id>`.';

/**
 * The agent a connection is recorded as when the client's own name is no name.
 *
 * On this transport an agent exists BY CONSTRUCTION: a stdio connection is a
 * program talking to a program, and "a person acted directly" — what an absent
 * `which` means everywhere else in mnema — cannot be true here. So a client that
 * announces nothing usable is recorded as an agent whose name we do not know, which
 * is honest, rather than as nobody, which is false.
 */
const UNKNOWN_AGENT = 'unknown-agent';

/**
 * The agent this connection is for: the name the client announced, or
 * {@link UNKNOWN_AGENT} when that name is no identity at all.
 *
 * "No identity" is decided by {@link canonicalIdentity} — the rule that decides
 * what the chain records — and not by a check of our own, because a second reading
 * of "blank" could disagree with the first, and then a name would pass here and
 * vanish from the event. One call covers the absent name, a non-string from a
 * client that ignores the schema, whitespace of every kind, and a string the chain
 * cannot canonicalize.
 *
 * The blank name takes the SAME default the absent name always took, and that is
 * the coherent rule rather than a new one: the two are the same fact (no agent was
 * named) reaching us through a filled-in field instead of an empty one.
 *
 * A usable name passes through EXACTLY as announced, never canonicalized: the
 * content door screens the announced value and reports what it replaced, and that
 * report is the only way an agent learns its own name carried a credential (see
 * {@link Session.which}).
 *
 * It is decided HERE, before the session opens, because the session derives three
 * things from this ONE value — the default scope a write lands in, the `agent` on
 * the run's own fact, and the `which` stamped on every event of the connection.
 * Deciding it later, or twice, is what lets them disagree: a blank name used to
 * announce an agent, record none, and route the session's writes to the team's
 * committed tree, because "no agent" reads as "a person captured this".
 */
function connectingAgent(announced: string | undefined): string {
  if (announced !== undefined && canonicalIdentity(announced) !== undefined) return announced;
  return UNKNOWN_AGENT;
}

/** What the server needs from its host, injected so it is testable. */
export interface McpServerOptions {
  /** The discovery environment; defaults to the real process environment. */
  readonly env?: DiscoveryEnv;
  /**
   * An explicit project directory to operate on, overriding the client's roots —
   * what `mnema mcp --project` carries.
   *
   * It must be an ABSOLUTE path to a directory that IS a project; a value that is
   * neither refuses the whole session rather than falling back to the roots (see
   * {@link resolveContext}). Absent, the project comes from the cascade.
   */
  readonly configProject?: string | undefined;
  /** Where to write diagnostics (never stdout — that carries the protocol). */
  readonly log?: (line: string) => void;
}

/**
 * Builds the configured MCP server and returns it alongside `connect`, which
 * attaches a stdio transport and starts serving, and `armClose`, which wires the
 * ways this process can learn the connection ended.
 *
 * The three are split for one reason each. `connect` is separate so a test can build
 * the server and drive its tools without spawning a transport. `armClose` is separate
 * because it is the half of the close that CANNOT be exercised through a transport: it
 * attaches to the process, and a test that signalled the real process would signal the
 * test runner. `connect` calls it, so production wires itself; a test calls it with a
 * fake process and gets the whole path — trigger, close, the `run.ended` on disk.
 */
export function buildMcpServer(options: McpServerOptions = {}): {
  readonly server: McpServer;
  readonly connect: () => Promise<void>;
  readonly armClose: (lifecycle?: Lifecycle) => () => void;
} {
  const env = options.env ?? discoveryEnv();
  const log = options.log ?? ((line) => process.stderr.write(`${line}\n`));

  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  // The one piece of per-connection state: the session. It is resolved once,
  // and the in-flight PROMISE is what guards that — not the resolved value. The
  // initialized callback and a racing first tool call both await the SAME
  // promise, so exactly one `openSession` (one `startRun`) happens. Holding only
  // the resolved value would let a call that arrives during the `await` below
  // see no session yet and open a second run.
  let sessionPromise: Promise<Session> | undefined;
  // The SAME session, readable without awaiting — which the close needs and the
  // promise cannot give it. A process being asked to stop does not come back from
  // an `await`: the continuation that would record the end dies with the process,
  // which is how a close hung on `.then()` writes nothing however early it fires.
  // Assigned the instant `openSession` returns, so anything that can reach a run
  // (every write goes through the session) can also reach this.
  let openedSession: Session | undefined;

  /**
   * Opens the session if it is not open yet, from what the handshake exposed:
   * the client's name (the `which`, defaulted when the client announced no usable
   * one — see {@link connectingAgent}) and its workspace roots (for the project
   * cascade). Idempotent under concurrency — the first caller starts the open;
   * every caller awaits the one result.
   */
  const ensureSession = (): Promise<Session> => {
    if (sessionPromise !== undefined) return sessionPromise;
    sessionPromise = (async () => {
      const clientName = connectingAgent(server.server.getClientVersion()?.name);
      const roots = await listRootsSafely(server, log);
      const opened = openSession({
        clientName,
        roots,
        env,
        log,
        ...(options.configProject !== undefined ? { configProject: options.configProject } : {}),
      });
      // Before the log line and before this promise resolves: from here on the close
      // can reach the session synchronously, and there is no window in which a write
      // could open a run the close cannot see.
      openedSession = opened;
      // WHERE this session landed, first. The project is chosen by a cascade over
      // inputs the server never sees twice — a configured path, the roots the host
      // announced, in the order it announced them — and the rule walks up, so the
      // project it settles on is regularly not the directory anybody named: a folder
      // opened inside another repository resolves to that repository, and a package
      // of a monorepo resolves to the monorepo. Both are right, and either can be a
      // surprise. Until this line, nothing anywhere said which one won, and a choice
      // that leaves no trace is a choice nobody can correct.
      //
      // And HOW MANY it chose from, because the name alone does not say a choice was
      // made: one project and four look identical in a line that reports only the
      // winner. It is a count, not a warning — the server has no way to know which
      // project was meant, and a line that hedged would be hedging in every workspace
      // with two folders open.
      //
      // No agent name here. The name the chain records is the SCREENED one, and the
      // only party that screens is the write — so at the handshake there is no
      // screened value to print, and printing the announced one would put a
      // credential in the host's log in a product that replaces one before writing
      // it. The agent is named when the run opens, from what the write recorded.
      //
      // Collapsed to one line: the log is read one event per line, and a path
      // holding a newline would otherwise write a second event nothing happened in.
      log(
        oneLine(
          `session opened: project=${opened.project ?? '(none — the global tree)'} ` +
            `workspaceProjects=${opened.workspaceProjects.length} ` +
            `scope=${opened.scope} who=${opened.who} ` +
            'runs=(none — the first write to a project opens that project’s run)',
        ),
      );
      return opened;
    })();
    return sessionPromise;
  };

  // Resolve the session as soon as the client is known: the trees, the scope, the
  // anchor. This APPENDS NOTHING — the run waits for the first write — so a client
  // that attaches and calls nothing leaves the project as it found it. It is done
  // here anyway, rather than on first use, so the line above declares where the
  // session landed even for a connection that never asks anything.
  server.server.oninitialized = () => {
    void ensureSession().catch((error) => {
      log(`could not open session at initialize: ${messageOf(error)}`);
    });
  };

  registerTools(server, ensureSession);

  /**
   * Ends the connection's session: every run it opened, then its caches.
   *
   * SYNCHRONOUS from the check to the log line, and that is the requirement rather
   * than a style — see {@link armSessionClose}. It reads the session off
   * `openedSession` and not off the promise for exactly that reason.
   *
   * Only a session that actually opened is closed; a run left open by a refusal is
   * tolerated (the projection reads it as still open), so this never throws. A
   * session still OPENING holds nothing to release — no write can have reached a run
   * before the session it needs exists — and a session that FAILED to open never
   * read a tree at all.
   *
   * A session that only READ has no run, and the line says so instead of naming
   * one: closing is the last chance to write, and this is where a connection that
   * touched nothing would otherwise leave a whole run behind.
   *
   * The line names the runs rather than counting them, in both halves. A connection
   * that wrote to three projects ends three runs in three records, and a count
   * would leave a reader of the host's log unable to pair any of them with what
   * they can read on disk — which is the whole use of this line.
   */
  const closeNow = (): void => {
    if (openedSession === undefined) return;
    const { closed, leftOpen } = closeSession(openedSession);
    log(
      closed.length === 0 && leftOpen.length === 0
        ? 'session closed: no run was opened (nothing was written)'
        : `session closed: ${runList('closed', closed)}${
            leftOpen.length > 0 ? `; ${runList('left open', leftOpen)}` : ''
          }`,
    );
  };

  /**
   * Arms every way this process can learn its connection ended, and returns the
   * guarded closer they share.
   *
   * The connection ending is a fact about the PROCESS, not about the transport: the
   * SDK's server side never calls its own `close()`, so its `onclose` had no caller
   * and every session that wrote anything leaked its runs, in all six exit modes.
   */
  const armClose = (lifecycle?: Lifecycle): (() => void) =>
    armSessionClose({ close: closeNow, ...(lifecycle !== undefined ? { lifecycle } : {}) });

  const connect = async (): Promise<void> => {
    const transport = new StdioServerTransport();
    const closeOnce = armClose();
    // Still wired, and now harmless to double-fire: if a future SDK does call its own
    // close, the session ends once either way.
    transport.onclose = closeOnce;
    await server.connect(transport);
  };

  return { server, connect, armClose };
}

/**
 * Registers the tools. Each is a thin wrapper: it ensures the session, calls the
 * pure adapter, and shapes the response. The wiring adds only the schema and the
 * text envelope; all behavior is in the adapter and the core.
 */
function registerTools(server: McpServer, ensureSession: () => Promise<Session>): void {
  server.registerTool(
    'capture_memory',
    {
      title: 'Capture a memory',
      description:
        'Record a point-in-time fact into the mnema chain, attributed to this ' +
        'agent and pinned to the current session. Optionally pick the scope it ' +
        'lands in — public (team-visible), private (this machine, this project), ' +
        'or global (personal, cross-project); omitted, it follows the session ' +
        'default (private in a project, global outside one). Optionally pick the ' +
        'project it lands in, when the workspace holds more than one.' +
        RECORD_CONTRACT,
      inputSchema: {
        content: z.string().min(1).describe('The memory to record.'),
        scope: z
          .enum(['public', 'private', 'global'])
          .optional()
          .describe('Where the memory lands; overrides the session default.'),
        project: PROJECT_ARG,
      },
    },
    async ({ content, scope, project }) => {
      const active = await ensureSession();
      const result = runCaptureMemory(active, {
        content,
        ...(scope !== undefined ? { scope } : {}),
        ...(project !== undefined ? { project } : {}),
      });
      if (!result.ok) {
        // The override named a tree absent here — surface it as a tool error so
        // the agent sees the capture did not happen, not a silent no-op.
        return {
          isError: true,
          content: [{ type: 'text', text: `Refused (${result.code}): ${result.message}` }],
        };
      }
      return recorded(`Captured memory ${result.id}`, result);
    },
  );

  server.registerTool(
    'record_observation',
    {
      title: 'Record an observation',
      description:
        'Record an observation ABOUT an entity (a task, decision, …) into the ' +
        'mnema chain, attributed to this agent and pinned to the current session. ' +
        'It carries the observed entity id (`about`), a short `topic`, and the ' +
        'observation `text`. The `about` id is NOT checked to exist — a reference ' +
        'to an entity in another tree is honest and resolved on read. Optionally ' +
        'pick the scope and the project it lands in; omitted, both follow the ' +
        'session default. Returns the observation’s own minted id.' +
        RECORD_CONTRACT,
      inputSchema: {
        about: z.string().min(1).describe('The id of the entity being observed.'),
        topic: z.string().min(1).describe('A short topic label.'),
        text: z.string().min(1).describe('The observation itself.'),
        scope: z
          .enum(['public', 'private', 'global'])
          .optional()
          .describe('Where the observation lands; overrides the session default.'),
        project: PROJECT_ARG,
      },
    },
    async ({ about, topic, text, scope, project }) => {
      const active = await ensureSession();
      const result = runRecordObservation(active, {
        about,
        topic,
        text,
        ...(scope !== undefined ? { scope } : {}),
        ...(project !== undefined ? { project } : {}),
      });
      if (!result.ok) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Refused (${result.code}): ${result.message}` }],
        };
      }
      return recorded(`Recorded observation ${result.id} about ${about}`, result);
    },
  );

  server.registerTool(
    'record_handoff',
    {
      title: 'Record a handoff',
      description:
        'Record a handoff on a task — work passed from one agent to another — into ' +
        'the mnema chain, attributed to this agent and pinned to the current ' +
        'session. It carries the `task` and the two agent labels (`from`, `to`); ' +
        '`from == to` is legitimate (a chat restart). The `task` id is NOT checked ' +
        'to exist. Optionally pick the scope and the project; omitted, both follow ' +
        'the session default. A handoff has no id of its own — its subject is the task.' +
        RECORD_CONTRACT,
      inputSchema: {
        task: z.string().min(1).describe('The task the handoff is about.'),
        from: z.string().min(1).describe('The agent handing off.'),
        to: z.string().min(1).describe('The agent taking over (may equal `from`).'),
        scope: z
          .enum(['public', 'private', 'global'])
          .optional()
          .describe('Where the handoff lands; overrides the session default.'),
        project: PROJECT_ARG,
      },
    },
    async ({ task, from, to, scope, project }) => {
      const active = await ensureSession();
      const result = runRecordHandoff(active, {
        task,
        from,
        to,
        ...(scope !== undefined ? { scope } : {}),
        ...(project !== undefined ? { project } : {}),
      });
      if (!result.ok) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Refused (${result.code}): ${result.message}` }],
        };
      }
      // The labels the RECORD holds, not the ones the call asked for.
      const [landedFrom, landedTo] = result.recorded;
      return recorded(`Recorded handoff on ${task}: ${landedFrom} → ${landedTo}`, result);
    },
  );

  server.registerTool(
    'link_knowledge',
    {
      title: 'Link knowledge',
      description:
        'Link one piece of knowledge to another — a directed edge from a `subject` ' +
        'entity to a `target` entity, labeled by a relation `rel`. The relation is ' +
        'an OPEN string (recommended: supersedes, relates-to, derived-from, ' +
        'contradicts; any label is accepted). Neither endpoint is checked to ' +
        'exist — a link is legitimately cross-tree, resolved on read. Optionally ' +
        'pick the scope and the project the EDGE is recorded in; omitted, both ' +
        'follow the session default. A link has no id of its own — it is an edge.' +
        RECORD_CONTRACT,
      inputSchema: {
        subject: z.string().min(1).describe('The entity that originates the link.'),
        target: z.string().min(1).describe('The entity linked to.'),
        rel: z.string().min(1).describe('The relation label (an open string).'),
        scope: z
          .enum(['public', 'private', 'global'])
          .optional()
          .describe('Where the link lands; overrides the session default.'),
        project: PROJECT_ARG,
      },
    },
    async ({ subject, target, rel, scope, project }) => {
      const active = await ensureSession();
      const result = runLinkKnowledge(active, {
        subject,
        target,
        rel,
        ...(scope !== undefined ? { scope } : {}),
        ...(project !== undefined ? { project } : {}),
      });
      if (!result.ok) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Refused (${result.code}): ${result.message}` }],
        };
      }
      // The relation the RECORD holds, not the one the call asked for.
      return recorded(`Linked ${subject} —${result.recorded[0]}→ ${target}`, result);
    },
  );

  server.registerTool(
    'create_task',
    {
      title: 'Create a task',
      description:
        'Open a task in the mnema chain, attributed to this agent and pinned to ' +
        'the current session. A task needs a title; it starts in the workflow’s ' +
        'initial state and is moved from there with task_transition. Optionally ' +
        'pick the scope it lands in — public (team-visible), private (this ' +
        'machine, this project), or global (personal, cross-project); omitted, it ' +
        'follows the session default. Optionally pick the project it lands in, when ' +
        'the workspace holds more than one. Returns the minted id (the key to move ' +
        'it) and the short alias a human reads.' +
        RECORD_CONTRACT,
      inputSchema: {
        title: z.string().min(1).describe('What the task is.'),
        scope: z
          .enum(['public', 'private', 'global'])
          .optional()
          .describe('Where the task lands; overrides the session default.'),
        project: PROJECT_ARG,
      },
    },
    async ({ title, scope, project }) => {
      const active = await ensureSession();
      const result = runCreateTask(active, {
        title,
        ...(scope !== undefined ? { scope } : {}),
        ...(project !== undefined ? { project } : {}),
      });
      if (!result.ok) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Refused (${result.code}): ${result.message}` }],
        };
      }
      return recorded(`Created task ${result.alias} (${result.id})`, result);
    },
  );

  server.registerTool(
    'task_transition',
    {
      title: 'Move a task through the workflow',
      description:
        'Move an existing task to a new state (submit, start, block, unblock, ' +
        'submit_review, request_changes, approve, complete, cancel, reopen). The ' +
        'workflow gate decides whether the move is legal and carries the proof it ' +
        'requires — cancel/block/reopen need a reason, complete/approve a note, ' +
        'request_changes a feedback; an illegal move or missing proof is refused. ' +
        'The task is looked for in EVERY project of this workspace and the move lands ' +
        'in the project that holds it, so no `project` is taken here: the id decides ' +
        'where the move goes.' +
        RECORD_CONTRACT,
      inputSchema: {
        id: z.string().min(1).describe('The task id to move.'),
        action: z.string().min(1).describe('The transition to request.'),
        reason: z.string().optional().describe('Why (cancel, block, reopen).'),
        note: z.string().optional().describe('What was done (complete, approve).'),
        feedback: z.string().optional().describe('What must change (request_changes).'),
      },
    },
    async ({ id, action, reason, note, feedback }) => {
      const active = await ensureSession();
      const result = runTaskTransition(active, {
        id,
        action,
        ...(reason !== undefined ? { reason } : {}),
        ...(note !== undefined ? { note } : {}),
        ...(feedback !== undefined ? { feedback } : {}),
      });
      if (!result.ok) {
        // The gate refused — surface it as a tool error so the agent sees the
        // move did not happen, with the gate's own reason. Not a crash: a
        // refusal is a legitimate answer, returned as data.
        return {
          isError: true,
          content: [{ type: 'text', text: `Refused (${result.code}): ${result.message}` }],
        };
      }
      return recorded(`Task ${result.alias} → ${result.to}`, result);
    },
  );

  server.registerTool(
    'record_decision',
    {
      title: 'Record a decision',
      description:
        'Record a decision into the mnema chain, attributed to this agent and ' +
        'pinned to the current session. A decision needs both a title and a ' +
        'rationale (why it was made). Optionally pick the scope it lands in — ' +
        'public (team-visible), private (this machine, this project), or global ' +
        '(personal, cross-project); omitted, it follows the session default. ' +
        'Optionally pick the project it lands in, when the workspace holds more ' +
        'than one. Returns the citable ADR-<n> label — a decision has no short alias.' +
        RECORD_CONTRACT,
      inputSchema: {
        title: z.string().min(1).describe('The decision title.'),
        rationale: z.string().min(1).describe('Why the decision was made.'),
        scope: z
          .enum(['public', 'private', 'global'])
          .optional()
          .describe('Where the decision lands; overrides the session default.'),
        project: PROJECT_ARG,
      },
    },
    async ({ title, rationale, scope, project }) => {
      const active = await ensureSession();
      const result = runRecordDecision(active, {
        title,
        rationale,
        ...(scope !== undefined ? { scope } : {}),
        ...(project !== undefined ? { project } : {}),
      });
      if (!result.ok) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Refused (${result.code}): ${result.message}` }],
        };
      }
      return recorded(`Recorded decision ${result.adr} (${result.id})`, result);
    },
  );

  server.registerTool(
    'decision_transition',
    {
      title: 'Move a decision through the workflow',
      description:
        'Move an existing decision to a new state. accept and reject a proposed ' +
        'decision (each needs a note); supersede a proposed or accepted decision ' +
        'with a later one — supersede needs the successor decision id in `by` and ' +
        'a reason. `by` applies ONLY to supersede; accept and reject ignore it. ' +
        'An illegal move or missing proof is refused with the gate’s reason. The ' +
        'decision is looked for in EVERY project of this workspace and the move lands ' +
        'in the project that holds it — the id decides, so no `project` is taken.' +
        RECORD_CONTRACT,
      inputSchema: {
        id: z.string().min(1).describe('The decision id to move.'),
        action: z.string().min(1).describe('The transition: accept, reject, or supersede.'),
        by: z
          .string()
          .optional()
          .describe('The successor decision id — required by supersede, ignored otherwise.'),
        note: z.string().optional().describe('Why this verdict (accept, reject).'),
        reason: z.string().optional().describe('Why it is being replaced (supersede).'),
      },
    },
    async ({ id, action, by, note, reason }) => {
      const active = await ensureSession();
      const result = runDecisionTransition(active, {
        id,
        action,
        ...(by !== undefined ? { by } : {}),
        ...(note !== undefined ? { note } : {}),
        ...(reason !== undefined ? { reason } : {}),
      });
      if (!result.ok) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Refused (${result.code}): ${result.message}` }],
        };
      }
      return recorded(`Decision ${result.adr} → ${result.to}`, result);
    },
  );

  server.registerTool(
    'create_skill',
    {
      title: 'Propose a skill',
      description:
        'Propose a reusable pattern (a skill) into the mnema chain, attributed to ' +
        'this agent and pinned to the current session. A skill needs both a name ' +
        '(a short title) and a body (the reusable pattern itself). Optionally pick ' +
        'the scope it lands in — public (team-visible), private (this machine, ' +
        'this project), or global (personal, cross-project); omitted, it follows ' +
        'the session default. Optionally pick the project it lands in, when the ' +
        'workspace holds more than one. Returns the minted id (the key to move it) ' +
        'and the name — a skill has no short alias.' +
        RECORD_CONTRACT,
      inputSchema: {
        name: z.string().min(1).describe('A short title for the pattern.'),
        body: z.string().min(1).describe('The reusable pattern itself.'),
        scope: z
          .enum(['public', 'private', 'global'])
          .optional()
          .describe('Where the skill lands; overrides the session default.'),
        project: PROJECT_ARG,
      },
    },
    async ({ name, body, scope, project }) => {
      const active = await ensureSession();
      const result = runCreateSkill(active, {
        name,
        body,
        ...(scope !== undefined ? { scope } : {}),
        ...(project !== undefined ? { project } : {}),
      });
      if (!result.ok) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Refused (${result.code}): ${result.message}` }],
        };
      }
      return recorded(`Proposed skill "${result.name}" (${result.id})`, result);
    },
  );

  server.registerTool(
    'skill_transition',
    {
      title: 'Move a skill through the workflow',
      description:
        'Move an existing skill to a new state: review a proposed skill, adopt a ' +
        'reviewed one as a live pattern, reject a proposed or reviewed one, or ' +
        'deprecate an adopted one that fell out of use. review/adopt/reject each ' +
        'need a note; deprecate needs a reason. An illegal move or missing proof ' +
        'is refused with the gate’s reason. The skill is looked for in EVERY project ' +
        'of this workspace and the move lands in the project that holds it — the id ' +
        'decides, so no `project` is taken.' +
        RECORD_CONTRACT,
      inputSchema: {
        id: z.string().min(1).describe('The skill id to move.'),
        action: z.string().min(1).describe('The transition: review, adopt, reject, or deprecate.'),
        note: z.string().optional().describe('Why this verdict (review, adopt, reject).'),
        reason: z.string().optional().describe('Why it fell out of use (deprecate).'),
      },
    },
    async ({ id, action, note, reason }) => {
      const active = await ensureSession();
      const result = runSkillTransition(active, {
        id,
        action,
        ...(note !== undefined ? { note } : {}),
        ...(reason !== undefined ? { reason } : {}),
      });
      if (!result.ok) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Refused (${result.code}): ${result.message}` }],
        };
      }
      return recorded(`Skill "${result.name}" → ${result.to}`, result);
    },
  );

  server.registerTool(
    'bootstrap',
    {
      title: 'Bootstrap the session',
      description:
        "The opening context for this session's actor: where they left off and " +
        'the actionable work, derived from the chain.' +
        OPEN_RUN_CONTRACT,
    },
    async () => {
      const active = await ensureSession();
      const context = runBootstrap(active);
      // The opening read carries the same note as `resume`, whose answer it embeds —
      // and carries it most usefully, being the first thing an agent asks. It carries
      // WHERE it is reading from for the same reason: this is the first thing read,
      // so it is the cheapest place to learn that the workspace holds more than one
      // project — and the agent is the party that can pass that on to the person who
      // knows which one was meant.
      return withRunState(active, context, [whereThisSessionIs(active)]);
    },
  );

  server.registerTool(
    'skills',
    {
      title: 'Skills — the adopted patterns to work by',
      description:
        'Read the adopted patterns (skills) this project and machine work by — ' +
        'the reusable recipe, checklist or convention itself, not just its name. ' +
        'Call it with no `id` (an empty argument object) to get every adopted ' +
        'pattern with its body, or with an `id` from the bootstrap list to get ' +
        'just that one. Only adopted ' +
        'patterns are served: a proposed, rejected or deprecated skill is not a way ' +
        'of working and is refused. Consulting a pattern is RECORDED against this ' +
        'session (once per skill), so the record shows which work was informed by ' +
        'which pattern — it records that you read it, never that you followed it.' +
        SERVED_PATTERN_CONTRACT,
      inputSchema: {
        id: z
          .string()
          .min(1)
          .optional()
          .describe('A single skill id to read; omitted, every adopted pattern.'),
      },
    },
    async ({ id }) => {
      const active = await ensureSession();
      const result = runSkillsTool(active, { ...(id !== undefined ? { id } : {}) });
      if (!result.ok) {
        // No such skill, not an adopted pattern, or the consultation could not be
        // recorded — surface it so the agent never mistakes a refusal for "there
        // are no patterns here".
        return {
          isError: true,
          content: [{ type: 'text', text: `Refused (${result.code}): ${result.message}` }],
        };
      }
      // Serving a pattern RECORDS a consultation, so this read is also a write —
      // and the one report a write must never swallow is what it replaced. The
      // agent name rides on that fact's envelope like any other, so if it held a
      // credential this reply is where the caller can still rotate it.
      const notice = replacementNotice(result.replaced);
      // The payload FIRST, then the framing, then the notice. The bodies are the
      // answer; the framing is a statement about the answer (what a pattern is,
      // and who adopted each one), and it travels as its own block so the payload
      // stays byte-identical to what a caller parsed before it existed.
      const framing = servedPatternsFraming(result.skills);
      return {
        content: [
          { type: 'text', text: JSON.stringify(result.skills, null, 2) },
          ...(framing.length > 0 ? [{ type: 'text' as const, text: framing.join('\n') }] : []),
          ...(notice.length > 0 ? [{ type: 'text' as const, text: notice.join('\n') }] : []),
        ],
      };
    },
  );

  server.registerTool(
    'focus',
    {
      title: 'Focus — what I am touching now',
      description:
        'Show the open runs of THIS session’s actor — the work in flight right ' +
        'now. Use it to answer "what am I in the middle of". Read-only: it derives ' +
        'from the chain and writes nothing. Reports only this machine’s own open ' +
        'runs (the actor is the session, never a supplied value).' +
        OPEN_RUN_CONTRACT,
    },
    async () => {
      const active = await ensureSession();
      const result = runFocusTool(active);
      return withRunState(active, result);
    },
  );

  server.registerTool(
    'resume',
    {
      title: 'Resume — where I left off',
      description:
        'Show where THIS session’s actor left off: their most recent run (open OR ' +
        'already ended) plus their current focus. Use it at the start of a session ' +
        'to answer "where was I" — even a run that ended carries the goal that ' +
        'reminds you. When this session has a run of its own here, that is the one ' +
        'reported. Read-only: it derives from the chain and writes nothing.' +
        OPEN_RUN_CONTRACT,
    },
    async () => {
      const active = await ensureSession();
      const result = runResumeTool(active);
      return withRunState(active, result);
    },
  );

  server.registerTool(
    'next_actions',
    {
      title: 'Next actions — what moves a task allows',
      description:
        'Show the transitions the workflow allows a task next, from its current ' +
        'state. Use it to answer "what can I do to this task" — each suggestion is a ' +
        'real move the gate would authorize. A terminal task returns an empty list ' +
        '(no legal moves). The task is looked for in EVERY project of this workspace; ' +
        'an id no tree of it holds is refused, naming the projects searched. Read-only.',
      inputSchema: {
        id: z.string().min(1).describe('The task id to inspect.'),
      },
    },
    async ({ id }) => {
      const active = await ensureSession();
      const result = runNextActionsTool(active, { id });
      if (!result.ok) {
        // No tree of the workspace holds the task, or two records do — surface it as
        // a tool error so the agent sees there is no ONE such task, not an empty
        // (misleadable) list.
        return {
          isError: true,
          content: [{ type: 'text', text: `Refused (${result.code}): ${result.message}` }],
        };
      }
      return { content: [{ type: 'text', text: JSON.stringify(result.actions, null, 2) }] };
    },
  );

  server.registerTool(
    'guard',
    {
      title: 'Guard — would a move be allowed?',
      description:
        'Simulate whether a task transition would be permitted BEFORE trying it — ' +
        'a dry-run of the workflow gate that writes NOTHING. Use it to answer "may ' +
        'I approve/complete/… this task, and if not, why?" without making the move. ' +
        'It reads the task’s current state and returns the gate’s own verdict: ' +
        'ALLOWED (with the state the move would reach) or REFUSED (with the gate’s ' +
        'reason — an illegal move, missing proof, or who == which). Pass the same ' +
        'proof you would carry (note/reason/feedback) to see if that proof suffices. ' +
        'The verdict is paired with your current focus. The task is looked for in ' +
        'EVERY project of this workspace — the same search `task_transition` makes, so ' +
        'a verdict here and the move agree; an id no tree of it holds is refused, ' +
        'naming the projects searched. Read-only.' +
        OPEN_RUN_CONTRACT,
      inputSchema: {
        id: z.string().min(1).describe('The task id to test.'),
        action: z.string().min(1).describe('The transition to simulate.'),
        reason: z.string().optional().describe('Simulate the reason (cancel, block, reopen).'),
        note: z.string().optional().describe('Simulate the note (complete, approve).'),
        feedback: z.string().optional().describe('Simulate the feedback (request_changes).'),
        which: z
          .string()
          .optional()
          .describe('Simulate an executing agent (must differ from the session actor).'),
      },
    },
    async ({ id, action, reason, note, feedback, which }) => {
      const active = await ensureSession();
      const result = runGuardTool(active, {
        id,
        action,
        ...(reason !== undefined ? { reason } : {}),
        ...(note !== undefined ? { note } : {}),
        ...(feedback !== undefined ? { feedback } : {}),
        ...(which !== undefined ? { which } : {}),
      });
      if (!result.ok) {
        // No tree of the workspace holds the task, or two records do — surface it as
        // a tool error so the agent
        // sees there is no such task, not a misleadable empty verdict.
        return {
          isError: true,
          content: [{ type: 'text', text: `Refused (${result.code}): ${result.message}` }],
        };
      }
      // A REFUSED verdict is NOT a tool error — the dry-run succeeded and its
      // answer is "the move would be refused, here is why". Return the verdict
      // (and focus) as data so the agent reads the reason, exactly as it would
      // from the real move's refusal.
      //
      // The verdict travels WITH the asker's focus, so this reply lists runs like
      // `focus` does — and carries the same note for the same reason: "here is
      // what you are in the middle of" must not answer for the connection.
      return withRunState(active, result.result);
    },
  );

  server.registerTool(
    'search',
    {
      title: 'Search — find what has been recorded',
      description:
        'Search everything recorded in EVERY project of this workspace and on this ' +
        'machine — memories, observations, decisions, tasks and skills — by the words ' +
        'a person wrote in them. Use it to answer "have we written about X?" or ' +
        '"what did we decide about Y?" BEFORE assuming nothing is recorded. ' +
        'With NO term it lists the most recent records instead ("what has been ' +
        'going on here" — call it with an empty argument object). Narrow with ' +
        'kind, scope, state or a time window. ' +
        'Returns an INDEX — id, kind, tree, project, when, and one line each — not ' +
        'the bodies; take an id to `read_record` for the whole thing. It searches ' +
        'every tree it can see (the team’s, this machine’s, your own) in every ' +
        'project you have open, and each hit says which project and which tree hold ' +
        'it. Two limits worth knowing: each tree ranks its own matches against its ' +
        'own words, so the merged order is a good approximation and not one global ' +
        'ranking; and `limit` can fill the answer from one project — when it leaves ' +
        'another project’s matches out entirely, the reply names that project under ' +
        '`hidden`, and asking again with a larger limit reaches them. Read-only.',
      inputSchema: {
        term: z
          .string()
          .optional()
          .describe('Words to look for; omit to list the most recent records.'),
        kind: z.enum(SEARCH_KINDS).optional().describe('Only this kind of record.'),
        scope: z
          .enum(['public', 'private', 'global'])
          .optional()
          .describe('Only this tree; omitted, every tree this session can see.'),
        state: z
          .string()
          .optional()
          .describe('Only records in this state (excludes kinds that have none).'),
        from: z.string().optional().describe('Only records at or after this ISO-8601 instant.'),
        to: z.string().optional().describe('Only records at or before this ISO-8601 instant.'),
        limit: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            `How many hits to return (default ${SEARCH_DEFAULT_LIMIT}, max ${SEARCH_MAX_LIMIT}).`,
          ),
      },
    },
    async ({ term, kind, scope, state, from, to, limit }) => {
      const active = await ensureSession();
      const result = runSearchTool(active, {
        ...(term !== undefined ? { term } : {}),
        ...(kind !== undefined ? { kind } : {}),
        ...(scope !== undefined ? { scope } : {}),
        ...(state !== undefined ? { state } : {}),
        ...(from !== undefined ? { from } : {}),
        ...(to !== undefined ? { to } : {}),
        ...(limit !== undefined ? { limit } : {}),
      });
      if (!result.ok) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Refused (${result.code}): ${result.message}` }],
        };
      }
      // An empty index is an ANSWER ("nothing here matches"), never an error.
      return { content: [{ type: 'text', text: JSON.stringify(result.value, null, 2) }] };
    },
  );

  server.registerTool(
    'read_record',
    {
      title: 'Read record — one whole record by id',
      description:
        'Read ONE record in full — a memory’s content, a decision’s rationale, an ' +
        'observation’s text, a task — by the id `search` gave. This is the second ' +
        'half of a search: the index tells you what exists, this tells you what it ' +
        'says. It looks in EVERY project of this workspace, not only the one you are ' +
        'working in — an id is minted once and lives in one place — and the answer ' +
        'says which project and which tree hold it. A skill id is refused here and ' +
        'pointed at the `skills` tool, which serves the adopted patterns and records ' +
        'the consultation. An id no project holds is refused, in a reply that names ' +
        'where it looked. Read-only.',
      inputSchema: {
        id: z.string().min(1).describe('The record id (from `search`).'),
      },
    },
    async ({ id }) => {
      const active = await ensureSession();
      const result = runReadRecordTool(active, { id });
      if (!result.ok) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Refused (${result.code}): ${result.message}` }],
        };
      }
      return { content: [{ type: 'text', text: JSON.stringify(result.value, null, 2) }] };
    },
  );

  // The three INTELLIGENCE tools, prefixed `audit_` — the AUDITOR's view over a UNION
  // of trees (distinct from the session reads focus/resume/guard, which serve the
  // session's own tree and carry no prefix). Each folds every tree it covers into one
  // view and returns the faithful object. Read-only: they read the tails and fold
  // them, opening no writer and no cache. With no project a session has no record to
  // audit — refused.
  //
  // ALL FIVE span every project of the workspace, and what differs between them is what
  // each may MERGE from that one list — by the shape of the answer, never by an option.
  // The two keyed by an id merge ITEMS: an id has one home, what points at it lives
  // wherever the pointing happened, and a merged list of labelled items adds without
  // changing. `audit_accountability` and `audit_antipatterns` merge nothing: they
  // return counts, one record at a time, because summing several would answer "how much
  // have I written" under the name of "how much is in this record".
  //
  // `audit_exposure` is where both halves of that rule land in ONE answer: the findings
  // merge (each naming the project to rotate in) and the denominator decomposes (one
  // count per record). Two of these fold the TAILS rather than the caches, which is a
  // different mechanism for reaching a project and a real cost — the trees are the same
  // list either way, so the coverage of an answer never depends on how it is computed.

  server.registerTool(
    'audit_timeline',
    {
      title: 'Audit — the full history of an entity',
      description:
        'Show the complete history of one entity (a task, decision, skill, …) ' +
        'across ALL trees of ALL projects in this workspace: every event where it is ' +
        'the subject, plus events that refer to it (an observation about it, a link ' +
        'whose target is it) — which may live in another tree, or in another project. ' +
        'Use it to answer "tell me the whole story of this entity", including the part ' +
        'that happened in a sibling codebase; each entry says which project it came ' +
        'from. An id no event touches returns an empty history (a valid answer). ' +
        'Read-only.',
      inputSchema: {
        id: z.string().min(1).describe('The entity id whose history to show.'),
      },
    },
    async ({ id }) => {
      const active = await ensureSession();
      const result = runTimelineTool(active, { id });
      if (!result.ok) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Refused (${result.code}): ${result.message}` }],
        };
      }
      return { content: [{ type: 'text', text: JSON.stringify(result.value, null, 2) }] };
    },
  );

  server.registerTool(
    'audit_refs',
    {
      title: 'Audit — what an entity is connected to',
      description:
        'Show what one entity is connected to across ALL trees of ALL projects in ' +
        'this workspace: the observations about it, the links into and out of it, the ' +
        'decision that superseded it. Use it after `search` to pull on a thread — ' +
        '"what else is tied to this?". By default it is the NEIGHBOURHOOD (one hop, ' +
        'either direction); set `direction` to "out" (what it points at) or "in" ' +
        '(what points at it) with a larger `depth` to follow a lineage, such as a ' +
        'decision’s supersede chain. `direction: "in"` is how you answer "have I ' +
        'already applied this in my other projects?" — the things that point at it ' +
        'are in THEIR records, and every edge says which project asserts it. A far ' +
        'end no visible tree holds comes back marked unresolved — that is legitimate, ' +
        'not an error — and the answer says when the depth cut it. Read-only.',
      inputSchema: {
        id: z.string().min(1).describe('The entity id to walk from (from `search`).'),
        direction: z
          .enum(['both', 'out', 'in'])
          .optional()
          .describe('Which way to follow edges; omitted, both.'),
        depth: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            `How many hops (default ${REFERENCE_DEFAULT_DEPTH}, max ${REFERENCE_MAX_DEPTH}).`,
          ),
      },
    },
    async ({ id, direction, depth }) => {
      const active = await ensureSession();
      const result = runReferencesTool(active, {
        id,
        ...(direction !== undefined ? { direction } : {}),
        ...(depth !== undefined ? { depth } : {}),
      });
      if (!result.ok) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Refused (${result.code}): ${result.message}` }],
        };
      }
      // An entity nothing references is an ANSWER ("nothing is tied to this"),
      // never an error — the same reason an empty history is one.
      return { content: [{ type: 'text', text: JSON.stringify(result.value, null, 2) }] };
    },
  );

  server.registerTool(
    'audit_accountability',
    {
      title: 'Audit — who authorized what',
      description:
        'Show who authorized what and which agent executed it, across ALL trees of ' +
        'ALL projects in this workspace. Use it to answer "who did what" over the ' +
        'whole record — with no filter it accounts for everything (like git ' +
        'shortlog). Optionally narrow by a time window (from/to), a single author ' +
        '(who), or a single executing agent (which). The answer is ONE ACCOUNT PER ' +
        'PROJECT (plus the machine-global tree, which belongs to none) — each with ' +
        'its own total and per-author breakdown (counts by kind and by executing ' +
        'agent). There is deliberately no combined total: a count belongs to a ' +
        'record, and adding several projects up answers "how much have I written ' +
        'anywhere" under the name of "how much is in this record". Add them yourself ' +
        'if that is your question. A project with nothing to report is listed at ' +
        'zero rather than left out. Read-only.',
      inputSchema: {
        from: z
          .string()
          .optional()
          .describe('Include only facts at or after this ISO-8601 instant.'),
        to: z
          .string()
          .optional()
          .describe('Include only facts at or before this ISO-8601 instant.'),
        who: z.string().optional().describe('Count only facts authorized by this anchor id.'),
        which: z.string().optional().describe('Count only facts executed by this agent.'),
      },
    },
    async ({ from, to, who, which }) => {
      const active = await ensureSession();
      const result = runAccountabilityTool(active, {
        ...(from !== undefined ? { from } : {}),
        ...(to !== undefined ? { to } : {}),
        ...(who !== undefined ? { who } : {}),
        ...(which !== undefined ? { which } : {}),
      });
      if (!result.ok) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Refused (${result.code}): ${result.message}` }],
        };
      }
      return { content: [{ type: 'text', text: JSON.stringify(result.value, null, 2) }] };
    },
  );

  server.registerTool(
    'audit_exposure',
    {
      title: 'Audit — where a credential may already be recorded',
      description:
        'Show which records hold something shaped like a credential — a cloud key, ' +
        'an API token, a private key, a password inside a URL — across ALL trees of ' +
        'ALL projects in this workspace. Use it to answer "is a secret already in the ' +
        'record?", which writing can no longer cause but the past can: values in a ' +
        'recognized format are replaced before anything is written today, and ' +
        'everything recorded before that was not. It reports WHERE and never WHAT: ' +
        'the id, the kind, the tree, the PROJECT and the instant, plus the CLASS — ' +
        'never the value, so reading it cannot leak what it found. A record in a ' +
        'public tree is committed and clones to every machine; one in the global tree ' +
        'is on this disk alone; and the project says which repository to go and ' +
        'change a key in. The remedy is to ROTATE the credential: mnema is ' +
        'append-only and nothing deletes a fact. `scanned` is ONE COUNT PER RECORD — ' +
        'each project and the machine-global tree — so an empty `findings` says which ' +
        'records were read and how much of each. Two limits: it recognizes FORMATS, ' +
        'so an empty report means nothing recognizable rather than nothing (a ' +
        'password in prose has no format); and it reports what is recorded — it does ' +
        'not prevent a value from being read back by `search` or `read_record`, which ' +
        'serve the record as written. Read-only.',
    },
    async () => {
      const active = await ensureSession();
      const result = runExposureTool(active);
      if (!result.ok) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Refused (${result.code}): ${result.message}` }],
        };
      }
      // An empty report is an ANSWER ("nothing recognizable is recorded here"),
      // never an error — the same reason an empty history is one.
      return { content: [{ type: 'text', text: JSON.stringify(result.value, null, 2) }] };
    },
  );

  server.registerTool(
    'audit_antipatterns',
    {
      title: 'Audit — recurring shapes in the record',
      description:
        'Show recurring shapes across ALL trees of ALL projects in this workspace — ' +
        'tasks reopened, decisions superseded, skills deprecated — each with the exact ' +
        'events that make up the count, plus the tasks reopened more than once as ' +
        'skill CANDIDATES (a POINTER, not an action — this creates no skill). It ' +
        'reports the shapes; it does NOT judge them good or bad. Use it to spot ' +
        'patterns a human might act on. The answer is ONE SET OF SHAPES PER PROJECT ' +
        '(plus the machine-global tree, which belongs to none): these are counts, and ' +
        'adding several projects up would answer a question about a workspace under ' +
        'the name of a question about a record — a skill candidate especially, since ' +
        'the pattern is distilled by whoever is doing the work that kept reopening. A ' +
        'project with nothing recurring is listed with empty lists rather than left ' +
        'out. Read-only.',
    },
    async () => {
      const active = await ensureSession();
      const result = runAntipatternsTool(active);
      if (!result.ok) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Refused (${result.code}): ${result.message}` }],
        };
      }
      return { content: [{ type: 'text', text: JSON.stringify(result.value, null, 2) }] };
    },
  );
}

/**
 * Lists the client's workspace roots, returning an empty list on any failure —
 * a client without the `roots` capability makes `listRoots` reject, which is not
 * an error here but the signal to fall back to the global tree.
 */
async function listRootsSafely(
  server: McpServer,
  log: (line: string) => void,
): Promise<readonly string[]> {
  if (server.server.getClientCapabilities()?.roots === undefined) return [];
  try {
    const result = await server.server.listRoots();
    return result.roots.map((root) => root.uri);
  } catch (error) {
    log(`roots/list unavailable: ${messageOf(error)}`);
    return [];
  }
}

/**
 * A write tool's successful reply: what landed, plus what the content door
 * replaced on the way in.
 *
 * One helper for all ten, because a scrub the caller is not told about is the tool
 * writing something other than what was asked for and saying nothing — and the
 * caller is the only party that can still act on it (rotate the credential, warn
 * the person, record the thing again without it). The notice is absent when nothing
 * was replaced, so the ordinary write reads exactly as it did before.
 */
function recorded(
  line: string,
  result: Replacement,
): { readonly content: [{ readonly type: 'text'; readonly text: string }] } {
  return {
    content: [{ type: 'text', text: [line, ...replacementNotice(result.replaced)].join('\n') }],
  };
}

/**
 * An actor read's reply, plus one sentence when this session has not opened a run.
 *
 * The reads that answer about RUNS answer about the ACTOR, not the connection: they
 * list the runs this machine's anchor has open and the last one it worked in,
 * wherever those came from. That answer is complete on its own, and it is also the
 * answer most likely to be read as being about the asking session — an empty focus
 * reads as "you have nothing in flight" when what is true is "this connection has
 * not started anything, and a run opens when you first write". One is a fact about
 * the record, the other about this connection, and the reply now carries both.
 *
 * FOUR reads reach this, and they are all of them: `focus` (the runs themselves),
 * `resume` (the latest run plus that focus), `bootstrap` (which embeds the resume)
 * and `guard` (whose verdict travels paired with the asker's focus). The rule is
 * the payload, not the tool: a read that lists the actor's runs says whose they
 * are. Nothing else on the surface lists a run — the index does not carry them,
 * `read_record` refuses a run id, and the auditor reads answer about the record
 * rather than about this connection.
 *
 * WHOSE EACH RUN IS is no longer said here, and that is the correction. This sentence
 * used to carry both halves — "this session has opened none" AND "so anything listed
 * is from elsewhere" — which meant the qualifier switched OFF for exactly the session
 * that needed it most: one that had written, and therefore had its own run mixed in
 * with the ones it did not open. It is a property of each run, so it travels on each
 * run (`thisSession`, see {@link OPEN_RUN_CONTRACT}) and cannot switch off.
 *
 * What stays is the half that really is about the connection and really does vary:
 * whether this one has opened a run at all. It is absent from the record by design
 * (the run waits for the first write), so nothing in the payload could say it.
 *
 * It travels as its OWN content block, never merged into the JSON: the payload stays
 * byte-identical to what a caller parsed before this sentence existed, and the
 * derivation stays the copilot's — a note about the connection has no business
 * inside a shape the domain defines.
 *
 * `also` carries any further sentences a particular read adds — they follow the
 * payload, before this one. Same rule, same reason: a read with something else to
 * say about the connection says it beside the answer, not inside it.
 */
function withRunState(
  session: Session,
  result: unknown,
  also: readonly string[] = [],
): { readonly content: { readonly type: 'text'; readonly text: string }[] } {
  const blocks = [
    { type: 'text' as const, text: JSON.stringify(result, null, 2) },
    ...also.map((text) => ({ type: 'text' as const, text })),
  ];
  // ANY run: the question this sentence answers is whether the connection has
  // written yet, and a connection that opened a run in the second project of the
  // workspace has. Asking about the session's own tree instead would tell an agent
  // that has been recording work for an hour that it has started nothing.
  if (session.runs.size > 0) return { content: blocks };
  return {
    content: [
      ...blocks,
      {
        type: 'text' as const,
        text:
          'This session has not opened a run of its own yet — one opens when it ' +
          'first records something.',
      },
    ],
  };
}

/**
 * Where this session is reading and writing, and which projects it chose from.
 *
 * A statement of FACT, and shaped as one deliberately. It fires in every workspace
 * with two folders open, so a sentence that told the agent to be careful would be
 * telling it that in most sessions, and a caution that constant is one nobody reads.
 * Nor could it be more specific honestly: the server knows which project the cascade
 * picked and cannot know which one the person meant. So it reports what it does know
 * and stops — the agent is talking to someone who can tell it, and this is what makes
 * asking possible.
 *
 * The others are NAMED, not counted, and the reason is that a write can now name one.
 * A count says a choice was made; the names are what let the agent record work in the
 * project it is actually doing it in, and the agent has no other channel to learn them
 * — it sees directories, not this server's cascade. A number would leave it able to
 * tell that something is wrong and unable to fix it.
 *
 * It travels as its own content block for the same reason the run-state note does:
 * the payload is the copilot's shape, and where a session landed is a fact about
 * this connection rather than about the record it derives from.
 */
function whereThisSessionIs(session: Session): string {
  // One line, like the log line and the refusals: a directory name may hold a
  // newline, and a sentence the agent reads as one statement must not become two.
  const where =
    session.project === undefined ? 'the machine-global tree' : oneLine(session.project);
  const projects = session.workspaceProjects;
  // "knows of", because that is exactly what this is: the projects this session
  // could name. It does not claim they are all the workspace holds — a project the
  // host announced no folder for is one this session never saw — and it does not
  // claim they came from the roots, since a configured path is not a folder anybody
  // opened.
  //
  // Below two, the count says everything and the names would repeat what the
  // sentence already ends with. There is also nothing to route to: naming the one
  // project a session is already in changes nothing about where a write lands, and
  // offering the argument there would be offering it for no reason.
  if (projects.length < 2) {
    const known = projects.length === 0 ? 'no project' : '1 project';
    return `Workspace: this session knows of ${known}; it is operating on ${where}.`;
  }
  return (
    `Workspace: this session knows of ${projects.length} projects — ${namedProjects(projects)} ` +
    `— and it is operating on ${where}. A write can name another of them with ` +
    '`project`; one that names none lands here.'
  );
}

/**
 * One half of the close line: how many runs met a fate, and which ones.
 *
 * `no runs` rather than an empty list, because a line reading "closed: " with
 * nothing after it is a line a reader has to guess at — and the two halves are
 * printed independently, so the empty one has to say what it means. Run ids are
 * minted, never text anybody supplied, so nothing here can break the line.
 */
function runList(fate: string, runs: readonly string[]): string {
  if (runs.length === 0) return `no runs ${fate}`;
  return `${runs.length} ${runs.length === 1 ? 'run' : 'runs'} ${fate} (${runs.join(', ')})`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
