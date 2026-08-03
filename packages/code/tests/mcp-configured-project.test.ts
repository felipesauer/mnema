/**
 * `mnema mcp --project <dir>`: the project the server serves, said out loud.
 *
 * A CLI verb has a working directory and that is the answer. A server does not —
 * the host spawns it with an arbitrary cwd — so the project came entirely from the
 * workspace folders the host announced. The first real use of the surface found what
 * that costs: an agent that went to the record on its own was answered out of a
 * project it had never mentioned (a stray `.mnema/` above home, first among the
 * roots), and the emptiness of that record read as "nothing was decided here". The
 * answer was WRONG and it was LOAD-BEARING — it decided which of two systems to fix.
 *
 * So the operator can name the project, and the tests here are about the two halves
 * of what naming it must mean:
 *
 *   - it WINS over the roots, including when a root would have resolved to a project
 *     of its own (the originating case); and
 *   - being told wrong is a REFUSAL, not a fallback. A path that is no project, or a
 *     path that is relative, stops the session — because "I said which project and
 *     you served another in silence" is the defect, and continuing the cascade IS
 *     that defect. The refusal lands before anything is written: not one event, not
 *     the machine's identity.
 *
 * The control is in here too, over the same fixture: the cascade with no flag lands
 * exactly where it did. That is what makes the refusal a decision about the
 * explicit path rather than a change to the rule underneath it.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { catalogUpcasters, ensureTree } from '@mnema/chain';
import {
  chainRootForScope,
  type DiscoveryEnv,
  orderedEvents,
  PROJECT_DIR,
  resolveTrees,
} from '@mnema/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildMcpServer } from '../src/mcp/server.js';

let sandbox: string;
let env: DiscoveryEnv;
/** Every diagnostic the server wrote for this connection. */
let logged: string[];

/** Makes a directory that IS a project (has a `.mnema/` tree), returns its path. */
function makeProject(name: string): string {
  const dir = join(sandbox, name);
  mkdirSync(dir, { recursive: true });
  ensureTree({ root: join(dir, PROJECT_DIR) });
  return dir;
}

/** Makes a plain directory that is NOT a project, returns its path. */
function makeFolder(name: string): string {
  const dir = join(sandbox, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Connects a real SDK client to a server built over `configProject`, announcing
 * `roots` — the handshake as a host performs it.
 */
async function connect(
  roots: readonly string[],
  configProject?: string,
): Promise<{ client: Client; close: () => Promise<void> }> {
  const { server } = buildMcpServer({
    env,
    log: (line) => logged.push(line),
    ...(configProject !== undefined ? { configProject } : {}),
  });
  const client = new Client(
    { name: 'claude-code', version: '1.0.0' },
    { capabilities: { roots: {} } },
  );
  client.setRequestHandler(ListRootsRequestSchema, () => ({
    roots: roots.map((uri) => ({ uri })),
  }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return { client, close: () => client.close() };
}

/** Every text block of a callTool result, joined. */
function allText(result: unknown): string {
  const content = (result as { content?: { type: string; text?: string }[] }).content ?? [];
  return content
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('\n');
}

/** How many events a project's two trees hold, together. */
function eventsIn(project: string): number {
  const trees = resolveTrees(project, env);
  return (['public', 'private'] as const).reduce((total, scope) => {
    const root = chainRootForScope(trees, scope);
    if (root === undefined || !existsSync(root)) return total;
    return total + orderedEvents({ root }, catalogUpcasters()).length;
  }, 0);
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-mcp-configured-'));
  const home = join(sandbox, 'home');
  mkdirSync(home, { recursive: true });
  env = { home, xdgDataHome: join(sandbox, 'data') };
  logged = [];
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe('mnema mcp --project — the project the server serves', () => {
  it('serves the named project even when a root would have resolved to another', async () => {
    // The originating shape, exactly: the host announces a folder that IS a project
    // (a stray `.mnema/` the operator forgot about), and the work is somewhere else.
    const stray = makeProject('stray');
    const pilot = makeProject('pilot');

    const { client, close } = await connect([pathToFileURL(stray).href], pilot);
    const said = allText(await client.callTool({ name: 'bootstrap', arguments: {} }));
    expect(said).toContain(`it is operating on ${pilot}`);
    expect(said).not.toContain(`operating on ${stray}`);

    // And a write lands there, which is the half the sentence cannot prove.
    await client.callTool({ name: 'capture_memory', arguments: { content: 'from the pilot' } });
    await close();
    expect(eventsIn(pilot)).toBeGreaterThan(0);
    expect(eventsIn(stray)).toBe(0);
  });

  it('names the configured project among the workspace projects, unannounced by any root', async () => {
    // The list is what the seven union reads walk and what a write may name, and the
    // configured project is regularly in NO root — that is the point of the flag. A
    // session that served it while listing only the roots would be unable to name
    // the very project it is writing to.
    const stray = makeProject('stray');
    const pilot = makeProject('pilot');

    const { client, close } = await connect([pathToFileURL(stray).href], pilot);
    const said = allText(await client.callTool({ name: 'bootstrap', arguments: {} }));
    expect(said).toContain('knows of 2 projects');
    expect(said).toContain(`"${stray}"`);
    expect(said).toContain(`"${pilot}"`);
    await close();
  });

  it('serves the PROJECT a configured subdirectory belongs to, not the directory named', async () => {
    // Pointing at a package of a monorepo is legitimate use, so the walk-up stays.
    // What is reported is the parent of the `.mnema/` that was found.
    const mono = makeProject('mono');
    const pkg = join(mono, 'packages', 'one');
    mkdirSync(pkg, { recursive: true });

    const { client, close } = await connect([], pkg);
    const said = allText(await client.callTool({ name: 'bootstrap', arguments: {} }));
    expect(said).toContain(`it is operating on ${mono}`);
    expect(said).not.toContain(pkg);
    await close();
  });

  it('refuses a configured path that is no project, and opens no session in one nobody asked for', async () => {
    const stray = makeProject('stray');
    const typo = makeFolder('piloot');

    const { client, close } = await connect([pathToFileURL(stray).href], typo);
    const answer = await client.callTool({ name: 'bootstrap', arguments: {} });
    expect(answer.isError).toBe(true);
    // The path AS CONFIGURED — the string to go and find in the host's config.
    expect(allText(answer)).toContain(`the configured project "${typo}" is not a project`);
    expect(allText(answer)).toContain('will not serve another instead');
    // The root that WOULD have won is untouched, and so is the machine: the refusal
    // fires while the trees are being resolved, before the anchor is read, which is
    // the first thing that opens a writer.
    expect(eventsIn(stray)).toBe(0);
    expect(existsSync(join(sandbox, 'data', 'mnema'))).toBe(false);
    // The operator's own channel says it too — the host's log, where a session that
    // never opened is otherwise indistinguishable from one that opened quietly.
    expect(logged.join('\n')).toContain('could not open session at initialize');
    await close();
  });

  it('refuses a RELATIVE configured path, saying which rule it broke', async () => {
    const stray = makeProject('stray');
    const { client, close } = await connect([pathToFileURL(stray).href], 'pilot');
    const answer = await client.callTool({ name: 'bootstrap', arguments: {} });
    expect(answer.isError).toBe(true);
    expect(allText(answer)).toContain('"pilot" is not an absolute path');
    expect(eventsIn(stray)).toBe(0);
    await close();
  });

  it('leaves the cascade exactly as it was when no project is configured', async () => {
    // The control, over the fixture the first test refuses on: with no flag, the
    // first root that resolves still wins, and it still never refuses.
    const stray = makeProject('stray');
    makeProject('pilot');

    const { client, close } = await connect([pathToFileURL(stray).href]);
    const said = allText(await client.callTool({ name: 'bootstrap', arguments: {} }));
    expect(said).toContain(`it is operating on ${stray}`);
    await close();
  });
});
