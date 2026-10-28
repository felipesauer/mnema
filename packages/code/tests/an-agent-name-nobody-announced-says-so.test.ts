/**
 * AN AGENT NAME NO CLIENT ANNOUNCED IS SAID TO BE ONE, wherever a reading names the agent.
 *
 * A client that never sends `initialize`, or announces in it a name that is no name, writes under
 * the server's default, `unknown-agent`, and the run it opens is marked `run.unannounced`
 * (FORMAT.md section 6.9). Before the mark, the readings printed that default exactly as they
 * print a name a client announced, and a client announcing the word `unknown-agent` read the same.
 * This drives both clients on one record and reads it back the way a person does: `mnema show`,
 * the opening document, `mnema audit accountability`, `mnema verify` and the record page's model.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { catalogUpcasters } from '@mnema/chain';
import { orderedEvents, PROJECT_DIR } from '@mnema/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { type JSONRPCMessage, ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildMcpServer } from '../src/mcp/server.js';
import { pageModel } from '../src/site/model.js';

const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const SAID = 'no name announced in an MCP handshake';

let sandbox: string;
let home: string;
let app: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-unannounced-'));
  home = join(sandbox, 'home');
  app = join(sandbox, 'app');
  mkdirSync(home, { recursive: true });
  mkdirSync(app, { recursive: true });
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function mnema(...argv: string[]) {
  const ran = spawnSync(process.execPath, [CLI, ...argv], {
    cwd: app,
    encoding: 'utf-8',
    env: { PATH: process.env.PATH ?? '', HOME: home },
  });
  return { status: ran.status, stdout: ran.stdout, out: ran.stdout + ran.stderr };
}

function idOf(printed: string): string {
  const id = /[0-9a-f]{8}-[0-9a-f-]{27}/.exec(printed)?.[0];
  expect(id, printed).toBeDefined();
  return id as string;
}

type Reply = { isError?: boolean; content: { text: string }[] };

/** Tool calls from a client that sends no `initialize`, each with nothing before it. */
async function withNoHandshake(
  calls: readonly { name: string; arguments: Record<string, unknown> }[],
): Promise<string[]> {
  const { server } = buildMcpServer({ cwd: app, env: { home }, log: () => {} });
  const [client, serverSide] = InMemoryTransport.createLinkedPair();
  const answers = new Map<number, (message: JSONRPCMessage) => void>();
  client.onmessage = (message) => {
    if ('id' in message && typeof message.id === 'number') answers.get(message.id)?.(message);
  };
  await server.connect(serverSide);
  await client.start();
  const texts: string[] = [];
  let next = 0;
  for (const call of calls) {
    const id = ++next;
    const answer = await new Promise<JSONRPCMessage>((resolve) => {
      answers.set(id, resolve);
      void client.send({ jsonrpc: '2.0', id, method: 'tools/call', params: call });
    });
    const reply = (answer as unknown as { result: Reply }).result;
    const text = reply.content.map((block) => block.text).join('\n');
    expect(reply.isError, text).not.toBe(true);
    texts.push(text);
  }
  await client.close();
  return texts;
}

/** Tool calls from a client whose handshake announces `name`. */
async function announcing(
  name: string,
  calls: readonly { name: string; arguments: Record<string, unknown> }[],
): Promise<string[]> {
  const { server } = buildMcpServer({ cwd: app, env: { home }, log: () => {} });
  const client = new Client({ name, version: '1.0.0' }, { capabilities: { roots: {} } });
  client.setRequestHandler(ListRootsRequestSchema, () => ({
    roots: [{ uri: pathToFileURL(app).href }],
  }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  const texts: string[] = [];
  for (const call of calls) {
    const reply = (await client.callTool(call)) as Reply;
    const text = reply.content.map((block) => block.text).join('\n');
    expect(reply.isError, text).not.toBe(true);
    texts.push(text);
  }
  await client.close();
  return texts;
}

describe('an agent name no client announced', () => {
  it('is said beside the name by show, the opening document, the account, verify and the page', async () => {
    expect(mnema('init').status).toBe(0);
    // A person records the first call; the client with no handshake accepts it and records a
    // second; a client announcing the default's own word records a third.
    const first = idOf(mnema('decision', 'record', 'The first call', 'because').out);
    const [, recorded] = await withNoHandshake([
      { name: 'decision_transition', arguments: { id: first, action: 'accept', note: 'agreed' } },
      { name: 'record_decision', arguments: { title: 'The second call', rationale: 'because' } },
    ]);
    const second = idOf(recorded ?? '');
    const [said] = await announcing('unknown-agent', [
      { name: 'record_decision', arguments: { title: 'The third call', rationale: 'because' } },
    ]);
    const third = idOf(said ?? '');

    // `mnema show`: the act of the client with no handshake says so; the announced word does not.
    expect(mnema('show', first).out).toMatch(
      new RegExp(`accepted by mnid:[0-9a-f]+ \\(agent unknown-agent, ${SAID}\\)`),
    );
    expect(mnema('show', second).out).toMatch(
      new RegExp(`recorded by mnid:[0-9a-f]+ \\(agent unknown-agent, ${SAID}\\)`),
    );
    const shownThird = mnema('show', third).out;
    expect(shownThird).toMatch(/recorded by mnid:[0-9a-f]+ \(agent unknown-agent\)/);
    expect(shownThird).not.toContain(SAID);

    // The opening document: the rule the client with no handshake accepted.
    const brief = mnema('brief').stdout;
    const rule = /^- \*\*ADR-\d+: The first call\*\*.*$/m.exec(brief)?.[0] ?? '';
    expect(rule, brief).toContain(`(agent unknown-agent, ${SAID}`);

    // The account: the agent's facts, and how many of them no client announced.
    const account = mnema('audit', 'accountability').stdout;
    const counted = new RegExp(`unknown-agent (\\d+) \\((\\d+) with ${SAID}\\)`).exec(account);
    expect(counted, account).not.toBeNull();
    expect(Number(counted?.[2])).toBeGreaterThan(0);
    expect(Number(counted?.[2])).toBeLessThan(Number(counted?.[1]));

    // verify: green, and its census names the facts of the marked run apart, without a flag.
    const verified = mnema('verify');
    expect(verified.status, verified.out).toBe(0);
    expect(verified.out).toContain('census [unannounced-which]');
    expect(verified.out).toContain('agent name(s) no MCP client announced in a handshake');

    // The record page: the same acts, the same marks.
    const page = pageModel(orderedEvents({ root: join(app, PROJECT_DIR) }, catalogUpcasters()));
    const byId = new Map(page.decisions.map((d) => [d.id, d]));
    expect(byId.get(first)?.acceptedBy).toMatchObject({
      which: 'unknown-agent',
      unannounced: true,
    });
    expect(byId.get(second)?.recordedBy).toMatchObject({
      which: 'unknown-agent',
      unannounced: true,
    });
    expect(byId.get(third)?.recordedBy).toEqual({
      who: byId.get(third)?.recordedBy?.who,
      which: 'unknown-agent',
    });
  }, 120_000);
});
