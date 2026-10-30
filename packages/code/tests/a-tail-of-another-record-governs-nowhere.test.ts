/**
 * A TAIL OF ANOTHER RECORD GOVERNS NOWHERE HERE, AND EVERY READING OF WHAT GOVERNS SAYS WHICH TAIL
 * IT LEFT OUT (ADR-134, FORMAT.md section 6.10).
 *
 * One person signs every record they write in with one key, and the public keys travel with the
 * record, so a tail of project A copied with its keys into project B used to read in B as that
 * person's acts: A's decision listed in force in B's brief, pushed at an edit, served to the
 * agent. Both readers refuse such a directory (`another-record`), but the readings that say what
 * governs run over a directory nobody verified. They read the tails of the record now
 * (`tailsOfTheRecordAt`), the record being the one that holds the genesis, and each says, in its
 * own voice, which tail it left out: the brief, `rules` (its text and `--json`, which the Action
 * reads), `governing_rules`, the rules pushed at a write by the MCP tool and by the hook verb, and
 * `bootstrap`. The same directory without the graft is the control: each reading shows what it
 * showed, and says nothing more.
 *
 * WHAT IS BUILT. Project B is begun first, and project A after it, under another key, each with a
 * decision in force addressed at `src/queue`. A's one tail and its public key are then copied into
 * B, as a graft that verifies on its own would be made. B's genesis is the older, so B is the
 * record read and A's tail is the one left out.
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

/** The sentence every reading says a left-out tail in, up to the record's name. */
const leftOut = (tail: string) => `Left out of this reading: tail ${tail} names another record (`;

beforeEach(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-another-record-'));
  repo = join(sandbox, 'repo');
  other = join(sandbox, 'other');
  originalCwd = process.cwd();
  originalHome = process.env.HOME;
  delete process.env.MNEMA_RUN;
  ours = await project(repo, join(sandbox, 'home'), OURS);
  theirs = await project(other, join(sandbox, 'home-other'), THEIRS);
  process.env.HOME = join(sandbox, 'home');
  env = { home: join(sandbox, 'home') };
  process.chdir(repo);
});

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

describe('a tail grafted from another record', () => {
  it('both readers refuse the directory, as before (the premise of every case below)', async () => {
    graft();
    const verified = await said('verify');
    expect(verified.failed).toBe(true);
    expect(`${verified.out}\n${verified.err}`).toContain('another-record');
  });

  it('the brief leaves its decision out and says which tail it left out', async () => {
    const tail = graft();
    const document = await did('brief');
    expect(document).toContain('## Decisions in force (1)');
    expect(document).toContain(OURS);
    expect(document).not.toContain(THEIRS);
    expect(document).not.toContain(theirs);
    expect(document).toContain(leftOut(tail));
  });

  it('the text of the rules leaves it out and says so on the other stream', async () => {
    const tail = graft();
    const asked = await said('rules', `${PATH}/a.ts`);
    expect(asked.failed).toBe(false);
    expect(asked.out).toContain(ours);
    expect(asked.out).not.toContain(theirs);
    expect(asked.err).toContain(leftOut(tail));
  });

  it('the rules as JSON leave it out and carry the tail, which is what the Action reads', async () => {
    const tail = graft();
    const reading = JSON.parse(await did('rules', '--json', `${PATH}/a.ts`)) as {
      rules: { rule: string }[];
      anotherRecord?: { tail: string; record: string }[];
    };
    expect(reading.rules.map((one) => one.rule)).toEqual([ours]);
    expect(reading.anotherRecord?.map((one) => one.tail)).toEqual([tail]);
    expect(reading.anotherRecord?.[0]?.record).toMatch(/^[0-9a-f]{64}$/);
  });

  it('the rules pushed at an edit by the MCP tool leave it out and say so', () => {
    const tail = graft();
    const context = pushedByTheTool();
    expect(context).toContain(ours);
    expect(context).not.toContain(theirs);
    expect(context).toContain(leftOut(tail));
  });

  it('the rules pushed at an edit by the hook verb leave it out and say so', () => {
    const tail = graft();
    const context = pushedByTheVerb();
    expect(context).toContain(ours);
    expect(context).not.toContain(theirs);
    expect(context).toContain(leftOut(tail));
  });

  it('governing_rules leaves it out of the payload and says so beside it', async () => {
    const tail = graft();
    const client = await connected();
    const [payload, ...beside] = await called(client, 'governing_rules', { path: `${PATH}/a.ts` });
    const answer = JSON.parse(payload as string) as { rules: { rule: string }[] };
    expect(answer.rules.map((one) => one.rule)).toEqual([ours]);
    expect(beside.join('\n')).toContain(leftOut(tail));
    await client.close();
  });

  it('bootstrap leaves it out of the decisions in force and says so beside them', async () => {
    const tail = graft();
    const client = await connected();
    const [payload, ...beside] = await called(client, 'bootstrap');
    const context = JSON.parse(payload as string) as { decisions: { id: string }[] };
    expect(context.decisions.map((one) => one.id)).toEqual([ours]);
    expect(beside.join('\n')).toContain(leftOut(tail));
    await client.close();
  });

  it('a clone that holds no cache of its own leaves it out of the whole replay too', async () => {
    const tail = graft();
    // A fresh clone carries no projection: the reading replays every tail of the record.
    for (const file of readdirSync(join(repo, '.mnema', 'locks'))) {
      if (file.startsWith('projection.db')) rmSync(join(repo, '.mnema', 'locks', file));
    }
    const document = await did('brief');
    expect(document).toContain(OURS);
    expect(document).not.toContain(THEIRS);
    expect(document).toContain(leftOut(tail));
  });

  it('a graft that arrives while a session is open is left out of what the session reads next', async () => {
    const client = await connected();
    const [before] = await called(client, 'bootstrap');
    expect((JSON.parse(before as string) as { decisions: unknown[] }).decisions).toHaveLength(1);
    const tail = graft();
    const [payload, ...beside] = await called(client, 'bootstrap');
    const context = JSON.parse(payload as string) as { decisions: { id: string }[] };
    expect(context.decisions.map((one) => one.id)).toEqual([ours]);
    expect(beside.join('\n')).toContain(leftOut(tail));
    await client.close();
  });

  it('the console that follows the record does not show what arrives on it as having happened here', async () => {
    const following = followingTheRecord([join(repo, '.mnema')]);
    graft();
    expect(following.whatHappened()).toEqual([]);
  });

  it('a reading that does not say what governs does not serve it either', async () => {
    graft();
    const shown = await said('show', theirs);
    expect(shown.failed).toBe(true);
    expect(shown.out).not.toContain(THEIRS);
  });
});

describe('the same directory with no graft (the control)', () => {
  it('the brief shows the decision in force and says nothing of another record', async () => {
    const document = await did('brief');
    expect(document).toContain('## Decisions in force (1)');
    expect(document).toContain(OURS);
    expect(document).not.toContain('Left out of this reading');
  });

  it('the rules, as text and as JSON, say nothing of another record', async () => {
    const asked = await said('rules', `${PATH}/a.ts`);
    expect(asked.out).toContain(ours);
    expect(asked.err).not.toContain('Left out of this reading');
    const reading = JSON.parse(await did('rules', '--json', `${PATH}/a.ts`)) as {
      anotherRecord?: unknown;
    };
    expect(reading.anotherRecord).toBeUndefined();
  });

  it('the rules pushed at an edit, by the tool and by the verb, say nothing of another record', () => {
    for (const context of [pushedByTheTool(), pushedByTheVerb()]) {
      expect(context).toContain(ours);
      expect(context).not.toContain('Left out of this reading');
    }
  });

  it('governing_rules and bootstrap say nothing of another record', async () => {
    const client = await connected();
    const rules = await called(client, 'governing_rules', { path: `${PATH}/a.ts` });
    const opening = await called(client, 'bootstrap');
    expect([...rules, ...opening].join('\n')).not.toContain('Left out of this reading');
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

  it('show serves the other project’s decision in its own project', async () => {
    process.env.HOME = join(sandbox, 'home-other');
    process.chdir(other);
    expect(await did('show', theirs)).toContain(THEIRS);
  });
});
