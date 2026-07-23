/**
 * The MCP server, two ways.
 *
 * UNIT — the session and the tool adapters as plain functions over a sandbox,
 * the way the CLI tests drive the commands: `openSession` opens a run, the two
 * tools write and read, `closeSession` ends the run. No transport is spawned.
 *
 * END TO END — the real SDK `Client` talking to the real server over an
 * in-process transport pair: the handshake runs, the client exposes roots, and
 * the tools are called by name. This proves the wiring (the schema, the session
 * resolved from the client's roots, the response envelope), not just the
 * adapters. It is the handshake exercised for real, without a child process.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { catalogUpcasters, ensureTree, verify } from '@mnema/chain';
import { chainRootForScope, type DiscoveryEnv, orderedEvents, PROJECT_DIR } from '@mnema/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildMcpServer } from '../src/mcp/server.js';
import { closeSession, openSession } from '../src/mcp/session.js';
import { runBootstrap, runCaptureMemory } from '../src/mcp/tools.js';

let sandbox: string;
let env: DiscoveryEnv;

/** Makes a directory that IS a project (has a `.mnema/` tree), returns its path. */
function makeProject(name: string): string {
  const dir = join(sandbox, name);
  mkdirSync(dir, { recursive: true });
  ensureTree({ root: join(dir, PROJECT_DIR) });
  return dir;
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-mcp-e2e-'));
  const home = join(sandbox, 'home');
  mkdirSync(home, { recursive: true });
  env = { home, xdgDataHome: join(sandbox, 'data') };
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe('MCP session + tools — unit', () => {
  it('opening a session starts a run authored by the machine anchor, not the client', () => {
    const project = makeProject('proj');
    const session = openSession({
      clientName: 'claude-code',
      roots: [pathToFileURL(project).href],
      env,
    });
    expect(session.which).toBe('claude-code');
    // who is the machine's anchor (a derived id), never the client's name.
    expect(session.who).not.toBe('claude-code');
    expect(session.who.length).toBeGreaterThan(0);
    expect(session.runId.length).toBeGreaterThan(0);
    // In a project, an agent connection routes writes PRIVATE (the origin rule).
    expect(session.inProject).toBe(true);
    expect(session.scope).toBe('private');
  });

  it('a session with no project lands on the global tree (never refuses)', () => {
    const session = openSession({ clientName: 'claude-code', roots: [], env });
    expect(session.inProject).toBe(false);
    expect(session.scope).toBe('global');
    expect(session.runId.length).toBeGreaterThan(0);
  });

  it('capture_memory appends a verifiable event; bootstrap reads it back', () => {
    const project = makeProject('proj');
    const session = openSession({
      clientName: 'claude-code',
      roots: [pathToFileURL(project).href],
      env,
    });

    const { id } = runCaptureMemory(session, { content: 'the auth flow uses PKCE' });
    expect(id.length).toBeGreaterThan(0);

    // The write landed in the session's (private) tree and verifies.
    const chainRoot = chainRootForScope(session.trees, session.scope) as string;
    const verdict = verify(chainRoot, catalogUpcasters());
    expect(verdict.ok).toBe(true);

    // The captured event is really there, attributed to the client (`which`).
    const events = orderedEvents({ root: chainRoot }, catalogUpcasters());
    const captured = events.find((e) => e.kind === 'memory.captured');
    expect(captured).toBeDefined();
    expect(captured?.which).toBe('claude-code');

    // bootstrap serves the actor's context — the run it just opened is there.
    const context = runBootstrap(session);
    expect(context.resume.actor).toBe(session.who);
    expect(context.resume.focus.openRuns.some((r) => r.id === session.runId)).toBe(true);
  });

  it('closeSession ends the run; a second close is a tolerated no-op', () => {
    const session = openSession({ clientName: 'claude-code', roots: [], env });
    expect(closeSession(session)).toBe(true);
    // Already ended — endRun refuses, closeSession swallows it (best-effort).
    expect(closeSession(session)).toBe(false);
  });
});

/** A client that advertises `roots` and answers `roots/list` with `roots`. */
async function connectClient(
  server: ReturnType<typeof buildMcpServer>['server'],
  roots: readonly string[],
): Promise<Client> {
  const client = new Client(
    { name: 'claude-code', version: '1.0.0' },
    { capabilities: { roots: {} } },
  );
  client.setRequestHandler(ListRootsRequestSchema, () => ({
    roots: roots.map((uri) => ({ uri })),
  }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

/** Reads the first text block out of a callTool result. */
function textOf(result: unknown): string {
  const content = (result as { content?: { type: string; text?: string }[] }).content ?? [];
  const first = content.find((c) => c.type === 'text');
  return first?.text ?? '';
}

describe('MCP server — end to end over a real client', () => {
  it('resolves the project from the client roots, captures, and bootstraps', async () => {
    const project = makeProject('proj');
    const { server } = buildMcpServer({ env, log: () => {} });
    const client = await connectClient(server, [pathToFileURL(project).href]);

    // The handshake ran; the two tools are advertised.
    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name).sort();
    expect(names).toEqual(['bootstrap', 'capture_memory']);

    // capture_memory writes into the resolved project's private tree.
    const captured = await client.callTool({
      name: 'capture_memory',
      arguments: { content: 'prefer PKCE over implicit' },
    });
    expect(textOf(captured)).toMatch(/^Captured memory /);

    // The write is real and verifiable in the project's private tree.
    const privateRoot = join(project, PROJECT_DIR, 'private');
    const verdict = verify(privateRoot, catalogUpcasters());
    expect(verdict.ok).toBe(true);

    // bootstrap serves the actor's context (the run opened at initialize).
    const boot = await client.callTool({ name: 'bootstrap' });
    const context = JSON.parse(textOf(boot)) as { resume: { focus: { openRuns: unknown[] } } };
    expect(context.resume.focus.openRuns.length).toBeGreaterThan(0);

    await client.close();
  });

  it('a client with no roots is served on the global tree', async () => {
    const { server } = buildMcpServer({ env, log: () => {} });
    const client = await connectClient(server, []);

    const captured = await client.callTool({
      name: 'capture_memory',
      arguments: { content: 'a cross-project lesson' },
    });
    expect(textOf(captured)).toMatch(/^Captured memory /);

    // No project tree was created anywhere under the workspace — the capture
    // went to the global tree.
    const globalRoot = join(sandbox, 'data', 'mnema', 'global');
    const verdict = verify(globalRoot, catalogUpcasters());
    expect(verdict.ok).toBe(true);

    await client.close();
  });
});
