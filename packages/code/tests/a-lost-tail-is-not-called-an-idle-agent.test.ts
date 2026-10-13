/**
 * A KEY WITHOUT A TAIL IS NOT CALLED AN IDLE AGENT BY A VERIFIER THAT CANNOT KNOW IT.
 *
 * The census says of a committed key with no tail what the record can say. For a key the record
 * enrols as an agent, the sentence names the agent — and says both readings, because an agent that
 * signed and whose tail was lost in a merge reads the same, on disk, as one that never wrote. For
 * the key of a person it is the chain's own sentence, agent in the record or not; and where a waiver
 * names the cut, it is the waiver's account and nothing else.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  catalogUpcasters,
  generateKeyPair,
  listTails,
  persistKeyPair,
  tailDir,
} from '@mnema/chain';
import { type DiscoveryEnv, orderedEvents, resolveTrees } from '@mnema/core';
import { deferredWrite, enrollFromRequest, requestEnrollment } from '@mnema/core/write';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildMcpServer } from '../src/mcp/server.js';
import { type CliIo, run } from '../src/program.js';

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

/** Makes the agent `claude` and enrols it; returns its fingerprint. */
async function anAgent(): Promise<string> {
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
  return requested.match(/\b[0-9a-f]{64}\b/)?.[0] as string;
}

/** The agent writes once into the committed tree, through its own server. */
async function theAgentSigns(): Promise<void> {
  const { server } = buildMcpServer({ cwd: sandbox, env, log: () => {}, agentKey: 'claude' });
  const client = new Client(
    { name: 'claude-code', version: '1.0.0' },
    { capabilities: { roots: {} } },
  );
  client.setRequestHandler(ListRootsRequestSchema, () => ({
    roots: [{ uri: pathToFileURL(repo).href }],
  }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  try {
    const reply = (await client.callTool({
      name: 'record_decision',
      arguments: { title: 'Signed by the agent', rationale: 'because' },
    })) as { isError?: boolean };
    expect(reply.isError).not.toBe(true);
  } finally {
    await client.close();
  }
}

const publicRoot = (): string => resolveTrees(repo, env).projectPublic as string;

/** The tail the key `fingerprint` wrote in the committed tree. */
function tailOf(fingerprint: string): string {
  const tail = listTails({ root: publicRoot() }).find((name) => name.startsWith(fingerprint));
  if (tail === undefined) throw new Error(`setup: no tail of ${fingerprint}`);
  return tail;
}

/** The census line of the committed tree for the key `fingerprint`. */
async function censusLine(fingerprint: string): Promise<string> {
  const said = await mnema('verify');
  const line = (said.out + said.err)
    .split('\n')
    .find((one) => one.includes(`[key-without-tail] public ${fingerprint}`));
  if (line === undefined)
    throw new Error(`no key-without-tail line for ${fingerprint} in ${said.out}`);
  return line;
}

let agentFp: string;

beforeEach(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-lost-tail-'));
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
  agentFp = await anAgent();
});

afterEach(() => {
  process.chdir(originalCwd);
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalXdg === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = originalXdg;
  rmSync(sandbox, { recursive: true, force: true });
});

describe('the census of a committed key with no tail', () => {
  it('still says the tail may have been dropped, for an agent that signed and lost its tail', async () => {
    await theAgentSigns();
    rmSync(tailDir({ root: publicRoot() }, tailOf(agentFp)), { recursive: true });

    const line = await censusLine(agentFp);

    expect(line).toContain('the key of the agent "claude" of mnid:');
    expect(line).toContain('its tail may have been dropped (a botched merge) or removed');
  });

  it('keeps the chain’s own sentence for a colleague’s key, in a record that holds an agent', async () => {
    await theAgentSigns();
    // A key of the identity that joined and never wrote here: the record enrols it, it has no tail.
    const elsewhere = mkdtempSync(join(sandbox, 'the-colleague-'));
    const keyFile = persistKeyPair({ root: elsewhere }, generateKeyPair());
    const colleague = basename(keyFile, '.key');
    const joining = requestEnrollment({
      anchor: orderedEvents({ root: publicRoot() }, catalogUpcasters()).find(
        (event) => event.kind === 'identity.founded',
      )?.subject as string,
      keyRoot: elsewhere,
    });
    if (!joining.ok) throw new Error(joining.message);
    const write = deferredWrite(resolveTrees(repo, env), 'public');
    expect(enrollFromRequest(write, { request: joining.request }).ok).toBe(true);
    write.checkpoint();

    const line = await censusLine(colleague);

    expect(line).toContain('the tail may have been dropped (a botched merge), never written');
    expect(line).not.toContain('the key of the agent');
  });

  it('gives the waiver’s account, and not the agent’s sentence, where the record names the cut', async () => {
    await theAgentSigns();
    const tail = tailOf(agentFp);
    await did('tail', 'prune', tail, '--reason', 'the agent was cut');
    rmSync(tailDir({ root: publicRoot() }, tail), { recursive: true });

    const line = await censusLine(agentFp);

    expect(line).toContain('the record names the cut');
    expect(line).not.toContain('the key of the agent');
  });
});
