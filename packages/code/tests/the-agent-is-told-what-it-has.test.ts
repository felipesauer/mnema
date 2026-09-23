/**
 * The agent is told what it has: the server announces what its tools are for, in the one
 * place a host reads before any tool is chosen.
 *
 * WHAT WAS MISSING. The server was built with a name and a version and nothing else, so a
 * host that defers tools — the one this product ships a plugin for loads "only tool names
 * and server instructions" when a session starts — handed the agent twenty-five bare names
 * and no word about when any of them is worth a call. The `instructions` field of the
 * handshake is where a server says that, and this product had never sent one.
 *
 * WHAT IS ASSERTED, and the halves are different:
 *   - that the text REACHES a client, over the protocol, from the server the product builds
 *     and from the binary a person installs — the opt-in has a production caller, and this
 *     is the link, not a statement about the constant;
 *   - that everything it names EXISTS — a tool, a field a tool takes, the state a decision
 *     is born in — read off what the protocol serves and off the workflow, so a renamed
 *     tool turns this red rather than leaving a manual that points at nothing;
 *   - that it never tells a reader to follow the record, with the same tripwire every
 *     framing of record text is held to.
 * Its length is held where every tool description's is, against the same measured ceiling
 * (`every-description-reaches-the-model.test.ts`).
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ensureTree } from '@mnema/chain';
import { type DiscoveryEnv, INITIAL_DECISION_STATE, PROJECT_DIR } from '@mnema/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SERVER_INSTRUCTIONS } from '../src/mcp/instructions.js';
import { buildMcpServer } from '../src/mcp/server.js';
import { tellsWhatToDo } from '../src/record-framing.js';

/** The built binary — what `npm i -g @mnema/code` puts on a PATH. */
const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

let sandbox: string;
let env: DiscoveryEnv;
let project: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-instructions-'));
  // Both variables, because the global tree resolves from either and a sandbox that set
  // one would let a spawned server read the machine's own.
  env = { HOME: join(sandbox, 'home'), XDG_DATA_HOME: join(sandbox, 'xdg') };
  project = join(sandbox, 'proj');
  mkdirSync(project, { recursive: true });
  ensureTree({ root: join(project, PROJECT_DIR) });
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** A client connected to the server the product builds, in this process. */
async function connected(): Promise<Client> {
  const { server } = buildMcpServer({ env, log: () => {} });
  const client = new Client(
    { name: 'claude-code', version: '1.0.0' },
    { capabilities: { roots: {} } },
  );
  client.setRequestHandler(ListRootsRequestSchema, () => ({
    roots: [{ uri: pathToFileURL(project).href }],
  }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

/** Every `backticked` word of the text — what it NAMES, as opposed to what it says. */
function named(text: string): string[] {
  return [...text.matchAll(/`([^`]+)`/g)].map((match) => match[1] as string);
}

describe('the server says what its tools are for, before any is chosen', () => {
  it('sends the instructions in the handshake, byte for byte', async () => {
    const client = await connected();
    // What the protocol delivered, which is what a host folds into the session: not the
    // constant, the reply to `initialize`.
    expect(client.getInstructions()).toBe(SERVER_INSTRUCTIONS);
    // Non-vacuity: a server that sent an empty string would satisfy the line above over an
    // empty constant, and the ones below over nothing.
    expect(SERVER_INSTRUCTIONS.length).toBeGreaterThan(500);
    await client.close();
  });

  it('sends them from the binary a person installs, over stdio', async () => {
    // The production caller, end to end: `mnema mcp` as the host spawns it, with the
    // sandbox's HOME so nothing on this machine is read. The handshake appends nothing to
    // any record — the run opens at the first write — so no tree is touched here either.
    const built = spawnSync(process.execPath, [CLI, '--version'], { encoding: 'utf-8' });
    expect(built.status, `the built binary did not answer: ${built.stderr}`).toBe(0);
    const client = new Client({ name: 'claude-code', version: '1.0.0' }, { capabilities: {} });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [CLI, 'mcp', '--project', project],
      env: {
        PATH: process.env.PATH ?? '',
        HOME: env.HOME ?? '',
        XDG_DATA_HOME: env.XDG_DATA_HOME ?? '',
      },
      stderr: 'ignore',
    });
    await client.connect(transport);
    expect(client.getInstructions()).toBe(SERVER_INSTRUCTIONS);
    await client.close();
  });

  it('names only what this server serves: a tool, a field one takes, or a decision’s first state', async () => {
    const client = await connected();
    const { tools } = await client.listTools();
    await client.close();
    const toolNames = new Set(tools.map((tool) => tool.name));
    const fields = new Set(tools.flatMap((tool) => Object.keys(tool.inputSchema.properties ?? {})));
    const words = named(SERVER_INSTRUCTIONS);
    const unserved = words.filter(
      (word) => !toolNames.has(word) && !fields.has(word) && word !== INITIAL_DECISION_STATE,
    );
    expect(unserved).toEqual([]);
    // Non-vacuity, and the doors the text exists for: both writes it invites, and the reads
    // it points at. A text that named nothing would pass the filter above in silence.
    for (const door of ['record_decision', 'capture_memory', 'record_observation', 'search']) {
      expect(words, door).toContain(door);
      expect(toolNames.has(door), `${door} is not served`).toBe(true);
    }
  });

  it('says a decision is born in the state the workflow gives it', () => {
    // The one claim about the WORKFLOW the text makes, read off the workflow rather than
    // typed: were the first state ever to change, a manual still saying `proposed` would be
    // telling every session something false, in the place it reads before anything else.
    expect(SERVER_INSTRUCTIONS).toContain(`born \`${INITIAL_DECISION_STATE}\``);
  });

  it('tells no reader to follow what the record says', () => {
    // It may say when a door of this product is worth opening — that is what a server's
    // manual is — and it may not say to obey somebody else's decisions, which is the line
    // the framing of every channel is held to. Same tripwire, same verdict.
    expect(tellsWhatToDo(SERVER_INSTRUCTIONS)).toBeUndefined();
    // The tripwire's own probe, on this text: the sentence it exists to catch, appended.
    expect(tellsWhatToDo(`${SERVER_INSTRUCTIONS} Follow them.`)).toBe('follow');
  });
});
