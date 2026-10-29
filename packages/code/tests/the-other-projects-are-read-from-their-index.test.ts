/**
 * THE OTHER PROJECTS OF A WORKSPACE ARE ASKED FOR THEIR RUNS AND THEIR SWITCHES, AND ANSWER FROM A
 * FILE THE MACHINE KEEPS FOR THEM, UNDER ITS OWN HOME, WITHOUT BEING OPENED; THE ANSWER IS THE ONE
 * THE PROJECTION GIVES.
 *
 * A session's `resume`, `focus` and the resume inside `bootstrap` look for the actor's runs in
 * every project of the workspace (a run is the actor's wherever it was opened), and every call is
 * counted unless a tree switched the count off. Both used to open every project's projection.
 *
 * What is asserted, over the real transport on a workspace of three projects where the actor's
 * last run is in a project that is not the first:
 *
 *   - the answers with the files present are the answers with the files absent (the independent
 *     source: a connection that finds none and reads the trees), and the run found is the one in
 *     the OTHER project;
 *   - the files are what the answer is served from while the trees have not moved: a run planted
 *     in one of them shows, which a read of the tree could not produce;
 *   - a write by another connection moves the tree, and the next connection hears the truth and
 *     not the file;
 *   - nothing is written into a project the session does not serve, and a `locks/tree-index.json`
 *     a project carries (a clone can bring one) is never read, even one with a valid mark;
 *   - a file with rows that are not rows (`runs: [null]`) never breaks a tool: the tree is read;
 *   - a checkout that swaps the live segment for another of the same size is heard.
 */

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ensureTree } from '@mnema/chain';
import {
  chainRootForScope,
  type DiscoveryEnv,
  PROJECT_DIR,
  ProjectionCache,
  resolveTrees,
  treeIndexFile,
} from '@mnema/core';
import { switchChannel } from '@mnema/core/write';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCacheRegistry } from '../src/mcp/cache-registry.js';
import { buildMcpServer } from '../src/mcp/server.js';
import { writeContext } from '../src/mcp/session.js';
import { GIT_WITHOUT_MAINTENANCE } from './support/git-without-maintenance.js';

let sandbox: string;
let env: DiscoveryEnv;
let projects: string[];

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-other-projects-index-'));
  const home = join(sandbox, 'home');
  mkdirSync(home, { recursive: true });
  env = { home };
  projects = ['first', 'second', 'third'].map((name) => join(sandbox, name));
  for (const dir of projects) {
    mkdirSync(dir, { recursive: true });
    ensureTree({ root: join(dir, PROJECT_DIR) });
  }
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

async function connect(): Promise<Client> {
  const { server } = buildMcpServer({ cwd: sandbox, env, log: () => {} });
  const client = new Client(
    { name: 'claude-code', version: '1.0.0' },
    { capabilities: { roots: {} } },
  );
  client.setRequestHandler(ListRootsRequestSchema, () => ({
    roots: projects.map((dir) => ({ uri: pathToFileURL(dir).href, name: dir })),
  }));
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientSide), server.connect(serverSide)]);
  return client;
}

async function write(client: Client, project: string, title: string): Promise<void> {
  const wrote = await client.callTool({ name: 'create_task', arguments: { title, project } });
  expect(wrote.isError).not.toBe(true);
}

/** The three reads about the actor, without the two clocks an open run's age is read at. */
async function answers(client: Client): Promise<unknown> {
  const said: Record<string, unknown> = {};
  for (const name of ['resume', 'focus', 'bootstrap']) {
    const reply = await client.callTool({ name, arguments: {} });
    expect(reply.isError).not.toBe(true);
    const text = (reply.content as { text: string }[])[0]?.text as string;
    said[name] = JSON.parse(text);
  }
  const bootstrap = said.bootstrap as { resume: unknown };
  return JSON.parse(
    JSON.stringify(
      { resume: said.resume, focus: said.focus, bootstrap: bootstrap.resume },
      (key, value) => (key === 'ageSeconds' || key === 'idleSeconds' ? undefined : value),
    ),
  );
}

/** The mnema home of the sandbox's machine: where the index of every tree is kept. */
const dataDir = (): string => dirname(resolveTrees(projects[0] as string, env).global);

const indexOf = (dir: string): string => treeIndexFile(dataDir(), join(dir, PROJECT_DIR));

/** Every file under a directory with its size, to say a read left a project as it found it. */
function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const path = join(entry.parentPath, entry.name);
      return `${path}:${statSync(path).size}`;
    })
    .sort();
}

describe('the runs of the projects a session does not otherwise read', () => {
  it('are the same with the files as without them, and the last run is the one in the other project', async () => {
    const [, second, third] = projects as [string, string, string];
    const writer = await connect();
    await write(writer, third, 'work in the third project');
    await write(writer, second, 'work in the second project, later');
    await writer.close();

    const without = await connect();
    const expected = (await answers(without)) as { resume: { lastRun: { id: string } | null } };
    await without.close();
    expect(expected.resume.lastRun).not.toBeNull();

    // The files the connection above left are the ones the next serves from.
    expect(() => readFileSync(indexOf(second), 'utf8')).not.toThrow();
    expect(() => readFileSync(indexOf(third), 'utf8')).not.toThrow();
    const with_ = await connect();
    expect(await answers(with_)).toEqual(expected);
    await with_.close();

    rmSync(indexOf(second));
    rmSync(indexOf(third));
    const absent = await connect();
    expect(await answers(absent)).toEqual(expected);
    await absent.close();
  });

  it('are served from the file while the tree has not moved, and heard again once it has', async () => {
    const [, second] = projects as [string, string, string];
    const writer = await connect();
    await write(writer, second, 'work in the second project');
    await writer.close();

    const priming = await connect();
    await answers(priming);
    await priming.close();

    const path = indexOf(second);
    const kept = JSON.parse(readFileSync(path, 'utf8')) as {
      facts: { runs: { goal?: string }[] };
    };
    expect(kept.facts.runs).toHaveLength(1);
    kept.facts.runs[0] = { ...kept.facts.runs[0], goal: 'a goal only the file holds' };
    writeFileSync(path, JSON.stringify(kept));

    const served = await connect();
    const heard = (await answers(served)) as { resume: { lastRun: { goal?: string } } };
    expect(heard.resume.lastRun.goal).toBe('a goal only the file holds');
    await served.close();

    const moving = await connect();
    await write(moving, second, 'another write moves the tree');
    await moving.close();

    const after = await connect();
    const truth = (await answers(after)) as { resume: { lastRun: { goal?: string } } };
    expect(truth.resume.lastRun.goal).not.toBe('a goal only the file holds');
    await after.close();
  });

  it('say where a channel stands in a tree they have not opened, as the projection does', () => {
    const [first] = projects as [string, string, string];
    const trees = resolveTrees(first, env);
    const wrote = switchChannel(writeContext(trees, 'public', createCacheRegistry()), {
      channel: 'tool-call-count',
      on: false,
      reason: 'a person asked',
    });
    expect(wrote.ok).toBe(true);
    const root = chainRootForScope(trees, 'public') as string;

    const replay = ProjectionCache.open(root);
    replay.rebuild();
    const expected = replay.channelSwitch('tool-call-count');
    replay.close();
    expect(expected).toMatchObject({ on: false, reason: 'a person asked' });

    // Two registries: the first has to read the tree and leaves the file; the second is served
    // from it, and a channel nobody switched is null in both, as it is in the projection.
    for (const round of [1, 2]) {
      const registry = createCacheRegistry(
        () => false,
        (tree) => treeIndexFile(dataDir(), tree),
      );
      expect(registry.channelSwitchOf(root, 'tool-call-count'), `round ${round}`).toEqual(expected);
      expect(
        registry.channelSwitchOf(root, 'a-channel-nobody-switched'),
        `round ${round}`,
      ).toBeNull();
      expect(registry.opened().length, `round ${round}`).toBe(round === 1 ? 1 : 0);
      registry.closeAll();
    }
  });

  it('leave no index for a tree the session is not allowed to index, and answer the same', () => {
    const [first] = projects as [string, string, string];
    const trees = resolveTrees(first, env);
    switchChannel(writeContext(trees, 'public', createCacheRegistry()), {
      channel: 'tool-call-count',
      on: false,
    });
    const root = chainRootForScope(trees, 'public') as string;
    const registry = createCacheRegistry(
      () => false,
      () => undefined,
    );
    expect(registry.channelSwitchOf(root, 'tool-call-count')).toMatchObject({ on: false });
    expect(registry.runsOf(root)).toBeDefined();
    expect(existsSync(treeIndexFile(dataDir(), root))).toBe(false);
    registry.closeAll();
  });
});

describe('the index of the other projects', () => {
  it('is kept under the mnema home and writes nothing into a project the session does not serve', async () => {
    const [, second, third] = projects as [string, string, string];
    const writer = await connect();
    await write(writer, third, 'work in the third project');
    await write(writer, second, 'work in the second project');
    await writer.close();

    const before = [filesUnder(second), filesUnder(third)];
    const reading = await connect();
    await answers(reading);
    await reading.close();

    expect([filesUnder(second), filesUnder(third)]).toEqual(before);
    expect(existsSync(indexOf(second))).toBe(true);
    expect(indexOf(second).startsWith(dataDir())).toBe(true);
    expect(existsSync(join(second, PROJECT_DIR, 'locks', 'tree-index.json'))).toBe(false);
  });

  it('is the only one read: a file of that name a project carries is not served', async () => {
    const [, second] = projects as [string, string, string];
    const writer = await connect();
    await write(writer, second, 'work in the second project');
    await writer.close();

    const priming = await connect();
    const expected = await answers(priming);
    await priming.close();

    // What a clone can bring: a file with the mark the tree really has and a run it never had.
    const kept = JSON.parse(readFileSync(indexOf(second), 'utf8')) as {
      facts: { runs: { goal?: string }[] };
    };
    kept.facts.runs[0] = { ...kept.facts.runs[0], goal: 'a goal a clone planted' };
    const planted = join(second, PROJECT_DIR, 'locks', 'tree-index.json');
    mkdirSync(dirname(planted), { recursive: true });
    writeFileSync(planted, JSON.stringify(kept));
    rmSync(join(dataDir(), 'cache'), { recursive: true, force: true });

    const reading = await connect();
    expect(await answers(reading)).toEqual(expected);
    await reading.close();
    expect(JSON.stringify(expected)).not.toContain('a goal a clone planted');
  });

  it.each([
    ['a null run', { runs: [null], channelSwitches: [] }],
    ['an empty run', { runs: [{}], channelSwitches: [] }],
    ['a null switch', { runs: [], channelSwitches: [null] }],
    ['an empty switch', { runs: [], channelSwitches: [{}] }],
  ])('with %s, a tool still answers what the record says', async (_name, facts) => {
    const [, second] = projects as [string, string, string];
    const writer = await connect();
    await write(writer, second, 'work in the second project');
    await writer.close();

    const priming = await connect();
    const expected = await answers(priming);
    await priming.close();

    const kept = JSON.parse(readFileSync(indexOf(second), 'utf8')) as { mark: string };
    writeFileSync(indexOf(second), JSON.stringify({ mark: kept.mark, facts }));
    const reading = await connect();
    expect(await answers(reading)).toEqual(expected);
    await reading.close();
  });

  it('hears a checkout that swaps the live segment for one of the same size', async () => {
    const [, second] = projects as [string, string, string];
    const vcs = (...args: string[]): void => {
      execFileSync('git', args, {
        cwd: second,
        stdio: 'pipe',
        env: {
          PATH: process.env.PATH ?? '',
          HOME: env.home as string,
          GIT_CONFIG_GLOBAL: GIT_WITHOUT_MAINTENANCE,
        },
      });
    };
    vcs('init', '-q', '-b', 'main');
    vcs('config', 'user.email', 'a@example.com');
    vcs('config', 'user.name', 'a');
    const seed = await connect();
    await write(seed, second, 'seed');
    await seed.close();
    vcs('add', '-A');
    vcs('commit', '-qm', 'base');
    // The writer's note of the last entry it wrote (`locks/<tailId>.head`, which git does not
    // see) is put back as it was at the base before each branch writes, as a checkout copied
    // whole would carry it: without it the second branch goes to a tail of its own (ADR-123),
    // and the same-size live segment this case is about is never made.
    const locks = join(second, PROJECT_DIR, 'locks');
    const notes = new Map(
      readdirSync(locks)
        .filter((name) => name.endsWith('.head'))
        .map((name) => [join(locks, name), readFileSync(join(locks, name))] as const),
    );
    for (const [branch, title] of [
      ['x', 'goal-AAAA'],
      ['y', 'goal-BBBB'],
    ] as const) {
      vcs('checkout', '-q', 'main');
      vcs('checkout', '-q', '-b', branch);
      for (const [path, bytes] of notes) writeFileSync(path, bytes);
      const writing = await connect();
      const wrote = await writing.callTool({
        name: 'create_task',
        arguments: { title, project: second, scope: 'public' },
      });
      expect(wrote.isError).not.toBe(true);
      await writing.close();
      vcs('add', '-A');
      vcs('commit', '-qm', branch);
    }
    const live = (): string[] =>
      filesUnder(join(second, PROJECT_DIR, 'tails')).filter((file) => file.includes('.jsonl'));

    vcs('checkout', '-q', 'x');
    const onXFiles = live().map((file) => file.slice(file.lastIndexOf(':')));
    const onX = await connect();
    const heardOnX = await answers(onX);
    await onX.close();
    vcs('checkout', '-q', 'y');
    expect(live().map((file) => file.slice(file.lastIndexOf(':')))).toEqual(onXFiles);

    const onY = await connect();
    const heardOnY = await answers(onY);
    await onY.close();
    rmSync(indexOf(second), { force: true });
    const fresh = await connect();
    const freshOnY = await answers(fresh);
    await fresh.close();

    expect(heardOnY).toEqual(freshOnY);
    expect(heardOnY).not.toEqual(heardOnX);
  });
});
