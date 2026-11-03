/**
 * EVERY SURFACE THAT SERVES A RECORD SAYS WHERE A NEWER MNEMA WROTE (ADR-113, ADR-140).
 *
 * A line of a kind this binary does not know is read past: verified, named by `verify`, and left
 * out of every projection. A surface that served the record without it said nothing, so a reading
 * could be out of date by a line that moved a decision, and nothing on the screen showed it. Here
 * a record this binary wrote is given a line of a kind no version declares, appended as a newer
 * mnema on the machine would (`support/a-newer-mnema-writes.ts`), and each surface is asked: status
 * (text and `--json`), the brief (its document and its hook copy), `show` and `read_record` for the
 * record the line names as its subject, `bootstrap`, and `doctor`. The same record without the
 * line is asked the same questions and nothing is said.
 *
 * The sentences are quoted whole below, as literals, and not rebuilt from the function that words
 * them: a test that recomputed its expectation would pass with any sentence.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildMcpServer } from '../src/mcp/server.js';
import { aNewerMnemaWrites, FUTURE } from './support/a-newer-mnema-writes.js';
import { GIT_WITHOUT_MAINTENANCE } from './support/git-without-maintenance.js';

const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

const OF_THE_RECORD =
  'A newer mnema wrote 1 line into this record (1 of "x.from-the-future") that this one does not ' +
  'read or apply, so what it serves from this record may be out of date. Update mnema to read ' +
  'them, and do not guess what they say.';
const ABOUT_THIS_ONE =
  'A newer mnema wrote 1 line about this record (1 of "x.from-the-future") that this one does not ' +
  'read or apply, so what it shows of this record may be out of date. Update mnema to read them, ' +
  'and do not guess what they say.';

const AN_ID = /([0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12})/;

let sandbox: string;
let home: string;
let repo: string;

const ENV = () => ({
  PATH: process.env.PATH ?? '',
  HOME: home,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: GIT_WITHOUT_MAINTENANCE,
  GIT_AUTHOR_NAME: 'a',
  GIT_AUTHOR_EMAIL: 'a@example.invalid',
  GIT_COMMITTER_NAME: 'a',
  GIT_COMMITTER_EMAIL: 'a@example.invalid',
});

function mnema(...argv: string[]) {
  const ran = spawnSync(process.execPath, [CLI, ...argv], {
    cwd: repo,
    encoding: 'utf-8',
    env: ENV(),
  });
  return { status: ran.status, out: ran.stdout, err: ran.stderr };
}

/** One line of a kind no version declares, appended as a newer mnema writes it. */
const newerWrites = (line: { kind?: string; subject?: string } = {}) =>
  aNewerMnemaWrites({ record: join(repo, '.mnema'), home }, { means: 'something' }, line);

/** Records one decision and returns its id. */
function aDecision(): string {
  const decided = mnema('decision', 'record', 'Use Postgres', 'The team knows it.');
  expect(decided.status, decided.err).toBe(0);
  const id = AN_ID.exec(`${decided.out}${decided.err}`)?.[1];
  expect(id, decided.out).toBeDefined();
  return id as string;
}

/** Records one memory and returns its id: a record the line below does not name. */
function anotherRecord(): string {
  const wrote = mnema('memory', 'Another record.');
  expect(wrote.status, wrote.err).toBe(0);
  return AN_ID.exec(`${wrote.out}${wrote.err}`)?.[1] as string;
}

/** What the agent's tools answer, each by a client connected afresh. */
async function theTools(id: string, other: string): Promise<Record<string, string[]>> {
  const { server } = buildMcpServer({ cwd: repo, env: { home }, log: () => {} });
  const client = new Client(
    { name: 'claude-code', version: '1.0.0' },
    { capabilities: { roots: {} } },
  );
  client.setRequestHandler(ListRootsRequestSchema, () => ({
    roots: [{ uri: pathToFileURL(repo).href, name: repo }],
  }));
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientSide), server.connect(serverSide)]);
  const called = async (name: string, args: Record<string, unknown> = {}) => {
    const reply = await client.callTool({ name, arguments: args });
    expect(reply.isError ?? false, `${name}: ${JSON.stringify(reply.content)}`).toBe(false);
    return (reply.content as { text: string }[]).map((block) => block.text);
  };
  const answers = {
    bootstrap: await called('bootstrap'),
    read_record: await called('read_record', { id }),
    read_another: await called('read_record', { id: other }),
  };
  await client.close();
  return answers;
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-newer-says-'));
  home = join(sandbox, 'home');
  repo = join(sandbox, 'repo');
  mkdirSync(home);
  mkdirSync(repo);
  expect(spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: repo, env: ENV() }).status).toBe(0);
  expect(mnema('init').status).toBe(0);
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

// Each case runs the binary a dozen times over; under the full suite one takes longer than the default.
describe('a record a newer mnema wrote a line into', { timeout: 120_000 }, () => {
  it('says so in status, the one line, above the lists it qualifies, and in --json', () => {
    aDecision();
    // Read once BEFORE the line: the cache on disk is warm, so what follows is the catch-up
    // reading an arrival, which is the path a session in the middle of work takes.
    expect(mnema('status').status).toBe(0);
    newerWrites();

    const status = mnema('status');
    expect(status.status, status.err).toBe(0);
    const lines = status.out.split('\n');
    expect(lines.filter((line) => line.includes('A newer mnema wrote'))).toEqual([OF_THE_RECORD]);
    expect(lines.indexOf(OF_THE_RECORD)).toBeLessThan(
      lines.findIndex((line) => line.includes('decisions in force')),
    );

    const json = mnema('status', '--json');
    expect(json.status, json.err).toBe(0);
    expect(JSON.parse(json.out).newerLines).toEqual({
      lines: 1,
      kinds: [{ kind: FUTURE, lines: 1 }],
    });
  });

  it('keeps saying it after a known line is written behind it, in this process and the next', () => {
    aDecision();
    expect(mnema('status').status).toBe(0);
    newerWrites();
    expect(mnema('status').out).toContain(OF_THE_RECORD);
    // A line this binary reads, appended after the unread one: the catch-up now folds an arrival
    // and must carry what it already knew of the line it read past.
    anotherRecord();
    expect(mnema('status').out).toContain(OF_THE_RECORD);
    expect(JSON.parse(mnema('status', '--json').out).newerLines.lines).toBe(1);
  });

  it('counts each line and each kind, and names no more than three kinds', () => {
    aDecision();
    for (const kind of [FUTURE, 'x.second', 'x.third', 'x.fourth', 'x.second'])
      newerWrites({ kind });
    const status = mnema('status');
    expect(status.out).toContain(
      'A newer mnema wrote 5 lines into this record (1 of "x.from-the-future", 2 of "x.second", ' +
        '1 of "x.third", and 1 more kinds) that this one does not read or apply',
    );
    expect(JSON.parse(mnema('status', '--json').out).newerLines).toEqual({
      lines: 5,
      kinds: [
        { kind: FUTURE, lines: 1 },
        { kind: 'x.second', lines: 2 },
        { kind: 'x.third', lines: 1 },
        { kind: 'x.fourth', lines: 1 },
      ],
    });
  });

  it('says so in the brief on the error stream, and never in the document', () => {
    aDecision();
    newerWrites();
    const document = mnema('brief');
    expect(document.status, document.err).toBe(0);
    expect(document.out).not.toContain('newer mnema');
    expect(document.err).toContain(OF_THE_RECORD);

    const hook = mnema('brief', '--hook');
    expect(hook.status, hook.err).toBe(0);
    expect(hook.out).not.toContain('newer mnema');
    expect(hook.err).toContain(OF_THE_RECORD);
  });

  it('says so in show for the record the line names, and for no other', () => {
    const id = aDecision();
    const otherId = anotherRecord();
    const before = mnema('show', id).out;
    newerWrites({ subject: id });

    const shown = mnema('show', id);
    expect(shown.status, shown.err).toBe(0);
    expect(shown.out).toBe(before);
    expect(shown.err).toContain(ABOUT_THIS_ONE);
    const asJson = mnema('show', id, '--json');
    expect(JSON.parse(asJson.out).id).toBe(id);
    expect(asJson.err).toContain(ABOUT_THIS_ONE);

    expect(mnema('show', otherId).err).not.toContain('newer mnema');
  });

  it('says so in show for a memory too, which is read over every tree and not the first', () => {
    aDecision();
    const memoryId = anotherRecord();
    newerWrites({ subject: memoryId });
    const shown = mnema('show', memoryId);
    expect(shown.status, shown.err).toBe(0);
    expect(shown.err).toContain(ABOUT_THIS_ONE);
  });

  it('says so in the finding of doctor, and in nothing else of its checklist', () => {
    aDecision();
    newerWrites();
    const doctor = mnema('doctor');
    expect(doctor.status, `${doctor.out}${doctor.err}`).toBe(0);
    expect(doctor.out.split('\n').filter((line) => line.includes('newer-mnema'))).toEqual([
      `to do · newer-mnema: ${OF_THE_RECORD}`,
    ]);
  });

  it('is said by bootstrap and by read_record to the agent, beside the payload', async () => {
    const id = aDecision();
    const otherId = anotherRecord();
    newerWrites({ subject: id });
    const tools = await theTools(id, otherId);
    expect(tools.bootstrap).toContain(OF_THE_RECORD);
    expect(JSON.parse(tools.bootstrap?.[0] as string).newerLines).toEqual({
      lines: 1,
      kinds: [{ kind: FUTURE, lines: 1 }],
    });
    expect(tools.read_record).toContain(ABOUT_THIS_ONE);
    expect(tools.read_another?.join('\n')).not.toContain('newer mnema');
  });
});

describe('a record no newer mnema wrote into', { timeout: 120_000 }, () => {
  it('is told nothing new by any surface', async () => {
    const id = aDecision();
    for (const argv of [
      ['status'],
      ['status', '--json'],
      ['brief'],
      ['brief', '--hook'],
      ['show', id],
      ['show', id, '--json'],
      ['doctor'],
    ]) {
      const ran = mnema(...argv);
      expect(`${ran.out}${ran.err}`, argv.join(' ')).not.toMatch(/newer.mnema/);
    }
    expect(JSON.parse(mnema('status', '--json').out)).not.toHaveProperty('newerLines');
    const tools = await theTools(id, id);
    expect(JSON.stringify(tools)).not.toMatch(/newer.mnema|newerLines/);
  });
});
