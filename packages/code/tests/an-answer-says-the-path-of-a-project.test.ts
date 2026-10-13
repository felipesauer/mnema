/**
 * AN ANSWER NAMES A PROJECT BY ITS PATH, SO AN ECHO OF IT CANNOT LAND IN ANOTHER DIRECTORY.
 *
 * A short name is not stable across connections: after a reload the workspace can hold a
 * different directory with the same name, and a name carried over would write into it,
 * silently. The absolute path is refused as `UNKNOWN_PROJECT` there, and nothing is written.
 *
 * The scenario: three repositories, `work/api`, `work/alpha` and `clones/api`. Connection 1
 * (`work/api`, `work/alpha`) reads. Connection 2 (`clones/api`, `work/alpha`) echoes what
 * connection 1 said into a write.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ensureTree } from '@mnema/chain';
import { type DiscoveryEnv, PROJECT_DIR } from '@mnema/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildMcpServer } from '../src/mcp/server.js';

let sandbox: string;
let env: DiscoveryEnv;
let workApi: string;
let workAlpha: string;
let clonesApi: string;

function makeProject(...parts: string[]): string {
  const dir = join(sandbox, ...parts);
  mkdirSync(dir, { recursive: true });
  ensureTree({ root: join(dir, PROJECT_DIR) });
  return dir;
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-path-answers-'));
  const home = join(sandbox, 'home');
  mkdirSync(home, { recursive: true });
  env = { home };
  workApi = makeProject('work', 'api');
  workAlpha = makeProject('work', 'alpha');
  clonesApi = makeProject('clones', 'api');
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

async function connect(roots: readonly string[]): Promise<Client> {
  const { server } = buildMcpServer({ cwd: sandbox, env, log: () => {} });
  const client = new Client(
    { name: 'claude-code', version: '1.0.0' },
    { capabilities: { roots: {} } },
  );
  client.setRequestHandler(ListRootsRequestSchema, () => ({
    roots: roots.map((dir) => ({ uri: pathToFileURL(dir).href, name: dir })),
  }));
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientSide), server.connect(serverSide)]);
  return client;
}

function text(result: unknown): string {
  return (result as { content: { text: string }[] }).content[0]?.text as string;
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const reply = await client.callTool({ name, arguments: args });
  expect(reply.isError, text(reply)).not.toBe(true);
  return text(reply);
}

describe('an answer gives the absolute path of a project', () => {
  it('search and read_record say the path, even where the directory name is unique', async () => {
    const one = await connect([workApi, workAlpha]);
    await call(one, 'capture_memory', { content: 'the shared runbook', project: workApi });
    await call(one, 'capture_memory', { content: 'the shared runbook', project: workAlpha });

    const found = JSON.parse(await call(one, 'search', { term: 'runbook' })) as {
      hits: { id: string; project?: string }[];
    };
    expect(found.hits.map((hit) => hit.project).sort()).toEqual([workAlpha, workApi].sort());

    const id = found.hits[0]?.id as string;
    const record = JSON.parse(await call(one, 'read_record', { id })) as { project?: string };
    expect([workAlpha, workApi]).toContain(record.project);
    await one.close();
  });

  it('an echo of it on a connection that holds another directory of that name is refused and writes nothing', async () => {
    const one = await connect([workApi, workAlpha]);
    await call(one, 'capture_memory', { content: 'kept in the work repository', project: workApi });
    const found = JSON.parse(await call(one, 'search', { term: 'work repository' })) as {
      hits: { project?: string }[];
    };
    const said = found.hits[0]?.project as string;
    expect(said).toBe(workApi);
    await one.close();

    const two = await connect([clonesApi, workAlpha]);
    const refused = await two.callTool({
      name: 'capture_memory',
      arguments: { content: 'echoed from another connection', project: said },
    });
    expect(refused.isError).toBe(true);
    expect(text(refused)).toContain('UNKNOWN_PROJECT');

    const none = JSON.parse(await call(two, 'search', { term: 'echoed from another' })) as {
      hits: unknown[];
    };
    expect(none.hits).toEqual([]);
    await two.close();
  });
});
