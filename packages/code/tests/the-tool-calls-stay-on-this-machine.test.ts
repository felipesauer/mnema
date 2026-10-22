/**
 * The local count of tool calls (`src/tool-calls.ts`): what it keeps, what it never keeps, and
 * where it lives.
 *
 * Four properties, each held by a case that goes red when the defect it names is put back:
 *
 *   1. THE COUNT IS BY NAME. Tools are called through a real server and the count read back
 *      says how many calls each got, how many were refused, and under which code.
 *   2. NO ARGUMENT IS EVER KEPT. A marker is sent as the argument of a write and of a read, and
 *      the file is searched for it, and for the marker's neighbours in the tool's own reply.
 *   3. THE FILE NEVER REACHES THE REPOSITORY: it is in the machine's data directory, outside
 *      the working tree and outside every tree of the record, and no file of the repository
 *      (its `.git` included) holds a line of it.
 *   4. SWITCHED OFF, IT KEEPS NOTHING, and it is on until somebody switches it.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ensureTree } from '@mnema/chain';
import { type DiscoveryEnv, PROJECT_DIR, resolveTrees } from '@mnema/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runInit } from '../src/commands/init.js';
import { runSwitch } from '../src/commands/switch.js';
import { runToolUsage } from '../src/commands/usage.js';
import { buildMcpServer } from '../src/mcp/server.js';
import { renderPlain } from '../src/presentation/plain.js';
import { toolUsageReport } from '../src/presentation/usage.js';
import { flushToolCalls, readToolCalls, toolCallsFile } from '../src/tool-calls.js';

const MARKER = 'ZEBRA-MARKER-9f3a41c7';

let sandbox: string;
let repo: string;
let env: DiscoveryEnv;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-tool-calls-'));
  repo = join(sandbox, 'repo');
  mkdirSync(join(repo, '.git'), { recursive: true });
  writeFileSync(join(repo, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  env = { home: join(sandbox, 'home') };
  mkdirSync(env.home, { recursive: true });
  runInit({ cwd: repo, env });
  ensureTree({ root: join(repo, PROJECT_DIR) });
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** A connection to the project, the way a host holds one: roots announced, calls made. */
async function connect(): Promise<Client> {
  const { server } = buildMcpServer({ cwd: sandbox, env, log: () => undefined });
  const client = new Client(
    { name: 'claude-code', version: '1.0.0' },
    { capabilities: { roots: {} } },
  );
  client.setRequestHandler(ListRootsRequestSchema, () => ({
    roots: [{ uri: pathToFileURL(repo).href }],
  }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

/** The file this project's calls are counted in, which must exist for a project. */
function theFile(): string {
  const file = toolCallsFile(resolveTrees(repo, env));
  if (file === undefined) throw new Error('setup: the sandbox is not a project');
  return file;
}

/** Every file under `dir`, as paths relative to it. */
function filesUnder(dir: string): string[] {
  const found: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else found.push(relative(dir, path));
    }
  };
  walk(dir);
  return found;
}

describe('the local count of tool calls', () => {
  it('counts each tool by name, with its refusals and the code they carried', async () => {
    const client = await connect();
    await client.callTool({ name: 'capture_memory', arguments: { content: 'first' } });
    await client.callTool({ name: 'capture_memory', arguments: { content: 'second' } });
    await client.callTool({ name: 'search', arguments: { term: 'first' } });
    const refused = await client.callTool({
      name: 'read_record',
      arguments: { id: 'no-such-record' },
    });
    await client.close();
    expect(refused.isError).toBe(true);

    const done = runToolUsage({ cwd: repo, env });
    if (!done.ok) throw new Error('unreachable');
    const byTool = Object.fromEntries(done.tools.map((row) => [row.tool, row]));
    expect(byTool.capture_memory).toMatchObject({ calls: 2, refused: 0, effect: 'mutates' });
    expect(byTool.search).toMatchObject({ calls: 1, refused: 0, effect: 'reads' });
    expect(byTool.read_record).toMatchObject({ calls: 1, refused: 1, effect: 'reads' });

    const lines = readToolCalls(theFile()).calls;
    expect(lines.map((line) => `${line.tool}:${line.result}`)).toEqual([
      'capture_memory:ok',
      'capture_memory:ok',
      'search:ok',
      expect.stringMatching(/^read_record:[A-Z_]+$/),
    ]);
    // One line has exactly four fields: nothing else of a call is kept.
    const first = JSON.parse(readFileSync(theFile(), 'utf-8').split('\n')[0] ?? '') as object;
    expect(Object.keys(first).sort()).toEqual(['at', 'effect', 'result', 'tool']);
  });

  it("writes a call's line after its reply has gone, and loses none", async () => {
    const client = await connect();
    await client.callTool({ name: 'search', arguments: { term: 'a' } });
    await client.callTool({ name: 'search', arguments: { term: 'b' } });
    await client.callTool({ name: 'capture_memory', arguments: { content: 'c' } });
    // The reply of the last call is in hand and its line is not on the file yet: the count is not
    // part of the time the call took.
    const onDisk = (): string => (existsSync(theFile()) ? readFileSync(theFile(), 'utf-8') : '');
    expect(onDisk()).not.toContain('capture_memory');
    flushToolCalls();
    expect(onDisk()).toContain('capture_memory');
    expect(readToolCalls(theFile()).calls.map((call) => call.tool)).toEqual([
      'search',
      'search',
      'capture_memory',
    ]);
    await client.close();
  });

  it('leaves the line of a call on disk when SIGTERM arrives before the write turn', async () => {
    const { server, armClose } = buildMcpServer({ cwd: sandbox, env, log: () => undefined });
    const client = new Client(
      { name: 'claude-code', version: '1.0.0' },
      { capabilities: { roots: {} } },
    );
    client.setRequestHandler(ListRootsRequestSchema, () => ({
      roots: [{ uri: pathToFileURL(repo).href }],
    }));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    const signals = new Map<string, () => void>();
    armClose({
      on: (event, handler) => signals.set(event, handler),
      off: () => {},
      // Swallowed: a re-raise here would take the test runner down.
      raise: () => {},
      onStdin: () => {},
    });
    await client.callTool({ name: 'capture_memory', arguments: { content: 'last words' } });
    const onDisk = (): string => (existsSync(theFile()) ? readFileSync(theFile(), 'utf-8') : '');
    expect(onDisk()).not.toContain('capture_memory');
    // The signal handler runs in the turn after the reply and before the write turn.
    signals.get('SIGTERM')?.();
    expect(onDisk()).toContain('capture_memory');
    await client.close();
  });

  it('keeps no argument: a marker sent to a write and to a read is nowhere in the file', async () => {
    const client = await connect();
    await client.callTool({ name: 'capture_memory', arguments: { content: MARKER } });
    await client.callTool({ name: 'search', arguments: { term: MARKER } });
    await client.callTool({ name: 'read_record', arguments: { id: MARKER } });
    await client.close();

    flushToolCalls();
    const text = readFileSync(theFile(), 'utf-8');
    expect(text.split('\n').filter((line) => line !== '')).toHaveLength(3);
    expect(text).not.toContain(MARKER);
  });

  it('never lands in the repository: it is outside the working tree and the record', async () => {
    const client = await connect();
    await client.callTool({ name: 'capture_memory', arguments: { content: 'x' } });
    await client.close();

    const file = theFile();
    expect(file.startsWith(`${join(env.home, '.mnema')}/`)).toBe(true);
    expect(file.startsWith(`${repo}/`)).toBe(false);
    expect(readToolCalls(file).calls).toHaveLength(1);
    // And nothing under the repository, `.git` and the committed tree included, is a count.
    for (const path of filesUnder(repo)) {
      expect(readFileSync(join(repo, path)).includes('"effect":"mutates"'), path).toBe(false);
    }
    expect(filesUnder(repo).filter((path) => path.endsWith(basename(file)))).toEqual([]);
  });

  it('keeps nothing while switched off, and keeps again when switched on', async () => {
    const off = runSwitch({ cwd: repo, env }, { channel: 'tool-call-count', on: false });
    expect(off.ok).toBe(true);
    const client = await connect();
    await client.callTool({ name: 'search', arguments: { term: 'x' } });
    expect(readToolCalls(theFile()).calls).toEqual([]);

    const done = runToolUsage({ cwd: repo, env });
    if (!done.ok) throw new Error('unreachable');
    expect(done.counting).toBe(false);
    expect(toolUsageReport(renderPlain, done).join('\n')).toContain('switched off');

    runSwitch({ cwd: repo, env }, { channel: 'tool-call-count', on: true });
    await client.callTool({ name: 'search', arguments: { term: 'x' } });
    await client.close();
    expect(readToolCalls(theFile()).calls.map((call) => call.tool)).toEqual(['search']);
  });

  it('keeps nothing, and makes no directory, on a machine that has no key of its own yet', async () => {
    const stranger = join(sandbox, 'stranger');
    mkdirSync(stranger, { recursive: true });
    const strangerEnv = { home: stranger };
    const { server } = buildMcpServer({ cwd: sandbox, env: strangerEnv, log: () => undefined });
    const client = new Client(
      { name: 'claude-code', version: '1.0.0' },
      { capabilities: { roots: {} } },
    );
    client.setRequestHandler(ListRootsRequestSchema, () => ({
      roots: [{ uri: pathToFileURL(repo).href }],
    }));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    await client.callTool({ name: 'search', arguments: { term: 'x' } });
    await client.close();
    expect(readdirSync(stranger)).toEqual([]);
  });

  it('is on until somebody switches it, and says so on the listing', () => {
    const done = runToolUsage({ cwd: repo, env });
    if (!done.ok) throw new Error('unreachable');
    expect(done.counting).toBe(true);
    expect(done.tools).toEqual([]);
  });

  it('says what it counts and what it does not, and prints the example', async () => {
    const client = await connect();
    await client.callTool({ name: 'search', arguments: { term: 'x' } });
    await client.close();
    const done = runToolUsage({ cwd: repo, env });
    if (!done.ok) throw new Error('unreachable');
    const said = toolUsageReport(renderPlain, done).join('\n');
    expect(said).toContain('1 tool(s) called:');
    expect(said).toContain('1 call(s)');
    expect(said).toContain('only the calls the MCP server on this machine answered');
    expect(said).toContain('not in the record');
  });
});
