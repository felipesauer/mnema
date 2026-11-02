// @reads-the-tree
/**
 * An agent working through the MCP server is told, in the reply of the tool that wrote, that the
 * writer opened a new tail.
 *
 * The sentence is the writer's (`describeNewTail`, in the chain): the command line writes it to
 * standard error and the MCP server wrote it to the host's log, which a model never reads, so the
 * agent whose write went to another tail was the one party not told. The reply carries it now,
 * once, by the door every reply leaves by (`replied` and `refused` in `mcp/server.ts`, and the
 * hook's reply in `mcp/tools.ts`), beside what a write founded.
 *
 * THE TOOLS ARE FOUND BY WHAT THEY DECLARE, not by a list kept here: every tool the server
 * declares `mutates` is called for real, over one connection, after the writer's note of the last
 * entry it wrote was taken away (which is what a branch switch or a copied checkout leaves), and
 * each reply is held to say it. A writing tool added later arrives in `CALLS` or this file fails
 * on it, and a call that stops opening a tail is named.
 *
 * WHAT A PASS DOES NOT SAY: that a write whose own refusal comes after the writer opened the
 * tail says it. That path is the `STALE_ANCHOR` one, held by its own case below.
 */

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ensureTree } from '@mnema/chain';
import { type DiscoveryEnv, PROJECT_DIR } from '@mnema/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildMcpServer } from '../src/mcp/server.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(HERE, '..', 'src', 'mcp');
const NEW_TAIL = /mnema: wrote to a new tail, (\S+), and left tail (\S+) as it is/g;

let sandbox: string;
let env: DiscoveryEnv;
let project: string;
let logged: string[];

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-mcp-new-tail-'));
  env = { home: join(sandbox, 'home') };
  mkdirSync(env.home as string, { recursive: true });
  project = join(sandbox, 'proj');
  mkdirSync(join(project, 'src'), { recursive: true });
  writeFileSync(join(project, 'src', 'collate.ts'), 'export const collate = () => undefined;\n');
  ensureTree({ root: join(project, PROJECT_DIR) });
  logged = [];
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

async function connect(): Promise<{
  client: Client;
  tools: ReturnType<typeof buildMcpServer>['tools'];
}> {
  const { server, tools } = buildMcpServer({
    cwd: sandbox,
    env,
    log: (line) => logged.push(line),
  });
  const client = new Client(
    { name: 'claude-code', version: '1.0.0' },
    { capabilities: { roots: {} } },
  );
  client.setRequestHandler(ListRootsRequestSchema, () => ({
    roots: [{ uri: pathToFileURL(project).href }],
  }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return { client, tools };
}

function textOf(result: unknown): string {
  const content = (result as { content?: { type: string; text?: string }[] }).content ?? [];
  return content
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('\n');
}

function idIn(said: string): string {
  const found = said.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
  if (found === null) throw new Error(`no minted id in: ${said}`);
  return found[0];
}

/** Takes away the writer's note of the last entry it wrote to each tail, as a branch switch does. */
function forgetWhatWasWritten(dir: string): number {
  let taken = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) taken += forgetWhatWasWritten(path);
    else if (/^[0-9a-f]+-[0-9a-f]+\.head$/.test(entry.name) && dirname(path).endsWith('locks')) {
      rmSync(path);
      taken += 1;
    }
  }
  return taken;
}

/** The sentences of a text that tell of a new tail: the whole sentence, to its full stop. */
function told(text: string): string[] {
  return [...text.matchAll(/mnema: wrote to a new tail,[^\n]*?would fork the tail\./g)].map(
    (one) => one[0],
  );
}

describe('an agent through the MCP server is told of a new tail by the tool that wrote', () => {
  it('says it once in the reply of every tool that writes, and the host log hears the same sentence', async () => {
    const { client, tools } = await connect();
    try {
      // The first writes of the connection: the tails hold nothing yet, so there is nothing to fork.
      const task = idIn(
        textOf(await client.callTool({ name: 'create_task', arguments: { title: 'collate' } })),
      );
      const skill = idIn(
        textOf(
          await client.callTool({
            name: 'create_skill',
            arguments: { name: 'Fold once', body: 'Fold at the edge.' },
          }),
        ),
      );
      const decision = idIn(
        textOf(
          await client.callTool({
            name: 'record_decision',
            arguments: { title: 'Round at the edge', rationale: 'Two roundings disagree.' },
          }),
        ),
      );
      const observation = idIn(
        textOf(
          await client.callTool({
            name: 'record_observation',
            arguments: { about: task, topic: 'review', text: 'it needs a rollback' },
          }),
        ),
      );
      expect(told(logged.join('\n'))).toEqual([]);

      const CALLS: Record<string, Record<string, unknown>> = {
        capture_memory: { content: 'the ledger rounds twice' },
        record_observation: { about: task, topic: 'review', text: 'a second note' },
        retract_note: { id: observation, reason: 'it was already there' },
        retract_link: { subject: decision, target: 'src', rel: 'governs', reason: 'too wide' },
        record_handoff: { task, from: 'agent-alpha', to: 'agent-beta' },
        link_knowledge: { subject: decision, target: 'src', rel: 'governs' },
        create_task: { title: 'a second task' },
        task_transition: { id: task, action: 'submit' },
        record_decision: { title: 'Another call', rationale: 'Because.' },
        decision_transition: { id: decision, action: 'accept', note: 'we agree' },
        create_skill: { name: 'Fold twice', body: 'Fold at the middle.' },
        skill_transition: { id: skill, action: 'review', note: 'it reads well' },
        skills: { id: skill },
        rules_before_an_edit: { path: 'src/collate.ts' },
      };
      // Each call needs what an earlier one made: this is the order in which they hold.
      const order = [
        'capture_memory',
        'record_observation',
        'retract_note',
        'record_handoff',
        'link_knowledge',
        'create_task',
        'task_transition',
        'record_decision',
        'decision_transition',
        'create_skill',
        'skill_transition',
        'skills',
        'rules_before_an_edit',
        'retract_link',
      ];

      // The tools are the server's own declaration, in both directions.
      const writing = tools.filter((one) => one.effect === 'mutates').map((one) => one.act);
      expect([...writing].sort()).toEqual(Object.keys(CALLS).sort());
      expect([...order].sort()).toEqual(Object.keys(CALLS).sort());

      const silent: string[] = [];
      for (const name of order) {
        const heard = logged.length;
        expect(forgetWhatWasWritten(sandbox), `${name}: no note to take away`).toBeGreaterThan(0);
        const result = await client.callTool({ name, arguments: CALLS[name] ?? {} });
        const said = textOf(result);
        expect(result.isError, `${name}: ${said}`).not.toBe(true);
        const sentences = told(said);
        if (sentences.length === 0) silent.push(name);
        // Once each: the same sentence is not in the reply twice, and the log heard it as it is.
        expect(new Set(sentences).size, `${name} repeated it`).toBe(sentences.length);
        expect(told(logged.slice(heard).join('\n')).sort(), `${name}: the log`).toEqual(
          [...sentences].sort(),
        );
      }
      expect(silent).toEqual([]);
    } finally {
      await client.close();
    }
  });

  it('says it once, and the next reply says nothing of it', async () => {
    const { client } = await connect();
    try {
      await client.callTool({ name: 'create_task', arguments: { title: 'first' } });
      forgetWhatWasWritten(sandbox);
      const second = textOf(
        await client.callTool({ name: 'create_task', arguments: { title: 'second' } }),
      );
      expect(told(second)).toHaveLength(1);
      const [ids] = [...second.matchAll(NEW_TAIL)];
      expect(ids?.[1]).not.toBe(ids?.[2]);
      const later = textOf(
        await client.callTool({ name: 'create_task', arguments: { title: 'third' } }),
      );
      expect(told(later)).toEqual([]);
      expect(told(textOf(await client.callTool({ name: 'search', arguments: {} })))).toEqual([]);
    } finally {
      await client.close();
    }
  });
});

describe('the sentence has one source, and every door a reply leaves by asks for it', () => {
  const files = readdirSync(SOURCE)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .map((name) => ({ name, text: readFileSync(join(SOURCE, name), 'utf-8') }));

  it('writes the sentence nowhere in the MCP server: it is the chain’s `describeNewTail`', () => {
    for (const { name, text } of files) {
      expect(text.includes('wrote to a new tail'), name).toBe(false);
    }
    expect(files.some(({ text }) => text.includes('describeNewTail'))).toBe(true);
  });

  it('takes it wherever it takes what the content door replaced, as many times', () => {
    const count = (text: string, what: string): number => text.split(what).length - 1;
    const taking = files.filter(({ text }) => text.includes('replacementsOwed.take()'));
    expect(taking.map(({ name }) => name).sort()).toEqual(['server.ts', 'tools.ts']);
    for (const { name, text } of taking) {
      expect(count(text, 'newTails.take()'), name).toBe(count(text, 'replacementsOwed.take()'));
    }
  });
});
