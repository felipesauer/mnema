/**
 * Recording the same decision twice answers with the one that is on the record.
 *
 * THE DEFECT. A `record_decision` repeated after a reply that never arrived wrote a second
 * decision, with another id and another `ADR-<n>`, and the reply carried nothing the caller could
 * check. Now a decision whose title, rationale and alternatives are the ones being recorded, and
 * that is still proposed or accepted, is the decision already there: nothing is written and the
 * reply names it. The rule lives in the core operation, so both doors ask it.
 *
 * The comparison is against the projection's text of each decision (which is the text of its first
 * writing, never a later one), on the SCREENED values a write stores. A rejected or superseded
 * decision is not a twin.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { catalogUpcasters, ensureTree } from '@mnema/chain';
import {
  chainRootForScope,
  type DiscoveryEnv,
  orderedEvents,
  PROJECT_DIR,
  resolveTrees,
} from '@mnema/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildMcpServer } from '../src/mcp/server.js';
import { type CliIo, run } from '../src/program.js';

let sandbox: string;
let repo: string;
let env: DiscoveryEnv;
let originalCwd: string;
let originalHome: string | undefined;
let originalXdg: string | undefined;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-twice-'));
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

function said(result: unknown): string {
  const content = (result as { content?: { type: string; text?: string }[] }).content ?? [];
  return content
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('\n');
}

/** How many `decision.recorded` events the project's tree that travels holds. */
function births(): number {
  const root = chainRootForScope(resolveTrees(repo, env), 'public') as string;
  return orderedEvents({ root }, catalogUpcasters()).filter(
    (event) => event.kind === 'decision.recorded',
  ).length;
}

async function mnema(...argv: string[]): Promise<{ out: string; failed: boolean }> {
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
  return { out: out.join('\n'), failed };
}

/** The label and the id in `Recorded decision ADR-n (<id>)`. */
function recordedAs(reply: string): { adr: string; id: string } {
  const found = reply.match(/Recorded decision (\S+) \(([^)]+)\)/);
  if (found === null) throw new Error(`setup: not a recording: ${reply}`);
  return { adr: found[1] as string, id: found[2] as string };
}

const alreadyOf = (adr: string, id: string) =>
  `Decision ${adr} (${id}) is already recorded in the public tree with this title, rationale and alternatives. Nothing was written.`;

describe('record_decision, repeated', () => {
  it('answers with the decision that is there, offers nothing, and writes nothing', async () => {
    const client = await connect();
    // A path looked at makes the first reply offer an address; a repeat offers none.
    await client.callTool({ name: 'governing_rules', arguments: { path: 'src/a.ts' } });
    const args = {
      title: 'Keep the ledger',
      rationale: 'it is the audit surface',
      alternatives: 'a log file: not signed',
    };
    const first = said(await client.callTool({ name: 'record_decision', arguments: args }));
    const { adr, id } = recordedAs(first);
    expect(first).toContain('Paths of this project this connection looked at');
    expect(births()).toBe(1);

    const again = said(await client.callTool({ name: 'record_decision', arguments: args }));
    expect(again).toContain(alreadyOf(adr, id));
    expect(again).not.toContain('Recorded decision');
    expect(again).not.toContain('Paths of this project');
    expect(again).not.toContain('Landed in');
    expect(births()).toBe(1);
  });

  it('records a new decision when the alternatives, the rationale or the title differ', async () => {
    const client = await connect();
    const call = (args: Record<string, string>) =>
      client.callTool({ name: 'record_decision', arguments: args }).then(said);
    await call({ title: 'T', rationale: 'R', alternatives: 'A' });
    expect(await call({ title: 'T', rationale: 'R' })).toContain('Recorded decision ADR-2');
    expect(await call({ title: 'T', rationale: 'R', alternatives: 'B' })).toContain(
      'Recorded decision ADR-3',
    );
    expect(await call({ title: 'T', rationale: 'S', alternatives: 'A' })).toContain(
      'Recorded decision ADR-4',
    );
    expect(await call({ title: 'U', rationale: 'R', alternatives: 'A' })).toContain(
      'Recorded decision ADR-5',
    );
    expect(births()).toBe(5);
  });

  it('finds the twin after the screen: a secret replaced the first time is replaced again', async () => {
    const client = await connect();
    const args = { title: 'Deploy key', rationale: 'use AKIAIOSFODNN7EXAMPLE for the bucket' };
    const first = recordedAs(
      said(await client.callTool({ name: 'record_decision', arguments: args })),
    );
    const again = said(await client.callTool({ name: 'record_decision', arguments: args }));
    expect(again).toContain(alreadyOf(first.adr, first.id));
    expect(births()).toBe(1);
  });
});

describe('mnema decision record, repeated', () => {
  it('prints the decision that is there and writes nothing', async () => {
    const first = await mnema('decision', 'record', 'Use SQLite', 'one file');
    const { adr, id } = recordedAs(first.out);
    const again = await mnema('decision', 'record', 'Use SQLite', 'one file');
    expect(again.failed, again.out).toBe(false);
    expect(again.out).toBe(alreadyOf(adr, id));
    expect(births()).toBe(1);
  });

  it('is the same decision across the two doors, in force or proposed, and not once rejected', async () => {
    const first = await mnema('decision', 'record', 'Use SQLite', 'one file');
    const { adr, id } = recordedAs(first.out);
    const client = await connect();
    const viaTool = said(
      await client.callTool({
        name: 'record_decision',
        arguments: { title: 'Use SQLite', rationale: 'one file' },
      }),
    );
    expect(viaTool).toContain(alreadyOf(adr, id));

    // In force (accepted by the person at the command line) it is still the one on the record.
    const accepted = await mnema('decision', 'move', 'accept', id, '--note', 'agreed in review');
    expect(accepted.failed, accepted.out).toBe(false);
    expect((await mnema('decision', 'record', 'Use SQLite', 'one file')).out).toBe(
      alreadyOf(adr, id),
    );

    // Rejected, the same words are a new proposal.
    const second = await mnema('decision', 'record', 'Use Mongo', 'documents');
    const rejectedId = recordedAs(second.out).id;
    await mnema('decision', 'move', 'reject', rejectedId, '--note', 'does not fit');
    const third = await mnema('decision', 'record', 'Use Mongo', 'documents');
    expect(third.out).toContain('Recorded decision ADR-3');
    expect(births()).toBe(3);
  });
});
