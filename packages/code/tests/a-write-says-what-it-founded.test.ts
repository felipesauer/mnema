/**
 * A write that founds an identity where others already were says so — once, where somebody reads
 * it, on every path that can found.
 *
 * WHAT WAS WRONG. The founding was silent. A key's first write into a tree that already held other
 * identities founded one of its own, and the answer was "Captured memory … Landed in the public
 * tree" and nothing else; `status` said nothing, `verify` was clean, and only `accountability`
 * counted "2 author(s)". After that write the two authors of that tree cannot be joined, so the
 * only moment to say it is the moment it happens — and what it can still save is the person's
 * other trees.
 *
 * WHAT IS ASSERTED, each beside the silence that must stay a silence:
 *
 *   - the command line says it on stderr after the answer — and says nothing for the first founding
 *     of a tree, nothing for the key's next write, and nothing for a machine that joined by the
 *     handshake the page describes, which adopts and does not found;
 *   - a tree kept on one machine gets the words for that: the identity beside it was written from
 *     here too;
 *   - the server says it in the reply of the call whose write founded;
 *   - the hook — the path nobody asked for — says it in the one field of its reply the host hands
 *     the agent;
 *   - and `accountability` names, beside the author, where and when that identity was founded —
 *     in the line and in `--json`, from one reading.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { DiscoveryEnv } from '@mnema/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildMcpServer } from '../src/mcp/server.js';
import { closeSession, openSession } from '../src/mcp/session.js';
import { runRulesBeforeAnEditTool } from '../src/mcp/tools.js';

/** The built binary — what a person runs. */
const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

/** The words every founding sentence starts with — `a-new-identity.ts`. */
const FOUNDED = 'This founded a new identity';

let sandbox: string;
let repo: string;
/** Two keys: two homes, each its own `~/.mnema`. */
let homeA: string;
let homeB: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-says-what-it-founded-'));
  repo = join(sandbox, 'repo');
  homeA = join(sandbox, 'home-a');
  homeB = join(sandbox, 'home-b');
  for (const dir of [repo, homeA, homeB]) mkdirSync(dir, { recursive: true });
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** `mnema <argv>` in the repository, as the key under `home`. */
function mnema(
  home: string,
  ...argv: string[]
): { status: number | null; stdout: string; stderr: string } {
  const ran = spawnSync(process.execPath, [CLI, ...argv], {
    cwd: repo,
    encoding: 'utf-8',
    env: { PATH: process.env.PATH ?? '', HOME: home },
  });
  return { status: ran.status, stdout: ran.stdout, stderr: ran.stderr };
}

/** The founding sentences in a stream, one per line. */
function founded(stream: string): string[] {
  return stream.split('\n').filter((line) => line.includes(FOUNDED));
}

describe('the command line says it on stderr, once, after the answer', () => {
  it('for a key whose first write founds beside another identity — and names both', () => {
    expect(founded(mnema(homeA, 'init').stderr)).toEqual([]);
    const second = mnema(homeB, 'memory', 'from a key nobody vouched for');
    expect(second.status).toBe(0);
    expect(second.stdout).toContain('Landed in the public tree');
    expect(founded(second.stdout)).toEqual([]);
    const said = founded(second.stderr);
    expect(said).toHaveLength(1);
    expect(said[0]).toContain('in the public tree');
    expect(said[0]).toContain('beside 1 already there (mnid:');
    expect(said[0]).toContain('Someone new to this record reads exactly this');
    expect(said[0]).toMatch(/`mnema key request --anchor mnid:[0-9a-f]+` here/);

    // Said once: the key's next write founds nothing, and says nothing.
    expect(founded(mnema(homeB, 'memory', 'the same key again').stderr)).toEqual([]);
  }, 60_000);

  it('says nothing for a machine that joined by the handshake — it adopts, and founds nothing', () => {
    expect(mnema(homeA, 'init').status).toBe(0);
    const who = /(mnid:[0-9a-f]+)/.exec(mnema(homeA, 'accountability').stdout)?.[1] as string;
    const request = mnema(homeB, 'key', 'request', '--anchor', who);
    expect(request.status, request.stderr).toBe(0);
    const line = request.stdout.split('\n').find((one) => one.startsWith('mnema-key-request:'));
    expect(line).toBeDefined();
    expect(mnema(homeA, 'key', 'enroll', line as string).status).toBe(0);

    const joined = mnema(homeB, 'memory', 'first note from the laptop');
    expect(joined.status).toBe(0);
    expect(founded(joined.stderr)).toEqual([]);
    expect(mnema(homeA, 'accountability').stdout).toContain('1 author(s)');
  }, 60_000);

  it('gives a tree kept on one machine its own words — the identity beside it was written from here', () => {
    expect(mnema(homeA, 'init').status).toBe(0);
    expect(mnema(homeA, 'memory', 'a note of mine', '--scope', 'private').status).toBe(0);
    const said = founded(mnema(homeB, 'memory', 'mine too', '--scope', 'private').stderr);
    expect(said).toHaveLength(1);
    expect(said[0]).toContain('in the private tree');
    expect(said[0]).toContain('kept on this machine alone');
    expect(said[0]).toContain('— under another key —');
    expect(said[0]).not.toContain('on another machine');
  }, 60_000);
});

describe('the server says it where the agent reads', () => {
  /** A server for the key under `home`, a client whose workspace is the repository. */
  async function connected(home: string): Promise<Client> {
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

  /** Every text block of a tool's reply. */
  function blocks(reply: unknown): string[] {
    return ((reply as { content?: { type: string; text: string }[] }).content ?? []).map(
      (one) => one.text,
    );
  }

  it('in the reply of the call whose write founded — and in none after it', async () => {
    expect(mnema(homeA, 'init').status).toBe(0);
    const client = await connected(homeB);
    const first = blocks(
      await client.callTool({
        name: 'capture_memory',
        arguments: { content: 'from the agent, under another key', scope: 'public' },
      }),
    );
    expect(first[0]).toMatch(/^Captured memory /);
    expect(first.filter((block) => block.includes(FOUNDED))).toHaveLength(1);

    const next = blocks(
      await client.callTool({
        name: 'capture_memory',
        arguments: { content: 'and again', scope: 'public' },
      }),
    );
    expect(next.filter((block) => block.includes(FOUNDED))).toEqual([]);
    await client.close();
  });

  it('in the hook’s additionalContext — the path nobody asked for, whose prose the host drops', async () => {
    // A rule in force at a path, so the hook speaks and writes; the first key's session writes
    // there before the second one's does.
    expect(mnema(homeA, 'init').status).toBe(0);
    // The id in the parentheses of the echo, never the `ADR-<n>` in front of it.
    const rule = /\(([0-9a-f-]{20,})\)/.exec(
      mnema(homeA, 'decision', 'lay it out', 'why').stdout,
    )?.[1];
    expect(rule).toBeDefined();
    expect(
      mnema(homeA, 'decision', 'move', 'accept', rule as string, '--note', 'agreed').status,
    ).toBe(0);
    expect(mnema(homeA, 'link', rule as string, 'src', '--rel', 'governs').status).toBe(0);

    const edit = { path: 'src/a.ts' };
    const roots = [pathToFileURL(repo).href];
    const asA = openSession({ clientName: 'claude-code', roots, env: { home: homeA } });
    const first = runRulesBeforeAnEditTool(asA, edit);
    closeSession(asA);
    expect(first.ok).toBe(true);
    expect(JSON.stringify(first.ok ? first.value : {})).not.toContain(FOUNDED);

    const asB = openSession({ clientName: 'claude-code', roots, env: { home: homeB } });
    const reply = runRulesBeforeAnEditTool(asB, edit);
    closeSession(asB);
    expect(reply.ok).toBe(true);
    const output = reply.ok ? reply.value.hookSpecificOutput : undefined;
    expect(output?.additionalContext).toContain('lay it out');
    expect(output?.additionalContext).toContain(FOUNDED);
  });
});

describe('accountability names it, whenever somebody asks', () => {
  it('beside the author whose identity was founded where another already was', () => {
    expect(mnema(homeA, 'init').status).toBe(0);
    expect(mnema(homeB, 'memory', 'second').status).toBe(0);
    const lines = mnema(homeA, 'accountability').stdout.split('\n');
    expect(lines[0]).toContain('2 author(s)');
    const marked = lines.filter((line) => line.includes('founded beside'));
    expect(marked).toHaveLength(1);
    expect(marked[0]).toContain('founded beside 1 other(s) in the public tree');
  }, 60_000);

  it('and in --json, from the same reading: the tree, the instant, and who was already there', () => {
    expect(mnema(homeA, 'init').status).toBe(0);
    expect(mnema(homeB, 'memory', 'second').status).toBe(0);
    const account = JSON.parse(mnema(homeA, 'accountability', '--json').stdout) as {
      byWho: {
        who: string;
        foundedBeside: { scope: string; at: string; besides: string[] }[];
      }[];
    };
    expect(account.byWho).toHaveLength(2);
    const [second] = account.byWho.filter((one) => one.foundedBeside.length > 0);
    const [first] = account.byWho.filter((one) => one.foundedBeside.length === 0);
    // Present for both, and empty for the one that founded first: "none" is said, not left out.
    expect(first?.foundedBeside).toEqual([]);
    expect(second?.foundedBeside).toEqual([
      { scope: 'public', at: expect.stringMatching(/^\d{4}-\d\d-\d\dT/), besides: [first?.who] },
    ]);

    // The line says the same thing beside the same author.
    const mark = second?.foundedBeside[0];
    const line = mnema(homeA, 'accountability')
      .stdout.split('\n')
      .find((one) => one.includes('founded beside'));
    expect(line).toContain(`founded beside 1 other(s) in the public tree, ${mark?.at}`);
    const shortForm = line?.trim().split(/\s+/)[0] as string;
    expect(second?.who.startsWith(shortForm), `${shortForm} is not ${second?.who}`).toBe(true);
  }, 60_000);
});
