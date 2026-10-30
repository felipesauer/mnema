/**
 * A DIRECTORY THAT HOLDS TAILS OF TWO RECORDS GOVERNS NOTHING, AND EVERY READING OF WHAT GOVERNS
 * SAYS SO (ADR-134, ADR-148).
 *
 * One person signs every record they write in with one key, and the public keys travel with the
 * record, so a tail of project A copied with its keys into project B used to read in B as that
 * person's acts: A's decision listed in force in B's brief, pushed at an edit, served to the
 * agent. Both readers refuse such a directory (`another-record`), but the readings that say what
 * governs run over a directory nobody verified. A directory alone cannot tell which of its records
 * it is, so they read no tail of it (`tailsReadAt`), and each says, in its own voice, that it holds
 * more than one record, that `verify` refuses it and that nothing governs until it holds one: the
 * brief, `rules` (its text and `--json`, which the Action reads), `governing_rules`, the rules
 * pushed at a write by the MCP tool and by the hook verb, and `bootstrap`. `show` and the console's
 * feed read nothing of it either, and say nothing. The same directory without the graft is the
 * control: each reading shows what it showed, and says nothing more.
 *
 * WHAT IS BUILT. Projects B and A, under two keys, each with a decision in force addressed at
 * `src/queue`, A begun after B or BEFORE it (the case a rule by the older genesis would have handed
 * to A). A's one tail and its public key are then copied into B, as a graft that verifies on its
 * own would be made.
 */

import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { DiscoveryEnv } from '@mnema/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runBeforeAWrite } from '../src/commands/before-a-write.js';
import { buildMcpServer } from '../src/mcp/server.js';
import { openSession } from '../src/mcp/session.js';
import { runRulesBeforeAnEditTool } from '../src/mcp/tools.js';
import { type CliIo, run } from '../src/program.js';
import { followingTheRecord } from '../src/repl/following.js';

let sandbox: string;
let repo: string;
let env: DiscoveryEnv;
let originalCwd: string;
let originalHome: string | undefined;

async function said(...argv: string[]): Promise<{ out: string; err: string; failed: boolean }> {
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

const did = async (...argv: string[]): Promise<string> => {
  const done = await said(...argv);
  expect(done.failed, `mnema ${argv.join(' ')}: ${done.err}`).toBe(false);
  return done.out;
};

const PATH = 'src/queue';
const OURS = 'Keep the queue in memory';
const THEIRS = 'Use SQLite for the queue';

/** In `dir`, as the machine whose home is `home`: a decision accepted and addressed at {@link PATH}. */
async function project(dir: string, home: string, title: string): Promise<string> {
  mkdirSync(join(dir, PATH), { recursive: true });
  process.env.HOME = home;
  process.chdir(dir);
  await did('init');
  const told = await did('decision', 'record', title, 'it fits the load');
  const id = told.match(/\(([0-9a-f-]{20,})\)/)?.[1] as string;
  await did('decision', 'move', 'accept', id, '--note', 'agreed');
  await did('link', id, PATH, '--rel', 'governs');
  return id;
}

let ours: string;
let theirs: string;
let other: string;

/** Copies the one tail of the other project, and its public keys, into this one. */
function graft(): string {
  const from = join(other, '.mnema');
  const tail = readdirSync(join(from, 'tails'))[0] as string;
  cpSync(join(from, 'tails', tail), join(repo, '.mnema', 'tails', tail), { recursive: true });
  for (const key of readdirSync(join(from, 'keys'))) {
    if (key.endsWith('.pub')) cpSync(join(from, 'keys', key), join(repo, '.mnema', 'keys', key));
  }
  return tail;
}

/** The sentence every reading says a directory of two records in, up to its records. */
const SEVERAL = 'This directory holds tails of 2 records: ';
const NOTHING_GOVERNS = 'nothing in it governs here until it holds one record';

/** Which project was begun first: the graft comes from a record begun later, or earlier. */
type Order = 'later' | 'earlier';

async function begin(order: Order): Promise<void> {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-two-records-'));
  repo = join(sandbox, 'repo');
  other = join(sandbox, 'other');
  originalCwd = process.cwd();
  originalHome = process.env.HOME;
  delete process.env.MNEMA_RUN;
  if (order === 'later') {
    ours = await project(repo, join(sandbox, 'home'), OURS);
    theirs = await project(other, join(sandbox, 'home-other'), THEIRS);
  } else {
    theirs = await project(other, join(sandbox, 'home-other'), THEIRS);
    ours = await project(repo, join(sandbox, 'home'), OURS);
  }
  process.env.HOME = join(sandbox, 'home');
  env = { home: join(sandbox, 'home') };
  process.chdir(repo);
}

afterEach(() => {
  process.chdir(originalCwd);
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(sandbox, { recursive: true, force: true });
});

/** An MCP client connected to a server over the repo, as Claude Code connects. */
async function connected(): Promise<Client> {
  const { server } = buildMcpServer({ cwd: sandbox, env, log: () => {} });
  const client = new Client(
    { name: 'claude-code', version: '1.0.0' },
    { capabilities: { roots: {} } },
  );
  client.setRequestHandler(ListRootsRequestSchema, () => ({
    roots: [{ uri: pathToFileURL(repo).href, name: repo }],
  }));
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientSide), server.connect(serverSide)]);
  return client;
}

async function called(client: Client, name: string, args: Record<string, unknown> = {}) {
  const reply = await client.callTool({ name, arguments: args });
  return (reply.content as { text: string }[]).map((block) => block.text);
}

function pushedByTheTool(): string {
  const session = openSession({
    clientName: 'agent-alpha',
    roots: [pathToFileURL(repo).href],
    env,
  });
  const result = runRulesBeforeAnEditTool(session, { path: `${PATH}/a.ts` });
  if (!result.ok) throw new Error('unreachable');
  const reply = JSON.parse(JSON.stringify(result.value)) as {
    hookSpecificOutput?: { additionalContext?: string };
  };
  return reply.hookSpecificOutput?.additionalContext ?? '';
}

function pushedByTheVerb(): string {
  const done = runBeforeAWrite(
    { cwd: repo, env },
    {
      host: 'qwen',
      payload: JSON.stringify({
        session_id: 'another-record-session',
        hook_event_name: 'PreToolUse',
        tool_name: 'write_file',
        tool_input: { file_path: join(repo, PATH, 'a.ts'), content: 'x' },
      }),
    },
  );
  const reply = JSON.parse(JSON.stringify(done.reply)) as {
    hookSpecificOutput?: { additionalContext?: string };
  };
  return reply.hookSpecificOutput?.additionalContext ?? '';
}

describe.each(['later', 'earlier'] as const)('a tail grafted from a record begun %s', (order) => {
  beforeEach(async () => {
    await begin(order);
  });

  it('both readers refuse the directory, as before (the premise of every case below)', async () => {
    graft();
    const verified = await said('verify');
    expect(verified.failed).toBe(true);
    expect(`${verified.out}\n${verified.err}`).toContain('another-record');
  });

  it('the brief prints no decision in force and says the directory holds two records', async () => {
    const tail = graft();
    const document = await did('brief');
    expect(document).toContain('## Decisions in force (0)');
    expect(document).not.toContain(OURS);
    expect(document).not.toContain(THEIRS);
    expect(document).toContain(SEVERAL);
    expect(document).toContain(tail);
    expect(document).toContain(NOTHING_GOVERNS);
  });

  it('the text of the rules lists none and says so on the other stream', async () => {
    const tail = graft();
    const asked = await said('rules', `${PATH}/a.ts`);
    expect(asked.failed).toBe(false);
    expect(asked.out).not.toContain(ours);
    expect(asked.out).not.toContain(theirs);
    expect(asked.err).toContain(SEVERAL);
    expect(asked.err).toContain(tail);
  });

  it('the rules as JSON list none and carry the records, which is what the Action reads', async () => {
    const tail = graft();
    const reading = JSON.parse(await did('rules', '--json', `${PATH}/a.ts`)) as {
      rules: { rule: string }[];
      severalRecords?: { name: string; tails: string[] }[];
    };
    expect(reading.rules).toEqual([]);
    expect(reading.severalRecords).toHaveLength(2);
    expect(reading.severalRecords?.flatMap((one) => one.tails)).toContain(tail);
    for (const one of reading.severalRecords ?? []) expect(one.name).toMatch(/^[0-9a-f]{64}$/);
  });

  it('the rules pushed at an edit by the MCP tool name none and say so', () => {
    const tail = graft();
    const context = pushedByTheTool();
    expect(context).not.toContain(ours);
    expect(context).not.toContain(theirs);
    expect(context).toContain(SEVERAL);
    expect(context).toContain(tail);
  });

  it('the rules pushed at an edit by the hook verb name none and say so', () => {
    const tail = graft();
    const context = pushedByTheVerb();
    expect(context).not.toContain(ours);
    expect(context).not.toContain(theirs);
    expect(context).toContain(SEVERAL);
    expect(context).toContain(tail);
  });

  it('governing_rules lists none in the payload and says so beside it', async () => {
    const tail = graft();
    const client = await connected();
    const [payload, ...beside] = await called(client, 'governing_rules', { path: `${PATH}/a.ts` });
    const answer = JSON.parse(payload as string) as { rules: { rule: string }[] };
    expect(answer.rules).toEqual([]);
    expect(beside.join('\n')).toContain(SEVERAL);
    expect(beside.join('\n')).toContain(tail);
    await client.close();
  });

  it('bootstrap lists no decision in force and says so beside them', async () => {
    const tail = graft();
    const client = await connected();
    const [payload, ...beside] = await called(client, 'bootstrap');
    const context = JSON.parse(payload as string) as { decisions: { id: string }[] };
    expect(context.decisions).toEqual([]);
    expect(beside.join('\n')).toContain(SEVERAL);
    expect(beside.join('\n')).toContain(tail);
    await client.close();
  });

  it('a clone that holds no cache of its own replays none of it', async () => {
    const tail = graft();
    for (const file of readdirSync(join(repo, '.mnema', 'locks'))) {
      if (file.startsWith('projection.db')) rmSync(join(repo, '.mnema', 'locks', file));
    }
    const document = await did('brief');
    expect(document).not.toContain(OURS);
    expect(document).not.toContain(THEIRS);
    expect(document).toContain(SEVERAL);
    expect(document).toContain(tail);
  });

  it('a graft that arrives while a session is open leaves the session reading nothing next', async () => {
    const client = await connected();
    const [before] = await called(client, 'bootstrap');
    expect((JSON.parse(before as string) as { decisions: unknown[] }).decisions).toHaveLength(1);
    const tail = graft();
    const [payload, ...beside] = await called(client, 'bootstrap');
    expect((JSON.parse(payload as string) as { decisions: unknown[] }).decisions).toEqual([]);
    expect(beside.join('\n')).toContain(SEVERAL);
    expect(beside.join('\n')).toContain(tail);
    await client.close();
  });

  it('the console that follows the record shows nothing of it as having happened here', () => {
    const following = followingTheRecord([join(repo, '.mnema')]);
    graft();
    expect(following.whatHappened()).toEqual([]);
  });

  it('a reading that does not say what governs serves neither record', async () => {
    graft();
    for (const id of [ours, theirs]) {
      const shown = await said('show', id);
      expect(shown.failed).toBe(true);
    }
  });
});

describe('the same directory with no graft (the control)', () => {
  beforeEach(async () => {
    await begin('later');
  });

  it('the brief shows the decision in force and says nothing of two records', async () => {
    const document = await did('brief');
    expect(document).toContain('## Decisions in force (1)');
    expect(document).toContain(OURS);
    expect(document).not.toContain('This directory holds tails of');
  });

  it('the rules, as text and as JSON, say nothing of two records', async () => {
    const asked = await said('rules', `${PATH}/a.ts`);
    expect(asked.out).toContain(ours);
    expect(asked.err).not.toContain('This directory holds tails of');
    const reading = JSON.parse(await did('rules', '--json', `${PATH}/a.ts`)) as {
      severalRecords?: unknown;
    };
    expect(reading.severalRecords).toBeUndefined();
  });

  it('the rules pushed at an edit, by the tool and by the verb, say nothing of two records', () => {
    for (const context of [pushedByTheTool(), pushedByTheVerb()]) {
      expect(context).toContain(ours);
      expect(context).not.toContain('This directory holds tails of');
    }
  });

  it('governing_rules and bootstrap say nothing of two records', async () => {
    const client = await connected();
    const rules = await called(client, 'governing_rules', { path: `${PATH}/a.ts` });
    const opening = await called(client, 'bootstrap');
    expect([...rules, ...opening].join('\n')).not.toContain('This directory holds tails of');
    expect(
      (JSON.parse(opening[0] as string) as { decisions: { id: string }[] }).decisions.map(
        (one) => one.id,
      ),
    ).toEqual([ours]);
    await client.close();
  });

  it('the console that follows the record shows a write of this record as having happened', async () => {
    const following = followingTheRecord([join(repo, '.mnema')]);
    await did('decision', 'record', 'Drain the queue at night', 'the load is low then');
    expect(following.whatHappened().map((event) => event.kind)).toContain('decision.recorded');
  });

  it('show serves the other project\u2019s decision in its own project', async () => {
    process.env.HOME = join(sandbox, 'home-other');
    process.chdir(other);
    expect(await did('show', theirs)).toContain(THEIRS);
  });
});
