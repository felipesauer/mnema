/**
 * Accepting a decision that is already accepted says what holds, in plain words: it is accepted,
 * by whom and when, and nothing changed. The refusal keeps its code, on the command line and in
 * the server's tool alike.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildMcpServer } from '../src/mcp/server.js';

const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

let sandbox: string;
let repo: string;
let home: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-accepted-twice-'));
  repo = join(sandbox, 'repo');
  home = join(sandbox, 'home');
  mkdirSync(repo, { recursive: true });
  mkdirSync(home, { recursive: true });
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function mnema(...argv: string[]): { status: number | null; stdout: string; stderr: string } {
  const ran = spawnSync(process.execPath, [CLI, ...argv], {
    cwd: repo,
    encoding: 'utf-8',
    env: { PATH: process.env.PATH ?? '', HOME: home },
  });
  return { status: ran.status, stdout: ran.stdout, stderr: ran.stderr };
}

const ALREADY =
  /ADR-1 is already accepted, by a person, at \d{4}-\d\d-\d\dT[\d:.]+Z: nothing changed\./;

describe('a decision accepted twice', () => {
  it('on the command line: the refusal keeps its code and says it is already accepted', () => {
    expect(mnema('init').status).toBe(0);
    const recorded = mnema(
      'decision',
      'record',
      'Keep the parser small',
      'It is read on every start',
    );
    const id = /\(([0-9a-f-]{36})\)/.exec(recorded.stdout)?.[1] as string;
    const first = mnema('decision', 'move', 'accept', id, '--note', 'agreed');
    expect(first.status, first.stderr).toBe(0);
    const again = mnema('decision', 'move', 'accept', id, '--note', 'agreed again');
    expect(again.status).toBe(1);
    expect(again.stderr).toContain('Refused (ILLEGAL_TRANSITION)');
    expect(again.stderr).toMatch(ALREADY);
    expect(again.stderr).not.toContain('cannot "accept"');
  }, 60_000);

  it('in the server: decision_transition answers the same words with the same code', async () => {
    expect(mnema('init').status).toBe(0);
    const recorded = mnema(
      'decision',
      'record',
      'Keep the parser small',
      'It is read on every start',
    );
    const id = /\(([0-9a-f-]{36})\)/.exec(recorded.stdout)?.[1] as string;
    expect(mnema('decision', 'move', 'accept', id, '--note', 'agreed').status).toBe(0);

    const { server } = buildMcpServer({ cwd: sandbox, env: { home }, log: () => {} });
    const client = new Client(
      { name: 'claude-code', version: '1.0.0' },
      { capabilities: { roots: {} } },
    );
    client.setRequestHandler(ListRootsRequestSchema, () => ({
      roots: [{ uri: pathToFileURL(repo).href }],
    }));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    const reply = (await client.callTool({
      name: 'decision_transition',
      arguments: { id, action: 'accept', note: 'agreed again' },
    })) as { isError?: boolean; content: { text: string }[] };
    await client.close();
    const text = reply.content.map((block) => block.text).join('\n');
    expect(reply.isError, text).toBe(true);
    expect(text).toContain('ILLEGAL_TRANSITION');
    expect(text).toMatch(ALREADY);
  }, 60_000);
});
