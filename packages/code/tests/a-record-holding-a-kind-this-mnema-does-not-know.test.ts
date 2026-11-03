/**
 * A RECORD HOLDING A LINE OF A KIND THIS MNEMA DOES NOT KNOW IS STILL READ, BY EVERY SURFACE
 * (ADR-113).
 *
 * The record is written by this binary: an identity, a decision, a note. Then a line of a kind no
 * version declares is appended to its tail as a newer mnema on the same machine would write it:
 * chained, signed under a checkpoint by the same key, and its head kept as the writer keeps one.
 * Before ADR-113 every surface refused the whole record over that line. Now `verify` reads it past
 * and names it, both readers verify it, and the surfaces that project the record (status, show,
 * search, brief, site, doctor) serve what they served before, the line left out of what they say.
 * The writer appends after it on the same tail and signs a checkpoint over it, and the record still
 * verifies. Naming the line in those surfaces is a later change: here they only stay correct.
 */

import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  type CanonicalValue,
  canonicalStringify,
  catalogUpcasters,
  checkpointHash,
  entryHash,
  listTails,
  loadOrCreateKeyPair,
  readTailCheckpoints,
  readTailEntries,
  serializeCheckpoint,
  signCheckpoint,
  writtenAsStored,
} from '@mnema/chain';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildMcpServer } from '../src/mcp/server.js';
import { GIT_WITHOUT_MAINTENANCE } from './support/git-without-maintenance.js';

const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const SECOND_READER = fileURLToPath(
  new URL('../../chain/verifier/mnema_verify.py', import.meta.url),
);

/** The kind no version declares (`x.from-the-future`, reserved by `FORMAT.md` section 7.1). */
const FUTURE = 'x.from-the-future';

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

const record = () => join(repo, '.mnema');

/**
 * Appends one line of `FUTURE` to the record's one tail, as a newer mnema on this machine writes
 * it: chained after the tail's last line, covered by a checkpoint its key signs under the scheme
 * and record name the tail's last checkpoint carries, and its head kept where the writer keeps it.
 */
function aNewerMnemaWrites(payload: Readonly<Record<string, CanonicalValue>>): string {
  const [tail, ...others] = listTails({ root: record() });
  if (tail === undefined || others.length > 0) throw new Error('setup: not one tail');
  const entries = readTailEntries({ root: record() }, tail, catalogUpcasters());
  const last = entries.at(-1);
  if (last === undefined) throw new Error('setup: an empty tail');
  const keyPair = loadOrCreateKeyPair({ root: join(home, '.mnema', 'identity') });
  const event = {
    v: 1,
    kind: FUTURE,
    at: new Date(Date.parse(last.event.at) + 1000).toISOString(),
    who: last.event.who,
    signerFp: keyPair.fingerprint,
    subject: 'something-new',
    payload,
  };
  const seq = last.link.seq + 1;
  const hash = entryHash({ event: writtenAsStored(event), tail, seq, prev: last.link.hash });
  const segment = join(record(), 'tails', tail, '000001.jsonl');
  appendFileSync(
    segment,
    `${canonicalStringify({ event, link: { tail, seq, prev: last.link.hash, hash } })}\n`,
  );
  const checkpoints = readTailCheckpoints({ root: record() }, tail);
  const previous = checkpoints.at(-1);
  if (previous === undefined || previous.toSeq !== last.link.seq) {
    throw new Error('setup: the tail is not covered to its end');
  }
  const signed = signCheckpoint({
    tail,
    fromSeq: seq,
    events: [writtenAsStored(event)],
    prev: checkpointHash(previous),
    keyPair,
    ...(previous.record !== undefined ? { record: previous.record } : {}),
  });
  appendFileSync(
    join(record(), 'tails', tail, 'checkpoints.jsonl'),
    `${serializeCheckpoint(signed)}\n`,
  );
  // The note of the last entry this installation wrote (`kept-head.ts`): a newer writer keeps it
  // as this one does, so the next write here continues this tail rather than starting another.
  const head = join(record(), 'locks', `${tail}.head`);
  if (!existsSync(head)) throw new Error(`setup: no kept head at ${head}`);
  writeFileSync(head, `${seq} ${hash}\n`);
  return tail;
}

function secondReading(): { verdict: string; findings: { section: string; what: string }[] } {
  const ran = spawnSync('python3', ['-I', SECOND_READER, '--json', 'record', record()], {
    encoding: 'utf-8',
  });
  if (ran.stdout === '') throw new Error(`the second reader produced no verdict: ${ran.stderr}`);
  return JSON.parse(ran.stdout);
}

/** What the agent's tools answer over the record, each by a client connected afresh. */
async function theTools(id: string): Promise<Record<string, string[]>> {
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
    search: await called('search', { query: 'Postgres' }),
    read_record: await called('read_record', { id }),
    governing_rules: await called('governing_rules', { path: 'src/db.ts' }),
  };
  await client.close();
  return answers;
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-unread-kind-'));
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
describe('a record a newer mnema added a kind to', { timeout: 120_000 }, () => {
  it('is verified by both readers, every line signed, the kind named once', () => {
    const decided = mnema('decision', 'record', 'Use Postgres', 'The team knows it.');
    expect(decided.status, decided.err).toBe(0);
    const tail = aNewerMnemaWrites({ means: 'something this mnema cannot know' });

    const verified = mnema('verify', '--json');
    expect(verified.status, verified.err).toBe(0);
    const result = JSON.parse(verified.out);
    const tree = (result.trees ?? [result])[0];
    const notes = JSON.stringify(tree);
    expect(notes).toContain('"kind":"unread-kind"');
    expect(notes).toContain(`"eventKind":"${FUTURE}"`);

    const said = mnema('verify');
    expect(said.status, said.err).toBe(0);
    expect(said.out).toContain(`census [unread-kind]`);
    expect(said.out).toContain(`1 line(s) of kind "${FUTURE}" in tail(s) ${tail}`);
    expect(said.out).toContain('1 kind(s) this reader does not know, checked and not read');

    const there = secondReading();
    expect(there.verdict).toBe('VERIFIED');
    expect(there.findings.filter((f) => f.section === '7.1').map((f) => f.what)).toEqual([
      expect.stringContaining(`1 line(s) of kind "${FUTURE}" in tail(s) ${tail}`),
    ]);
  });

  it('is served by status, show, search, brief, site and doctor as it was before the line', () => {
    const decided = mnema('decision', 'record', 'Use Postgres', 'The team knows it.');
    expect(decided.status, decided.err).toBe(0);
    const id = /([0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12})/.exec(
      `${decided.out}${decided.err}`,
    )?.[1];
    expect(id, decided.out).toBeDefined();
    const before = {
      status: mnema('status').out,
      show: mnema('show', id as string).out,
      search: mnema('search', 'Postgres').out,
      brief: mnema('brief').out,
    };

    aNewerMnemaWrites({ title: 'Use MongoDB', supersedes: id as string });

    const status = mnema('status');
    expect(status.status, status.err).toBe(0);
    // The line is an event, and where no commit holds it yet the screen counts it under its own
    // heading (`events-not-in-git.ts`); the reading above that heading is what must not move.
    const reading = (screen: string) => screen.split('\nNot in git yet:')[0];
    expect(reading(status.out)).toBe(reading(before.status));
    const show = mnema('show', id as string);
    expect(show.status, show.err).toBe(0);
    expect(show.out).toBe(before.show);
    const search = mnema('search', 'Postgres');
    expect(search.status, search.err).toBe(0);
    expect(search.out).toBe(before.search);
    const brief = mnema('brief');
    expect(brief.status, brief.err).toBe(0);
    expect(brief.out).toBe(before.brief);
    expect(brief.out).not.toContain('MongoDB');
    // Nothing of the line is served as a fact: its payload is not read.
    expect(mnema('search', 'MongoDB').out).toBe('Nothing recorded matching "MongoDB".\n');

    const site = mnema('site', '--out', join(sandbox, 'site'));
    expect(site.status, site.err).toBe(0);
    expect(readFileSync(join(sandbox, 'site', 'index.html'), 'utf-8')).toContain('Use Postgres');

    const doctor = mnema('doctor');
    expect(doctor.status, `${doctor.out}${doctor.err}`).toBe(0);
  });

  it('is served by the agent tools as it was before the line', async () => {
    const decided = mnema('decision', 'record', 'Use Postgres', 'The team knows it.');
    expect(decided.status, decided.err).toBe(0);
    const id = /([0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12})/.exec(
      `${decided.out}${decided.err}`,
    )?.[1] as string;
    const before = await theTools(id);
    expect(JSON.stringify(before.search)).toContain('Use Postgres');
    aNewerMnemaWrites({ title: 'Use MongoDB', supersedes: id });
    expect(await theTools(id)).toEqual(before);
  });

  it('arrives in a commit that verify --since holds to the base, and passes', () => {
    const vcs = (...args: string[]) =>
      spawnSync('git', args, {
        cwd: repo,
        env: { ...ENV(), GIT_CONFIG_GLOBAL: GIT_WITHOUT_MAINTENANCE },
        encoding: 'utf-8',
      });
    expect(mnema('decision', 'record', 'Use Postgres', 'The team knows it.').status).toBe(0);
    expect(vcs('add', '.mnema').status).toBe(0);
    expect(vcs('commit', '-qm', 'the record').status).toBe(0);
    const base = vcs('rev-parse', 'HEAD').stdout.trim();
    aNewerMnemaWrites({ means: 'something' });
    expect(vcs('add', '.mnema').status).toBe(0);
    expect(vcs('commit', '-qm', 'a newer mnema wrote').status).toBe(0);

    const since = mnema('verify', '--since', base);
    expect(since.status, `${since.out}${since.err}`).toBe(0);
  });

  it('is written to after the line on the same tail, signed, and still verifies', () => {
    expect(mnema('decision', 'record', 'Use Postgres', 'The team knows it.').status).toBe(0);
    const tail = aNewerMnemaWrites({ means: 'something' });

    const wrote = mnema('memory', 'Written after the newer line.');
    expect(wrote.status, wrote.err).toBe(0);
    // The same tail, one line longer, every line covered: the writer chained after the line and
    // its checkpoint signed over it.
    expect(listTails({ root: record() })).toEqual([tail]);
    const entries = readTailEntries({ root: record() }, tail, catalogUpcasters());
    const at = entries.findIndex((entry) => entry.event.kind === FUTURE);
    const unread = entries[at];
    const next = entries[at + 1];
    expect(unread).toBeDefined();
    // The writer chained the next line onto the unread one: its `prev` is that line's hash.
    expect(next?.link.seq).toBe((unread?.link.seq ?? -2) + 1);
    expect(next?.link.prev).toBe(unread?.link.hash);
    const verified = mnema('verify', '--require', 'signed');
    expect(verified.status, `${verified.out}${verified.err}`).toBe(0);
    expect(secondReading().verdict).toBe('VERIFIED');
    expect(mnema('recall').out).toContain('Written after the newer line.');
  });
});
