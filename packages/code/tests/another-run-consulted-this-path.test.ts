/**
 * THE EDGE OF AN EDIT SAYS WHEN ANOTHER RUN CONSULTED THE SAME PATH, and says nothing it cannot
 * show from the record.
 *
 * WHAT IS HELD, at the layers a host reaches: the MCP tool a Claude Code hook calls
 * (`rules_before_an_edit`, with a second connection standing for the other agent) and the command
 * a VS Code hook runs (`runBeforeAWrite`). The sentence is derived from the record's open runs
 * and from the charges they left at the path (`channel.asked`, `channel.refused`); nothing is
 * appended on account of it, and the formats are untouched.
 *
 * THE HOSTILE ENTRIES: a run opened long ago and never closed (the host killed with SIGKILL), at
 * the ceiling of age and a minute past it; a path with a combining sequence and one with `..`.
 *
 * WHAT IT CANNOT HOLD is the host: that a host hands the reason to the model whole is measured
 * on the real binary, not here (`presentation/within-a-hook.ts`).
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { type CatalogEvent, catalogUpcasters } from '@mnema/chain';
import { type DiscoveryEnv, orderedEvents, resolveTrees } from '@mnema/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runBeforeAWrite } from '../src/commands/before-a-write.js';
import { buildMcpServer } from '../src/mcp/server.js';
import { type CliIo, run } from '../src/program.js';

let sandbox: string;
let repo: string;
let env: DiscoveryEnv;
let originalCwd: string;
let originalHome: string | undefined;
let originalXdg: string | undefined;
const clients: Client[] = [];

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
  expect(failed, `${argv.join(' ')}: ${err.join(' / ')}`).toBe(false);
  return out.join('\n');
}

function idIn(said: string): string {
  const id = said.match(/\(([0-9a-f-]{20,})\)/)?.[1];
  if (id === undefined) throw new Error(`setup: no id in ${said}`);
  return id;
}

/** A connection of an agent called `name` to this project, over the real server. */
async function connect(name: string): Promise<Client> {
  const { server } = buildMcpServer({ cwd: repo, env, log: () => {} });
  const client = new Client({ name, version: '1.0.0' }, { capabilities: { roots: {} } });
  client.setRequestHandler(ListRootsRequestSchema, () => ({
    roots: [{ uri: pathToFileURL(repo).href }],
  }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  clients.push(client);
  return client;
}

/** What the tool answers for `path`, as the hook reply the host reads. */
async function edge(
  client: Client,
  path: string,
): Promise<{ decision?: string; text: string; context: string }> {
  const result = (await client.callTool({
    name: 'rules_before_an_edit',
    arguments: { path: join(repo, path) },
  })) as { content: { type: string; text?: string }[] };
  const reply = JSON.parse(result.content[0]?.text ?? '{}') as {
    hookSpecificOutput?: {
      permissionDecision?: string;
      permissionDecisionReason?: string;
      additionalContext?: string;
    };
  };
  const out = reply.hookSpecificOutput;
  return {
    ...(out?.permissionDecision !== undefined ? { decision: out.permissionDecision } : {}),
    text: out?.permissionDecisionReason ?? '',
    context: out?.additionalContext ?? '',
  };
}

function publicEvents(): CatalogEvent[] {
  return orderedEvents(
    { root: resolveTrees(repo, env).projectPublic as string },
    catalogUpcasters(),
  );
}

/** The payload VS Code hands a hook before `create_file`. */
function createFile(path: string): string {
  return JSON.stringify({
    hook_event_name: 'PreToolUse',
    tool_name: 'create_file',
    tool_input: { filePath: join(repo, path), content: 'x' },
    cwd: repo,
  });
}

function reasonOfTheHook(path: string): string {
  const done = runBeforeAWrite({ cwd: repo, env }, { host: 'vscode', payload: createFile(path) });
  const reply = JSON.parse(JSON.stringify(done.reply)) as {
    hookSpecificOutput?: { permissionDecisionReason?: string };
  };
  return reply.hookSpecificOutput?.permissionDecisionReason ?? '';
}

const SENTENCE = /(Another run|\d+ other runs) \([^)]*\) consulted this path/;

beforeEach(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-who-is-here-'));
  repo = join(sandbox, 'repo');
  mkdirSync(join(repo, 'src', 'billing'), { recursive: true });
  mkdirSync(join(sandbox, 'home'), { recursive: true });
  originalCwd = process.cwd();
  originalHome = process.env.HOME;
  originalXdg = process.env.XDG_DATA_HOME;
  process.env.HOME = join(sandbox, 'home');
  process.env.XDG_DATA_HOME = join(sandbox, 'data');
  delete process.env.MNEMA_RUN;
  env = { home: join(sandbox, 'home') };
  process.chdir(repo);
  await did('init');
  const asking = idIn(
    await did('decision', 'record', 'Refunds need finance', 'Money leaves the company'),
  );
  await did('decision', 'move', 'accept', asking, '--note', 'agreed');
  await did('link', asking, 'src/billing', '--rel', 'asks-for-a-person');
});

afterEach(async () => {
  vi.useRealTimers();
  for (const client of clients.splice(0)) await client.close();
  process.chdir(originalCwd);
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalXdg === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = originalXdg;
  rmSync(sandbox, { recursive: true, force: true });
});

describe('the edge of an edit, with a second agent in the project', () => {
  it('tells the agent that another run consulted the path, naming the other agent', async () => {
    const codex = await connect('codex');
    const claude = await connect('claude-code');
    const first = await edge(codex, 'src/billing/invoice.ts');
    // Nobody was here before the first: no sentence.
    expect(first.decision).toBe('ask');
    expect(first.text).not.toMatch(SENTENCE);

    const second = await edge(claude, 'src/billing/invoice.ts');
    expect(second.decision).toBe('ask');
    expect(second.text).toContain(
      'Another run (codex) consulted this path less than a minute ago.',
    );
    // And the one that was here first is told of the second, not of itself.
    const again = await edge(codex, 'src/billing/invoice.ts');
    expect(again.text).toContain('Another run (claude-code) consulted this path');
    expect(again.text).not.toContain('(codex)');
  });

  it('says nothing at a path the other run was not charged at, or where no rule speaks', async () => {
    const codex = await connect('codex');
    const claude = await connect('claude-code');
    await edge(codex, 'src/billing/invoice.ts');
    expect((await edge(claude, 'src/billing/ledger.ts')).text).not.toMatch(SENTENCE);
    const elsewhere = await edge(claude, 'src/other/a.ts');
    expect(elsewhere).toEqual({ text: '', context: '' });
  });

  it('writes nothing on account of the sentence', async () => {
    const codex = await connect('codex');
    const claude = await connect('claude-code');
    await edge(codex, 'src/billing/invoice.ts');
    const before = publicEvents().length;
    const told = await edge(claude, 'src/billing/invoice.ts');
    expect(told.text).toMatch(SENTENCE);
    const kinds = publicEvents()
      .slice(before)
      .map((event) => event.kind);
    // What an ordinary asking appends: a run (the first call of a connection), the asking, its
    // service. Nothing the sentence needed.
    expect(
      kinds.filter((kind) => !['run.started', 'channel.asked', 'channel.served'].includes(kind)),
    ).toEqual([]);
  });

  it('rides in the reply of a command hook too', async () => {
    const codex = await connect('codex');
    await edge(codex, 'src/billing/invoice.ts');
    expect(reasonOfTheHook('src/billing/invoice.ts')).toContain(
      'Another run (codex) consulted this path less than a minute ago.',
    );
    expect(reasonOfTheHook('src/billing/ledger.ts')).not.toMatch(SENTENCE);
  });

  it('ignores a run left open past the ceiling of age, and keeps one just inside it', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-09T10:00:00.000Z') });
    const codex = await connect('codex');
    const claude = await connect('claude-code');
    await edge(codex, 'src/billing/invoice.ts');
    // The run is never closed. 29 minutes later it is still here; 31 minutes later it is not.
    vi.setSystemTime(new Date('2026-10-09T10:29:30.000Z'));
    expect((await edge(claude, 'src/billing/invoice.ts')).text).toContain(
      'Another run (codex) consulted this path 29 min ago.',
    );
    vi.setSystemTime(new Date('2026-10-09T10:31:00.000Z'));
    expect((await edge(claude, 'src/billing/invoice.ts')).text).not.toContain('(codex)');
    expect(reasonOfTheHook('src/billing/invoice.ts')).not.toContain('(codex)');
  });

  it('finds a path however it is spelled to the same file, and not one outside the project', async () => {
    const codex = await connect('codex');
    const claude = await connect('claude-code');
    // A combining sequence on one side and the precomposed letter on the other.
    await edge(codex, 'src/billing/café.ts');
    expect((await edge(claude, 'src/billing/café.ts')).text).toMatch(SENTENCE);
    // `..` that stays inside is the file it lands on; one that leaves is no file of the project.
    await edge(codex, 'src/billing/invoice.ts');
    expect((await edge(claude, 'src/billing/../billing/invoice.ts')).text).toMatch(SENTENCE);
    const outside = await edge(claude, '../outside.ts');
    expect(outside.text).not.toMatch(SENTENCE);
  });
});
