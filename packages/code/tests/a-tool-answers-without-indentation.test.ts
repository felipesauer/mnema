/**
 * A TOOL ANSWERS IN THE SHORTEST JSON THAT SAYS THE SAME THING.
 *
 * The first block of each read below is a JSON document nobody reads as a page: the host hands it to
 * the model, which reads every space of an indented one on every call. The test holds
 * both halves of that: the text is the document written without indentation (so it is what
 * `JSON.stringify` of its own parse gives back, byte for byte), and what it says is the record's
 * (a field read back out of it is the one the write put in).
 *
 * The sizes are pinned by `the-channels-have-a-budget.test.ts`; this file is the property that
 * explains a drop there.
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
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildMcpServer } from '../src/mcp/server.js';

let sandbox: string;
let client: Client;
let decision: string;

async function call(name: string, args: Record<string, unknown> = {}): Promise<string[]> {
  const reply = (await client.callTool({ name, arguments: args })) as {
    content: { type: string; text?: string }[];
  };
  return reply.content.map((c) => c.text ?? '');
}

beforeAll(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-compact-'));
  const project = join(sandbox, 'project');
  mkdirSync(project, { recursive: true });
  ensureTree({ root: join(project, PROJECT_DIR) });
  const env: DiscoveryEnv = { home: join(sandbox, 'home') };
  mkdirSync(join(sandbox, 'home'), { recursive: true });
  const { server } = buildMcpServer({ cwd: project, env, log: () => {} });
  client = new Client({ name: 'claude-code', version: '1.0.0' }, { capabilities: { roots: {} } });
  client.setRequestHandler(ListRootsRequestSchema, () => ({
    roots: [{ uri: pathToFileURL(project).href }],
  }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  const said = (
    await call('record_decision', {
      title: 'Retries use exponential backoff',
      rationale: 'A fixed delay hammers a service that is already down',
      alternatives: 'a fixed delay: it makes a recovering service fall again',
    })
  ).join('\n');
  const id = said.match(/\(([0-9a-f-]{20,})\)/)?.[1];
  if (id === undefined) throw new Error(`setup: no id in ${said}`);
  decision = id;
});

afterAll(async () => {
  await client?.close();
  rmSync(sandbox, { recursive: true, force: true });
});

describe('what a read tool answers', () => {
  it.each([
    ['bootstrap', () => ({})],
    ['focus', () => ({})],
    ['skills', () => ({})],
    ['resume', () => ({})],
    ['search', () => ({})],
    ['read_record', () => ({ id: decision })],
    ['audit_timeline', () => ({ id: decision })],
    ['audit_refs', () => ({ id: decision })],
    ['governing_rules', () => ({ path: 'src' })],
    ['audit_accountability', () => ({})],
    ['audit_exposure', () => ({})],
    ['audit_antipatterns', () => ({})],
  ] as const)('%s is JSON without a space of indentation', async (name, args) => {
    const [first] = await call(name, args());
    const text = first as string;
    expect(text).not.toContain('\n');
    expect(JSON.stringify(JSON.parse(text))).toBe(text);
  });

  it('says what the record holds, in the compact form', async () => {
    const [first] = await call('read_record', { id: decision });
    const read = JSON.parse(first as string) as { record: { title: string; rationale: string } };
    expect(read.record.title).toBe('Retries use exponential backoff');
    expect(read.record.rationale).toBe('A fixed delay hammers a service that is already down');

    const [found] = await call('search', {});
    const hits = (JSON.parse(found as string) as { hits: { id: string; title: string }[] }).hits;
    expect(hits.find((h) => h.id === decision)?.title).toBe('Retries use exponential backoff');
  });
});
