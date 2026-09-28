/**
 * A write that founds an identity where others already were says so — once, where somebody reads
 * it, on every path that can found.
 *
 * WHAT WAS WRONG. The founding was silent. A key's first write into a tree that already held other
 * identities founded one of its own, and the answer was "Captured memory … Landed in the public
 * tree" and nothing else; `status` said nothing, `verify` was clean, and only `accountability`
 * counted "2 author(s)". After that write the two authors of that tree cannot be joined, so the
 * only moment to say it is the moment it happens — and what it can still save is the person's
 * other trees.
 *
 * WHAT IS ASSERTED, each beside the silence that must stay a silence:
 *
 *   - the command line says it on stderr after the answer — and says nothing for the first founding
 *     of a tree, nothing for the key's next write, and nothing for a machine that joined by the
 *     handshake the page describes, which adopts and does not found;
 *   - a tree kept on one machine gets the words for that: the identity beside it was written from
 *     here too;
 *   - what the sentence tells the person to do works when it is done to the letter, between two
 *     projects with a remote each — and the enrollment the OLD words led to, in the project that
 *     split, spares nothing and leaves a fresh clone of it refusing the key;
 *   - it is said again, and stays true, where the key takes up a founding of its own;
 *   - the server says it in the reply of the call whose write founded;
 *   - the hook — the path nobody asked for — says it in the one field of its reply the host hands
 *     the agent;
 *   - and `accountability` names, beside the author, where and when that identity was founded —
 *     in the line and in `--json`, from one reading;
 *   - and so does the account the AGENT reads, `audit_accountability`, which carried none of it:
 *     the same marks beside the same authors, from the same selection.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { DiscoveryEnv } from '@mnema/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildMcpServer } from '../src/mcp/server.js';
import { closeSession, openSession } from '../src/mcp/session.js';
import { runRulesBeforeAnEditTool } from '../src/mcp/tools.js';

/** The built binary — what a person runs. */
const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

/** The words every founding sentence starts with — `a-new-identity.ts`. */
const FOUNDED = 'This key founded an identity of its own';

let sandbox: string;
let repo: string;
/** Two keys: two homes, each its own `~/.mnema`. */
let homeA: string;
let homeB: string;
/** A home that writes nothing — the one the counts are read as, so no key of the case is asked. */
let auditor: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-says-what-it-founded-'));
  repo = join(sandbox, 'repo');
  homeA = join(sandbox, 'home-a');
  homeB = join(sandbox, 'home-b');
  auditor = join(sandbox, 'home-auditor');
  for (const dir of [repo, homeA, homeB, auditor]) mkdirSync(dir, { recursive: true });
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** `mnema <argv>` in `dir`, as the key under `home`. */
function mnemaIn(
  dir: string,
  home: string,
  ...argv: string[]
): { status: number | null; stdout: string; stderr: string } {
  const ran = spawnSync(process.execPath, [CLI, ...argv], {
    cwd: dir,
    encoding: 'utf-8',
    env: { PATH: process.env.PATH ?? '', HOME: home },
  });
  return { status: ran.status, stdout: ran.stdout, stderr: ran.stderr };
}

/** `mnema <argv>` in the repository, as the key under `home`. */
function mnema(
  home: string,
  ...argv: string[]
): { status: number | null; stdout: string; stderr: string } {
  return mnemaIn(repo, home, ...argv);
}

/** How many authors the record at `dir` counts, read as a home that wrote nothing. */
function authors(dir: string): string {
  const said = mnemaIn(dir, auditor, 'accountability');
  expect(said.status, said.stderr).toBe(0);
  return /\d+ author\(s\)/.exec(said.stdout)?.[0] ?? `no count in: ${said.stdout}`;
}

/**
 * How many `identity.founded` the record at `dir` holds, counted in the stored lines themselves —
 * not asked of the product whose sentence the count is there to check.
 */
function foundingsIn(dir: string): number {
  const tails = join(dir, '.mnema', 'tails');
  let count = 0;
  for (const tail of readdirSync(tails)) {
    for (const segment of readdirSync(join(tails, tail)).filter((one) =>
      /^\d+\.jsonl$/.test(one),
    )) {
      const lines = readFileSync(join(tails, tail, segment), 'utf-8').split('\n');
      count += lines.filter((line) => line.includes('"kind":"identity.founded"')).length;
    }
  }
  return count;
}

/** The founding sentences in a stream, one per line. */
function founded(stream: string): string[] {
  return stream.split('\n').filter((line) => line.includes(FOUNDED));
}

describe('the command line says it on stderr, once, after the answer', () => {
  it('for a key whose first write founds beside another identity — and names both', () => {
    expect(founded(mnema(homeA, 'init').stderr)).toEqual([]);
    const second = mnema(homeB, 'memory', 'from a key nobody vouched for');
    expect(second.status).toBe(0);
    expect(second.stdout).toContain('Landed in the public tree');
    expect(founded(second.stdout)).toEqual([]);
    const said = founded(second.stderr);
    expect(said).toHaveLength(1);
    expect(said[0]).toContain('in the public tree');
    expect(said[0]).toContain('beside 1 already there (mnid:');
    expect(said[0]).toContain(
      'If you are new to this record, this is how everyone after the first',
    );
    expect(said[0]).toMatch(/`mnema key request --anchor mnid:[0-9a-f]+` here/);

    // Said once: the key's next write founds nothing, and says nothing.
    expect(founded(mnema(homeB, 'memory', 'the same key again').stderr)).toEqual([]);
  }, 60_000);

  it('says nothing for a machine that joined by the handshake — it adopts, and founds nothing', () => {
    expect(mnema(homeA, 'init').status).toBe(0);
    const who = /(mnid:[0-9a-f]+)/.exec(mnema(homeA, 'accountability').stdout)?.[1] as string;
    const request = mnema(homeB, 'key', 'request', '--anchor', who);
    expect(request.status, request.stderr).toBe(0);
    const line = request.stdout.split('\n').find((one) => one.startsWith('mnema-key-request:'));
    expect(line).toBeDefined();
    expect(mnema(homeA, 'key', 'enroll', line as string).status).toBe(0);

    const joined = mnema(homeB, 'memory', 'first note from the laptop');
    expect(joined.status).toBe(0);
    expect(founded(joined.stderr)).toEqual([]);
    expect(mnema(homeA, 'accountability').stdout).toContain('1 author(s)');
  }, 60_000);

  it('gives a tree kept on one machine its own words — the identity beside it was written from here', () => {
    expect(mnema(homeA, 'init').status).toBe(0);
    expect(mnema(homeA, 'memory', 'a note of mine', '--scope', 'private').status).toBe(0);
    const said = founded(mnema(homeB, 'memory', 'mine too', '--scope', 'private').stderr);
    expect(said).toHaveLength(1);
    expect(said[0]).toContain('in the private tree');
    expect(said[0]).toContain('kept on this machine alone');
    expect(said[0]).toContain('— under another key —');
    expect(said[0]).not.toContain('on another machine');
  }, 60_000);
});

describe('what the sentence says to do, done to the letter, spares the other projects', () => {
  /**
   * `git <args>` in `dir`, with a home of the sandbox's and no configuration of the machine's — so a
   * signing key, an identity or a default somebody set there cannot reach the case.
   */
  function git(dir: string, ...args: string[]): string {
    const ran = spawnSync(
      'git',
      [
        '-c',
        'user.name=mnema test',
        '-c',
        'user.email=test@example.invalid',
        '-c',
        'commit.gpgsign=false',
        ...args,
      ],
      {
        cwd: dir,
        encoding: 'utf-8',
        env: { PATH: process.env.PATH ?? '', HOME: join(sandbox, 'git'), GIT_CONFIG_NOSYSTEM: '1' },
      },
    );
    if (ran.status !== 0) throw new Error(`setup: git ${args.join(' ')} in ${dir}: ${ran.stderr}`);
    return ran.stdout;
  }

  /** One project two machines work in, the way a team's does: through a remote. */
  interface Shared {
    readonly remote: string;
    /** The clone on the machine already in the identity — the first key's, where it was founded. */
    readonly a: string;
    /** The clone on the machine whose key has not written there yet. */
    readonly b: string;
  }

  /** A project the first key founds, shared, and cloned by the machine of the second. */
  function sharedProject(name: string): Shared {
    const remote = join(sandbox, 'remotes', `${name}.git`);
    const a = join(sandbox, 'machine-a', name);
    const b = join(sandbox, 'machine-b', name);
    for (const dir of [a, join(sandbox, 'remotes'), join(sandbox, 'machine-b')]) {
      mkdirSync(dir, { recursive: true });
    }
    git(a, 'init', '-q');
    expect(mnemaIn(a, homeA, 'init').status).toBe(0);
    git(a, 'add', '-A');
    git(a, 'commit', '-q', '-m', 'found the record');
    git(sandbox, 'clone', '-q', '--bare', a, remote);
    git(a, 'remote', 'add', 'origin', remote);
    git(a, 'push', '-q', '-u', 'origin', 'HEAD');
    git(sandbox, 'clone', '-q', remote, b);
    return { remote, a, b };
  }

  /** Commits what the record holds in `dir`, and pushes it. */
  function share(dir: string): void {
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '--allow-empty', '-m', 'share the record');
    git(dir, 'push', '-q');
  }

  /** Brings what was pushed into `dir`. */
  function pull(dir: string): void {
    git(dir, 'pull', '-q', '--ff-only');
  }

  /** The one founding sentence a write said on stderr. */
  function theSentence(said: { status: number | null; stderr: string }): string {
    expect(said.status, said.stderr).toBe(0);
    const sentences = founded(said.stderr);
    expect(sentences).toHaveLength(1);
    return sentences[0] as string;
  }

  /** Runs the request the sentence names, where it names it, and returns the line it printed. */
  function requestAsTheSentenceSays(sentence: string, here: string): string {
    const request = /`(mnema key request --anchor [^`]+)` here/.exec(sentence)?.[1];
    expect(request, `the sentence names no request to run here: ${sentence}`).toBeDefined();
    const asked = mnemaIn(here, homeB, ...(request as string).split(' ').slice(1));
    expect(asked.status, asked.stderr).toBe(0);
    const line = asked.stdout.split('\n').find((one) => one.startsWith('mnema-key-request:'));
    expect(line).toBeDefined();
    return line as string;
  }

  /**
   * Does what the sentence tells the second key's person to do — every command it names, where it
   * names it, and nothing it does not say — for a person whose other project is `next`.
   *
   * THE PLACES ARE READ OFF THE WORDS. The place the sentence gives `mnema key enroll` is looked up
   * here, and one this does not know fails the case by name, so whoever changes the words has to
   * come here and say where they now send the person. `wherever its key is` stays in the table: it
   * is the old words, read as the measurement read them — the machine that holds that identity's
   * key runs it where it stands, which is the project that split — so that putting them back
   * turns this case red on what they lead to, and not on a string.
   */
  function followTheSentence(sentence: string, split: Shared, next: Shared): void {
    const line = requestAsTheSentenceSays(sentence, split.b);
    const places: Readonly<Record<string, readonly string[]>> = {
      'inside each of those projects': [next.a],
      'wherever its key is': [split.a],
    };
    const place = Object.keys(places).find((one) =>
      new RegExp(`\`mnema key enroll[^\`]*\` ${one}`).test(sentence),
    );
    expect(
      place,
      `the sentence sends the enrollment where this case cannot follow: ${sentence}`,
    ).toBeDefined();
    for (const dir of places[place as string] as readonly string[]) {
      const vouched = mnemaIn(dir, homeA, 'key', 'enroll', line);
      expect(vouched.status, vouched.stderr).toBe(0);
      if (sentence.includes('commits and shares the record')) share(dir);
    }
    if (sentence.includes('pull it here before this key writes there')) pull(next.b);
  }

  it('followed to the letter, leaves the next project counting the person once', () => {
    const split = sharedProject('split');
    const next = sharedProject('next');
    const sentence = theSentence(mnemaIn(split.b, homeB, 'memory', 'before anyone vouched'));

    followTheSentence(sentence, split, next);

    const first = mnemaIn(next.b, homeB, 'memory', 'the first note in the next project');
    expect(first.status, first.stderr).toBe(0);
    expect(founded(first.stderr)).toEqual([]);
    expect(authors(next.b)).toBe('1 author(s)');
  }, 60_000);

  it('enrolled where the old words led — the project that split — spares nothing, and a fresh clone of it refuses the key', () => {
    const split = sharedProject('split');
    const next = sharedProject('next');
    const sentence = theSentence(mnemaIn(split.b, homeB, 'memory', 'before anyone vouched'));
    share(split.b);
    const line = requestAsTheSentenceSays(sentence, split.b);
    // The machine already in the identity vouches where it stands: the project that split.
    pull(split.a);
    expect(mnemaIn(split.a, homeA, 'key', 'enroll', line).status).toBe(0);
    share(split.a);

    // The next project founds again: the vouch landed in the record of the one that split.
    pull(next.b);
    const nextWrite = mnemaIn(next.b, homeB, 'memory', 'the first note in the next project');
    expect(founded(nextWrite.stderr)).toHaveLength(1);
    expect(authors(next.b)).toBe('2 author(s)');

    // An enrollment alone joins nothing in the one that split: the installation that founded
    // speaks as it did.
    pull(split.b);
    expect(mnemaIn(split.b, homeB, 'memory', 'again, where it founded').status).toBe(0);
    expect(authors(split.b)).toBe('2 author(s)');

    // And the record now proves the key a member of two identities, so a fresh clone refuses it
    // rather than choose — and writes nothing.
    const fresh = join(sandbox, 'machine-b', 'split-again');
    git(sandbox, 'clone', '-q', split.remote, fresh);
    const refused = mnemaIn(fresh, homeB, 'memory', 'from a fresh clone');
    expect(refused.status).not.toBe(0);
    expect(refused.stderr).toContain('Refused (AMBIGUOUS_MEMBERSHIP)');
    expect(authors(fresh)).toBe('2 author(s)');
  }, 60_000);

  it('is said again, and stays true, where the key takes up a founding of its own — nothing founded', () => {
    const split = sharedProject('split');
    theSentence(mnemaIn(split.b, homeB, 'memory', 'before anyone vouched'));
    share(split.b);
    const before = foundingsIn(split.b);
    expect(before).toBe(2);

    // A fresh clone, the same key: its anchor is settled by adopting its own founding.
    const clone = join(sandbox, 'machine-b', 'split-again');
    git(sandbox, 'clone', '-q', split.remote, clone);
    const again = theSentence(mnemaIn(clone, homeB, 'memory', 'from a fresh clone'));
    expect(again).toMatch(/^This key founded an identity of its own in the public tree/);
    expect(foundingsIn(clone)).toBe(before);

    // A restore of that key into a key root that held none, in another fresh clone.
    const restored = join(sandbox, 'machine-c', 'split');
    mkdirSync(join(sandbox, 'machine-c'), { recursive: true });
    git(sandbox, 'clone', '-q', split.remote, restored);
    const keys = join(homeB, '.mnema', 'identity', 'keys');
    const key = readdirSync(keys).find((one) => one.endsWith('.key'));
    expect(key).toBeDefined();
    const homeC = join(sandbox, 'home-c');
    theSentence(mnemaIn(restored, homeC, 'key', 'restore', join(keys, key as string)));
    expect(foundingsIn(restored)).toBe(before);
  }, 60_000);

  it('in a tree kept on one machine, no enrollment reaches it — the public tree it names is spared', () => {
    // One machine, two keys: one working copy, as for a key root that moved.
    expect(mnema(homeA, 'init').status).toBe(0);
    expect(mnema(homeA, 'memory', 'a note of mine', '--scope', 'private').status).toBe(0);
    const other = join(sandbox, 'other');
    mkdirSync(other, { recursive: true });
    expect(mnemaIn(other, homeA, 'init').status).toBe(0);
    expect(mnemaIn(other, homeA, 'memory', 'and one here', '--scope', 'private').status).toBe(0);

    const sentence = theSentence(mnema(homeB, 'memory', 'mine too', '--scope', 'private'));
    expect(sentence).toContain('in the private tree');
    expect(sentence).toContain('the public trees of your projects, this one’s included,');
    const line = requestAsTheSentenceSays(sentence, repo);
    // The machine already in the identity is this one, under the key it wrote with; it enrolls
    // inside each of the projects — this one included.
    for (const dir of [repo, other]) {
      expect(mnemaIn(dir, homeA, 'key', 'enroll', line).status).toBe(0);
    }

    // The public trees are spared: the first public write adopts, and says nothing.
    for (const dir of [repo, other]) {
      const wrote = mnemaIn(dir, homeB, 'memory', 'a public note');
      expect(wrote.status, wrote.stderr).toBe(0);
      expect(founded(wrote.stderr)).toEqual([]);
    }
    // The private tree of the other project is not: no enrollment reaches it.
    const kept = theSentence(
      mnemaIn(other, homeB, 'memory', 'a private one', '--scope', 'private'),
    );
    expect(kept).toContain('in the private tree');
  }, 60_000);
});

describe('the server says it where the agent reads', () => {
  /** A server for the key under `home`, a client whose workspace is the repository. */
  async function connected(home: string): Promise<Client> {
    const env: DiscoveryEnv = { home };
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

  /** Every text block of a tool's reply. */
  function blocks(reply: unknown): string[] {
    return ((reply as { content?: { type: string; text: string }[] }).content ?? []).map(
      (one) => one.text,
    );
  }

  it('in the reply of the call whose write founded — and in none after it', async () => {
    expect(mnema(homeA, 'init').status).toBe(0);
    const client = await connected(homeB);
    const first = blocks(
      await client.callTool({
        name: 'capture_memory',
        arguments: { content: 'from the agent, under another key', scope: 'public' },
      }),
    );
    expect(first[0]).toMatch(/^Captured memory /);
    expect(first.filter((block) => block.includes(FOUNDED))).toHaveLength(1);

    const next = blocks(
      await client.callTool({
        name: 'capture_memory',
        arguments: { content: 'and again', scope: 'public' },
      }),
    );
    expect(next.filter((block) => block.includes(FOUNDED))).toEqual([]);
    await client.close();
  });

  it('in the refusal of a first write, which founded on its way in — and the refusal says only the fact did not land', async () => {
    // The run opens before the operation decides (`ensureRun`), so a key's first write into a
    // tree founds there even when the operation then refuses. The refusal used to be composed
    // by hand and asked the session nothing: the sentence waited for a next reply, and a
    // connection that closed right after never heard it. And the refusal said "Nothing was
    // recorded" with the founding and the run's start on the tail.
    expect(mnema(homeA, 'init').status).toBe(0);
    expect(foundingsIn(repo)).toBe(1);
    const client = await connected(homeB);
    const reply = await client.callTool({
      name: 'capture_memory',
      arguments: { content: 'x'.repeat(70_000), scope: 'public' },
    });
    await client.close();

    expect((reply as { isError?: boolean }).isError).toBe(true);
    const said = blocks(reply);
    expect(said[0]).toMatch(/^Refused \(CONTENT_TOO_LARGE\): /);
    // What was written is read off the disk, not off the reply: B's founding is there.
    expect(foundingsIn(repo)).toBe(2);
    expect(said.filter((block) => block.includes(FOUNDED))).toHaveLength(1);
    // And the words are true beside it: the fact did not land, which is all the door knows.
    expect(said[0]).toContain('The fact was not recorded');
    expect(said.join('\n')).not.toMatch(/nothing was recorded/i);
  });

  it('in the hook’s additionalContext — the path nobody asked for, whose prose the host drops', async () => {
    // A rule in force at a path, so the hook speaks and writes; the first key's session writes
    // there before the second one's does.
    expect(mnema(homeA, 'init').status).toBe(0);
    // The id in the parentheses of the echo, never the `ADR-<n>` in front of it.
    const rule = /\(([0-9a-f-]{20,})\)/.exec(
      mnema(homeA, 'decision', 'lay it out', 'why').stdout,
    )?.[1];
    expect(rule).toBeDefined();
    expect(
      mnema(homeA, 'decision', 'move', 'accept', rule as string, '--note', 'agreed').status,
    ).toBe(0);
    expect(mnema(homeA, 'link', rule as string, 'src', '--rel', 'governs').status).toBe(0);

    const edit = { path: 'src/a.ts' };
    const roots = [pathToFileURL(repo).href];
    const asA = openSession({ clientName: 'claude-code', roots, env: { home: homeA } });
    const first = runRulesBeforeAnEditTool(asA, edit);
    closeSession(asA);
    expect(first.ok).toBe(true);
    expect(JSON.stringify(first.ok ? first.value : {})).not.toContain(FOUNDED);

    const asB = openSession({ clientName: 'claude-code', roots, env: { home: homeB } });
    const reply = runRulesBeforeAnEditTool(asB, edit);
    closeSession(asB);
    expect(reply.ok).toBe(true);
    const output = reply.ok ? reply.value.hookSpecificOutput : undefined;
    expect(output?.additionalContext).toContain('lay it out');
    expect(output?.additionalContext).toContain(FOUNDED);
  });
});

describe('accountability names it, whenever somebody asks', () => {
  it('beside the author whose identity was founded where another already was', () => {
    expect(mnema(homeA, 'init').status).toBe(0);
    expect(mnema(homeB, 'memory', 'second').status).toBe(0);
    const lines = mnema(homeA, 'accountability').stdout.split('\n');
    expect(lines[0]).toContain('2 author(s)');
    const marked = lines.filter((line) => line.includes('founded beside'));
    expect(marked).toHaveLength(1);
    expect(marked[0]).toContain('founded beside 1 other(s) in the public tree');
  }, 60_000);

  it('and in --json, from the same reading: the tree, the instant, and who was already there', () => {
    expect(mnema(homeA, 'init').status).toBe(0);
    expect(mnema(homeB, 'memory', 'second').status).toBe(0);
    const account = JSON.parse(mnema(homeA, 'accountability', '--json').stdout) as {
      byWho: {
        who: string;
        foundedBeside: { scope: string; at: string; besides: string[] }[];
      }[];
    };
    expect(account.byWho).toHaveLength(2);
    const [second] = account.byWho.filter((one) => one.foundedBeside.length > 0);
    const [first] = account.byWho.filter((one) => one.foundedBeside.length === 0);
    // Present for both, and empty for the one that founded first: "none" is said, not left out.
    expect(first?.foundedBeside).toEqual([]);
    expect(second?.foundedBeside).toEqual([
      { scope: 'public', at: expect.stringMatching(/^\d{4}-\d\d-\d\dT/), besides: [first?.who] },
    ]);

    // The line says the same thing beside the same author.
    const mark = second?.foundedBeside[0];
    const line = mnema(homeA, 'accountability')
      .stdout.split('\n')
      .find((one) => one.includes('founded beside'));
    expect(line).toContain(`founded beside 1 other(s) in the public tree, ${mark?.at}`);
    const shortForm = line?.trim().split(/\s+/)[0] as string;
    expect(second?.who.startsWith(shortForm), `${shortForm} is not ${second?.who}`).toBe(true);
  }, 60_000);

  it('and in the account the agent reads, the same marks beside the same authors', async () => {
    // The third reading of the account. It is decomposed by record, so the entry to read is the
    // project's; the command line folds the machine-global tree in too, and neither home here has
    // written there, so the two accounts name the same authors and must carry the same marks.
    expect(mnema(homeA, 'init').status).toBe(0);
    expect(mnema(homeB, 'memory', 'second').status).toBe(0);
    type Mark = { scope: string; at: string; besides: string[] };
    type Author = { who: string; foundedBeside: Mark[] };

    const { server } = buildMcpServer({ cwd: sandbox, env: { home: auditor }, log: () => {} });
    const client = new Client(
      { name: 'claude-code', version: '1.0.0' },
      { capabilities: { roots: {} } },
    );
    client.setRequestHandler(ListRootsRequestSchema, () => ({
      roots: [{ uri: pathToFileURL(repo).href }],
    }));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    const reply = (await client.callTool({ name: 'audit_accountability', arguments: {} })) as {
      isError?: boolean;
      content: { text: string }[];
    };
    await client.close();
    expect(reply.isError).not.toBe(true);
    const served = JSON.parse(reply.content[0]?.text as string) as {
      byProject: { project?: string; byWho: Author[] }[];
    };
    const agents = served.byProject.find((entry) => entry.project === repo)?.byWho ?? [];

    const printed = (
      JSON.parse(mnema(auditor, 'accountability', '--json').stdout) as { byWho: Author[] }
    ).byWho;
    const marks = (authors: Author[]) =>
      authors
        .map(({ who, foundedBeside }) => ({ who, foundedBeside }))
        .sort((a, b) => a.who.localeCompare(b.who));

    // One author founded beside the other — and the agent is told so, not only the person.
    expect(agents.filter((one) => one.foundedBeside.length > 0)).toHaveLength(1);
    expect(agents.filter((one) => one.foundedBeside.length === 0)).toHaveLength(1);
    expect(marks(agents)).toEqual(marks(printed));
  }, 60_000);
});
