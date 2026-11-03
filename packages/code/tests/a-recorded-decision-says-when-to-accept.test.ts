/**
 * A decision just recorded says its state and when an agent accepts it, in the reply of both doors.
 *
 * It is born `proposed`: where the person dictated it, or chose it among the options an agent
 * offered, the agent accepts it at once with a note quoting the answer; where the agent concluded it
 * alone, it waits for the person. With the switch `agent-accepts` off only a person accepts, and
 * the reply says that instead. A decision recorded a second time wrote nothing and says nothing of
 * its state. The wording is one function (`stateOfANewDecision`); what is held here is that each
 * door hands it over, in the state the switch is in.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ensureTree } from '@mnema/chain';
import { type DiscoveryEnv, PROJECT_DIR } from '@mnema/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stateOfANewDecision } from '../src/agent-accepts.js';
import { buildMcpServer } from '../src/mcp/server.js';
import { type CliIo, run } from '../src/program.js';
import { tellsWhatToDo } from '../src/record-framing.js';

let sandbox: string;
let repo: string;
let env: DiscoveryEnv;
let originalCwd: string;
let originalHome: string | undefined;
let originalXdg: string | undefined;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-when-to-accept-'));
  repo = join(sandbox, 'repo');
  mkdirSync(repo, { recursive: true });
  mkdirSync(join(sandbox, 'home'), { recursive: true });
  env = { home: join(sandbox, 'home') };
  ensureTree({ root: join(repo, PROJECT_DIR) });
  originalCwd = process.cwd();
  originalHome = process.env.HOME;
  originalXdg = process.env.XDG_DATA_HOME;
  process.env.HOME = join(sandbox, 'home');
  process.env.XDG_DATA_HOME = join(sandbox, 'data');
  delete process.env.MNEMA_RUN;
  process.chdir(repo);
});

afterEach(() => {
  delete process.env.MNEMA_RUN;
  process.chdir(originalCwd);
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalXdg === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = originalXdg;
  rmSync(sandbox, { recursive: true, force: true });
});

/** A client over this repo, the way a host connects. */
async function connect(): Promise<Client> {
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

/** Every text block of a reply, joined. */
function said(result: unknown): string {
  const content = (result as { content?: { type: string; text?: string }[] }).content ?? [];
  return content
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('\n');
}

/** Runs `mnema <argv>` in process: what it printed, and whether it failed. */
async function mnema(...argv: string[]): Promise<{ out: string[]; failed: boolean }> {
  const out: string[] = [];
  let failed = false;
  const io: CliIo = {
    out: (line) => out.push(line),
    err: (line) => out.push(line),
    fail: () => {
      failed = true;
    },
  };
  await run(argv, io);
  return { out, failed };
}

const WHEN_TO_ACCEPT = stateOfANewDecision(true, 'agent-tool');
const ONLY_A_PERSON = stateOfANewDecision(false, 'agent-tool');

describe('record_decision, over a real client', () => {
  it('says the state and when to accept, on the line after the label and before where it landed', async () => {
    const client = await connect();
    const reply = said(
      await client.callTool({
        name: 'record_decision',
        arguments: { title: 'Use SQLite', rationale: 'one file' },
      }),
    );
    const lines = reply.split('\n');
    expect(lines[0]).toMatch(/^Recorded decision ADR-1 \([0-9a-f-]{36}\)$/);
    expect(lines[1]).toBe(
      '  Born proposed, so not yet in force. If the person dictated it, or chose it among options ' +
        'you offered (a recommended one included), accept it now with `decision_transition` ' +
        '(action `accept`), the note quoting their answer; if you concluded it alone, it waits ' +
        'for the person (`mnema decision review`).',
    );
    expect(lines[1]).toBe(WHEN_TO_ACCEPT);
    expect(lines[2]).toMatch(/^ {2}Landed in the public tree/);
    expect(tellsWhatToDo(reply)).toBeUndefined();
  });

  it('says only a person accepts where agent-accepts is off, and says when to accept once it is on again', async () => {
    const client = await connect();
    expect((await mnema('switch', 'off', 'agent-accepts')).failed).toBe(false);
    const off = said(
      await client.callTool({
        name: 'record_decision',
        arguments: { title: 'Use SQLite', rationale: 'one file' },
      }),
    );
    expect(off.split('\n')[1]).toBe(
      '  Born proposed, so not yet in force. Here only a person accepts it ' +
        '(`mnema decision review`): `agent-accepts` is switched off.',
    );
    expect(off.split('\n')[1]).toBe(ONLY_A_PERSON);
    expect(off).not.toContain('accept it now');

    expect((await mnema('switch', 'on', 'agent-accepts')).failed).toBe(false);
    const on = said(
      await client.callTool({
        name: 'record_decision',
        arguments: { title: 'Use WAL', rationale: 'readers do not block' },
      }),
    );
    expect(on.split('\n')[1]).toBe(WHEN_TO_ACCEPT);
  });

  it('says nothing of the state for a decision recorded a second time: nothing was written', async () => {
    const client = await connect();
    const args = { title: 'Use SQLite', rationale: 'one file' };
    await client.callTool({ name: 'record_decision', arguments: args });
    const again = said(await client.callTool({ name: 'record_decision', arguments: args }));
    expect(again).toContain('is already recorded');
    expect(again).not.toContain('Born proposed');
  });

  it('is told what the reply says: the accept it names is a call that works and the note is quoted', async () => {
    const client = await connect();
    const reply = said(
      await client.callTool({
        name: 'record_decision',
        arguments: { title: 'Use SQLite', rationale: 'one file' },
      }),
    );
    const id = /Recorded decision ADR-1 \(([^)]+)\)/.exec(reply)?.[1] as string;
    const accepted = await client.callTool({
      name: 'decision_transition',
      arguments: { id, action: 'accept', note: 'The person said: "SQLite, one file".' },
    });
    expect(accepted.isError).toBeFalsy();
    expect(said(accepted)).toContain('recorded as made by an agent');
  });
});

describe('mnema decision record', () => {
  it('tells an act declared with --which when to accept, with the command that accepts', async () => {
    const done = await mnema(
      'decision',
      'record',
      'Use SQLite',
      'one file',
      '--which',
      'claude-code',
    );
    expect(done.failed).toBe(false);
    expect(done.out[0]).toMatch(/^Recorded decision ADR-1 \(/);
    expect(done.out[1]).toBe(stateOfANewDecision(true, 'agent-command'));
    expect(done.out[1]).toContain('`mnema decision move accept <id> --which <agent>`');
    expect(done.out[2]).toMatch(/^ {2}Landed in the public tree/);
  });

  it('says only a person accepts, for that act, where agent-accepts is off', async () => {
    await mnema('switch', 'off', 'agent-accepts');
    const done = await mnema(
      'decision',
      'record',
      'Use SQLite',
      'one file',
      '--which',
      'claude-code',
    );
    expect(done.out[1]).toBe(ONLY_A_PERSON);
  });

  it('tells a person, who declares no agent, that a person accepts it with the review', async () => {
    const done = await mnema('decision', 'record', 'Use SQLite', 'one file');
    expect(done.out[1]).toBe(stateOfANewDecision(false, 'person'));
    expect(done.out[1]).toBe(
      '  Born proposed, so not yet in force. A person accepts it with `mnema decision review`.',
    );
  });
});
