/**
 * WHAT THE CONTENT DOOR REPLACED IN A FACT NO TOOL CALL ASKED FOR IS STILL SAID — to the agent,
 * in the words every write already uses.
 *
 * WHAT WAS WRONG. The agent's server records facts of its own: the run it opens for a
 * connection, and, from the edit hook, one `channel.asked` per rule that asks a person about the
 * path being edited and one `channel.served` per channel that spoke. Each of those writes hands
 * back what the content door replaced, and each site dropped it — `ensureRun` read `started.id`
 * and never `started.replaced`, and the hook's two writers returned `{ ok }` and nothing. The
 * path a host names is a BODY to the door (`core/src/content/fields.ts`: it is the circumstance a
 * rule was charged in, not an address), so a credential in a file name is replaced in the
 * record — and the agent was never told a value it handed over was recorded as a placeholder.
 *
 * WHICH OF THOSE SITES CAN REPLACE ANYTHING TODAY, measured against the door's table: only the
 * asking. The run's `agent` and every envelope `which` are NAMES, and a name holding a
 * credential is refused rather than redacted; the server opens and closes runs with no `goal` and
 * no `outcome`; `channel.served` carries no text of its own. The others are carried all the same
 * (`ReplacementsOwed` in `mcp/session.ts`), so a body added to one of them later is not the next
 * silence; this file asks the one that can speak.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { DiscoveryEnv } from '@mnema/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildMcpServer } from '../src/mcp/server.js';

/** The built binary — what a person runs. */
const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

/** Shaped like an AWS access key id — a class the door replaces in a body. */
const SECRET = 'AKIAABCDEFGHIJKLMNOP';

/** The words the owed block opens with (`mcp/session.ts`). */
const OWED = 'What this connection recorded on its own';

let sandbox: string;
let repo: string;
let home: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-records-on-its-own-'));
  repo = join(sandbox, 'repo');
  home = join(sandbox, 'home');
  for (const dir of [repo, home]) mkdirSync(dir, { recursive: true });
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function mnema(...argv: string[]): string {
  const ran = spawnSync(process.execPath, [CLI, ...argv], {
    cwd: repo,
    encoding: 'utf-8',
    env: { PATH: process.env.PATH ?? '', HOME: home },
  });
  expect(ran.status, ran.stderr).toBe(0);
  return ran.stdout;
}

async function connected(): Promise<Client> {
  const env: DiscoveryEnv = { home };
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

/** The text the hook hands the agent — the one field of its reply that reaches the model. */
function contextOf(reply: unknown): string {
  const text = ((reply as { content?: { text: string }[] }).content ?? [])[0]?.text ?? '{}';
  const parsed = JSON.parse(text) as { hookSpecificOutput?: { additionalContext?: string } };
  return parsed.hookSpecificOutput?.additionalContext ?? '';
}

/** Every line of every tail of the project, as the disk holds it. */
function recorded(): string {
  const tails = join(repo, '.mnema', 'tails');
  let all = '';
  for (const tail of readdirSync(tails)) {
    for (const segment of readdirSync(join(tails, tail)).filter((one) => one.endsWith('.jsonl'))) {
      all += readFileSync(join(tails, tail, segment), 'utf-8');
    }
  }
  return all;
}

describe('the edit hook’s asking, over a path holding a credential', () => {
  it('records the placeholder, and tells the agent in the words every write uses', async () => {
    mnema('init');
    const rule = /\(([0-9a-f-]{36})\)/.exec(
      mnema('decision', 'record', 'A person signs off on src', 'it is the billing code'),
    )?.[1] as string;
    mnema('decision', 'move', 'accept', rule, '--note', 'agreed');
    mnema('link', rule, 'src', '--rel', 'asks-for-a-person');

    const client = await connected();
    const first = await client.callTool({
      name: 'rules_before_an_edit',
      arguments: { path: `src/${SECRET}.ts` },
    });
    const second = await client.callTool({
      name: 'rules_before_an_edit',
      arguments: { path: `src/${SECRET}.ts` },
    });
    await client.close();

    // The record holds the placeholder and never the value: the door did replace it.
    const disk = recorded();
    expect(disk).toContain('"kind":"channel.asked"');
    expect(disk).not.toContain(SECRET);
    // And the agent was told, in the words `replacementNotice` gives every other write.
    const told = contextOf(first);
    expect(told).toContain(OWED);
    expect(told).toContain('value(s) replaced before recording: <SECRET:');
    expect(told).toContain('If those were real credentials, rotate them.');
    // Once per fact: the second asking recorded a second fact, and says its own.
    expect(contextOf(second).split(OWED)).toHaveLength(2);
  }, 60_000);

  it('says nothing of the kind over a path with nothing in it', async () => {
    mnema('init');
    const rule = /\(([0-9a-f-]{36})\)/.exec(
      mnema('decision', 'record', 'A person signs off on src', 'it is the billing code'),
    )?.[1] as string;
    mnema('decision', 'move', 'accept', rule, '--note', 'agreed');
    mnema('link', rule, 'src', '--rel', 'asks-for-a-person');
    const client = await connected();
    const reply = await client.callTool({
      name: 'rules_before_an_edit',
      arguments: { path: 'src/collate.ts' },
    });
    await client.close();
    expect(contextOf(reply)).not.toContain(OWED);
    expect(recorded()).toContain('"kind":"channel.asked"');
  }, 60_000);
});
