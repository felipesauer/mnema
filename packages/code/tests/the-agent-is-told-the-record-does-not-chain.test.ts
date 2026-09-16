/**
 * THE AGENT IS TOLD THE RECORD DOES NOT CHAIN — over the real protocol.
 *
 * ## What it was
 *
 * `grep -rn "linkBreak" packages/code/src/mcp/` came back with nothing. Over a tree
 * `mnema verify` exits 1 on, every one of the twenty-five tools answered exactly as it
 * answers over a sound record: the facts were served and the one thing wrong with the
 * record was never mentioned. By this product's own axis the agent is its principal
 * reader, and it was the only reader never told.
 *
 * ## Why it is over the CLIENT and not over the adapters
 *
 * Because the adapters are not where the sentence is. This repository has measured that
 * exact hole: 123 green cases with the served line deleted, because every one of them
 * ended at the adapter's return value and the text block is composed in the server. So
 * every case here goes through a real `Client`, over a real transport, and reads the
 * CONTENT BLOCKS the protocol carried — which is the only thing a model ever sees.
 *
 * ## What the cases are asked to hold
 *
 * That the fact arrives in the SAME reply and not behind a second call — `verify` is not
 * a tool of this server, so "ask verify" would point at a door this reader cannot open;
 * that it arrives for every read that serves the record; that the PAYLOAD is untouched,
 * because `bootstrap`'s object is served byte for byte through two doors and a field
 * added here would make them disagree; and that over a sound record nothing is said at
 * all, which is the guard that makes the rest mean anything.
 */

import { appendFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { catalogUpcasters, ensureTree, verify } from '@mnema/chain';
import { type DiscoveryEnv, PROJECT_DIR } from '@mnema/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildMcpServer } from '../src/mcp/server.js';

const LF = '\n';

let sandbox: string;
let env: DiscoveryEnv;
let project: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-agent-told-'));
  const home = join(sandbox, 'home');
  mkdirSync(home, { recursive: true });
  env = { home, xdgDataHome: join(sandbox, 'data') };
  project = join(sandbox, 'proj');
  mkdirSync(project, { recursive: true });
  ensureTree({ root: join(project, PROJECT_DIR) });
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** A client and server joined by an in-process transport pair, rooted at the project. */
async function connect(): Promise<Client> {
  const { server } = buildMcpServer({ env, log: () => {} });
  const client = new Client(
    { name: 'claude-code', version: '1.0.0' },
    { capabilities: { roots: {} } },
  );
  client.setRequestHandler(ListRootsRequestSchema, () => ({
    roots: [{ uri: pathToFileURL(project).href }],
  }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

/** Every text block of a tool result, in order — what the model is handed. */
function blocks(result: unknown): string[] {
  const content = (result as { content?: { type: string; text?: string }[] }).content ?? [];
  return content.filter((c) => c.type === 'text').map((c) => c.text ?? '');
}

/** The tree this connection's private writes land in. */
function privateRoot(): string {
  return join(project, PROJECT_DIR, 'private');
}

/**
 * The plant: the last entry of a tail, appended again — the same `seq`, the same
 * `prev`, byte for byte what two writers appending at once used to leave.
 *
 * It is done by hand and not raced for, for the reason the command line's half gives: a
 * tail can stop chaining from a botched merge, a hand-edited file or a restore from half
 * a copy, and every case here would still be the right case if nothing had ever raced.
 */
function breakTheTail(root: string): void {
  const tails = join(root, 'tails');
  const tail = readdirSync(tails)[0] as string;
  const file = join(tails, tail, '000001.jsonl');
  const lines = readFileSync(file, 'utf-8').trimEnd().split(LF);
  appendFileSync(file, `${lines[lines.length - 1] as string}${LF}`, 'utf-8');
}

/** The sentence the agent is owed, by its opening words. */
const TOLD = 'The record this answer came off does not chain';

/**
 * Every read of this server that serves the record, with the arguments that reach it.
 *
 * `rules_before_an_edit` is deliberately NOT here: its reply is a hook reply the HOST
 * parses, and anything that is not the reply JSON is discarded in silence (measured
 * against the real binary) — so a notice in it would reach nobody. That claim lives in
 * `TOOLS_SERVING_NO_RECORD_CONTENT` and the structural guard holds it there.
 */
const READS = (id: string): readonly (readonly [string, Record<string, unknown>])[] => [
  ['bootstrap', {}],
  ['focus', {}],
  ['resume', {}],
  ['search', {}],
  ['read_record', { id }],
  ['audit_timeline', { id }],
  ['audit_refs', { id }],
  ['audit_accountability', {}],
  ['audit_exposure', {}],
  ['audit_antipatterns', {}],
  ['governing_rules', { path: 'src/index.ts' }],
  ['skills', {}],
];

/** Writes one memory through the server and answers with its id. */
async function seed(client: Client): Promise<string> {
  const captured = await client.callTool({
    name: 'capture_memory',
    arguments: { content: 'prefer PKCE over implicit' },
  });
  // The id as the line PRINTS it — a memory has no alias, so the line ends in the id
  // itself rather than carrying it in parentheses.
  const id = /Captured memory (\S+)/.exec(blocks(captured)[0] ?? '')?.[1];
  if (id === undefined) throw new Error(`fixture: no id in ${blocks(captured)[0]}`);
  return id;
}

describe('over a record that chains, no tool says anything about the chain', () => {
  // THE VACUITY GUARD, and it runs first: every case in the next block would pass over a
  // sentence emitted unconditionally, and this is what makes them mean what they say.
  it('says nothing, in any read, and the record really is sound', async () => {
    const client = await connect();
    const id = await seed(client);
    expect(verify(privateRoot(), catalogUpcasters()).ok).toBe(true);
    for (const [name, args] of READS(id)) {
      const answered = await client.callTool({ name, arguments: args });
      expect(blocks(answered).join(LF), name).not.toContain(TOLD);
    }
    await client.close();
  }, 60_000);
});

describe('over a record that does not chain, every read says so', () => {
  it('tells the agent, in the same reply, in every read that serves the record', async () => {
    // Seeded and broken BEFORE the connection that is measured: a session accumulates
    // warm caches, and what is asserted here is what a connection meeting a broken
    // record is told — not what one that watched it break is told.
    const seeding = await connect();
    const id = await seed(seeding);
    await seeding.close();
    breakTheTail(privateRoot());
    expect(verify(privateRoot(), catalogUpcasters()).ok).toBe(false);

    const client = await connect();
    for (const [name, args] of READS(id)) {
      const answered = await client.callTool({ name, arguments: args });
      const said = blocks(answered);
      // IN A BLOCK OF ITS OWN, after the payload — never inside it.
      const notice = said.find((block) => block.includes(TOLD));
      expect(notice, name).toBeDefined();
      expect(notice as string, name).toMatch(/issue \[T1\] \S+ \S+#\d+: .+/);
      // And the fact is COMPLETE where it lands: no second call is named, because
      // `verify` is not a tool this reader has.
      expect(notice as string, name).toContain('still on the tail');
      expect(said[0] as string, name).not.toContain(TOLD);
    }
    await client.close();
  }, 60_000);

  it('leaves the payload exactly the object it was', async () => {
    const seeding = await connect();
    await seed(seeding);
    await seeding.close();
    breakTheTail(privateRoot());

    const client = await connect();
    const boot = await client.callTool({ name: 'bootstrap' });
    const said = blocks(boot);
    // `bootstrap` is served byte for byte through two doors — this one and the CLI's
    // `--json` — so the notice may not enter the object, and the object has to stay
    // parseable on its own.
    expect(() => JSON.parse(said[0] as string)).not.toThrow();
    const context = JSON.parse(said[0] as string) as Record<string, unknown>;
    expect(Object.keys(context)).not.toContain('linkBreaks');
    await client.close();
  }, 60_000);

  it('does not turn a read into an error: the facts were served', async () => {
    const seeding = await connect();
    const id = await seed(seeding);
    await seeding.close();
    breakTheTail(privateRoot());

    const client = await connect();
    const answered = await client.callTool({ name: 'read_record', arguments: { id } });
    // Ruling on the record is `verify`'s. A read that started failing over a break would
    // fail on a record that still holds every fact it ever held.
    expect((answered as { isError?: boolean }).isError).not.toBe(true);
    expect(blocks(answered)[0]).toContain('prefer PKCE');
    await client.close();
  }, 60_000);

  it('the hook reply carries no prose, because the host would discard it', async () => {
    const seeding = await connect();
    await seed(seeding);
    await seeding.close();
    breakTheTail(privateRoot());

    const client = await connect();
    const replied = await client.callTool({
      name: 'rules_before_an_edit',
      arguments: { path: 'src/index.ts' },
    });
    const said = blocks(replied);
    // ONE block, and it parses: the host takes the reply JSON and discards everything
    // else in silence, so a second block here would be paid for on every edit and read
    // by nobody.
    expect(said).toHaveLength(1);
    expect(() => JSON.parse(said[0] as string)).not.toThrow();
    await client.close();
  }, 60_000);
});
