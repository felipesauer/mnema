/**
 * A write into the private tree asks GIT whether the tree would be committed, and does not
 * trust a committed file to say so.
 *
 * THE DEFECT, MEASURED ON THE SHIPPED BINARY. `.mnema/.gitignore` is what keeps `private/`
 * out of git, and it is committed — so a commit by anybody with push access that drops the
 * `/private/` line reads as housekeeping. A private memory written over that file answered
 * *"it is not committed and does not travel"* and was staged by the `git add -A` that
 * followed (six paths, the memory's tail among them).
 *
 * AND THEN THE TREE LEFT THE WORKING TREE. Inside a repository the private tree lives under the
 * common git directory now (`git-place.ts`, `@mnema/core`), where no `git add` reaches, so the
 * line no longer stands between a private note and a commit and its loss refuses nothing. The
 * refusal stays for every private tree that IS in a working tree: the old `.mnema/private/`,
 * which is where it still lives outside a repository.
 *
 * WHAT THIS HOLDS, in the order the property has to be shown:
 *   - the ordinary project writes privately, into the repository's git directory;
 *   - with the line gone, the CLI and the MCP server both still write there, and `git add`
 *     stages nothing private; `verify` has nothing to say about it;
 *   - a private tree inside the working tree that nothing ignores is STILL refused, with
 *     nothing written — the case a guard that said "outside" of every tree would let through;
 *   - where git cannot answer (no repository, no git on the PATH) the write goes on as it did;
 *   - git's answer is the whole answer: a rule that lives elsewhere (`.git/info/exclude`)
 *     counts, which a read of the one file never did.
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
import { PrivateTreeVisibleError, type ResolvedTrees } from '@mnema/core';
import { openTreeForWriting } from '@mnema/core/write';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildMcpServer } from '../src/mcp/server.js';
import { GIT_WITHOUT_MAINTENANCE } from './support/git-without-maintenance.js';

const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

let sandbox: string;
let home: string;
let project: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-private-write-asks-git-'));
  home = join(sandbox, 'home');
  project = join(sandbox, 'project');
  mkdirSync(home);
  mkdirSync(project);
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function mnema(path: string | undefined, ...argv: string[]) {
  const ran = spawnSync(process.execPath, [CLI, ...argv], {
    cwd: project,
    encoding: 'utf-8',
    env: {
      PATH: path ?? process.env.PATH ?? '',
      HOME: home,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: GIT_WITHOUT_MAINTENANCE,
    },
  });
  return { status: ran.status, out: `${ran.stdout}${ran.stderr}` };
}

function git(...args: string[]) {
  return spawnSync('git', args, {
    cwd: project,
    encoding: 'utf-8',
    env: {
      PATH: process.env.PATH ?? '',
      HOME: home,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: GIT_WITHOUT_MAINTENANCE,
    },
  });
}

/** A project in a repository, founded the way a person does. */
function aRepository(): void {
  expect(git('init', '-q', '-b', 'main').status).toBe(0);
  expect(mnema(undefined, 'init').status).toBe(0);
}

/** What a collaborator's commit did: the same file, without the line that keeps `private/` out. */
function withoutThePrivateLine(): void {
  const file = join(project, '.mnema', '.gitignore');
  const kept = readFileSync(file, 'utf-8')
    .split('\n')
    .filter((line) => line.trim() !== '/private/');
  writeFileSync(file, kept.join('\n'));
}

/** Where the private tree of the project at the top of a repository lives. */
function inTheRepository(): string {
  return join(project, '.git', 'mnema', 'private');
}

describe('the ordinary project', () => {
  it('writes privately, into the repository’s git directory, and says what it always said', () => {
    aRepository();
    const wrote = mnema(undefined, 'memory', '--scope', 'private', 'a note for this machine');
    expect(wrote.status, wrote.out).toBe(0);
    expect(wrote.out).toContain('not committed and does not travel');
    expect(existsSync(join(inTheRepository(), 'tails'))).toBe(true);
    expect(existsSync(join(project, '.mnema', 'private'))).toBe(false);
    expect(git('add', '-A', '-n').stdout).not.toContain('private');
  }, 120_000);
});

describe('a committed .gitignore that lost its /private/ line', () => {
  it('no longer stands between a private note and a commit: the command line writes, and git stages nothing private', () => {
    aRepository();
    withoutThePrivateLine();
    const wrote = mnema(undefined, 'memory', '--scope', 'private', 'the password is in prose');
    expect(wrote.status, wrote.out).toBe(0);
    expect(wrote.out).toContain('not committed and does not travel');
    expect(existsSync(join(inTheRepository(), 'tails'))).toBe(true);
    expect(existsSync(join(project, '.mnema', 'private'))).toBe(false);
    expect(git('add', '-A', '-n').stdout).not.toContain('private');
  }, 120_000);

  it('is not a refusal on the server either: the fact is recorded, out of the working tree', async () => {
    aRepository();
    withoutThePrivateLine();
    const { server } = buildMcpServer({ cwd: sandbox, env: { home }, log: () => {} });
    const client = new Client(
      { name: 'claude-code', version: '1.0.0' },
      { capabilities: { roots: {} } },
    );
    client.setRequestHandler(ListRootsRequestSchema, () => ({
      roots: [{ uri: pathToFileURL(project).href }],
    }));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    const reply = (await client.callTool({
      name: 'capture_memory',
      arguments: { content: 'a note for this machine', scope: 'private' },
    })) as { isError?: boolean; content: { text: string }[] };
    await client.close();
    const text = reply.content.map((block) => block.text).join('\n');
    expect(reply.isError, text).not.toBe(true);
    expect(existsSync(join(inTheRepository(), 'tails'))).toBe(true);
    expect(existsSync(join(project, '.mnema', 'private'))).toBe(false);
  }, 30_000);

  it('gives verify nothing to say about a private record in the repository’s git directory', () => {
    aRepository();
    expect(mnema(undefined, 'memory', '--scope', 'private', 'written either way').status).toBe(0);
    withoutThePrivateLine();
    const after = mnema(undefined, 'verify');
    expect(after.status, after.out).toBe(0);
    expect(after.out).not.toContain('git would stage');
  }, 120_000);
});

/**
 * The refusal, where it still belongs: a private tree INSIDE the working tree. Discovery puts
 * one there only outside a repository, so these trees are named by hand — the old
 * `.mnema/private/`, in a repository whose `.gitignore` lost its line.
 */
describe('a private tree inside the working tree that nothing ignores', () => {
  function inTheWorkingTree(): ResolvedTrees {
    return {
      projectPublic: join(project, '.mnema'),
      projectPrivate: join(project, '.mnema', 'private'),
      global: join(home, '.mnema', 'global'),
      keyRoot: join(home, '.mnema', 'identity'),
    };
  }

  it('is refused on the command line where the git directory itself lies inside the worktree', () => {
    // `.git` is a file naming `realgd`, a directory of the working tree: the private tree under
    // it is a path `git add -A` stages, whatever is or is not in `.mnema/.gitignore`.
    expect(
      git('init', '-q', '-b', 'main', '--separate-git-dir', join(project, 'realgd')).status,
    ).toBe(0);
    expect(mnema(undefined, 'init').status).toBe(0);
    const wrote = mnema(undefined, 'memory', '--scope', 'private', 'a note for this machine');
    expect(wrote.status, wrote.out).toBe(1);
    expect(wrote.out).toContain('git would stage realgd/mnema/');
    expect(wrote.out).toContain('Nothing was written.');
    expect(git('add', '-A', '-n').stdout).not.toContain('private');
  }, 120_000);

  it('is still refused, names the file the way out is in, and writes nothing', () => {
    aRepository();
    withoutThePrivateLine();
    let refused: unknown;
    try {
      openTreeForWriting(inTheWorkingTree(), 'private');
    } catch (error) {
      refused = error;
    }
    expect(refused).toBeInstanceOf(PrivateTreeVisibleError);
    const message = (refused as Error).message;
    expect(message).toContain('git would stage .mnema/private');
    expect(message).toContain('.mnema/.gitignore');
    expect(message).toContain('Nothing was written.');
    expect(existsSync(join(project, '.mnema', 'private'))).toBe(false);
  }, 120_000);

  it('is written where git’s answer is that it is ignored — by a rule that lives somewhere else than the committed file', () => {
    aRepository();
    withoutThePrivateLine();
    appendFileSync(join(project, '.git', 'info', 'exclude'), '/.mnema/private/\n');
    expect(() => openTreeForWriting(inTheWorkingTree(), 'private')).not.toThrow();
    expect(git('add', '-A', '-n').stdout).not.toContain('private');
  }, 120_000);
});

describe('where git cannot answer, the write goes on as it did', () => {
  it('outside a repository', () => {
    expect(mnema(undefined, 'init').status).toBe(0);
    withoutThePrivateLine();
    const wrote = mnema(undefined, 'memory', '--scope', 'private', 'no repository to leak into');
    expect(wrote.status, wrote.out).toBe(0);
    expect(existsSync(join(project, '.mnema', 'private', 'tails'))).toBe(true);
  }, 120_000);

  it('with no git to ask', () => {
    aRepository();
    withoutThePrivateLine();
    // The binary is run by its absolute path, so an empty PATH hides git and nothing else.
    const wrote = mnema('/nonexistent', 'memory', '--scope', 'private', 'git is not here');
    expect(wrote.status, wrote.out).toBe(0);
  }, 120_000);
});
