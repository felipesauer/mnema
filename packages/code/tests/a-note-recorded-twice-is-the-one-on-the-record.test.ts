/**
 * Recording the same memory or observation twice answers with the one that is on the record.
 *
 * THE DEFECT. A `capture_memory` or a `record_observation` repeated after a reply that never
 * arrived wrote a second note with another id, as a decision did until it was fixed. Now a note
 * whose text (and, for an observation, topic and `about`) is the one being recorded, and that has not
 * been retracted, is the note already there: nothing is written and the reply says so, by both doors.
 * A task is not looked for: two tasks with one title are two tasks.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { catalogUpcasters, ensureTree } from '@mnema/chain';
import {
  chainRootForScope,
  type DiscoveryEnv,
  orderedEvents,
  PROJECT_DIR,
  resolveTrees,
} from '@mnema/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildMcpServer } from '../src/mcp/server.js';
import { type CliIo, run } from '../src/program.js';

let sandbox: string;
let repo: string;
let env: DiscoveryEnv;
let originalCwd: string;
let originalHome: string | undefined;
let originalXdg: string | undefined;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-note-twice-'));
  repo = join(sandbox, 'repo');
  mkdirSync(repo, { recursive: true });
  mkdirSync(join(sandbox, 'home'), { recursive: true });
  env = { home: join(sandbox, 'home') };
  ensureTree({ root: join(repo, PROJECT_DIR) });
  originalCwd = process.cwd();
  originalHome = process.env.HOME;
  originalXdg = process.env.XDG_DATA_HOME;
  process.env.HOME = join(sandbox, 'home');
  process.env.XDG_DATA_HOME = join(sandbox, 'data');
  delete process.env.MNEMA_RUN;
  process.chdir(repo);
});

afterEach(() => {
  delete process.env.MNEMA_RUN;
  process.chdir(originalCwd);
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalXdg === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = originalXdg;
  rmSync(sandbox, { recursive: true, force: true });
});

async function connect(): Promise<Client> {
  const { server } = buildMcpServer({ cwd: sandbox, env, log: () => {} });
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

function said(result: unknown): string {
  const content = (result as { content?: { type: string; text?: string }[] }).content ?? [];
  return content
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('\n');
}

/** How many events of this kind the project's tree that travels holds. */
function written(kind: 'memory.captured' | 'observation.recorded'): number {
  const root = chainRootForScope(resolveTrees(repo, env), 'public') as string;
  return orderedEvents({ root }, catalogUpcasters()).filter((event) => event.kind === kind).length;
}

async function mnema(...argv: string[]): Promise<{ out: string; failed: boolean }> {
  const out: string[] = [];
  let failed = false;
  const io: CliIo = {
    out: (line) => out.push(line),
    err: (line) => out.push(line),
    fail: () => {
      failed = true;
    },
  };
  await run(argv, io);
  return { out: out.join('\n'), failed };
}

const idIn = (reply: string, pattern: RegExp): string => {
  const found = reply.match(pattern);
  if (found === null) throw new Error(`setup: not a recording: ${reply}`);
  return found[1] as string;
};

const memoryAlready = (id: string) =>
  `Memory ${id} is already recorded in the public tree with this text. Nothing was written.`;
const observationAlready = (id: string, about: string) =>
  `Observation ${id} about ${about} is already recorded in the public tree with this topic and text. Nothing was written.`;

describe('capture_memory, repeated', () => {
  it('answers with the memory that is there and writes nothing', async () => {
    const client = await connect();
    const args = { content: 'the build needs the chain built first', scope: 'public' };
    const first = said(await client.callTool({ name: 'capture_memory', arguments: args }));
    const id = idIn(first, /Captured memory (\S+)/);
    expect(written('memory.captured')).toBe(1);

    const again = said(await client.callTool({ name: 'capture_memory', arguments: args }));
    expect(again).toContain(memoryAlready(id));
    expect(again).not.toContain('Captured memory');
    expect(again).not.toContain('Landed in');
    expect(written('memory.captured')).toBe(1);

    const other = said(
      await client.callTool({
        name: 'capture_memory',
        arguments: { content: 'the build needs the chain built first.', scope: 'public' },
      }),
    );
    expect(other).toContain('Captured memory');
    expect(written('memory.captured')).toBe(2);
  });

  it('finds the twin after the screen: a secret replaced the first time is replaced again', async () => {
    const client = await connect();
    const args = { content: 'the bucket key is AKIAIOSFODNN7EXAMPLE', scope: 'public' };
    const first = said(await client.callTool({ name: 'capture_memory', arguments: args }));
    const again = said(await client.callTool({ name: 'capture_memory', arguments: args }));
    expect(again).toContain(memoryAlready(idIn(first, /Captured memory (\S+)/)));
    expect(written('memory.captured')).toBe(1);
  });
});

describe('mnema memory, repeated', () => {
  it('prints the memory that is there, across the two doors, and a retracted one is not a twin', async () => {
    const first = await mnema('memory', 'the cache lives in the data dir', '--scope', 'public');
    const id = idIn(first.out, /Captured memory (\S+)/);
    const again = await mnema('memory', 'the cache lives in the data dir', '--scope', 'public');
    expect(again.failed, again.out).toBe(false);
    expect(again.out).toBe(memoryAlready(id));

    const client = await connect();
    const viaTool = said(
      await client.callTool({
        name: 'capture_memory',
        arguments: { content: 'the cache lives in the data dir', scope: 'public' },
      }),
    );
    expect(viaTool).toContain(memoryAlready(id));
    expect(written('memory.captured')).toBe(1);

    const taken = await mnema('retract', id, '--reason', 'it moved');
    expect(taken.failed, taken.out).toBe(false);
    const afresh = await mnema('memory', 'the cache lives in the data dir', '--scope', 'public');
    expect(afresh.out).toContain('Captured memory');
    expect(written('memory.captured')).toBe(2);
  });
});

describe('record_observation, repeated', () => {
  it('answers with the observation that is there, and differs by topic, text or about', async () => {
    const client = await connect();
    const call = (args: Record<string, string>) =>
      client
        .callTool({ name: 'record_observation', arguments: { scope: 'public', ...args } })
        .then(said);
    const first = await call({ about: 'task-1', topic: 'finding', text: 'it is slow' });
    const id = idIn(first, /Recorded observation (\S+) about task-1/);

    expect(await call({ about: 'task-1', topic: 'finding', text: 'it is slow' })).toContain(
      observationAlready(id, 'task-1'),
    );
    expect(written('observation.recorded')).toBe(1);

    expect(await call({ about: 'task-2', topic: 'finding', text: 'it is slow' })).toContain(
      'Recorded observation',
    );
    expect(await call({ about: 'task-1', topic: 'other', text: 'it is slow' })).toContain(
      'Recorded observation',
    );
    expect(await call({ about: 'task-1', topic: 'finding', text: 'it is fast' })).toContain(
      'Recorded observation',
    );
    expect(written('observation.recorded')).toBe(4);
  });
});

describe('mnema observe, repeated', () => {
  it('prints the observation that is there, and a retracted one is not a twin', async () => {
    const run = () =>
      mnema('observe', 'task-9', '--topic', 'finding', '--text', 'flaky', '--scope', 'public');
    const first = await run();
    const id = idIn(first.out, /Recorded observation (\S+) about task-9/);
    const again = await run();
    expect(again.failed, again.out).toBe(false);
    expect(again.out).toBe(observationAlready(id, 'task-9'));
    expect(written('observation.recorded')).toBe(1);

    await mnema('retract', id, '--reason', 'it was not');
    expect((await run()).out).toContain('Recorded observation');
    expect(written('observation.recorded')).toBe(2);
  });
});
