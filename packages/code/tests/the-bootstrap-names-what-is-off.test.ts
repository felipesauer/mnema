/**
 * THE BOOTSTRAP NAMES WHAT IS OFF ON THIS MACHINE, once, and only when something is.
 *
 * An agent that opens a session learns what is in force from `bootstrap`, but nothing it was
 * handed said that a channel it might expect (the hold on a first write, the proposals recorded
 * from a person's corrections) begins off. The reply now carries one line, a block of its own
 * beside the JSON: which channels are off on this machine, read from the effective state of the
 * project's trees, and that only a person turns one on, with the command (the MCP server has no
 * tool for it, `the-switch-is-a-fact.test.ts`). It is a statement of fact and asks the agent for
 * nothing.
 *
 * A channel a person switched on leaves the line, and with none off there is no line at all,
 * which is the half that keeps the line from being one more thing every reply repeats.
 * The server's instructions, the tool's description and the block committed into the repository
 * are not touched: what this machine has switched is not a fact of the repository.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { DiscoveryEnv } from '@mnema/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildMcpServer } from '../src/mcp/server.js';
import { openSession } from '../src/mcp/session.js';
import { channelsOffHere } from '../src/mcp/tools.js';
import { type CliIo, run } from '../src/program.js';
import { offOnThisMachine, STARTS_OFF } from '../src/record-framing.js';

let sandbox: string;
let repo: string;
let env: DiscoveryEnv;
let originalCwd: string;
let originalXdg: string | undefined;
let originalHome: string | undefined;

/** Runs `mnema <argv>` in process and refuses to go on if it was refused. */
async function did(...argv: string[]): Promise<void> {
  const err: string[] = [];
  let failed = false;
  const io: CliIo = {
    out: () => undefined,
    err: (line) => err.push(line),
    fail: () => {
      failed = true;
    },
  };
  await run(argv, io);
  expect(failed, `mnema ${argv.join(' ')}: ${err.join(' / ')}`).toBe(false);
}

/** What a fresh connection over the project is told by `bootstrap`: every text block of the reply. */
async function bootstrapBlocks(): Promise<string[]> {
  const { server } = buildMcpServer({ cwd: repo, env, log: () => undefined });
  const client = new Client(
    { name: 'claude-code', version: '1.0.0' },
    { capabilities: { roots: {} } },
  );
  client.setRequestHandler(ListRootsRequestSchema, () => ({
    roots: [{ uri: pathToFileURL(repo).href }],
  }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  const reply = (await client.callTool({ name: 'bootstrap' })) as {
    content: { type: string; text?: string }[];
  };
  await client.close();
  return reply.content.flatMap((block) => (block.text === undefined ? [] : [block.text]));
}

const offLine = (blocks: readonly string[]): string | undefined =>
  blocks.find((block) => block.startsWith('Off on this machine:'));

beforeEach(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-bootstrap-off-'));
  repo = join(sandbox, 'repo');
  mkdirSync(repo, { recursive: true });
  mkdirSync(join(sandbox, 'home'), { recursive: true });
  originalCwd = process.cwd();
  originalXdg = process.env.XDG_DATA_HOME;
  originalHome = process.env.HOME;
  process.env.XDG_DATA_HOME = join(sandbox, 'data');
  process.env.HOME = join(sandbox, 'home');
  env = { home: join(sandbox, 'home') };
  process.chdir(repo);
  await did('init');
});

afterEach(() => {
  process.chdir(originalCwd);
  if (originalXdg === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = originalXdg;
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(sandbox, { recursive: true, force: true });
});

describe('the opening read names the channels that are off', () => {
  it('says which begin off, and that only a person turns one on', async () => {
    const line = offLine(await bootstrapBlocks());
    expect(line).toBe(
      'Off on this machine: edit-first-write-gate, user-corrections. ' +
        'Only a person turns one on, with `mnema switch on <name>`.',
    );
    expect(line).toBe(offOnThisMachine([...STARTS_OFF]));
    // The line is the cheap half of the trade: well under sixty tokens.
    expect((line ?? '').length).toBeLessThan(4 * 60);
  });

  it('drops a channel a person switched on, and says no line when nothing is off', async () => {
    await did('switch', 'on', 'user-corrections');
    expect(offLine(await bootstrapBlocks())).toBe(
      'Off on this machine: edit-first-write-gate. Only a person turns one on, with `mnema switch on <name>`.',
    );
    await did('switch', 'on', 'edit-first-write-gate');
    expect(offLine(await bootstrapBlocks())).toBeUndefined();
  });

  it('names a channel a person switched off, beside the ones that begin off', async () => {
    await did('switch', 'off', 'session-tally');
    const line = offLine(await bootstrapBlocks()) ?? '';
    expect(line).toContain('edit-first-write-gate, user-corrections, session-tally');
  });

  it('reads the same off the session as it does off the reply', () => {
    const session = openSession({
      clientName: 'agent-alpha',
      roots: [pathToFileURL(repo).href],
      env,
    });
    expect(channelsOffHere(session)).toEqual([...STARTS_OFF]);
  });
});
