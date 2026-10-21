/**
 * THE RUNS AN ACTOR LEFT ARE READ IN EVERY PROJECT OF THE WORKSPACE, AND AN ABSENT ACTOR IS SAID.
 *
 * A session opens on the first project its client lists, and its `resume`, `focus` and the resume
 * inside `bootstrap` read that project's trees alone. A first write routed to the SECOND project
 * opens the session's run there, so the answers went on saying `lastRun: null` and no open run
 * about a session that had just written. And before any write, on a machine with no key, they said
 * `actor: ""` and nothing else, which reads as an answer about nobody rather than as "no one signs
 * here yet".
 *
 * What is asserted, over the real transport on a workspace of two projects: after a write routed
 * to the second project, the three reads name the actor, the run the session opened there (as its
 * own), and its open work; and before any write, each says in a block of its own that no identity
 * signs for the session yet, and drops the sentence once one does.
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
let first: string;
let second: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-runs-where-written-'));
  const home = join(sandbox, 'home');
  mkdirSync(home, { recursive: true });
  env = { home };
  for (const name of ['first', 'second']) {
    const dir = join(sandbox, name);
    mkdirSync(dir, { recursive: true });
    ensureTree({ root: join(dir, PROJECT_DIR) });
  }
  first = join(sandbox, 'first');
  second = join(sandbox, 'second');
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

async function connect(): Promise<Client> {
  const { server } = buildMcpServer({ cwd: sandbox, env, log: () => {} });
  const client = new Client(
    { name: 'claude-code', version: '1.0.0' },
    { capabilities: { roots: {} } },
  );
  client.setRequestHandler(ListRootsRequestSchema, () => ({
    roots: [first, second].map((dir) => ({ uri: pathToFileURL(dir).href, name: dir })),
  }));
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientSide), server.connect(serverSide)]);
  return client;
}

interface Reply {
  readonly payload: Record<string, unknown>;
  readonly notes: readonly string[];
}

/** A read's answer: the JSON of its first block, and every block after it. */
async function read(client: Client, name: string): Promise<Reply> {
  const reply = await client.callTool({ name, arguments: {} });
  expect(reply.isError).not.toBe(true);
  const blocks = (reply.content as { text: string }[]).map((block) => block.text);
  return { payload: JSON.parse(blocks[0] as string), notes: blocks.slice(1) };
}

const NO_ONE_SIGNS = 'No identity signs for this session yet';

describe('the reads about the actor, on a workspace of two projects', () => {
  it('say no one signs yet, before the first write, in a block of their own', async () => {
    const client = await connect();
    for (const name of ['resume', 'focus', 'bootstrap']) {
      const said = await read(client, name);
      const actor =
        name === 'bootstrap' ? (said.payload.resume as { actor: string }) : said.payload;
      expect(actor.actor, name).toBe('');
      expect(said.notes.join('\n'), name).toContain(NO_ONE_SIGNS);
    }
    await client.close();
  });

  it('read the run a write routed to the second project opened, as the session’s own', async () => {
    const client = await connect();
    const wrote = await client.callTool({
      name: 'create_task',
      arguments: { title: 'work in the second project', project: second },
    });
    expect(wrote.isError).not.toBe(true);

    const resumed = (await read(client, 'resume')).payload as {
      actor: string;
      lastRun: { thisSession: boolean; open: boolean } | null;
      focus: { openRuns: { thisSession: boolean }[] };
    };
    expect(resumed.actor).toMatch(/^mnid:/);
    expect(resumed.lastRun).toMatchObject({ thisSession: true, open: true });
    expect(resumed.focus.openRuns).toHaveLength(1);

    const focused = (await read(client, 'focus')).payload as {
      actor: string;
      openRuns: { thisSession: boolean }[];
    };
    expect(focused.actor).toBe(resumed.actor);
    expect(focused.openRuns).toMatchObject([{ thisSession: true }]);

    const opened = await read(client, 'bootstrap');
    expect((opened.payload.resume as { lastRun: unknown }).lastRun).toEqual(resumed.lastRun);
    expect(opened.notes.join('\n')).not.toContain(NO_ONE_SIGNS);
    await client.close();
  });
});
