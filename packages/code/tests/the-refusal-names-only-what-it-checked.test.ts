/**
 * THE REFUSAL OF A HOST SIGNING AS AN AGENT SAYS ONLY WHAT WAS CHECKED.
 *
 * A retirement is found in the trees a process reaches, and the words must not promise more; and the
 * refusal of a session's opening, which asks before any write has a tree, names none — the first tree
 * it asks is the private one, and a refusal saying so reads as the tree of a write that was for the
 * committed one.
 */

import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { type DiscoveryEnv, resolveTrees } from '@mnema/core';
import { deferredWrite, retireAgentKey } from '@mnema/core/write';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildMcpServer } from '../src/mcp/server.js';
import { type CliIo, run } from '../src/program.js';

type Reply = { isError?: boolean; content: { text: string }[] };

let sandbox: string;
let home: string;
let repo: string;
let env: DiscoveryEnv;
let originalCwd: string;
let originalHome: string | undefined;
let originalXdg: string | undefined;

async function mnema(...argv: string[]): Promise<{ out: string; err: string; failed: boolean }> {
  const out: string[] = [];
  const err: string[] = [];
  let failed = false;
  const io: CliIo = {
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    fail: () => {
      failed = true;
    },
  };
  await run(argv, io);
  return { out: out.join('\n'), err: err.join('\n'), failed };
}

async function did(...argv: string[]): Promise<string> {
  const said = await mnema(...argv);
  expect(said.failed, `${argv.join(' ')}: ${said.err}`).toBe(false);
  return said.out;
}

const lineOf = (said: string): string => {
  const line = said.split('\n').find((one) => one.startsWith('mnema-agent-request:1:'));
  if (line === undefined) throw new Error(`setup: no request line in ${said}`);
  return line;
};

const fingerprintIn = (said: string): string => {
  const fp = said.match(/\b[0-9a-f]{64}\b/)?.[0];
  if (fp === undefined) throw new Error(`setup: no fingerprint in ${said}`);
  return fp;
};

/** One connection that announces every one of `projects` as a root. */
async function connected(
  announced: string,
  agentKey: string,
  projects: readonly string[],
  call: (client: Client) => Promise<void>,
): Promise<void> {
  const { server } = buildMcpServer({ cwd: sandbox, env, log: () => {}, agentKey });
  const client = new Client({ name: announced, version: '1.0.0' }, { capabilities: { roots: {} } });
  client.setRequestHandler(ListRootsRequestSchema, () => ({
    roots: projects.map((project) => ({ uri: pathToFileURL(project).href })),
  }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  try {
    await call(client);
  } finally {
    await client.close();
  }
}

/** Makes the agent `claude`, enrols it in the three trees of the project, and returns its line. */
async function anAgent(): Promise<{ line: string; fingerprint: string }> {
  const identity = (await did('audit', 'accountability')).match(/mnid:[0-9a-f]{8}/)?.[0];
  const requested = await did(
    'key',
    'request',
    '--agent',
    'claude',
    '--anchor',
    identity as string,
  );
  await did('key', 'enroll', '--agent', lineOf(requested));
  return { line: lineOf(requested), fingerprint: fingerprintIn(requested) };
}

beforeEach(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-routed-agent-'));
  home = join(sandbox, 'home');
  repo = join(sandbox, 'repo');
  mkdirSync(home, { recursive: true });
  mkdirSync(repo, { recursive: true });
  originalCwd = process.cwd();
  originalHome = process.env.HOME;
  originalXdg = process.env.XDG_DATA_HOME;
  process.env.HOME = home;
  process.env.XDG_DATA_HOME = join(sandbox, 'data');
  delete process.env.MNEMA_HOME;
  delete process.env.MNEMA_RUN;
  delete process.env.MNEMA_KEY_PASSPHRASE;
  env = { home };
  process.chdir(repo);
  await did('init');
});

afterEach(() => {
  process.chdir(originalCwd);
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalXdg === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = originalXdg;
  rmSync(sandbox, { recursive: true, force: true });
});

const textOf = (reply: Reply | undefined): string =>
  (reply?.content ?? []).map((block) => block.text).join('\n');

describe('the refusal to write with a retired agent key', () => {
  it('says the tree it found the retirement in, and promises only the trees it reaches', async () => {
    const agent = await anAgent();
    const write = deferredWrite(resolveTrees(repo, env), 'public');
    expect(retireAgentKey(write, { fingerprint: agent.fingerprint, reason: 'lent out' }).ok).toBe(
      true,
    );
    write.checkpoint();

    let reply: Reply | undefined;
    await connected('claude-code', 'claude', [repo], async (client) => {
      reply = (await client.callTool({
        name: 'record_decision',
        arguments: { title: 'After the retirement', rationale: 'because' },
      })) as Reply;
    });

    expect(reply?.isError).toBe(true);
    expect(textOf(reply)).toContain(
      'the agent key "claude" was retired in this project\'s committed tree, and a retired key signs nothing in any tree it reaches from here. In a terminal,',
    );
    expect(textOf(reply)).not.toContain('of this machine');
  });
});

describe('the refusal of a write on a session that has no one to sign', () => {
  it('names the tree the write was for, and no other', async () => {
    const identity = (await did('audit', 'accountability')).match(/mnid:[0-9a-f]{8}/)?.[0];
    await did('key', 'request', '--agent', 'claude', '--anchor', identity as string);
    // A machine that mounts the agent's folder and nothing of the person's, and a record that
    // does not enrol the agent anywhere.
    const only = join(sandbox, 'only-the-agent');
    cpSync(join(home, '.mnema', 'agents'), join(only, '.mnema', 'agents'), { recursive: true });
    process.env.HOME = only;
    env = { home: only };

    let reply: Reply | undefined;
    await connected('claude-code', 'claude', [repo], async (client) => {
      reply = (await client.callTool({
        name: 'record_decision',
        arguments: { title: 'A public decision', rationale: 'because' },
      })) as Reply;
    });

    expect(reply?.isError).toBe(true);
    expect(textOf(reply)).toContain(
      'the agent "claude" is not enrolled in this project\'s committed tree, and the key that would sign instead, yours, is not on this machine. In a terminal in this project: `mnema key enroll --agent claude`.',
    );
    expect(textOf(reply)).not.toContain('private tree');
    expect(textOf(reply)).not.toContain('global tree');
  });
});
