/**
 * A PROTECTED KEY OF THE PERSON IS OPENED BY THE PASSPHRASE IN THE ENVIRONMENT, AND THEN SIGNS.
 *
 * Where the record does not enrol the agent a server was asked to sign as, the person's key signs and
 * the facts say their `which` is declared. When that key is protected and no passphrase is to hand, the
 * write is refused instead (`AGENT_NOT_ENROLLED`), and where the passphrase IS in the environment the
 * server was started in, the key opens, and the write goes through. The choice of key must read the
 * environment the way a write does, or a person who set it would be refused by a server that could sign.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { catalogUpcasters } from '@mnema/chain';
import { type DiscoveryEnv, orderedEvents, resolveTrees } from '@mnema/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildMcpServer } from '../src/mcp/server.js';
import { type CliIo, run } from '../src/program.js';

const PASSPHRASE = 'MNEMA_KEY_PASSPHRASE';

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

/** A decision through the agent's server, with the passphrase in the environment only where given. */
async function decided(passphrase: string | undefined): Promise<Reply | undefined> {
  let reply: Reply | undefined;
  if (passphrase === undefined) delete process.env[PASSPHRASE];
  else process.env[PASSPHRASE] = passphrase;
  try {
    await connected('claude-code', 'claude', [repo], async (client) => {
      reply = (await client.callTool({
        name: 'record_decision',
        arguments: { title: 'A decision of the host', rationale: 'because' },
      })) as Reply;
    });
  } finally {
    delete process.env[PASSPHRASE];
  }
  return reply;
}

describe('an agent the record does not enrol, and a person’s key that is protected', () => {
  it('is refused with no passphrase to hand, and signs as the person where the environment has it', async () => {
    // The agent has a key on this machine; the record does not enrol it.
    const identity = (await did('audit', 'accountability')).match(/mnid:[0-9a-f]{8}/)?.[0];
    await did('key', 'request', '--agent', 'claude', '--anchor', identity as string);
    process.env[PASSPHRASE] = 'correct horse';
    try {
      await did('key', 'protect');
    } finally {
      delete process.env[PASSPHRASE];
    }
    const trees = resolveTrees(repo, env);
    const decisions = () =>
      orderedEvents({ root: trees.projectPublic as string }, catalogUpcasters()).filter(
        (event) => event.kind === 'decision.recorded',
      );

    const without = await decided(undefined);
    expect(without?.isError).toBe(true);
    expect(textOf(without)).toContain('Refused (AGENT_NOT_ENROLLED)');
    expect(decisions()).toHaveLength(0);

    const withIt = await decided('correct horse');
    expect(withIt?.isError, textOf(withIt)).not.toBe(true);
    expect(decisions()).toHaveLength(1);
    expect(decisions()[0]?.which).toBe('claude-code');
  });
});
