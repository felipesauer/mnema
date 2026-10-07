/**
 * `$MNEMA_CACHE_DIR` reaches the cache from every door — the command line, the server a host
 * spawns, and the library — and a value that cannot serve is refused where it is read.
 *
 * It is the mould of `mcp-flag-reaches-the-server.test.ts`: what is asserted is that the value
 * ARRIVES, not what the core does with it (`cache-home.test.ts`). The proof that it arrived is the
 * cache file landing in the chosen directory, which only happens when the path the door built the
 * cache over came from the variable; a door that ignored it leaves the directory empty and the
 * cache in the tree.
 *
 * Every case reads a project whose record was written WITHOUT the variable, so a file in the
 * chosen directory is the read's and nothing else's.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openRecord } from '../../sdk/src/record.js';

/** The built binary — what a person runs, and what a host spawns as the server. */
const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

let sandbox: string;
let home: string;
let repo: string;
let cacheDir: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-cache-door-'));
  home = join(sandbox, 'home');
  repo = join(sandbox, 'repo');
  cacheDir = join(sandbox, 'cache');
  for (const dir of [home, repo, cacheDir]) mkdirSync(dir, { recursive: true });
  const init = mnema({}, 'init');
  expect(init.status, init.stderr).toBe(0);
  const noted = mnema({}, 'memory', 'a note so that the project has a record to read');
  expect(noted.status, noted.stderr).toBe(0);
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** `mnema <argv>` in the repository, with exactly `env` beside `PATH` and the sandbox home. */
function mnema(env: Record<string, string>, ...argv: string[]) {
  const ran = spawnSync(process.execPath, [CLI, ...argv], {
    cwd: repo,
    encoding: 'utf-8',
    env: { PATH: process.env.PATH ?? '', HOME: home, ...env },
  });
  return { status: ran.status, stdout: ran.stdout, stderr: ran.stderr };
}

const cachesIn = (dir: string): string[] => readdirSync(dir).filter((name) => name.endsWith('.db'));

describe('$MNEMA_CACHE_DIR reaches the cache from every door', () => {
  it('the command line keeps the cache of a read in the directory', () => {
    const ran = mnema({ MNEMA_CACHE_DIR: cacheDir }, 'brief');
    expect(ran.status, ran.stderr).toBe(0);
    expect(cachesIn(cacheDir).length).toBeGreaterThan(0);
    expect(existsSync(join(repo, '.mnema', 'locks', 'projection.db'))).toBe(false);
  }, 60_000);

  it('the command line keeps it in the tree when the variable is not set', () => {
    const ran = mnema({}, 'brief');
    expect(ran.status, ran.stderr).toBe(0);
    expect(cachesIn(cacheDir)).toEqual([]);
    expect(existsSync(join(repo, '.mnema', 'locks', 'projection.db'))).toBe(true);
  }, 60_000);

  it('the server a host spawns keeps its cache there too', async () => {
    const client = new Client({ name: 'claude-code', version: '1.0.0' }, { capabilities: {} });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [CLI, 'mcp', '--project', repo],
      cwd: repo,
      env: { PATH: process.env.PATH ?? '', HOME: home, MNEMA_CACHE_DIR: cacheDir },
      stderr: 'ignore',
    });
    await client.connect(transport);
    const read = await client.callTool({ name: 'bootstrap', arguments: {} });
    await client.close();

    expect(read.isError ?? false).toBe(false);
    expect(cachesIn(cacheDir).length).toBeGreaterThan(0);
  }, 60_000);

  it('the library keeps it there too', () => {
    const before = process.env.MNEMA_CACHE_DIR;
    process.env.MNEMA_CACHE_DIR = cacheDir;
    try {
      const read = openRecord({ cwd: repo, agent: 'a-program' }).brief();
      expect(read.ok).toBe(true);
    } finally {
      if (before === undefined) delete process.env.MNEMA_CACHE_DIR;
      else process.env.MNEMA_CACHE_DIR = before;
    }
    expect(cachesIn(cacheDir).length).toBeGreaterThan(0);
  }, 60_000);
});

describe('$MNEMA_CACHE_DIR that cannot serve is refused', () => {
  it('the command line says what to do and reads nothing', () => {
    const ran = mnema({ MNEMA_CACHE_DIR: join(sandbox, 'nowhere') }, 'brief');
    expect(ran.status).not.toBe(0);
    expect(ran.stderr).toContain('MNEMA_CACHE_DIR');
    expect(ran.stderr).toContain('unset MNEMA_CACHE_DIR');
  }, 60_000);
});
