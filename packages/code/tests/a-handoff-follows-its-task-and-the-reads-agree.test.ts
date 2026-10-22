/**
 * Where a handoff lands when it names no tree, what `next_actions` says over the wire, how `show`
 * and `read_record` count a task's notes, and what the link notice says of a relation that is not
 * an address.
 *
 * The MCP cases go through a connected client and assert on the text the reply carries; the tree
 * cases read the chains off disk, never the tool's own answer.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ensureTree } from '@mnema/chain';
import { type DiscoveryEnv, PROJECT_DIR, resolveTrees } from '@mnema/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runObserve } from '../src/commands/observe.js';
import { runShow } from '../src/commands/show.js';
import { runTask } from '../src/commands/task.js';
import { buildMcpServer } from '../src/mcp/server.js';
import { closeSession, openSession } from '../src/mcp/session.js';
import { runReadRecordTool } from '../src/mcp/tools.js';

let sandbox: string;
let project: string;
let env: DiscoveryEnv;
let client: Client;

async function call(name: string, args: Record<string, unknown> = {}): Promise<string> {
  const reply = (await client.callTool({ name, arguments: args })) as {
    content: { type: string; text?: string }[];
  };
  return reply.content.map((c) => c.text ?? '').join('\n');
}

/** The id in the `(<uuid>)` a creation reply carries. */
function idIn(said: string): string {
  const id = said.match(/\(([0-9a-f-]{20,})\)/)?.[1];
  if (id === undefined) throw new Error(`setup: no id in ${said}`);
  return id;
}

/** Every file under a directory, as text, for a search of what a tree holds on disk. */
function textsUnder(dir: string, skip?: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (path === skip) continue;
    if (statSync(path).isDirectory()) out.push(...textsUnder(path, skip));
    else out.push(readFileSync(path, 'utf8'));
  }
  return out;
}

beforeEach(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-handoff-follows-'));
  project = join(sandbox, 'repo');
  mkdirSync(project, { recursive: true });
  ensureTree({ root: join(project, PROJECT_DIR) });
  env = { home: join(sandbox, 'home') };
  mkdirSync(env.home, { recursive: true });
  const { server } = buildMcpServer({ cwd: project, env, log: () => {} });
  client = new Client({ name: 'claude-code', version: '1.0.0' }, { capabilities: { roots: {} } });
  client.setRequestHandler(ListRootsRequestSchema, () => ({
    roots: [{ uri: pathToFileURL(project).href }],
  }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
});

afterEach(async () => {
  await client.close();
  rmSync(sandbox, { recursive: true, force: true });
});

describe('record_handoff with no scope follows the task', () => {
  it('keeps a private task handoff and its brief out of the public tree', async () => {
    const task = idIn(await call('create_task', { title: 'Private work', scope: 'private' }));
    const said = await call('record_handoff', {
      task,
      from: 'alice',
      to: 'bob',
      brief: 'PRIVBRIEF yak',
    });
    expect(said).toContain('Landed in the private tree');
    expect(said).not.toContain('Landed in the public tree');
    expect(said).not.toContain('holds');
    const trees = resolveTrees(project, env);
    expect(
      textsUnder(join(project, PROJECT_DIR), join(project, PROJECT_DIR, 'private')).join('\n'),
    ).not.toContain('PRIVBRIEF');
    expect(trees.projectPrivate).toBeDefined();
    expect(textsUnder(trees.projectPrivate as string).join('\n')).toContain('PRIVBRIEF');
  });

  it('lands a public task handoff in the public tree', async () => {
    const task = idIn(await call('create_task', { title: 'Team work', scope: 'public' }));
    const said = await call('record_handoff', {
      task,
      from: 'alice',
      to: 'bob',
      brief: 'PUBBRIEF',
    });
    expect(said).toContain('Landed in the public tree');
    expect(
      textsUnder(join(project, PROJECT_DIR), join(project, PROJECT_DIR, 'private')).join('\n'),
    ).toContain('PUBBRIEF');
  });

  it('says so when no tree holds the task, and keeps the default', async () => {
    const said = await call('record_handoff', {
      task: '00000000-0000-7000-8000-000000000000',
      from: 'alice',
      to: 'bob',
    });
    expect(said).toContain('No tree of this workspace holds 00000000-0000-7000-8000-000000000000');
    expect(said).toContain('took the default tree (public)');
    expect(said).toContain('Landed in the public tree');
  });
});

describe('next_actions says who has the task and what happened last, in the reply', () => {
  it('carries both lines after the list of moves', async () => {
    const task = idIn(await call('create_task', { title: 'Hand me over' }));
    await call('record_handoff', { task, from: 'alice', to: 'bob', brief: 'Over to you.' });
    const reply = (await client.callTool({ name: 'next_actions', arguments: { id: task } })) as {
      content: { text: string }[];
    };
    const [moves, ...lines] = reply.content.map((c) => c.text);
    expect(JSON.parse(moves as string)).toBeInstanceOf(Array);
    expect(lines).toContain('Held by bob, by its last handoff.');
    expect(lines.some((line) => line.startsWith('Last: brief: Over to you.'))).toBe(true);
  });
});

describe('show and read_record count a task notes the same way', () => {
  it('counts a private note about a public task in both', () => {
    const cwd = { cwd: project, env };
    const made = runTask(cwd, { title: 'Counted', scope: 'public' });
    if (!made.ok) throw new Error('setup: task refused');
    for (const [scope, text] of [
      ['public', 'in the public tree'],
      ['private', 'in the private tree'],
    ] as const) {
      const noted = runObserve(cwd, { about: made.id, topic: 'finding', text, scope });
      if (!noted.ok) throw new Error('setup: observation refused');
    }
    const shown = runShow(cwd, { id: made.id });
    if (!shown.ok || shown.record.kind !== 'task') throw new Error('show did not read the task');

    const session = openSession({
      clientName: 'claude-code',
      roots: [pathToFileURL(project).href],
      env,
    });
    try {
      const read = runReadRecordTool(session, { id: made.id });
      if (!read.ok || read.value.kind !== 'task') throw new Error('read_record did not read it');
      expect(read.value.story?.notes.total).toBe(2);
      expect(shown.record.story?.notes.total).toBe(2);
    } finally {
      closeSession(session);
    }
  });
});

describe('link_knowledge says what a missing subject means for the relation it was given', () => {
  it('does not call a missing subject a rule for a relation that is no address', async () => {
    const said = await call('link_knowledge', {
      subject: '00000000-0000-7000-8000-000000000001',
      target: '00000000-0000-7000-8000-000000000002',
      rel: 'relates-to',
      scope: 'public',
    });
    expect(said).toContain(
      'No tree here holds 00000000-0000-7000-8000-000000000001, so this link names nothing a reader can open.',
    );
    expect(said).not.toContain('rule');
    expect(said).not.toContain('address');
  });

  it('keeps the address wording where the relation is an address', async () => {
    const said = await call('link_knowledge', {
      subject: '00000000-0000-7000-8000-000000000001',
      target: 'src',
      rel: 'governs',
      scope: 'public',
    });
    expect(said).toContain('No tree here holds the rule it names');
  });
});
