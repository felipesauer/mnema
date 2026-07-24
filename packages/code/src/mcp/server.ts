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
 * task_transition, record_decision, decision_transition, create_skill,
 * skill_transition, bootstrap, focus, resume, next_actions, guard, and the three
 * `audit_*` intelligence reads — audit_timeline, audit_accountability,
 * audit_antipatterns) delegates to a pure adapter in {@link ./tools.js}. The
 * reads (focus/resume/next_actions/guard, like bootstrap) are READ-ONLY — they
 * open a cache, rebuild, and derive; they open no writer. `guard` is a dry-run of
 * the gate: it simulates a move and returns the verdict, having written nothing.
 * The `audit_*` reads are read-only too but fold the UNION of the session's trees
 * (the auditor's view of the whole record), never opening a cache or a writer.
 *
 * The session is resolved lazily and once: `oninitialized` opens it as soon as
 * the client is known, and every tool call ensures it too, so a call that races
 * ahead of the initialized callback still finds a session rather than failing.
 * A failure to open the session is surfaced honestly as a tool error, never a
 * silent no-op.
 */

import type { DiscoveryEnv } from '@mnema/core';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { discoveryEnv } from '../env.js';
import { closeSession, openSession, type Session } from './session.js';
import {
  runAccountabilityTool,
  runAntipatternsTool,
  runBootstrap,
  runCaptureMemory,
  runCreateSkill,
  runDecisionTransition,
  runFocusTool,
  runGuardTool,
  runLinkKnowledge,
  runNextActionsTool,
  runRecordDecision,
  runRecordHandoff,
  runRecordObservation,
  runResumeTool,
  runSkillTransition,
  runTaskTransition,
  runTimelineTool,
} from './tools.js';

/** The name the server announces itself as (its own identity, not the client's). */
const SERVER_NAME = 'mnema';
const SERVER_VERSION = '0.0.0';

/** What the server needs from its host, injected so it is testable. */
export interface McpServerOptions {
  /** The discovery environment; defaults to the real process environment. */
  readonly env?: DiscoveryEnv;
  /** An explicit project directory to operate on, overriding the client's roots. */
  readonly configProject?: string | undefined;
  /** Where to write diagnostics (never stdout — that carries the protocol). */
  readonly log?: (line: string) => void;
}

/**
 * Builds the configured MCP server and returns it alongside `connect`, which
 * attaches a stdio transport and starts serving. Splitting the two lets a test
 * build the server and drive its tools without spawning a transport.
 */
export function buildMcpServer(options: McpServerOptions = {}): {
  readonly server: McpServer;
  readonly connect: () => Promise<void>;
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

  /**
   * Opens the session if it is not open yet, from what the handshake exposed:
   * the client's name (the `which`) and its workspace roots (for the project
   * cascade). Idempotent under concurrency — the first caller starts the open;
   * every caller awaits the one result.
   */
  const ensureSession = (): Promise<Session> => {
    if (sessionPromise !== undefined) return sessionPromise;
    sessionPromise = (async () => {
      const clientName = server.server.getClientVersion()?.name ?? 'unknown-agent';
      const roots = await listRootsSafely(server, log);
      const opened = openSession({
        clientName,
        roots,
        env,
        ...(options.configProject !== undefined ? { configProject: options.configProject } : {}),
      });
      log(
        `session opened: which=${clientName} who=${opened.who} ` +
          `scope=${opened.scope} run=${opened.runId}`,
      );
      return opened;
    })();
    return sessionPromise;
  };

  // Open the session as soon as the client is known — the thesis in action: the
  // server establishes the run at connection time, not on first use.
  server.server.oninitialized = () => {
    void ensureSession().catch((error) => {
      log(`could not open session at initialize: ${messageOf(error)}`);
    });
  };

  registerTools(server, ensureSession);

  const connect = async (): Promise<void> => {
    const transport = new StdioServerTransport();
    // Best-effort close: when stdin closes (the client disconnects), end the
    // session's run. Only a session that actually opened is closed; a run left
    // open by a crash is tolerated (the projection reads it as still open), so
    // this never throws.
    transport.onclose = () => {
      if (sessionPromise === undefined) return;
      void sessionPromise
        .then((active) => {
          const closed = closeSession(active);
          log(
            closed ? `session run ${active.runId} closed` : `session run ${active.runId} left open`,
          );
        })
        .catch(() => {
          /* the session never opened; nothing to close */
        });
    };
    await server.connect(transport);
  };

  return { server, connect };
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
        'default (private in a project, global outside one).',
      inputSchema: {
        content: z.string().min(1).describe('The memory to record.'),
        scope: z
          .enum(['public', 'private', 'global'])
          .optional()
          .describe('Where the memory lands; overrides the session default.'),
      },
    },
    async ({ content, scope }) => {
      const active = await ensureSession();
      const result = runCaptureMemory(active, {
        content,
        ...(scope !== undefined ? { scope } : {}),
      });
      if (!result.ok) {
        // The override named a tree absent here — surface it as a tool error so
        // the agent sees the capture did not happen, not a silent no-op.
        return {
          isError: true,
          content: [{ type: 'text', text: `Refused (${result.code}): ${result.message}` }],
        };
      }
      return { content: [{ type: 'text', text: `Captured memory ${result.id}` }] };
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
        'pick the scope it lands in; omitted, it follows the session default. ' +
        'Returns the observation’s own minted id.',
      inputSchema: {
        about: z.string().min(1).describe('The id of the entity being observed.'),
        topic: z.string().min(1).describe('A short topic label.'),
        text: z.string().min(1).describe('The observation itself.'),
        scope: z
          .enum(['public', 'private', 'global'])
          .optional()
          .describe('Where the observation lands; overrides the session default.'),
      },
    },
    async ({ about, topic, text, scope }) => {
      const active = await ensureSession();
      const result = runRecordObservation(active, {
        about,
        topic,
        text,
        ...(scope !== undefined ? { scope } : {}),
      });
      if (!result.ok) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Refused (${result.code}): ${result.message}` }],
        };
      }
      return {
        content: [{ type: 'text', text: `Recorded observation ${result.id} about ${about}` }],
      };
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
        'to exist. Optionally pick the scope; omitted, it follows the session ' +
        'default. A handoff has no id of its own — its subject is the task.',
      inputSchema: {
        task: z.string().min(1).describe('The task the handoff is about.'),
        from: z.string().min(1).describe('The agent handing off.'),
        to: z.string().min(1).describe('The agent taking over (may equal `from`).'),
        scope: z
          .enum(['public', 'private', 'global'])
          .optional()
          .describe('Where the handoff lands; overrides the session default.'),
      },
    },
    async ({ task, from, to, scope }) => {
      const active = await ensureSession();
      const result = runRecordHandoff(active, {
        task,
        from,
        to,
        ...(scope !== undefined ? { scope } : {}),
      });
      if (!result.ok) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Refused (${result.code}): ${result.message}` }],
        };
      }
      return {
        content: [{ type: 'text', text: `Recorded handoff on ${task}: ${from} → ${to}` }],
      };
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
        'pick the scope; omitted, it follows the session default. A link has no id ' +
        'of its own — it is an edge.',
      inputSchema: {
        subject: z.string().min(1).describe('The entity that originates the link.'),
        target: z.string().min(1).describe('The entity linked to.'),
        rel: z.string().min(1).describe('The relation label (an open string).'),
        scope: z
          .enum(['public', 'private', 'global'])
          .optional()
          .describe('Where the link lands; overrides the session default.'),
      },
    },
    async ({ subject, target, rel, scope }) => {
      const active = await ensureSession();
      const result = runLinkKnowledge(active, {
        subject,
        target,
        rel,
        ...(scope !== undefined ? { scope } : {}),
      });
      if (!result.ok) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Refused (${result.code}): ${result.message}` }],
        };
      }
      return {
        content: [{ type: 'text', text: `Linked ${subject} —${rel}→ ${target}` }],
      };
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
        'request_changes a feedback; an illegal move or missing proof is refused.',
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
      return { content: [{ type: 'text', text: `Task ${result.alias} → ${result.to}` }] };
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
        'Returns the citable ADR-<n> label — a decision has no short alias.',
      inputSchema: {
        title: z.string().min(1).describe('The decision title.'),
        rationale: z.string().min(1).describe('Why the decision was made.'),
        scope: z
          .enum(['public', 'private', 'global'])
          .optional()
          .describe('Where the decision lands; overrides the session default.'),
      },
    },
    async ({ title, rationale, scope }) => {
      const active = await ensureSession();
      const result = runRecordDecision(active, {
        title,
        rationale,
        ...(scope !== undefined ? { scope } : {}),
      });
      if (!result.ok) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Refused (${result.code}): ${result.message}` }],
        };
      }
      return {
        content: [{ type: 'text', text: `Recorded decision ${result.adr} (${result.id})` }],
      };
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
        'An illegal move or missing proof is refused with the gate’s reason.',
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
      return { content: [{ type: 'text', text: `Decision ${result.adr} → ${result.to}` }] };
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
        'the session default. Returns the minted id (the key to move it) and the ' +
        'name — a skill has no short alias.',
      inputSchema: {
        name: z.string().min(1).describe('A short title for the pattern.'),
        body: z.string().min(1).describe('The reusable pattern itself.'),
        scope: z
          .enum(['public', 'private', 'global'])
          .optional()
          .describe('Where the skill lands; overrides the session default.'),
      },
    },
    async ({ name, body, scope }) => {
      const active = await ensureSession();
      const result = runCreateSkill(active, {
        name,
        body,
        ...(scope !== undefined ? { scope } : {}),
      });
      if (!result.ok) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Refused (${result.code}): ${result.message}` }],
        };
      }
      return {
        content: [{ type: 'text', text: `Proposed skill "${result.name}" (${result.id})` }],
      };
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
        'is refused with the gate’s reason.',
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
      return { content: [{ type: 'text', text: `Skill "${result.name}" → ${result.to}` }] };
    },
  );

  server.registerTool(
    'bootstrap',
    {
      title: 'Bootstrap the session',
      description:
        "The opening context for this session's actor: where they left off and " +
        'the actionable work, derived from the chain.',
    },
    async () => {
      const active = await ensureSession();
      const context = runBootstrap(active);
      return { content: [{ type: 'text', text: JSON.stringify(context, null, 2) }] };
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
        'runs (the actor is the session, never a supplied value).',
    },
    async () => {
      const active = await ensureSession();
      const result = runFocusTool(active);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
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
        'reminds you. Read-only: it derives from the chain and writes nothing.',
    },
    async () => {
      const active = await ensureSession();
      const result = runResumeTool(active);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
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
        '(no legal moves); an id no visible tree holds is refused. Read-only.',
      inputSchema: {
        id: z.string().min(1).describe('The task id to inspect.'),
      },
    },
    async ({ id }) => {
      const active = await ensureSession();
      const result = runNextActionsTool(active, { id });
      if (!result.ok) {
        // No visible tree holds the task — surface it as a tool error so the agent
        // sees there is no such task, not an empty (misleadable) list.
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
        'The verdict is paired with your current focus. An id no visible tree holds ' +
        'is refused. Read-only.',
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
        // No visible tree holds the task — surface it as a tool error so the agent
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
      return { content: [{ type: 'text', text: JSON.stringify(result.result, null, 2) }] };
    },
  );

  // The three INTELLIGENCE tools, prefixed `audit_` — the AUDITOR's view over the
  // UNION of the session's trees (distinct from the session reads focus/resume/
  // guard, which serve the session's own tree and carry no prefix). Each folds
  // every present tree into one view of the whole record and returns the faithful
  // object. Read-only: they read the tails and fold them, opening no writer and
  // no cache. With no project a session has no record to audit — refused.

  server.registerTool(
    'audit_timeline',
    {
      title: 'Audit — the full history of an entity',
      description:
        'Show the complete history of one entity (a task, decision, skill, …) ' +
        'across ALL of this project’s trees: every event where it is the subject, ' +
        'plus events that refer to it (an observation about it, a link whose target ' +
        'is it) — which may live in another tree. Use it to answer "tell me the ' +
        'whole story of this entity". An id no event touches returns an empty ' +
        'history (a valid answer). Read-only.',
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
    'audit_accountability',
    {
      title: 'Audit — who authorized what',
      description:
        'Show who authorized what and which agent executed it, across ALL of this ' +
        'project’s trees. Use it to answer "who did what" over the whole record — ' +
        'with no filter it accounts for everything (like git shortlog). Optionally ' +
        'narrow by a time window (from/to), a single author (who), or a single ' +
        'executing agent (which). Returns the total and a per-author breakdown ' +
        '(counts by kind and by executing agent). Read-only.',
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
    'audit_antipatterns',
    {
      title: 'Audit — recurring shapes in the record',
      description:
        'Show recurring shapes across ALL of this project’s trees — tasks reopened, ' +
        'decisions superseded, skills deprecated — each with the exact events that ' +
        'make up the count, plus the tasks reopened more than once as skill ' +
        'CANDIDATES (a POINTER, not an action — this creates no skill). It reports ' +
        'the shapes; it does NOT judge them good or bad. Use it to spot patterns a ' +
        'human might act on. Read-only.',
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

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
