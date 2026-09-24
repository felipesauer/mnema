/**
 * The home directory is not a project, and a machine's data directory is no project's tree —
 * through the binary a person runs and the server a host starts.
 *
 * WHAT WAS WRONG. The data directory is `~/.mnema` — it was whenever `$XDG_DATA_HOME` was
 * unset, when this was measured, and it always is now — and a directory called `.mnema` is
 * exactly what the project walk looks for. Measured on the
 * built binary before this: after the first `mnema init` anywhere, `mnema memory` in a plain
 * folder under the home answered "Landed in the public tree — committed with the repository"
 * and wrote into `~/.mnema/tails/`, and `mnema recall` there spoke of "notes recorded for
 * this project". A rule for the working-directory rung of the server already refused that
 * directory; nothing else did. And a `.mnema/` FOUNDED in the home — `mnema init` there,
 * offered as the first door of the bare name — took every folder under the home as its own.
 *
 * WHAT IS ASSERTED, each beside the case that would pass if the rule refused too much:
 *
 *   - the defect itself: a verb from a folder under the home is
 *     not told it landed in a project, and nothing is written into the home's `.mnema/tails`;
 *   - a home tree written before this, by the product's own writer, is passed over and
 *     NAMED — where, why, how many events — and not a byte of what it holds changes, whatever
 *     runs: with the data directory kept elsewhere, and where it is the data directory itself;
 *   - outside a project the command line still answers over the machine-global tree, and
 *     a data directory holding nothing but its key and its global tree draws no line at all;
 *   - another environment's data directory, which only the key root in it says is one;
 *   - `mnema init` in the home refuses and makes nothing;
 *   - and the server says the same sentence in its log, once, for a client whose roots
 *     climb past such a tree.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { catalogUpcasters } from '@mnema/chain';
import { chainRootForScope, type DiscoveryEnv, PROJECT_DIR, type ResolvedTrees } from '@mnema/core';
import { captureMemory, openTreeForWriting } from '@mnema/core/write';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildMcpServer } from '../src/mcp/server.js';

/** The built binary — what a person runs. */
const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

let sandbox: string;
/** The sandbox's home — every case stands somewhere under it, or in it. */
let home: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-home-not-a-project-'));
  home = join(sandbox, 'home');
  mkdirSync(home, { recursive: true });
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** A directory under the sandbox, made. */
function dir(...parts: string[]): string {
  const path = join(sandbox, ...parts);
  mkdirSync(path, { recursive: true });
  return path;
}

/**
 * `mnema <argv>` in `cwd`, with this environment and nothing else. `relocated` is
 * `$MNEMA_HOME`, the one way to keep the data directory out of `~/.mnema`; absent, the data
 * directory is the home's `.mnema/` — which is the ordinary case.
 */
function mnema(
  at: { cwd: string; home: string; relocated?: string },
  ...argv: string[]
): { status: number | null; stdout: string; stderr: string } {
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH ?? '', HOME: at.home };
  if (at.relocated !== undefined) env.MNEMA_HOME = at.relocated;
  const ran = spawnSync(process.execPath, [CLI, ...argv], { cwd: at.cwd, encoding: 'utf-8', env });
  return { status: ran.status, stdout: ran.stdout, stderr: ran.stderr };
}

/**
 * A home tree written the way the product wrote one before this: the trees the old walk
 * resolved from any folder under the home — the home's `.mnema/` as the committed project
 * tree — handed to the product's own writer. Nothing here invents an event; each one is
 * what `mnema memory` would have signed and stored.
 */
function writtenAsTheOldWalkDid(dataDir: string, note: string): void {
  const trees: ResolvedTrees = {
    projectPublic: join(home, PROJECT_DIR),
    projectPrivate: join(home, PROJECT_DIR, 'private'),
    global: join(dataDir, 'global'),
    keyRoot: join(dataDir, 'identity'),
  };
  const writer = openTreeForWriting(trees, 'public');
  const captured = captureMemory(
    {
      writer,
      layout: { root: chainRootForScope(trees, 'public') as string },
      upcasters: catalogUpcasters(),
    },
    { content: note },
  );
  if (!captured.ok) throw new Error(`setup: the old walk's write was refused: ${captured.message}`);
  writer.checkpoint();
}

/** Every path under `root` with a digest of each file's bytes — directories included. */
function digestOf(root: string): string {
  const hash = createHash('sha256');
  const walk = (at: string): void => {
    for (const entry of readdirSync(at, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const full = join(at, entry.name);
      if (entry.isDirectory()) {
        hash.update(`D:${full}\n`);
        walk(full);
      } else {
        hash.update(`F:${full}:`);
        hash.update(readFileSync(full));
        hash.update('\n');
      }
    }
  };
  walk(root);
  return hash.digest('hex');
}

/** Every file under `root`, by its path relative to `root`, with a digest of its bytes. */
function filesIn(root: string): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (at: string): void => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const full = join(at, entry.name);
      if (entry.isDirectory()) walk(full);
      else
        files.set(
          relative(root, full),
          createHash('sha256').update(readFileSync(full)).digest('hex'),
        );
    }
  };
  walk(root);
  return files;
}

describe('the defect, through the binary', () => {
  it('does not tell a verb in a folder under the home that it landed in a project', () => {
    const app = dir('home', 'code', 'app');
    const plain = dir('home', 'Downloads', 'x');
    expect(mnema({ cwd: app, home }, 'init').status).toBe(0);
    // The first init made the data directory — `~/.mnema`, with the key root in it.
    expect(existsSync(join(home, PROJECT_DIR, 'identity'))).toBe(true);

    const note = mnema({ cwd: plain, home }, 'memory', 'a note taken in a plain folder');
    expect(note.stdout).not.toContain('committed with the repository');
    expect(note.stdout).not.toContain('Landed in the public tree');
    expect(note.stderr).toContain('No mnema project here');
    expect(existsSync(join(home, PROJECT_DIR, 'tails'))).toBe(false);

    const recalled = mnema({ cwd: plain, home }, 'recall');
    expect(recalled.stdout).not.toContain('recorded for this project');

    // Non-vacuity: a note meant for no project still has a place, and it is the global tree
    // — inside the data directory, never as a project's tails beside it.
    const global = mnema(
      { cwd: plain, home },
      'memory',
      'a note for no project',
      '--scope',
      'global',
    );
    expect(global.status).toBe(0);
    expect(global.stdout).toContain('Landed in the global tree');
    expect(existsSync(join(home, PROJECT_DIR, 'tails'))).toBe(false);
    // And the project under the home is still a project.
    expect(mnema({ cwd: app, home }, 'memory', 'inside the app').stdout).toContain(
      'Landed in the public tree',
    );
  }, 60_000);
});

describe('a home tree written before this — passed over, named, and left as it is', () => {
  it('says where it is, why it is no project, and how many events it holds — before the answer', () => {
    const data = join(sandbox, 'data');
    writtenAsTheOldWalkDid(join(data, 'mnema'), 'a note that landed in the home tree');
    writtenAsTheOldWalkDid(join(data, 'mnema'), 'a second one');
    const plain = dir('home', 'work', 'unrelated');

    const ran = mnema({ cwd: plain, home, relocated: join(data, 'mnema') }, 'skills');

    expect(ran.status).toBe(0);
    const said = ran.stderr.split('\n').filter((line) => line !== '');
    expect(said).toHaveLength(1);
    expect(said[0]).toContain(`${join(home, PROJECT_DIR)} is not taken for a project`);
    expect(said[0]).toContain('the home directory is never a project’s root');
    // identity.founded and the two memories — one machine's tail.
    expect(said[0]).toContain('It holds 3 event(s) in 1 tail(s)');
  }, 60_000);

  it('changes not one byte of it, whatever runs under the home — reads, writes, a refused init', () => {
    const data = join(sandbox, 'data');
    writtenAsTheOldWalkDid(join(data, 'mnema'), 'a note that landed in the home tree');
    const plain = dir('home', 'work', 'unrelated');
    const app = dir('home', 'code', 'app');
    // The data directory kept elsewhere, as the old walk's machine had it: then nothing of the
    // home tree changes at all, not even beside it.
    const at = { home, relocated: join(data, 'mnema') };
    const before = digestOf(join(home, PROJECT_DIR));

    mnema({ ...at, cwd: plain }, 'memory', 'a note', '--scope', 'global');
    mnema({ ...at, cwd: plain }, 'memory', 'a note meant for a project');
    mnema({ ...at, cwd: plain }, 'task', 'a task created in the wrong place');
    mnema({ ...at, cwd: plain }, 'skills');
    mnema({ ...at, cwd: plain }, 'recall');
    mnema({ ...at, cwd: plain }, 'verify');
    mnema({ ...at, cwd: home }, 'init');
    mnema({ ...at, cwd: app }, 'init');
    mnema({ ...at, cwd: app }, 'memory', 'inside the app');

    expect(digestOf(join(home, PROJECT_DIR))).toBe(before);
  }, 60_000);

  it('and where that tree IS the data directory — the ordinary case — what it held keeps every byte, and only the data directory’s own appears beside it', () => {
    // No `$MNEMA_HOME`: the data directory is `~/.mnema`, which on a machine the old walk
    // wrote to is this very tree. The first write puts the key root and the global tree in
    // it. Nothing the tree held is rewritten, nothing is written into it AS A PROJECT'S, and
    // the line that names it counts the same events after as before.
    const data = join(sandbox, 'data');
    writtenAsTheOldWalkDid(join(data, 'mnema'), 'a note that landed in the home tree');
    const plain = dir('home', 'work', 'unrelated');
    const app = dir('home', 'code', 'app');
    const tree = join(home, PROJECT_DIR);
    const before = filesIn(tree);
    const named = (): string => mnema({ cwd: plain, home }, 'skills').stderr;
    const saidBefore = named();

    mnema({ cwd: plain, home }, 'memory', 'a note', '--scope', 'global');
    mnema({ cwd: plain, home }, 'memory', 'a note meant for a project');
    mnema({ cwd: plain, home }, 'task', 'a task created in the wrong place');
    mnema({ cwd: plain, home }, 'recall');
    mnema({ cwd: plain, home }, 'verify');
    mnema({ cwd: home, home }, 'init');
    mnema({ cwd: app, home }, 'init');
    mnema({ cwd: app, home }, 'memory', 'inside the app');

    const after = filesIn(tree);
    for (const [path, digest] of before) expect(after.get(path), path).toBe(digest);
    const added = [...after.keys()].filter((path) => !before.has(path));
    // Non-vacuity: the data directory did land here — it is the case.
    expect(added.some((path) => path.startsWith('identity/'))).toBe(true);
    expect(added.some((path) => path.startsWith('global/'))).toBe(true);
    expect(added.filter((path) => !/^(identity|global)\//.test(path))).toEqual([]);
    expect(named()).toBe(saidBefore);
    expect(saidBefore).toContain('It holds 2 event(s) in 1 tail(s)');
  }, 60_000);

  it('still answers over the machine-global tree outside a project — the tree it passed is not a refusal', () => {
    const data = join(sandbox, 'data');
    writtenAsTheOldWalkDid(join(data, 'mnema'), 'a note that landed in the home tree');
    const plain = dir('home', 'work', 'unrelated');
    const at = { cwd: plain, home, relocated: join(data, 'mnema') };

    const empty = mnema(at, 'skills');
    expect(empty.status).toBe(0);
    expect(empty.stdout).toContain('No patterns recorded');

    const recorded = mnema(
      at,
      'skill',
      'my-own',
      '--body',
      'across every project',
      '--scope',
      'global',
    );
    expect(recorded.status).toBe(0);
    expect(mnema(at, 'skills').stdout).toContain('my-own');
  }, 60_000);

  it('draws no line for a data directory that holds only its key and its global tree', () => {
    // The ordinary machine: `~/.mnema` is passed over on every walk
    // from under the home, and a line about it on every command would be a line about nothing.
    const plain = dir('home', 'work', 'x');
    expect(mnema({ cwd: plain, home }, 'memory', 'into global', '--scope', 'global').status).toBe(
      0,
    );
    expect(existsSync(join(home, PROJECT_DIR, 'global'))).toBe(true);

    const ran = mnema({ cwd: plain, home }, 'skills');
    expect(ran.status).toBe(0);
    expect(ran.stderr).toBe('');
  }, 60_000);
});

describe('another environment’s data directory', () => {
  it('is not taken for a project by an environment whose home is elsewhere — and is not written to', () => {
    // A run whose `HOME` is not the home it stands in: a sandbox under a real home, `sudo`.
    // Only the key root inside the directory says what it is.
    const realHome = dir('real-home');
    const folder = dir('real-home', 'code', 'never-initialized');
    expect(
      mnema({ cwd: folder, home: realHome }, 'memory', 'the real user', '--scope', 'global').status,
    ).toBe(0);
    expect(existsSync(join(realHome, PROJECT_DIR, 'identity'))).toBe(true);
    const before = digestOf(join(realHome, PROJECT_DIR));

    const elsewhere = { cwd: folder, home: dir('other-home') };
    const ran = mnema(elsewhere, 'memory', 'from a run whose home is elsewhere');

    expect(ran.stdout).not.toContain('committed with the repository');
    expect(ran.stderr).toContain('No mnema project here');
    expect(digestOf(join(realHome, PROJECT_DIR))).toBe(before);
  }, 60_000);
});

describe('`mnema init` in the home', () => {
  it('refuses, says why and where to run it instead, and makes nothing', () => {
    const data = join(sandbox, 'data');
    const ran = mnema({ cwd: home, home, relocated: data }, 'init');

    expect(ran.status).toBe(1);
    expect(ran.stderr).toContain('Refused (NOT_A_PROJECT_ROOT)');
    expect(ran.stderr).toContain('the home directory is never a project’s root');
    expect(ran.stderr).toContain('in the project’s own directory');
    expect(existsSync(join(home, PROJECT_DIR))).toBe(false);
    expect(existsSync(data)).toBe(false);
  }, 60_000);
});

describe('the server says it too, in its log', () => {
  /** A server started by the product, a client with `roots`, and every line it logged. */
  async function connected(
    roots: readonly string[],
    env: DiscoveryEnv,
  ): Promise<{ client: Client; logged: string[] }> {
    const logged: string[] = [];
    const { server } = buildMcpServer({ cwd: sandbox, env, log: (line) => logged.push(line) });
    const client = new Client(
      { name: 'claude-code', version: '1.0.0' },
      { capabilities: { roots: {} } },
    );
    client.setRequestHandler(ListRootsRequestSchema, () => ({
      roots: roots.map((uri) => ({ uri })),
    }));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    await client.callTool({ name: 'focus' });
    return { client, logged };
  }

  it('names a home tree a root climbed past, once, under the landing — and names nothing where none was', async () => {
    const data = join(sandbox, 'data');
    writtenAsTheOldWalkDid(join(data, 'mnema'), 'a note that landed in the home tree');
    const one = dir('home', 'a');
    const two = dir('home', 'b');
    const env: DiscoveryEnv = { home, mnemaHome: join(data, 'mnema') };

    const { client, logged } = await connected(
      [pathToFileURL(one).href, pathToFileURL(two).href],
      env,
    );
    const opened = logged.findIndex((line) => line.startsWith('session opened:'));
    expect(logged[opened]).toContain('project=(none — the global tree)');
    const named = logged.filter((line) => line.includes('is not taken for a project'));
    expect(named).toEqual([
      expect.stringContaining(`${join(home, PROJECT_DIR)} is not taken for a project`),
    ]);
    expect(logged.indexOf(named[0] as string)).toBe(opened + 1);
    await client.close();

    // Non-vacuity: a workspace under a home with no such tree logs no such line.
    rmSync(join(home, PROJECT_DIR), { recursive: true, force: true });
    const quiet = await connected([pathToFileURL(one).href], env);
    expect(quiet.logged.some((line) => line.includes('is not taken for a project'))).toBe(false);
    await quiet.client.close();
  }, 60_000);
});
