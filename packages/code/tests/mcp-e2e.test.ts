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
import {
  chainRootForScope,
  type DiscoveryEnv,
  orderedEvents,
  PROJECT_DIR,
  projectTasks,
  resolveTrees,
} from '@mnema/core';
import { createTask } from '@mnema/core/write';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildMcpServer } from '../src/mcp/server.js';
import { closeSession, openSession, writeContext } from '../src/mcp/session.js';
import { runBootstrap, runCaptureMemory, runTaskTransition } from '../src/mcp/tools.js';

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

    const result = runCaptureMemory(session, { content: 'the auth flow uses PKCE' });
    if (!result.ok) throw new Error('setup: capture refused');
    expect(result.id.length).toBeGreaterThan(0);

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

  it('capture_memory scope arg overrides the session default (per-action scope)', () => {
    const project = makeProject('proj');
    const session = openSession({
      clientName: 'claude-code',
      roots: [pathToFileURL(project).href],
      env,
    });
    // The session's default is private (an agent in a project).
    expect(session.scope).toBe('private');

    // The agent states scope=public for THIS capture — it must land in public
    // despite the session default, so one session produces both public and
    // private work.
    const captured = runCaptureMemory(session, { content: 'a team-visible fact', scope: 'public' });
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;

    const publicRoot = chainRootForScope(session.trees, 'public') as string;
    const publicMems = orderedEvents({ root: publicRoot }, catalogUpcasters()).filter(
      (e) => e.subject === captured.id,
    );
    expect(publicMems.map((e) => e.kind)).toEqual(['memory.captured']);
    // The session's private tree did not receive it.
    const privateRoot = chainRootForScope(session.trees, 'private') as string;
    const privateMems = orderedEvents({ root: privateRoot }, catalogUpcasters()).filter(
      (e) => e.subject === captured.id,
    );
    expect(privateMems).toEqual([]);
  });

  it('capture_memory with no scope follows the session default (the cascade base)', () => {
    const project = makeProject('proj');
    const session = openSession({
      clientName: 'claude-code',
      roots: [pathToFileURL(project).href],
      env,
    });
    const captured = runCaptureMemory(session, { content: 'the session default' });
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;
    // Landed in the session's scope (private), not public.
    const privateRoot = chainRootForScope(session.trees, 'private') as string;
    const privateMems = orderedEvents({ root: privateRoot }, catalogUpcasters()).filter(
      (e) => e.subject === captured.id,
    );
    expect(privateMems.map((e) => e.kind)).toEqual(['memory.captured']);
  });

  it('capture_memory refuses a scope absent here (public with no project) as data', () => {
    // A session with no project has only the global tree. Asking for public
    // names a tree that does not exist — refuse as data, never throw.
    const session = openSession({ clientName: 'claude-code', roots: [], env });
    expect(session.scope).toBe('global');
    const refused = runCaptureMemory(session, { content: 'no public here', scope: 'public' });
    expect(refused).toMatchObject({ ok: false, code: 'SCOPE_UNAVAILABLE' });
  });

  it('task_transition moves a task through the same gate the CLI uses', () => {
    const project = makeProject('proj');
    const session = openSession({
      clientName: 'claude-code',
      roots: [pathToFileURL(project).href],
      env,
    });

    // Create a task in the session's (private) tree, then move it via the tool.
    const ctx = writeContext(session.trees, session.scope);
    const created = createTask(ctx, { title: 'wire the tool', which: session.which });
    if (!created.ok) throw new Error('setup: create refused');
    ctx.writer.checkpoint();

    const submitted = runTaskTransition(session, { id: created.id, action: 'submit' });
    expect(submitted).toMatchObject({ ok: true, to: 'READY' });
    const started = runTaskTransition(session, { id: created.id, action: 'start' });
    expect(started).toMatchObject({ ok: true, to: 'IN_PROGRESS' });

    // The move landed in the session's tree and the chain still verifies.
    const chainRoot = chainRootForScope(session.trees, session.scope) as string;
    expect(verify(chainRoot, catalogUpcasters()).ok).toBe(true);
    const state = projectTasks(orderedEvents({ root: chainRoot }, catalogUpcasters())).get(
      created.id,
    )?.state;
    expect(state).toBe('IN_PROGRESS');
  });

  it('task_transition follows the entity: an agent moves a PUBLIC task in PUBLIC', () => {
    // The central thesis flow: a human creates a task in the public tree, an
    // agent (a session that writes PRIVATE) executes the SAME task. The move
    // must follow the entity to its home (public), NOT land in the session's
    // private tree — else the team, who reads only public, would see the task
    // frozen while the agent's move hid in private. With the old fixed
    // session.scope this refused UNKNOWN_TASK; following the entity, it works.
    const project = makeProject('proj');
    const trees = resolveTrees(project, env);

    // The human creates the task in PUBLIC (no `which` → the human origin).
    const humanCtx = writeContext(trees, 'public');
    const created = createTask(humanCtx, { title: 'human-created work' });
    if (!created.ok) throw new Error('setup: create refused');
    humanCtx.writer.checkpoint();

    // The agent connects — its session routes NEW writes private.
    const session = openSession({
      clientName: 'claude-code',
      roots: [pathToFileURL(project).href],
      env,
    });
    expect(session.scope).toBe('private');

    // The agent moves the human's task. It lands in PUBLIC (the task's home).
    const moved = runTaskTransition(session, { id: created.id, action: 'submit' });
    expect(moved).toMatchObject({ ok: true, to: 'READY' });

    // The move is in PUBLIC, attributed to the agent (`which`), authorized by
    // the machine (`who`) — who != which preserved even though it is public.
    const publicRoot = chainRootForScope(trees, 'public') as string;
    const publicEvents = orderedEvents({ root: publicRoot }, catalogUpcasters()).filter(
      (e) => e.subject === created.id,
    );
    expect(publicEvents.map((e) => e.kind)).toEqual([
      'task.created',
      'task.transitioned',
      'task.transitioned',
    ]);
    const submit = publicEvents[2];
    expect(submit?.which).toBe('claude-code');
    expect(submit?.who).not.toBe('claude-code');
    expect(verify(publicRoot, catalogUpcasters()).ok).toBe(true);

    // The session's private tree never received the move — history not split.
    const privateRoot = chainRootForScope(trees, 'private') as string;
    const privateTaskEvents = orderedEvents({ root: privateRoot }, catalogUpcasters()).filter(
      (e) => e.subject === created.id,
    );
    expect(privateTaskEvents).toEqual([]);
  });

  it('task_transition returns the gate refusal as data, never throwing', () => {
    const project = makeProject('proj');
    const session = openSession({
      clientName: 'claude-code',
      roots: [pathToFileURL(project).href],
      env,
    });
    const ctx = writeContext(session.trees, session.scope);
    const created = createTask(ctx, { title: 'a task', which: session.which });
    if (!created.ok) throw new Error('setup: create refused');
    ctx.writer.checkpoint();

    // DRAFT → start is illegal (submit first); complete with no note is unproven.
    const illegal = runTaskTransition(session, { id: created.id, action: 'start' });
    expect(illegal).toMatchObject({ ok: false, code: 'ILLEGAL_TRANSITION' });
    const unknown = runTaskTransition(session, { id: created.id, action: 'frobnicate' });
    expect(unknown).toMatchObject({ ok: false, code: 'UNKNOWN_ACTION' });
    const missing = runTaskTransition(session, {
      id: '00000000-0000-7000-8000-000000000000',
      action: 'submit',
    });
    expect(missing).toMatchObject({ ok: false, code: 'UNKNOWN_TASK' });
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

    // The handshake ran; the tools are advertised.
    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name).sort();
    expect(names).toEqual(['bootstrap', 'capture_memory', 'task_transition']);

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

  it('task_transition moves a task over the real transport, and refuses as a tool error', async () => {
    const project = makeProject('proj');
    const { server } = buildMcpServer({ env, log: () => {} });

    // Seed a task in the project's private tree (the scope an agent session
    // writes to) so the tool has something to move. Same env → same machine
    // anchor, so the tool's writer authorizes it.
    const trees = resolveTrees(project, env);
    const ctx = writeContext(trees, 'private');
    const created = createTask(ctx, { title: 'over the wire', which: 'claude-code' });
    if (!created.ok) throw new Error('setup: create refused');
    ctx.writer.checkpoint();

    const client = await connectClient(server, [pathToFileURL(project).href]);

    // A legal move returns the new state.
    const moved = await client.callTool({
      name: 'task_transition',
      arguments: { id: created.id, action: 'submit' },
    });
    expect(moved.isError).toBeFalsy();
    expect(textOf(moved)).toMatch(/→ READY$/);

    // An illegal move comes back as a tool error carrying the gate's reason —
    // not a thrown exception that would break the connection.
    const refused = await client.callTool({
      name: 'task_transition',
      arguments: { id: created.id, action: 'complete' },
    });
    expect(refused.isError).toBe(true);
    expect(textOf(refused)).toContain('Refused (ILLEGAL_TRANSITION)');

    await client.close();
  });

  it('capture_memory scope arg routes over the real transport, and refuses absent scopes', async () => {
    const project = makeProject('proj');
    const { server } = buildMcpServer({ env, log: () => {} });
    const client = await connectClient(server, [pathToFileURL(project).href]);

    // The tool advertises the scope arg in its schema.
    const tools = await client.listTools();
    const captureTool = tools.tools.find((t) => t.name === 'capture_memory');
    expect(Object.keys(captureTool?.inputSchema.properties ?? {})).toContain('scope');

    // scope=public lands in the public tree, despite the session being private.
    const captured = await client.callTool({
      name: 'capture_memory',
      arguments: { content: 'a team-visible fact', scope: 'public' },
    });
    expect(captured.isError).toBeFalsy();
    expect(textOf(captured)).toMatch(/^Captured memory /);
    const publicRoot = join(project, PROJECT_DIR);
    const publicMems = orderedEvents({ root: publicRoot }, catalogUpcasters()).filter(
      (e) => e.kind === 'memory.captured',
    );
    expect(publicMems.length).toBe(1);
    expect(verify(publicRoot, catalogUpcasters()).ok).toBe(true);

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
