/**
 * A WRITE THAT NAMED A PROJECT SAYS WHICH DIRECTORY IT FELL IN.
 *
 * The answers of the read tools name a project by its directory's name when no other
 * project of the workspace has it. That name is what a conversation carries back into
 * `project` on a write, and a conversation outlives the connection: after a reload the
 * new workspace may hold a different `api` than the one the name was learnt in, and the
 * write — signed, append-only — resolves to it without a word. Nothing can refuse it,
 * the name is valid. What can be done is to make the landing visible at once, in the
 * one reply the caller reads: the absolute path, the only spelling that cannot mean two
 * places.
 *
 * Seven verbs take `project`, so each is driven here, over the real transport, and the
 * expected path is the directory the test made (the disk is the witness, not the reply).
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

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-routed-says-'));
  const home = join(sandbox, 'home');
  mkdirSync(home, { recursive: true });
  env = { home };
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** A directory that IS a project, at `<sandbox>/<area>/<names…>`. */
function makeProject(area: string, ...names: string[]): string {
  const dir = join(sandbox, area, ...names);
  mkdirSync(dir, { recursive: true });
  ensureTree({ root: join(dir, PROJECT_DIR) });
  return dir;
}

async function connect(...projects: readonly string[]): Promise<Client> {
  const { server } = buildMcpServer({ cwd: sandbox, env, log: () => {} });
  const client = new Client(
    { name: 'claude-code', version: '1.0.0' },
    { capabilities: { roots: {} } },
  );
  client.setRequestHandler(ListRootsRequestSchema, () => ({
    roots: projects.map((dir) => ({ uri: pathToFileURL(dir).href, name: dir })),
  }));
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientSide), server.connect(serverSide)]);
  return client;
}

/** What the caller reads: every text block of the reply, in order. */
async function say(client: Client, name: string, args: Record<string, unknown>): Promise<string> {
  const reply = await client.callTool({ name, arguments: args });
  expect(reply.isError).not.toBe(true);
  const blocks = reply.content as { type: string; text: string }[];
  return blocks.map((block) => block.text).join('\n');
}

const VERBS: readonly { name: string; args: Record<string, unknown> }[] = [
  { name: 'capture_memory', args: { content: 'the fact' } },
  { name: 'record_observation', args: { about: 'some-id', topic: 'shape', text: 'it looks so' } },
  { name: 'record_handoff', args: { task: 'some-id', from: 'claude-code', to: 'claude-code' } },
  { name: 'link_knowledge', args: { subject: 'some-id', target: 'other-id', rel: 'relates-to' } },
  { name: 'create_task', args: { title: 'the task' } },
  { name: 'record_decision', args: { title: 'the decision', rationale: 'because' } },
  { name: 'create_skill', args: { name: 'the pattern', body: 'do it this way' } },
];

describe('a write routed by `project` says the absolute path it fell in', () => {
  for (const verb of VERBS) {
    it(`${verb.name}: the name routes it, the reply says where`, async () => {
      const first = makeProject('area', 'first');
      const second = makeProject('area', 'second');
      const client = await connect(first, second);

      const text = await say(client, verb.name, { ...verb.args, project: 'second' });

      expect(text).toContain(`\n  In the project at ${second}.`);
      expect(text).not.toContain(first);
      await client.close();
    });

    it(`${verb.name}: the path routes it, and the reply says the same path`, async () => {
      const first = makeProject('area', 'first');
      const second = makeProject('area', 'second');
      const client = await connect(first, second);

      const text = await say(client, verb.name, { ...verb.args, project: first });

      expect(text).toContain(`\n  In the project at ${first}.`);
      expect(text).not.toContain(second);
      await client.close();
    });

    it(`${verb.name}: with no \`project\` the reply names no directory`, async () => {
      const first = makeProject('area', 'first');
      const second = makeProject('area', 'second');
      const client = await connect(first, second);

      const text = await say(client, verb.name, verb.args);

      expect(text).not.toContain('In the project at');
      await client.close();
    });
  }

  it('a name carried over a reconnection lands in the OTHER `api`, and the path shows it', async () => {
    // The conversation learnt `api` in one workspace and writes by it in two.
    const oldApi = makeProject('one', 'api');
    const oldOther = makeProject('one', 'alpha');
    const newApi = makeProject('two', 'api');
    const newOther = makeProject('two', 'alpha');

    const before = await connect(oldApi, oldOther);
    const afterReload = await connect(newApi, newOther);

    const first = await say(before, 'capture_memory', { content: 'a', project: 'api' });
    const second = await say(afterReload, 'capture_memory', { content: 'b', project: 'api' });

    expect(first).toContain(`\n  In the project at ${oldApi}.`);
    expect(second).toContain(`\n  In the project at ${newApi}.`);
    expect(second).not.toContain(oldApi);
    await before.close();
    await afterReload.close();
  });

  it('a write to the global tree through a project says no project (it fell in none)', async () => {
    const first = makeProject('area', 'first');
    const second = makeProject('area', 'second');
    const client = await connect(first, second);

    const text = await say(client, 'capture_memory', {
      content: 'mine, everywhere',
      project: 'second',
      scope: 'global',
    });

    expect(text).toContain('Landed in the global tree');
    expect(text).not.toContain('In the project at');
    await client.close();
  });
});
