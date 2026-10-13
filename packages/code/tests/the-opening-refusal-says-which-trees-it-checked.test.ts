/**
 * THE REFUSAL OF A SESSION'S OPENING SAYS WHICH TREES IT CHECKED, AND NO MORE.
 *
 * With only the agent's key on the machine, a session opens through the first tree that has someone
 * to sign: its own project's, else the global one. It does not look at the OTHER projects of the
 * workspace, and a refusal that said "any tree this session reaches" claimed it had. Here the
 * session's project does not enrol the agent, another project of the workspace does, and a write
 * routed to that other project is refused with a sentence that is true of what was asked.
 */

import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { DiscoveryEnv } from '@mnema/core';
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

async function did(...argv: string[]): Promise<string> {
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
  expect(failed, `${argv.join(' ')}: ${err.join('\n')}`).toBe(false);
  return out.join('\n');
}

async function connected(
  projects: readonly string[],
  call: (client: Client) => Promise<void>,
): Promise<void> {
  const { server } = buildMcpServer({ cwd: sandbox, env, log: () => {}, agentKey: 'claude' });
  const client = new Client(
    { name: 'claude-code', version: '1.0.0' },
    { capabilities: { roots: {} } },
  );
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

const textOf = (reply: Reply): string => reply.content.map((block) => block.text).join('\n');

/** The agent `claude`, enrolled in the three trees of `repo`; the machine then holds only its key. */
async function aMachineThatHoldsOnlyTheAgent(): Promise<void> {
  const identity = (await did('audit', 'accountability')).match(/mnid:[0-9a-f]{8}/)?.[0];
  const requested = await did(
    'key',
    'request',
    '--agent',
    'claude',
    '--anchor',
    identity as string,
  );
  const line = requested.split('\n').find((one) => one.startsWith('mnema-agent-request:1:'));
  await did('key', 'enroll', '--agent', line as string);
}

function holdingOnlyTheAgent(): void {
  const only = join(sandbox, 'only-the-agent');
  cpSync(join(home, '.mnema', 'agents'), join(only, '.mnema', 'agents'), { recursive: true });
  process.env.HOME = only;
  env = { home: only };
}

beforeEach(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-opening-refusal-'));
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

describe('the opening of a session on a machine that holds only the agent', () => {
  it('says it checked this project and the global tree when another project of the workspace enrols the agent', async () => {
    await aMachineThatHoldsOnlyTheAgent();
    // `other` is a copy of the record, which enrols the agent; `plain` is a project that does not.
    const other = join(sandbox, 'other');
    cpSync(repo, other, { recursive: true });
    const plain = join(sandbox, 'plain');
    mkdirSync(plain, { recursive: true });
    process.chdir(plain);
    await did('init');
    process.chdir(repo);
    // The person's key is left behind: only the agent's folder is mounted.
    holdingOnlyTheAgent();

    let reply: Reply | undefined;
    await connected([plain, other], async (client) => {
      reply = (await client.callTool({
        name: 'record_decision',
        arguments: { title: 'Routed away', rationale: 'because', project: other },
      })) as Reply;
    });

    expect(reply?.isError).toBe(true);
    expect(textOf(reply as Reply)).toContain(
      'the agent "claude" is not enrolled in this project\'s trees or the global tree, and the key that would sign instead, yours, is not on this machine.',
    );
    expect(textOf(reply as Reply)).not.toContain('any tree this session reaches');
  });

  it('says it checked the global tree alone when the session is outside any project', async () => {
    await aMachineThatHoldsOnlyTheAgent();
    holdingOnlyTheAgent();
    // Not even the global tree enrols the agent here: the one it was enrolled in is the person's.
    const nowhere = join(sandbox, 'nowhere');
    mkdirSync(nowhere, { recursive: true });

    let reply: Reply | undefined;
    await connected([nowhere], async (client) => {
      reply = (await client.callTool({
        name: 'record_decision',
        arguments: { title: 'Nowhere', rationale: 'because' },
      })) as Reply;
    });

    expect(reply?.isError).toBe(true);
    expect(textOf(reply as Reply)).toContain(
      'the agent "claude" is not enrolled in the global tree, and the key that would sign instead, yours, is not on this machine.',
    );
  });
});
