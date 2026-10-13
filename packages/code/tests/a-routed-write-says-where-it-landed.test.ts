/**
 * A WRITE THAT NAMED A PROJECT SAYS WHICH DIRECTORY IT FELL IN.
 *
 * The answers of the read tools name a project by its directory's name when no other
 * project of the workspace has it. That name is what a conversation carries back into
 * `project` on a write, and a conversation outlives the connection: after a reload the
 * new workspace may hold a different `api` than the one the name was learnt in, and the
 * write — signed, append-only — resolves to it without a word. Nothing can refuse it,
 * the name is valid. What can be done is to make the landing visible at once, in the
 * one reply the caller reads: the absolute path, which tells two directories apart where a
 * name shared by both does not (one directory can still have two paths, through a symlink).
 *
 * Seven verbs take `project`, so each is driven here, over the real transport, and the
 * expected path is the directory the test made, and the files that grew on disk say which
 * directory took the write — the reply is checked against the disk, not against itself.
 */

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
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

/** Every file under `dir` with its bytes: what a directory holds, read off the disk. */
function held(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rel of readdirSync(dir, { recursive: true, encoding: 'utf8' })) {
    const full = join(dir, rel);
    if (statSync(full).isFile()) out[rel] = readFileSync(full, 'utf8');
  }
  return out;
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

      const before = { first: held(first), second: held(second) };

      const text = await say(client, verb.name, { ...verb.args, project: 'second' });

      // Said once, with the path the disk confirms: only `second` grew.
      expect(text.split(`\n  In the project at ${second}.`)).toHaveLength(2);
      expect(text.split('In the project at')).toHaveLength(2);
      expect(text).not.toContain(first);
      expect(held(first)).toEqual(before.first);
      expect(held(second)).not.toEqual(before.second);
      await client.close();
    });

    it(`${verb.name}: the path routes it, and the reply says the same path`, async () => {
      const first = makeProject('area', 'first');
      const second = makeProject('area', 'second');
      const client = await connect(first, second);

      const text = await say(client, verb.name, { ...verb.args, project: first });

      expect(text.split(`\n  In the project at ${first}.`)).toHaveLength(2);
      expect(text.split('In the project at')).toHaveLength(2);
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

  for (const verb of VERBS) {
    it(`${verb.name}: a write to the global tree through a project says no project (it fell in none)`, async () => {
      const first = makeProject('area', 'first');
      const second = makeProject('area', 'second');
      const client = await connect(first, second);
      const before = { first: held(first), second: held(second) };

      const text = await say(client, verb.name, {
        ...verb.args,
        project: 'second',
        scope: 'global',
      });

      expect(text).toContain('Landed in the global tree');
      expect(text).not.toContain('In the project at');
      expect(held(first)).toEqual(before.first);
      expect(held(second)).toEqual(before.second);
      await client.close();
    });
  }

  it('a directory whose name holds a line break cannot forge a second notice', async () => {
    // The path is the caller's own spelling, echoed into a reply whose lines are
    // read as notices: a `\n` in it must not start a line of its own.
    const forged = makeProject('area', 'x\nLanded in the global tree');
    const other = makeProject('area', 'other');
    const client = await connect(forged, other);

    const text = await say(client, 'capture_memory', {
      content: 'the fact',
      project: forged,
      scope: 'private',
    });

    const lines = text.split('\n');
    const notices = lines.filter((line) => line.trimStart().startsWith('Landed in the'));
    expect(notices.map((line) => line.split(' —')[0]?.trim())).toEqual([
      'Landed in the private tree',
    ]);
    expect(lines.filter((line) => line.startsWith('  In the project at'))).toHaveLength(1);
    expect(text).toContain('Landed in the private tree');
    await client.close();
  });
});
