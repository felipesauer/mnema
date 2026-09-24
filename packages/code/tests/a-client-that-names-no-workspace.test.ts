/**
 * A client that names no workspace is served the project it is working in — and a
 * client that names an EMPTY one is not.
 *
 * WHAT WAS WRONG. A client that declares no `roots` capability — Cursor's command-line
 * agent declares only `elicitation` — gave the server no workspace, and the cascade sent
 * every such session to the machine-global tree. Measured through the binary before
 * this: a note an agent took there was answered "Landed in the global tree", and came
 * back in the notes of a second project that client had never opened; a decision
 * recorded there never reached the project's own record. That host starts the server in
 * the workspace root, and the server did not look.
 *
 * WHAT IS ASSERTED, through the transport and through the binary, because the one
 * decision the rule turns on is made where the capability is READ (`clientWorkspace`,
 * `server.ts`) and a test of the resolver cannot see it:
 *
 *   - a client with no `roots` capability, whose server was started in a project, is
 *     served that project, and both readers are told where the project came from — the
 *     host's log line and the agent's own `bootstrap`;
 *   - a client that DECLARED `roots` and listed none is NOT: it said its workspace holds
 *     no folder, and serving the project at the working directory would serve one nobody
 *     named. It is the trap an "an empty list means the cwd" fix falls into, and one
 *     that fails to answer `roots/list` is the same client;
 *   - nothing is founded: a working directory that is no project stays no project, and a
 *     write from it goes where every write with no project goes;
 *   - and the leak itself, through the binary a host spawns, with the handshake that
 *     client sends, byte for byte: a note taken in one project does not come back in the
 *     notes of another.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { catalogUpcasters, ensureTree } from '@mnema/chain';
import { type DiscoveryEnv, orderedEvents, PROJECT_DIR, resolveTrees } from '@mnema/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildMcpServer } from '../src/mcp/server.js';
import { decodedWhole } from './support/arriving.js';
import { until } from './support/console.js';

/** The built binary — what a host spawns when its configuration says `mnema mcp`. */
const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

/**
 * The `initialize` Cursor's command-line agent (2026.09.18) sends, captured on the wire
 * and pasted here unchanged: `elicitation` and nothing else — no `roots`.
 */
const CURSOR_INITIALIZE =
  '{"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{"elicitation":{"form":{}}},"clientInfo":{"name":"Cursor","version":"1.0.0"}},"jsonrpc":"2.0","id":0}';

let sandbox: string;
let env: DiscoveryEnv;
/** Every line the in-process server wrote to its log, in order. */
let logged: string[];

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-no-workspace-'));
  const home = join(sandbox, 'home');
  mkdirSync(home, { recursive: true });
  env = { home };
  logged = [];
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** Makes a directory that IS a project (has a `.mnema/` tree), returns its path. */
function makeProject(name: string): string {
  const dir = join(sandbox, name);
  mkdirSync(dir, { recursive: true });
  ensureTree({ root: join(dir, PROJECT_DIR) });
  return dir;
}

/** A directory that is NOT a project, returns its path. */
function makePlainDir(name: string): string {
  const dir = join(sandbox, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * The server the product builds, started in `cwd`, and a client connected to it.
 *
 * `roots` is what the client says about its workspace, and its three values are the
 * three clients this file is about: ABSENT is a client with no `roots` capability — the
 * capabilities are Cursor's, verbatim; a LIST is a client that declared the capability
 * and answers with it, empty included; `'fails'` declared it and throws when asked.
 */
async function connect(cwd: string, roots?: readonly string[] | 'fails'): Promise<Client> {
  const { server } = buildMcpServer({ cwd, env, log: (line) => logged.push(line) });
  const client =
    roots === undefined
      ? new Client(
          { name: 'Cursor', version: '1.0.0' },
          { capabilities: { elicitation: { form: {} } } },
        )
      : new Client({ name: 'claude-code', version: '1.0.0' }, { capabilities: { roots: {} } });
  if (roots !== undefined) {
    client.setRequestHandler(ListRootsRequestSchema, () => {
      if (roots === 'fails') throw new Error('this client cannot list its roots');
      return { roots: roots.map((uri) => ({ uri })) };
    });
  }
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

/** The line the server logs when the session opens. */
function openedLine(): string {
  return logged.find((line) => line.startsWith('session opened:')) ?? '';
}

/** The `Workspace:` block of a `bootstrap` reply. */
function whereItIs(reply: unknown): string {
  const content = (reply as { content: { type: string; text?: string }[] }).content;
  return content.find((block) => block.text?.startsWith('Workspace:'))?.text ?? '';
}

/** Every text block of a reply, joined. */
function textOf(reply: unknown): string {
  const content = (reply as { content: { type: string; text?: string }[] }).content;
  return content.map((block) => block.text ?? '').join('\n');
}

/** The kinds of every event in a tree — none when the tree holds nothing. */
function kindsIn(root: string | undefined): string[] {
  if (root === undefined || !existsSync(root)) return [];
  return orderedEvents({ root }, catalogUpcasters()).map((event) => event.kind);
}

describe('a client with no `roots` capability is served the project it works in', () => {
  it('lands in the project the server was started in, and records there', async () => {
    const app = makeProject('app');
    const client = await connect(app);

    const captured = await client.callTool({
      name: 'capture_memory',
      arguments: { content: 'a note taken where the work is' },
    });
    expect(captured.isError).toBeFalsy();
    expect(textOf(captured)).toContain('Landed in the private tree');
    const trees = resolveTrees(app, env);
    expect(kindsIn(trees.projectPrivate)).toContain('memory.captured');
    // The tree it used to land in holds nothing — the note went where the work is.
    expect(kindsIn(trees.global)).toEqual([]);

    await client.close();
  });

  it('says in the log that the project came from the working directory', async () => {
    const app = makeProject('app');
    const client = await connect(app);
    await client.callTool({ name: 'focus' });

    expect(openedLine()).toContain(
      `project=${app} (from this server's working directory, ${app}: ` +
        'the client declared no workspace roots)',
    );

    await client.close();
  });

  it('tells the agent the same thing, in the reply it opens with', async () => {
    // The log is the host's, and whether anybody reads it is the host's business. The
    // agent reads this — and it is the one landing the client did not ask for.
    const app = makeProject('app');
    const client = await connect(app);

    const said = whereItIs(await client.callTool({ name: 'bootstrap' }));
    expect(said).toContain(
      `operating on ${app}, taken from the directory the host started this server in, ` +
        'because the client declared no workspace roots',
    );

    await client.close();
  });

  it('founds nothing: a working directory that is no project stays one', async () => {
    const plain = makePlainDir('plain');
    const client = await connect(plain);

    const captured = await client.callTool({
      name: 'capture_memory',
      arguments: { content: 'a note with no project to go to' },
    });
    expect(textOf(captured)).toContain('Landed in the global tree');
    expect(existsSync(join(plain, PROJECT_DIR))).toBe(false);
    expect(readdirSync(plain)).toEqual([]);
    // And the log says why it is global — the one input a reader of it cannot see.
    expect(openedLine()).toContain(
      'project=(none — the global tree) (the client declared no workspace roots, and no ' +
        `project is at or above this server's working directory, ${plain})`,
    );

    await client.close();
  });
});

describe('the machine’s own data directory, reached from a workspace nobody initialized', () => {
  it('is made WITH its key root by a session that only reads, and is never served as a project', async () => {
    // The global tree lives in `~/.mnema`, and a directory
    // called `.mnema` is what a walk-up looks for — so every uninitialized workspace
    // under home would resolve to home, a "project" whose committed tree is this
    // machine's data. THIS SAID "the rung refuses a `.mnema/` that holds a key root"; the
    // refusal is now the core walk's, for every rung and verb, and the home itself is never
    // a project's root whatever its `.mnema/` holds. What this case asks of the product
    // still matters, for the reading that reaches ANOTHER environment's data directory —
    // the key root inside it: the first session makes the key root, even one that writes
    // nothing, because deciding who it is needs a key.
    //
    // IT ALSO MADE THE GLOBAL TREE, and this case asserted that it did. The anchor was
    // decided through a writer opened over the global tree, and opening one gives a tree a
    // public half, an installation and a tail — a connection that only read left them.
    // It is decided by the signer now, which opens nothing, so the global tree is NOT made
    // by a session that reads. The data directory still is, by its key root, which is all
    // the second half of this case needs: a `.mnema/` in the home for the walk to be
    // tempted by.
    const home = join(sandbox, 'home');
    env = { home };
    const first = makePlainDir('home/code/first');
    const second = makePlainDir('home/code/second');

    const one = await connect(first);
    await one.callTool({ name: 'bootstrap' });
    await one.close();
    expect(existsSync(join(home, PROJECT_DIR, 'identity'))).toBe(true);
    expect(existsSync(join(home, PROJECT_DIR, 'global'))).toBe(false);

    logged = [];
    const two = await connect(second);
    const said = whereItIs(await two.callTool({ name: 'bootstrap' }));
    expect(said).toContain('operating on the machine-global tree');
    expect(openedLine()).toContain('project=(none — the global tree)');
    expect(openedLine()).not.toContain(`project=${home} `);
    await two.close();
  });
});

describe('a client that declared `roots` is served what it listed — empty included', () => {
  it('does NOT take the working directory when it listed no roots — the window with no folder', async () => {
    // THE TRAP. This client and the one above both used to reach the cascade as an empty
    // list; a fix keyed on the list would serve this one the project the server happens
    // to be started in, right after the client said its workspace holds no folder.
    const app = makeProject('app');
    const client = await connect(app, []);

    const captured = await client.callTool({
      name: 'capture_memory',
      arguments: { content: 'a note from a window with no folder' },
    });
    expect(textOf(captured)).toContain('Landed in the global tree');
    const trees = resolveTrees(app, env);
    expect(kindsIn(trees.projectPrivate)).toEqual([]);
    expect(kindsIn(trees.projectPublic)).toEqual([]);
    expect(openedLine()).toContain(
      "project=(none — the global tree) (no project among the client's workspace roots)",
    );
    expect(openedLine()).not.toContain('working directory');

    await client.close();
  });

  it('does NOT take it when listing its roots failed, either', async () => {
    // A client that declared the capability said its workspace is what `roots/list`
    // answers. A failed call leaves that answer empty; it does not make the working
    // directory a better one.
    const app = makeProject('app');
    const client = await connect(app, 'fails');
    await client.callTool({ name: 'focus' });

    expect(openedLine()).toContain('project=(none — the global tree)');
    expect(openedLine()).not.toContain('working directory');
    expect(logged.some((line) => line.startsWith('roots/list unavailable:'))).toBe(true);

    await client.close();
  });

  it('names the roots when it landed by them, and never the working directory', async () => {
    // The same project, by the other road. The two lines differ only in the parenthesis,
    // and the parenthesis is what lets a reader tell a landing the client asked for from
    // one the server inferred.
    const app = makeProject('app');
    const elsewhere = makeProject('elsewhere');
    const client = await connect(elsewhere, [pathToFileURL(app).href]);
    await client.callTool({ name: 'focus' });

    expect(openedLine()).toContain(`project=${app} (from the client's workspace roots)`);
    expect(openedLine()).not.toContain('working directory');

    await client.close();
  });
});

/**
 * One JSON-RPC conversation with the built binary, the way a host that declares no
 * `roots` holds it: its `initialize`, byte for byte, then the calls — each one awaited
 * before the next, and the pipe closed only after the last reply, because a close that
 * overtakes a write in flight ends the session the write needs.
 *
 * Bytes come off the pipes through the one collector (`support/arriving.ts`), and a
 * reply is waited for by polling what has arrived — never by a fixed sleep.
 */
async function overTheBinary(
  cwd: string,
  calls: readonly { name: string; arguments: Record<string, unknown> }[],
): Promise<{ replies: string[]; stderr: string }> {
  const child = spawn(process.execPath, [CLI, 'mcp'], {
    cwd,
    env: {
      PATH: process.env.PATH ?? '',
      HOME: env.home,
    },
  });
  const out = decodedWhole();
  out.from(child.stdout);
  const err = decodedWhole();
  err.from(child.stderr);
  const exited = new Promise((resolve) => child.on('close', resolve));

  /** The reply with this id, once a whole line carrying it has arrived. */
  const replyTo = async (id: number): Promise<string> => {
    const carrying = (): string | undefined =>
      out
        .text()
        .split('\n')
        .find((line) => line.startsWith('{') && (JSON.parse(line) as { id?: number }).id === id);
    await until(() => carrying() !== undefined, `answered request ${id}`);
    return carrying() as string;
  };

  child.stdin.write(`${CURSOR_INITIALIZE}\n`);
  await replyTo(0);
  child.stdin.write('{"method":"notifications/initialized","jsonrpc":"2.0"}\n');
  const replies: string[] = [];
  for (const [at, call] of calls.entries()) {
    const id = at + 1;
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: call })}\n`,
    );
    replies.push(await replyTo(id));
  }
  child.stdin.end();
  await exited;
  return { replies, stderr: err.text() };
}

/** `mnema <argv>` run in `cwd` against this file's sandbox, stdout only. */
function mnemaIn(cwd: string, ...argv: string[]): string {
  const run = spawnSync(process.execPath, [CLI, ...argv], {
    cwd,
    encoding: 'utf-8',
    env: { PATH: process.env.PATH ?? '', HOME: env.home },
  });
  expect(run.status, run.stderr).toBe(0);
  return run.stdout;
}

describe('the leak, through the binary a host spawns', () => {
  it('keeps a note taken in one project out of the notes of another', async () => {
    // Two projects founded the way a person founds one, and a server started in the
    // first by a host that declares no `roots` — the handshake is that client's own.
    const first = join(sandbox, 'first');
    const second = join(sandbox, 'second');
    mkdirSync(first);
    mkdirSync(second);
    mnemaIn(first, 'init');
    mnemaIn(second, 'init');

    const mark = 'NOTEFROMTHEFIRSTPROJECT';
    const { replies, stderr } = await overTheBinary(first, [
      { name: 'capture_memory', arguments: { content: `${mark}: taken in the first project` } },
    ]);
    expect(replies[0]).toContain('Landed in the private tree');
    expect(stderr).toContain(`session opened: project=${first} (from this server's working`);

    // The other project's notes do not carry it. It used to come back here, and in the
    // opening of every project on the machine: the global tree is read by all of them.
    expect(mnemaIn(second, 'recall')).not.toContain(mark);
    // And the first project's do — the absence above is about where it went, not about
    // a note that went nowhere.
    expect(mnemaIn(first, 'recall')).toContain(mark);
    // Five processes of the built binary — two founders, the server, two readers. Alone
    // this takes about a second and a half; under the whole suite, in a mutation battery,
    // it went past the five-second default with its assertions intact.
  }, 60_000);
});
