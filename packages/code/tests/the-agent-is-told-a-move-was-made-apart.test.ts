/**
 * AN AGENT IS TOLD, BESIDE THE ANSWER, WHEN A RECORD WAS MOVED TWICE OUT OF ONE STATE.
 *
 * Two machines that moved one task without seeing each other leave two signed moves out of the
 * same state; `mnema show` and the brief say so, in the words `movedApartSentence` holds, and the
 * state they print is the last move in the record's order. `read_record` and `bootstrap` served
 * the same record to the agent with the last state alone, so the agent read "BLOCKED" about a task
 * that also left IN_PROGRESS for DONE, and had no way to know.
 *
 * What is asserted, over the real transport: `read_record` of the task and `bootstrap` each carry
 * the sentence, as a block of its own beside the payload and word for word the command line's;
 * a record moved in one line carries nothing of the sort; and the payload is the document it was.
 *
 * The two machines are made the way two clones make them (see `show-says-a-move-made-apart.test.ts`).
 */

import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { catalogUpcasters, openChainForWriting } from '@mnema/chain';
import { type DiscoveryEnv, resolveTrees } from '@mnema/core';
import { createTask, openTreeForWriting, transitionTask } from '@mnema/core/write';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runInit } from '../src/commands/init.js';
import { buildMcpServer } from '../src/mcp/server.js';
import { movedApartSentence } from '../src/record-integrity.js';
import { divergenceNotice } from '../src/wiring/integrity.js';

let sandbox: string;
let repo: string;
let env: DiscoveryEnv;
let root: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-agent-apart-'));
  repo = join(sandbox, 'repo');
  mkdirSync(repo, { recursive: true });
  env = { home: join(sandbox, 'home') };
  runInit({ cwd: repo, env });
  root = resolveTrees(repo, env).projectPublic as string;
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** One second per reading, from `start` seconds into 2030, so the merged order is the order made. */
function ticking(start: number): () => string {
  let t = start;
  return () => {
    t += 1;
    return new Date(Date.UTC(2030, 0, 1, 0, 0, t)).toISOString();
  };
}

function ok<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error(`setup refused: ${JSON.stringify(result)}`);
  return result as Extract<T, { ok: true }>;
}

/** A task that two clones moved out of IN_PROGRESS, one to DONE and one to BLOCKED; returns its id. */
function aTaskMovedApart(): string {
  const upcasters = catalogUpcasters();
  const here = {
    writer: openTreeForWriting(resolveTrees(repo, env), 'public'),
    layout: { root },
    upcasters,
    clock: ticking(0),
  };
  const { id } = ok(createTask(here, { title: 'Ship it' }));
  ok(transitionTask(here, { id, action: 'submit' }));
  ok(transitionTask(here, { id, action: 'start' }));
  here.writer.checkpoint();

  const cloneRoot = join(sandbox, 'clone-tree');
  cpSync(root, cloneRoot, { recursive: true });
  const clone = {
    writer: openChainForWriting(cloneRoot, { keyRoot: join(sandbox, 'clone-key') }),
    layout: { root: cloneRoot },
    upcasters,
    clock: ticking(100),
  };
  ok(transitionTask(here, { id, action: 'complete', fields: { note: 'shipped' } }));
  ok(transitionTask(clone, { id, action: 'block', fields: { reason: 'waiting on review' } }));
  here.writer.checkpoint();
  clone.writer.checkpoint();
  cpSync(join(cloneRoot, 'tails', clone.writer.tail), join(root, 'tails', clone.writer.tail), {
    recursive: true,
  });
  cpSync(join(cloneRoot, 'keys'), join(root, 'keys'), { recursive: true });
  return id;
}

async function connect(): Promise<Client> {
  const { server } = buildMcpServer({ cwd: sandbox, env, log: () => {} });
  const client = new Client(
    { name: 'claude-code', version: '1.0.0' },
    { capabilities: { roots: {} } },
  );
  client.setRequestHandler(ListRootsRequestSchema, () => ({
    roots: [{ uri: pathToFileURL(repo).href, name: repo }],
  }));
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientSide), server.connect(serverSide)]);
  return client;
}

/** Every block of a read's answer. */
async function blocks(client: Client, name: string, args: Record<string, unknown>) {
  const reply = await client.callTool({ name, arguments: args });
  expect(reply.isError).not.toBe(true);
  return (reply.content as { text: string }[]).map((block) => block.text);
}

const SAID =
  'this task left IN_PROGRESS more than once: to DONE, then BLOCKED, by moves on machines that had not seen each other. Each is a signed fact of the record; the state shown is the last of them in its order.';

describe('a record moved apart, read by an agent', () => {
  it('has one sentence, which is the command line’s word for word', () => {
    const move = { kind: 'task', entityId: 'x', from: 'IN_PROGRESS', to: ['DONE', 'BLOCKED'] };
    expect(movedApartSentence(move as never)).toBe(SAID);
    const line = divergenceNotice([move] as never)[0];
    expect(line?.parts.map((part) => part.text).join('')).toBe(SAID);
  });

  it('is said by `read_record`, beside the payload', async () => {
    const id = aTaskMovedApart();
    const client = await connect();
    const said = await blocks(client, 'read_record', { id });
    expect(JSON.parse(said[0] as string)).toMatchObject({ kind: 'task' });
    expect(said.slice(1).join('\n')).toContain(SAID);
    await client.close();
  });

  it('is said by `bootstrap`, the opening read', async () => {
    aTaskMovedApart();
    const client = await connect();
    const said = await blocks(client, 'bootstrap', {});
    expect(JSON.parse(said[0] as string)).toHaveProperty('work');
    expect(said.slice(1).join('\n')).toContain(SAID);
    await client.close();
  });

  it('is said once, naming both projects, when two checkouts hold the record', async () => {
    const id = aTaskMovedApart();
    const clone = join(sandbox, 'clone');
    cpSync(repo, clone, { recursive: true });
    const { server } = buildMcpServer({ cwd: sandbox, env, log: () => {} });
    const client = new Client(
      { name: 'claude-code', version: '1.0.0' },
      { capabilities: { roots: {} } },
    );
    client.setRequestHandler(ListRootsRequestSchema, () => ({
      roots: [repo, clone].map((dir) => ({ uri: pathToFileURL(dir).href, name: dir })),
    }));
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientSide), server.connect(serverSide)]);
    const said = (await blocks(client, 'read_record', { id })).slice(1).join('\n');
    expect(said.split('more than once')).toHaveLength(2);
    expect(said).toContain(repo);
    expect(said).toContain(clone);
    await client.close();
  });

  it('is not said about a record moved in one line', async () => {
    const upcasters = catalogUpcasters();
    const here = {
      writer: openTreeForWriting(resolveTrees(repo, env), 'public'),
      layout: { root },
      upcasters,
    };
    const { id } = ok(createTask(here, { title: 'Ship it' }));
    ok(transitionTask(here, { id, action: 'submit' }));
    here.writer.checkpoint();
    const client = await connect();
    for (const [name, args] of [
      ['read_record', { id }],
      ['bootstrap', {}],
    ] as const) {
      expect((await blocks(client, name, args)).join('\n'), name).not.toContain('more than once');
    }
    await client.close();
  });
});
