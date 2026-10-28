/**
 * A CLIENT THAT NEVER SENDS `initialize`, the way the 2026-07-28 revision of the Model Context
 * Protocol begins: no handshake, no `notifications/roots/list_changed`, each request carrying what
 * it needs. The hosts measured (Claude Code and the Copilot CLI) already open with a
 * `server/discover` request, and then, because the SDK answers it with an error, fall back to
 * `initialize`; none drops the handshake yet. This holds what the server does the day one does,
 * so the day is not a surprise.
 *
 * WHAT THE SERVER DOES TODAY, read off the transport by sending `tools/list` and `tools/call`
 * straight away, with nothing before them:
 *
 *   - it ANSWERS both. The SDK (1.x) does not refuse a request that comes before `initialize`;
 *   - the project is the one the server was STARTED in, taken as the client declared no workspace
 *     roots (the same rung a client without the `roots` capability gets), and the server's log
 *     line says so;
 *   - a fact written is recorded with `which` = `unknown-agent`, the default for a name that was
 *     never announced, and the run it opens says the same (`payload.agent`). The `which` is
 *     DECLARED by the client in any case, never proved, so it was never an identity;
 *   - and the run is MARKED: a `run.unannounced` with `handshake: false`, appended with the run's
 *     birth (FORMAT.md section 6.9), so the record says the name came from no handshake, and a
 *     client that announced the literal name `unknown-agent` (which leaves no mark) reads apart
 *     from this one. The readings say it beside the name: `mnema show`, the opening document,
 *     `audit_accountability`, the record page and `mnema verify`'s census.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { catalogUpcasters, ensureTree } from '@mnema/chain';
import { type DiscoveryEnv, orderedEvents, PROJECT_DIR, resolveTrees } from '@mnema/core';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildMcpServer } from '../src/mcp/server.js';

let sandbox: string;
let app: string;
let env: DiscoveryEnv;
let logged: string[];

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-no-initialize-'));
  const home = join(sandbox, 'home');
  mkdirSync(home, { recursive: true });
  env = { home };
  app = join(sandbox, 'app');
  mkdirSync(app, { recursive: true });
  ensureTree({ root: join(app, PROJECT_DIR) });
  logged = [];
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** The server the product builds, started in `app`, and the client side of its transport, with no handshake run. */
async function aServerNobodyInitialized() {
  const { server } = buildMcpServer({ cwd: app, env, log: (line) => logged.push(line) });
  const [client, serverSide] = InMemoryTransport.createLinkedPair();
  const answers = new Map<number, (message: JSONRPCMessage) => void>();
  client.onmessage = (message) => {
    if ('id' in message && typeof message.id === 'number') answers.get(message.id)?.(message);
  };
  await server.connect(serverSide);
  await client.start();
  let next = 0;
  return {
    /** Sends one request, with nothing before it, and resolves with the message that answers it. */
    request(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
      const id = ++next;
      return new Promise((resolve) => {
        answers.set(id, (message) => resolve(message as unknown as Record<string, unknown>));
        void client.send({ jsonrpc: '2.0', id, method, params });
      });
    },
    close: () => client.close(),
  };
}

describe('a client that sends no initialize', () => {
  it('is answered: tools/list and tools/call need no handshake', async () => {
    const wire = await aServerNobodyInitialized();

    const listed = (await wire.request('tools/list', {})) as {
      result?: { tools: { name: string }[] };
      error?: unknown;
    };
    expect(listed.error).toBeUndefined();
    expect(listed.result?.tools.map((tool) => tool.name)).toContain('capture_memory');

    const called = (await wire.request('tools/call', {
      name: 'capture_memory',
      arguments: { content: 'a note from a client that never said hello' },
    })) as { result?: { isError?: boolean }; error?: unknown };
    expect(called.error).toBeUndefined();
    expect(called.result?.isError).toBeFalsy();

    await wire.close();
  });

  it('lands in the directory the server was started in, and the log says why', async () => {
    const wire = await aServerNobodyInitialized();
    await wire.request('tools/call', { name: 'focus', arguments: {} });

    expect(logged.find((line) => line.startsWith('session opened:'))).toContain(
      `project=${app} (from this server's working directory, ${app}: ` +
        'the client declared no workspace roots)',
    );

    await wire.close();
  });

  it('records the fact with `which` = unknown-agent, and marks its run as announced by no handshake', async () => {
    const wire = await aServerNobodyInitialized();
    await wire.request('tools/call', {
      name: 'capture_memory',
      arguments: { content: 'a note from a client that never said hello' },
    });

    const trees = resolveTrees(app, env);
    if (trees.projectPrivate === undefined) throw new Error('the project has no private tree');
    const events = orderedEvents({ root: trees.projectPrivate }, catalogUpcasters());
    const note = events.find((event) => event.kind === 'memory.captured');
    const run = events.find((event) => event.kind === 'run.started');
    expect(note?.which).toBe('unknown-agent');
    expect(run?.which).toBe('unknown-agent');
    expect((run?.payload as { agent?: string } | undefined)?.agent).toBe('unknown-agent');
    // The mark: one, for that run, signed by the key that signed it, saying no handshake ran.
    const marks = events.filter((event) => event.kind === 'run.unannounced');
    expect(marks.map((mark) => mark.payload)).toEqual([{ handshake: false }]);
    expect(marks.map((mark) => [mark.subject, mark.run, mark.signerFp, mark.which])).toEqual([
      [run?.subject, run?.subject, run?.signerFp, 'unknown-agent'],
    ]);
    expect(note?.run).toBe(run?.subject);

    await wire.close();
  });
});
