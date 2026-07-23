/**
 * The mnema MCP server: a thin transport over the session and the tool adapters.
 *
 * The SDK does the protocol — the handshake, the tool dispatch, the JSON-RPC
 * envelope; this file only wires. It builds the server, registers the two tools
 * (each delegating to a pure adapter in {@link ./tools.js}), opens a session
 * once the handshake has run (so `clientInfo` and the client's roots are
 * available), and closes that session's run when the connection ends. There is
 * no domain logic here and none in the tools — the logic is the core's gate and
 * operations, reached through the session and the adapters.
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
import { runBootstrap, runCaptureMemory } from './tools.js';

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
 * Registers the two skeleton tools. Each is a thin wrapper: it ensures the
 * session, calls the pure adapter, and shapes the response. The wiring adds only
 * the schema and the text envelope; all behavior is in the adapter and the core.
 */
function registerTools(server: McpServer, ensureSession: () => Promise<Session>): void {
  server.registerTool(
    'capture_memory',
    {
      title: 'Capture a memory',
      description:
        'Record a point-in-time fact into the mnema chain, attributed to this ' +
        'agent and pinned to the current session.',
      inputSchema: { content: z.string().min(1).describe('The memory to record.') },
    },
    async ({ content }) => {
      const active = await ensureSession();
      const { id } = runCaptureMemory(active, { content });
      return { content: [{ type: 'text', text: `Captured memory ${id}` }] };
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
