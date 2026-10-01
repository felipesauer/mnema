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
 * WHAT THIS HOLDS, in the order the property has to be shown:
 *   - the ordinary project writes privately exactly as before (the case that would fail if
 *     the check refused everything);
 *   - with the line gone, the CLI and the MCP server both refuse, say which file the way
 *     out is in, and WRITE NOTHING — no private tree appears;
 *   - `verify` says so about a private record that already exists, without moving its verdict;
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

describe('the ordinary project', () => {
  it('writes privately, and says what it always said', () => {
    aRepository();
    const wrote = mnema(undefined, 'memory', '--scope', 'private', 'a note for this machine');
    expect(wrote.status, wrote.out).toBe(0);
    expect(wrote.out).toContain('not committed and does not travel');
    expect(git('status', '--porcelain', '--', '.mnema/private').stdout).toBe('');
  });
});

describe('a committed .gitignore that lost its /private/ line', () => {
  it('is refused on the command line, names the file, and writes nothing', () => {
    aRepository();
    withoutThePrivateLine();
    const wrote = mnema(undefined, 'memory', '--scope', 'private', 'the password is in prose');
    expect(wrote.status).toBe(1);
    expect(wrote.out).toContain('git would stage .mnema/private');
    expect(wrote.out).toContain('.mnema/.gitignore');
    expect(wrote.out).toContain('`/private/`');
    expect(wrote.out).toContain('Nothing was written.');
    expect(existsSync(join(project, '.mnema', 'private'))).toBe(false);
    // And that is what git sees: nothing under the private tree to add.
    expect(git('add', '-A', '-n').stdout).not.toContain('private');
  });

  it('is refused by the server, as a refusal, with the fact not recorded', async () => {
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
    expect(reply.isError, text).toBe(true);
    expect(text.startsWith('Refused (PRIVATE_TREE_VISIBLE): '), text).toBe(true);
    expect(text).toContain('.mnema/.gitignore');
    expect(text).toContain('The fact was NOT recorded.');
    expect(existsSync(join(project, '.mnema', 'private'))).toBe(false);
  }, 30_000);

  it('is said by verify about a private record that is already there, and the verdict stands', () => {
    aRepository();
    expect(
      mnema(undefined, 'memory', '--scope', 'private', 'written while it was safe').status,
    ).toBe(0);
    const before = mnema(undefined, 'verify');
    expect(before.status).toBe(0);
    expect(before.out).not.toContain('git would stage');

    withoutThePrivateLine();
    const after = mnema(undefined, 'verify');
    expect(after.out).toContain('note [private tree]');
    expect(after.out).toContain('git would stage .mnema/private');
    expect(after.out).toContain('.mnema/.gitignore');
    // A fact about the working tree: the chain is whole, and the exit says so.
    expect(after.status).toBe(0);
  });
});

describe('where git cannot answer, the write goes on as it did', () => {
  it('outside a repository', () => {
    expect(mnema(undefined, 'init').status).toBe(0);
    withoutThePrivateLine();
    const wrote = mnema(undefined, 'memory', '--scope', 'private', 'no repository to leak into');
    expect(wrote.status, wrote.out).toBe(0);
  });

  it('with no git to ask', () => {
    aRepository();
    withoutThePrivateLine();
    // The binary is run by its absolute path, so an empty PATH hides git and nothing else.
    const wrote = mnema('/nonexistent', 'memory', '--scope', 'private', 'git is not here');
    expect(wrote.status, wrote.out).toBe(0);
  });
});

describe('git’s answer is the whole answer', () => {
  it('counts a rule that lives somewhere else than the committed file', () => {
    aRepository();
    withoutThePrivateLine();
    appendFileSync(join(project, '.git', 'info', 'exclude'), '/.mnema/private/\n');
    const wrote = mnema(undefined, 'memory', '--scope', 'private', 'excluded another way');
    expect(wrote.status, wrote.out).toBe(0);
    expect(git('add', '-A', '-n').stdout).not.toContain('private');
  });
});
