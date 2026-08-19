/**
 * The session learns that the workspace moved — the half nothing was listening for.
 *
 * `resolveContext` had exactly one caller, `openSession`, in `oninitialized`. The
 * trees, the project and the list of the workspace's projects were resolved once and
 * never again, and `setNotificationHandler` did not appear anywhere in
 * `packages/code/src` — so `notifications/roots/list_changed`, which is the client
 * saying "the workspace changed" and is in the protocol for exactly this, arrived and
 * was dropped. An agent that opened a second project went on being served, and
 * WRITING, out of the record the cascade happened to pick first. It is the class that
 * already cost this bench a round of use: a session rooted in a home directory
 * answered about another project, and the wrong answer went on to support a choice.
 *
 * It is tested over the REAL transport, with the SDK's own client, because the whole
 * claim is about a protocol notification: an in-process call to `refreshWorkspace`
 * would prove the function and say nothing about whether anything ever calls it.
 * `client.sendRootsListChanged()` is what a host does, and the assertions are on what
 * the server ANSWERS afterwards.
 *
 * Four properties, and each one is a different way this could be wrong:
 *
 *   - **it re-reads at all**, and what changed is visible in what the tools answer;
 *   - **the landing never walks from one project to another.** The union the re-read
 *     resolves over keeps the roots already seen in their places, so the cascade
 *     returns at the same first root it returned at before. This is the property the
 *     whole slice's safety rests on and it is asserted directly;
 *   - **it says that it ran, including when nothing came of it.** A silent re-read
 *     and no re-read are the same connection from the outside, which is how this
 *     defect lived as long as it did;
 *   - **a workspace that never changes pays nothing**, because the cost of fixing the
 *     case of some must not land on the hot path of everybody. That one is a
 *     measurement and lives in the report; what is asserted here is the mechanism it
 *     rests on — the re-read runs only when the client speaks.
 *
 * WHAT IS DELIBERATELY NOT HERE: a root being RETIRED. The re-read is additive by
 * construction (see `refreshWorkspace`), and a tree leaving mid-session raises what
 * to do with a run open in it, with its caches and with a write in flight — product
 * design, not anything derivable from this defect. The case below that announces a
 * SHORTER list is what pins that decision: the retired root stays.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
import { openSession, refreshWorkspace } from '../src/mcp/session.js';

let sandbox: string;
let env: DiscoveryEnv;
let logged: string[];

/** Makes a directory that IS a project (has a `.mnema/` tree), returns its path. */
function makeProject(name: string): string {
  const dir = join(sandbox, name);
  mkdirSync(dir, { recursive: true });
  ensureTree({ root: join(dir, PROJECT_DIR) });
  return dir;
}

/** A directory that is NOT a project — until somebody founds one in it. */
function makePlainDir(name: string): string {
  const dir = join(sandbox, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * A connected client whose announced roots can be CHANGED, the way a host's are.
 *
 * The roots live in a box the caller writes to, and the `roots/list` handler reads
 * that box every time it is asked — which is the whole shape a re-read depends on. A
 * handler that closed over a fixed array would answer the same list forever, and the
 * notification would then be tested against a client that has nothing new to say.
 */
async function connect(initial: readonly string[]): Promise<{
  client: Client;
  announce: (roots: readonly string[]) => Promise<void>;
}> {
  const box = { roots: [...initial] };
  const { server } = buildMcpServer({ env, log: (line) => logged.push(line) });
  // `listChanged: true`, and it is not decoration: the SDK REFUSES to send the
  // notification from a client that did not declare it, so a host that announces roots
  // without it can never tell this server anything changed. That is the shape of what
  // the portable half depends on, and it is why it is spelled out here rather than
  // copied from the neighbouring file's `{ roots: {} }`.
  const client = new Client(
    { name: 'claude-code', version: '1.0.0' },
    { capabilities: { roots: { listChanged: true } } },
  );
  client.setRequestHandler(ListRootsRequestSchema, () => ({
    roots: box.roots.map((uri) => ({ uri })),
  }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  /**
   * Announces a new list and waits for the server to have finished with it.
   *
   * The wait is a `ping` and not a timer: the notification and the round trip travel
   * the same connection in order, so a reply to a request sent after it is proof the
   * server got that far. A sleep would make this test's own timing the thing under
   * test.
   */
  const announce = async (roots: readonly string[]): Promise<void> => {
    box.roots = [...roots];
    await client.sendRootsListChanged();
    await client.ping();
  };
  return { client, announce };
}

/** The `Workspace:` block of a `bootstrap` reply. */
function whereItIs(reply: unknown): string {
  const content = (reply as { content: { type: string; text?: string }[] }).content;
  return content.find((block) => block.text?.startsWith('Workspace:'))?.text ?? '';
}

/** Every event in a tree, or none when the tree holds nothing. */
function kindsIn(root: string): string[] {
  return orderedEvents({ root }, catalogUpcasters()).map((event) => event.kind);
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-learns-'));
  env = { home: sandbox, xdgDataHome: join(sandbox, 'xdg') };
  logged = [];
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe('the workspace is re-read when the client says it changed', () => {
  it('learns a project the workspace gained, and a write can name it', async () => {
    const alpha = makeProject('alpha');
    const beta = makeProject('beta');
    const { client, announce } = await connect([pathToFileURL(alpha).href]);

    // BEFORE: one project, and `beta` is a name this session cannot route to. The
    // refusal is the evidence, not the count — a list that merely omits it would look
    // the same as a list that holds it and is never consulted.
    expect(whereItIs(await client.callTool({ name: 'bootstrap' }))).toContain('knows of 1 project');
    const refused = await client.callTool({
      name: 'capture_memory',
      arguments: { content: 'before', project: beta },
    });
    expect(refused.isError).toBe(true);
    expect(JSON.stringify(refused)).toContain('UNKNOWN_PROJECT');

    await announce([pathToFileURL(alpha).href, pathToFileURL(beta).href]);

    // AFTER: the same call lands, in `beta`'s own tree. This is the defect closed —
    // the work of a project the session learned about goes into that project's record.
    const said = whereItIs(await client.callTool({ name: 'bootstrap' }));
    expect(said).toContain('knows of 2 projects');
    expect(said).toContain('said 1 time since this session opened');
    const landed = await client.callTool({
      name: 'capture_memory',
      arguments: { content: 'after', project: beta },
    });
    expect(landed.isError).toBeFalsy();
    expect(kindsIn(resolveTrees(beta, env).projectPrivate as string)).toContain('memory.captured');

    await client.close();
  });

  it('KEEPS the project it landed on when the workspace gains another', async () => {
    // The property the whole slice's safety rests on. The union keeps the roots
    // already seen in their places, so the cascade returns at the same first root —
    // and a session's own writes, its open run and its warm caches stay where they
    // were. If this ever walked, a write that named no project would silently change
    // records mid-connection.
    const alpha = makeProject('alpha');
    const beta = makeProject('beta');
    const { client, announce } = await connect([pathToFileURL(alpha).href]);

    // BETA FIRST in what the client now announces, and it still does not win.
    await announce([pathToFileURL(beta).href, pathToFileURL(alpha).href]);

    const said = whereItIs(await client.callTool({ name: 'bootstrap' }));
    expect(said).toContain(`operating on ${alpha}`);
    expect(said).toContain('knows of 2 projects');

    // And a write that names nothing still lands in alpha.
    await client.callTool({ name: 'capture_memory', arguments: { content: 'still alpha' } });
    expect(kindsIn(resolveTrees(alpha, env).projectPrivate as string)).toContain('memory.captured');
    expect(kindsIn(resolveTrees(beta, env).projectPrivate as string)).toEqual([]);

    await client.close();
  });

  it('LANDS in a project when it had none, which is the only way the landing moves', async () => {
    // The one case where the cascade's answer really does change: nothing among the
    // earlier roots resolved to a project, so the session was on the machine-global
    // tree and the first project to arrive is the first that resolves.
    const plain = makePlainDir('plain');
    const late = makeProject('late');
    const { client, announce } = await connect([pathToFileURL(plain).href]);

    expect(whereItIs(await client.callTool({ name: 'bootstrap' }))).toContain(
      'operating on the machine-global tree',
    );

    await announce([pathToFileURL(plain).href, pathToFileURL(late).href]);

    const said = whereItIs(await client.callTool({ name: 'bootstrap' }));
    expect(said).toContain(`operating on ${late}`);
    // And the log names it, so the operator reading a host's log can see the move.
    expect(logged.find((line) => line.startsWith('workspace re-read'))).toContain(
      `now operating on ${late}`,
    );

    await client.close();
  });

  it('learns a directory that BECAME a project, with no root new at all', async () => {
    // `mnema init` in a folder the client already announced. The list of roots comes
    // back identical, and the client has no reason to renumber anything — so a re-read
    // that only looked at which URIs are new would find none and answer with the old
    // world. The cascade runs on every notification for this.
    const plain = makePlainDir('becomes');
    const { client, announce } = await connect([pathToFileURL(plain).href]);
    expect(whereItIs(await client.callTool({ name: 'bootstrap' }))).toContain(
      'knows of no project',
    );

    ensureTree({ root: join(plain, PROJECT_DIR) });
    await announce([pathToFileURL(plain).href]);

    expect(whereItIs(await client.callTool({ name: 'bootstrap' }))).toContain(
      `operating on ${plain}`,
    );

    await client.close();
  });

  it('says that it ran even when nothing came of it', async () => {
    // A re-read that found nothing and a re-read that never happened are the same
    // connection from the outside — which is the whole defect, applied to the fix.
    // The count is reported always, zero included.
    const alpha = makeProject('alpha');
    const { client, announce } = await connect([pathToFileURL(alpha).href]);
    expect(whereItIs(await client.callTool({ name: 'bootstrap' }))).toContain(
      'said 0 times since this session opened',
    );

    await announce([pathToFileURL(alpha).href]);

    expect(whereItIs(await client.callTool({ name: 'bootstrap' }))).toContain(
      'said 1 time since this session opened',
    );
    // And the log line exists for the round that changed nothing, saying so in numbers.
    expect(logged.filter((line) => line.startsWith('workspace re-read'))).toEqual([
      'workspace re-read #1: 0 new root(s), 0 new project(s), 1 known',
    ]);

    await client.close();
  });

  it('KEEPS a root the client stopped announcing — additive, and declared as such', async () => {
    // The retired-root case, pinned rather than implemented. A client that drops a
    // folder gets the same list back, because the alternative is a tree leaving a
    // session that may hold an open run, warm caches and a write in flight in it.
    // When that is decided, THIS is the case that has to change.
    const alpha = makeProject('alpha');
    const beta = makeProject('beta');
    const { client, announce } = await connect([
      pathToFileURL(alpha).href,
      pathToFileURL(beta).href,
    ]);
    expect(whereItIs(await client.callTool({ name: 'bootstrap' }))).toContain(
      'knows of 2 projects',
    );

    await announce([pathToFileURL(alpha).href]);

    expect(whereItIs(await client.callTool({ name: 'bootstrap' }))).toContain(
      'knows of 2 projects',
    );

    await client.close();
  });

  it('leaves the record untouched when a re-read changes nothing', async () => {
    // The re-read reaches `resolveContext`, which walks the filesystem and writes
    // nothing — and this connection only read. A notification must not be the thing
    // that founds an identity in a project nobody worked in.
    const alpha = makeProject('alpha');
    const { client, announce } = await connect([pathToFileURL(alpha).href]);
    await announce([pathToFileURL(alpha).href]);
    await announce([pathToFileURL(alpha).href]);

    const trees = resolveTrees(alpha, env);
    for (const root of [trees.projectPublic as string, trees.projectPrivate as string]) {
      expect(kindsIn(root)).toEqual([]);
    }

    await client.close();
  });
});

describe('refreshWorkspace — the rule itself', () => {
  // The function beside the transport, for the two properties a protocol test can
  // only observe indirectly: what it REPORTS about a change, and that the roots it
  // resolves over are the union rather than the latest list.

  it('reports what it gained and what it learned, and counts every call', () => {
    const alpha = makeProject('alpha');
    const beta = makeProject('beta');
    const session = openSession({
      clientName: 'claude-code',
      roots: [pathToFileURL(alpha).href],
      env,
    });
    expect(session.refreshes).toBe(0);

    const first = refreshWorkspace(session, [pathToFileURL(beta).href]);
    expect(first).toEqual({ gained: [pathToFileURL(beta).href], learned: [beta] });
    expect(session.refreshes).toBe(1);
    expect(session.roots).toEqual([pathToFileURL(alpha).href, pathToFileURL(beta).href]);

    // The same announcement again: nothing gained, nothing learned, and STILL counted.
    const second = refreshWorkspace(session, [pathToFileURL(beta).href]);
    expect(second).toEqual({ gained: [], learned: [] });
    expect(session.refreshes).toBe(2);
  });

  it('names the project it landed on, and only when the landing moved', () => {
    const plain = makePlainDir('plain');
    const late = makeProject('late');
    const session = openSession({
      clientName: 'claude-code',
      roots: [pathToFileURL(plain).href],
      env,
    });
    expect(session.inProject).toBe(false);
    expect(session).not.toHaveProperty('project');

    expect(refreshWorkspace(session, [pathToFileURL(late).href])).toEqual({
      gained: [pathToFileURL(late).href],
      learned: [late],
      landedOn: late,
    });
    expect(session.inProject).toBe(true);
    expect(session.project).toBe(late);

    // A second project arriving after the landing does NOT report a landing: the
    // session is already in one, and the cascade returns at the same root.
    const other = makeProject('other');
    expect(refreshWorkspace(session, [pathToFileURL(other).href])).toEqual({
      gained: [pathToFileURL(other).href],
      learned: [other],
    });
    expect(session.project).toBe(late);
  });

  it('asks the PROJECT for the anchor when the landing moves into one', () => {
    // The anchor is recorded PER TREE, so a session that walks from the global tree
    // into a project has to ask the project's private tree the question it used to ask
    // the global one. Leaving the old answer in place would attribute that project's
    // work to what another tree said.
    //
    // ASSERTED BY WHICH TREE WAS ASKED, not by the value, and that is deliberate: in a
    // fresh sandbox both trees answer with the same machine key, so an equality on
    // `who` is satisfied by a session that never re-read at all. It is vacuous, and it
    // was found that way — the mutation that drops the re-read left every other case in
    // this file green. Opening the private tree to ask is what materializes it, so its
    // EXISTENCE is the evidence, and a re-read that skipped the question leaves the
    // directory absent.
    const plain = makePlainDir('plain');
    const late = makeProject('late');
    const priv = resolveTrees(late, env).projectPrivate as string;

    const session = openSession({
      clientName: 'claude-code',
      roots: [pathToFileURL(plain).href],
      env,
    });
    // Not vacuous: the tree is absent while the session is on the global one, so the
    // assertion below is about this re-read rather than about the fixture.
    expect(existsSync(priv)).toBe(false);
    expect(session.who).toMatch(/^mnid:/);

    refreshWorkspace(session, [pathToFileURL(late).href]);

    expect(existsSync(priv)).toBe(true);
    // And the session says who it is out of that tree — the same answer a session
    // opened there from the start gives, which is what "as if the root had arrived at
    // the handshake" means.
    expect(session.who).toBe(
      openSession({
        clientName: 'claude-code',
        roots: [pathToFileURL(plain).href, pathToFileURL(late).href],
        env,
      }).who,
    );
  });

  it('does NOT ask again when the landing did not move', () => {
    // The other side, and it is what keeps the case above from being "re-read the
    // anchor on every notification": a session already in a project has its answer, and
    // asking again would open a writer over a tree per notification for nothing.
    const alpha = makeProject('alpha');
    const beta = makeProject('beta');
    const betaPriv = resolveTrees(beta, env).projectPrivate as string;
    const session = openSession({
      clientName: 'claude-code',
      roots: [pathToFileURL(alpha).href],
      env,
    });

    refreshWorkspace(session, [pathToFileURL(beta).href]);

    // `beta` is in the list and can be written to — and nothing has been opened in it.
    expect(session.workspaceProjects.map((project) => project.dir)).toContain(beta);
    expect(existsSync(betaPriv)).toBe(false);
  });

  it('runs the SAME cascade, so a configured project still wins', () => {
    // The configured path is carried on the session for this: a re-read that took
    // only the roots would be a second reading of "where is this session", and the
    // one rung that REFUSES rather than falling through would apply at the handshake
    // and be quietly dropped afterwards.
    const configured = makeProject('configured');
    const other = makeProject('other');
    const session = openSession({ clientName: 'claude-code', configProject: configured, env });
    expect(session.project).toBe(configured);

    refreshWorkspace(session, [pathToFileURL(other).href]);

    expect(session.project).toBe(configured);
    expect(session.workspaceProjects.map((project) => project.dir).sort()).toEqual(
      [configured, other].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// Why a re-read cannot land in the middle of a read
// ---------------------------------------------------------------------------

/** `packages/code/src`, for the guard below. */
const SRC = fileURLToPath(new URL('../src', import.meta.url));

/**
 * The source with its comments removed, so a guard about CODE cannot be satisfied —
 * or accused — by prose.
 *
 * This bench has been bitten both ways: a scan that matched from one string literal
 * into another accused the file it was scanning, and a mutation planted inside a
 * comment left the guard looking blind. The doc of the very module scanned here uses
 * the word this looks for, in a sentence about not using it.
 */
function code(file: string): string {
  return readFileSync(join(SRC, file), 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
}

describe('a re-read runs BETWEEN calls and never inside one', () => {
  it('holds every tool adapter synchronous, which is what makes that true', () => {
    // THE ARGUMENT THIS GUARDS. `refreshWorkspace` mutates the session, and the
    // question that decides whether that is safe is whether a read can observe the
    // session in two states. It cannot, and the reason is not a lock: every adapter in
    // `mcp/tools.ts` is synchronous, so once one starts it runs to completion before
    // the event loop can deliver a notification. The `await` in each tool's wrapper is
    // for `ensureSession()`, which is BEFORE the adapter is entered — a re-read that
    // arrives during it is seen whole by the read that follows.
    //
    // The day somebody makes an adapter async, that argument silently stops holding
    // and no behaviour test would notice. This is the point that goes red instead.
    const tools = code('mcp/tools.ts');
    expect(tools).not.toMatch(/\basync\b/);
    expect(tools).not.toMatch(/\bawait\b/);

    // NOT VACUOUS, in two directions. The file really was read (it holds the adapters
    // the assertions above are about) …
    expect(tools).toContain('export function runBootstrap');
    expect(tools.length).toBeGreaterThan(10_000);
    // … and the words really are findable by this scan where they exist: the server's
    // own wiring is full of both, and it is stripped of comments by the same function.
    const server = code('mcp/server.ts');
    expect(server).toMatch(/\basync\b/);
    expect(server).toMatch(/\bawait\b/);
  });

  it('reaches the cascade from exactly two places, and both are the same function', () => {
    // A3: a rule with two readings is a rule that diverges. `resolveContext` answers
    // "where is this session", and it is now asked twice — when the session opens and
    // when the client says the workspace changed. Both go through the ONE function, so
    // a rung added to the cascade (or the one rung that REFUSES) cannot apply at the
    // handshake and be quietly skipped afterwards.
    const session = code('mcp/session.ts');
    const calls = [...session.matchAll(/\bresolveContext\(/g)];
    expect(calls).toHaveLength(2);
    // And nothing outside this module reaches it at all.
    for (const file of ['mcp/server.ts', 'mcp/route.ts', 'mcp/locate.ts', 'mcp/tools.ts']) {
      expect(code(file), file).not.toMatch(/\bresolveContext\(/);
    }
  });
});
