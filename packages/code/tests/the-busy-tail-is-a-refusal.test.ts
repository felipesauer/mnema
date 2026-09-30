/**
 * A TAIL ANOTHER PROCESS HOLDS IS A REFUSAL ON THE AGENT'S SURFACE — worded at the door every
 * other refusal leaves by, and not answered by the protocol library with a bare message.
 *
 * WHAT WAS WRONG. The chain refuses an append whose tail stays locked past its budget by
 * THROWING (`TailBusyError`, `chain/src/chain/tail-lock.ts`), and no tool caught it, so the SDK
 * answered with the message alone: no `Refused (TAIL_BUSY)` for an agent to read the code off,
 * and none of what the session owed — a write opens its run before the operation decides, so a
 * call that meets a busy tail may already have founded an identity on its way in, and the
 * sentence that says so waited for a next reply. `answeringThrownRefusals` in `mcp/server.ts`
 * catches it now, beside the identity refusals it already caught.
 *
 * HOW THE TAIL IS MADE BUSY: the lock file of this key's tail, written as a live process — this
 * one — holding it now. The lock waits its whole budget (2000 ms) and refuses; nothing of the
 * refused write is appended.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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

let sandbox: string;
let repo: string;
let home: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-busy-tail-'));
  repo = join(sandbox, 'repo');
  home = join(sandbox, 'home');
  for (const dir of [repo, home]) mkdirSync(dir, { recursive: true });
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

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

describe('a write that meets a tail another process holds', () => {
  it('is refused with its code, by the server’s own door', async () => {
    const init = spawnSync(process.execPath, [CLI, 'init'], {
      cwd: repo,
      encoding: 'utf-8',
      env: { PATH: process.env.PATH ?? '', HOME: home },
    });
    expect(init.status, init.stderr).toBe(0);
    const client = await connected();
    // The first write opens the connection's run, so the one below meets nothing but the lock.
    const opened = await client.callTool({
      name: 'capture_memory',
      arguments: { content: 'the first note', scope: 'public' },
    });
    expect((opened as { isError?: boolean }).isError).not.toBe(true);

    const tails = readdirSync(join(repo, '.mnema', 'tails'));
    expect(tails).toHaveLength(1);
    const lock = join(repo, '.mnema', 'locks', `${tails[0]}.lock`);
    mkdirSync(join(repo, '.mnema', 'locks'), { recursive: true });
    writeFileSync(lock, `${process.pid} ${Date.now()}\n`, 'utf-8');
    const reply = (await client.callTool({
      name: 'capture_memory',
      arguments: { content: 'a note the lock turns away', scope: 'public' },
    })) as { isError?: boolean; content: { text: string }[] };
    rmSync(lock);
    await client.close();

    expect(reply.isError).toBe(true);
    expect(reply.content[0]?.text).toMatch(
      new RegExp(
        `^Refused \\(TAIL_BUSY\\): this machine's tail is being written by process ${process.pid} `,
      ),
    );
    expect(reply.content[0]?.text).toContain('this write was not appended');
  }, 20_000);
});
