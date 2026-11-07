/**
 * The sentences about the public tree assume a git repository: committed with it, reaching every
 * clone. In a project with no git none of that holds, and a person or an agent who reads it
 * believes the fact travels when it is a folder. Each sentence is asserted in both places: with
 * git it is the text it has always been, without git it says what holds there.
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
import { outsideTheProject } from '../src/link-target.js';
import { buildMcpServer } from '../src/mcp/server.js';
import { landedNotice, subjectReachNotice } from '../src/recorded-content.js';

const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

const WITH_GIT =
  '  Landed in the public tree: committed with the repository, so it reaches every clone.';
const WITHOUT_GIT =
  "  Landed in the public tree: a folder of this project, not committed (there is no git here); it travels only as the project's files are copied.";

let sandbox: string;
let home: string;
let plain: string;
let repo: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-without-git-'));
  home = join(sandbox, 'home');
  plain = join(sandbox, 'plain');
  repo = join(sandbox, 'repo');
  for (const dir of [home, plain, repo]) mkdirSync(dir, { recursive: true });
  const init = spawnSync('git', ['init', '-q'], {
    cwd: repo,
    env: { PATH: process.env.PATH ?? '', HOME: home, GIT_CONFIG_NOSYSTEM: '1' },
  });
  expect(init.status).toBe(0);
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function mnema(
  cwd: string,
  ...argv: string[]
): { status: number | null; stdout: string; stderr: string } {
  const ran = spawnSync(process.execPath, [CLI, ...argv], {
    cwd,
    encoding: 'utf-8',
    env: { PATH: process.env.PATH ?? '', HOME: home, GIT_CONFIG_NOSYSTEM: '1' },
  });
  return { status: ran.status, stdout: ran.stdout, stderr: ran.stderr };
}

describe('the line that says where a write landed', () => {
  it('is one function: a repository gets the committed sentence, a plain folder the one that holds', () => {
    expect(landedNotice('public', repo)).toBe(WITH_GIT);
    expect(landedNotice('public', plain)).toBe(WITHOUT_GIT);
    expect(landedNotice('public')).toBe(WITH_GIT);
    // The other trees never said anything about git.
    expect(landedNotice('private', plain)).toBe(landedNotice('private', repo));
    expect(landedNotice('global', plain)).toBe(landedNotice('global', repo));
  });

  it('is what mnema decision record prints, in each place', () => {
    for (const [dir, sentence] of [
      [repo, WITH_GIT],
      [plain, WITHOUT_GIT],
    ] as const) {
      expect(mnema(dir, 'init').status).toBe(0);
      const said = mnema(dir, 'decision', 'record', 'Keep it', 'Because.', '--scope', 'public');
      expect(said.status, said.stderr).toBe(0);
      expect(said.stdout.split('\n')).toContain(sentence);
    }
  }, 60_000);

  it('is what the tool replies, in each place', async () => {
    for (const [dir, sentence] of [
      [repo, WITH_GIT],
      [plain, WITHOUT_GIT],
    ] as const) {
      expect(mnema(dir, 'init').status).toBe(0);
      const { server } = buildMcpServer({ cwd: sandbox, env: { home }, log: () => {} });
      const client = new Client(
        { name: 'claude-code', version: '1.0.0' },
        { capabilities: { roots: {} } },
      );
      client.setRequestHandler(ListRootsRequestSchema, () => ({
        roots: [{ uri: pathToFileURL(dir).href }],
      }));
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
      const reply = (await client.callTool({
        name: 'capture_memory',
        arguments: { content: `a note in ${dir}`, scope: 'public' },
      })) as { content: { text: string }[] };
      expect(reply.content[0]?.text.split('\n')).toContain(sentence);
      await client.close();
    }
  }, 60_000);
});

describe('the line mnema site ends with', () => {
  it('says the public tree is committed with git, and only that it is in the page without', () => {
    for (const [dir, sentence] of [
      [repo, 'only the committed public tree is in the page'],
      [plain, 'only the public tree is in the page'],
    ] as const) {
      expect(mnema(dir, 'init').status).toBe(0);
      expect(
        mnema(dir, 'decision', 'record', 'Keep it', 'Because.', '--scope', 'public').status,
      ).toBe(0);
      const site = mnema(dir, 'site', '--out', join(sandbox, `out-${dir.length}`));
      expect(site.status, site.stderr).toBe(0);
      expect(site.stdout.split('\n').map((line) => line.trim())).toContain(sentence);
    }
  }, 60_000);
});

describe('the replies that say where a link reaches', () => {
  it('the notice about the rule a link names says every clone with git and every copy without', () => {
    for (const [subjectScope, isTask] of [
      [undefined, false],
      ['private', true],
      ['private', false],
    ] as const) {
      const withGit = subjectReachNotice('public', subjectScope, isTask, undefined, repo).join(
        '\n',
      );
      const without = subjectReachNotice('public', subjectScope, isTask, undefined, plain).join(
        '\n',
      );
      expect(withGit).toContain('reaches every clone');
      expect(without).not.toContain('clone');
      expect(without).toContain('reaches every copy of the project');
      // Nothing named: the sentence is the one a repository earns, byte for byte.
      expect(subjectReachNotice('public', subjectScope, isTask)).toEqual(
        subjectReachNotice('public', subjectScope, isTask, undefined, repo),
      );
    }
  });

  it('the refusal of an address outside the project names a clone only with git', () => {
    const root = (dir: string): string => join(dir, '.mnema');
    mkdirSync(root(repo), { recursive: true });
    mkdirSync(root(plain), { recursive: true });
    const withGit = outsideTheProject('governs', '/elsewhere/file.ts', root(repo));
    const without = outsideTheProject('governs', '/elsewhere/file.ts', root(plain));
    expect(withGit).toContain('reaches every clone, none of which can open that path');
    expect(without).toBe(
      '"/elsewhere/file.ts" is outside this project, and a link in the public tree travels only as the project\'s files are copied, and no copy can open that path. Link a path inside the project, or record the link with --scope private. Nothing was recorded.',
    );
  });
});
