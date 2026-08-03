/**
 * What a connection ENDING records, and what an open run tells the session that asks
 * about it.
 *
 * Both halves used to be false, and they were false together. No MCP session closed
 * its run — in six of six exit modes, `run.started` without `run.ended` — because the
 * only caller of `closeSession` was a transport hook the SDK never fires. So a machine
 * accumulated one open run per session forever, `focus` listed them as identical
 * lines, and the note that would have qualified them switched OFF for exactly the
 * session that had written and therefore had its own run in the list.
 *
 * The close is exercised through `armClose`, the seam `connect()` uses, with a FAKE
 * process: signalling the real one would signal the test runner, and stdio here is an
 * in-memory pair with no stdin to end. What that leaves unproven is the one line where
 * `connect()` calls it — proven instead by the six-mode probe against `mnema mcp` over
 * real stdio, whose table is the entry's headline number.
 *
 * Nothing here asserts that an old run is DEAD. The record holds no fact about a
 * process, and two sessions provably alive at once falsify every rule that would let
 * one session close another's run. So the tests below check what is reported — whose
 * the run is, how old, how long idle — and there is deliberately no test for a sweeper,
 * because there deliberately is no sweeper.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { catalogUpcasters, ensureTree } from '@mnema/chain';
import { type DiscoveryEnv, orderedEvents, PROJECT_DIR, resolveTrees } from '@mnema/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Lifecycle } from '../src/mcp/lifecycle.js';
import { buildMcpServer } from '../src/mcp/server.js';

let sandbox: string;
let env: DiscoveryEnv;
let logged: string[];

/** A process whose signals and stdin a test can fire. */
function fakeLifecycle(): Lifecycle & {
  readonly fire: (event: string) => void;
  readonly fireStdin: (event: string) => void;
} {
  const handlers = new Map<string, (() => void)[]>();
  const stdin = new Map<string, (() => void)[]>();
  const add = (map: Map<string, (() => void)[]>, event: string, handler: () => void): void => {
    map.set(event, [...(map.get(event) ?? []), handler]);
  };
  return {
    on: (event, handler) => add(handlers, event, handler),
    off: (event, handler) => {
      handlers.set(
        event,
        (handlers.get(event) ?? []).filter((h) => h !== handler),
      );
    },
    // Swallowed: a re-raise in this process would take the test runner down with it.
    // What the re-raise itself does is pinned in `lifecycle.test.ts`.
    raise: () => {},
    onStdin: (event, handler) => add(stdin, event, handler),
    fire: (event) => {
      for (const handler of [...(handlers.get(event) ?? [])]) handler();
    },
    fireStdin: (event) => {
      for (const handler of [...(stdin.get(event) ?? [])]) handler();
    },
  };
}

/** Makes a directory that IS a project (has a `.mnema/` tree), returns its path. */
function makeProject(name: string): string {
  const dir = join(sandbox, name);
  mkdirSync(dir, { recursive: true });
  ensureTree({ root: join(dir, PROJECT_DIR) });
  return dir;
}

/** A connected client, plus the seam that arms this connection's close. */
async function connect(
  roots: readonly string[],
  clientName = 'claude-code',
): Promise<{
  client: Client;
  end: (how?: 'SIGTERM' | 'SIGINT' | 'stdin') => void;
  endTwice: () => void;
}> {
  const { server, armClose } = buildMcpServer({ env, log: (line) => logged.push(line) });
  const client = new Client(
    { name: clientName, version: '1.0.0' },
    { capabilities: { roots: {} } },
  );
  client.setRequestHandler(ListRootsRequestSchema, () => ({
    roots: roots.map((uri) => ({ uri })),
  }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  const lifecycle = fakeLifecycle();
  armClose(lifecycle);
  return {
    client,
    end: (how = 'SIGTERM') => {
      if (how === 'stdin') lifecycle.fireStdin('end');
      else lifecycle.fire(how);
    },
    endTwice: () => {
      lifecycle.fireStdin('end');
      lifecycle.fireStdin('close');
      lifecycle.fire('SIGTERM');
    },
  };
}

/** Every event kind in a project's three trees, flattened. */
function kindsIn(project: string): string[] {
  const trees = resolveTrees(project, env);
  return [trees.projectPublic as string, trees.projectPrivate as string, trees.global].flatMap(
    (root) => orderedEvents({ root }, catalogUpcasters()).map((e) => e.kind),
  );
}

/** How many `run.started` and `run.ended` a project's record holds. */
function runTally(project: string): { started: number; ended: number } {
  const kinds = kindsIn(project);
  return {
    started: kinds.filter((k) => k === 'run.started').length,
    ended: kinds.filter((k) => k === 'run.ended').length,
  };
}

/**
 * The `run.ended` facts a project's record holds — read off the DISK, not off a
 * reply, because what is under test is what the close appended.
 */
function endsIn(project: string) {
  const trees = resolveTrees(project, env);
  return [trees.projectPublic as string, trees.projectPrivate as string, trees.global].flatMap(
    (root) => orderedEvents({ root }, catalogUpcasters()).filter((e) => e.kind === 'run.ended'),
  );
}

/** The JSON payload of a tool reply — always its first content block. */
function payloadOf(reply: unknown): Record<string, unknown> {
  const content = (reply as { content: { text?: string }[] }).content;
  return JSON.parse(content[0]?.text ?? '{}') as Record<string, unknown>;
}

/** A reported open run, as the reads hand it back. */
interface Reported {
  readonly id: string;
  readonly thisSession: boolean;
  readonly ageSeconds?: number;
  readonly idleSeconds?: number;
}

/** The open runs a `focus` reply lists. */
function openRunsOf(reply: unknown): readonly Reported[] {
  return (payloadOf(reply) as { openRuns: Reported[] }).openRuns;
}

/** Records one fact, so the session has a run to close. */
async function writeSomething(
  client: Client,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  return client.callTool({
    name: 'capture_memory',
    arguments: { content: 'a fact worth a run', ...args },
  });
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-session-close-'));
  const home = join(sandbox, 'home');
  mkdirSync(home, { recursive: true });
  env = { home, xdgDataHome: join(sandbox, 'data') };
  logged = [];
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe('a connection that ends', () => {
  it.each(['SIGTERM', 'SIGINT', 'stdin'] as const)('records the run’s end on %s', async (how) => {
    const project = makeProject('proj');
    const { client, end } = await connect([pathToFileURL(project).href]);
    await writeSomething(client);
    expect(runTally(project)).toEqual({ started: 1, ended: 0 });

    end(how);

    // The half that was missing in all six exit modes: the record now says the
    // session finished, and it says so in the tree that started it.
    expect(runTally(project)).toEqual({ started: 1, ended: 1 });
    expect(logged.some((line) => line.startsWith('session closed: 1 run closed'))).toBe(true);
    await client.close();
  });

  it('ends the run of EVERY project it wrote to, each in that project’s own record', async () => {
    // A connection holds one run per destination since writes began routing by
    // project. A close that reached only the session's own tree would end one run and
    // leave the others open forever — and nothing afterwards could ever come back to
    // them, because this connection was the only party that knew they were its own.
    const a = makeProject('alpha');
    const b = makeProject('beta');
    const c = makeProject('gamma');
    const { client, end } = await connect([a, b, c].map((p) => pathToFileURL(p).href));
    await writeSomething(client);
    await writeSomething(client, { project: 'beta' });
    await writeSomething(client, { project: 'gamma' });

    end();

    for (const project of [a, b, c]) {
      expect(runTally(project)).toEqual({ started: 1, ended: 1 });
    }
    // Named, not counted: the log line is what pairs a run with the record a reader
    // can find it in.
    const closeLine = logged.find((line) => line.startsWith('session closed:')) ?? '';
    expect(closeLine).toContain('3 runs closed');
    await client.close();
  });

  it('credits the close to the AGENT that connected, read back off the disk', async () => {
    // The defect this closes, on the surface where it was measured: a session opened
    // `for claude` was closed, in the record, by nobody — `run.ended` carried no
    // `which` at all, so every read credited the seal to the person whose anchor
    // authorized the session. The agent is not asked for: the connection announced
    // its name at the handshake and the session has held it since, so a close that
    // took it from the wire could name an agent other than the one that worked.
    const project = makeProject('proj');
    const { client, end } = await connect([pathToFileURL(project).href], 'cursor');
    await writeSomething(client);

    // Through the same seam the rest of this file uses, for the reason its module doc
    // gives: the in-memory pair has no stdin to end and signalling the real process
    // would take the runner down. What `client.close()` over REAL stdio records is
    // proven by the probe beside this delivery, against the built binary.
    end('stdin');

    const ended = endsIn(project);
    expect(ended).toHaveLength(1);
    expect(ended[0]?.which).toBe('cursor');
    // The `who` is still the anchor that AUTHORIZED the session: the closer did not
    // become the authorizer, and the two roles stay distinct on the sealing fact the
    // way they are on every fact inside it.
    expect(ended[0]?.who).not.toBe('cursor');
    expect(ended[0]?.who?.startsWith('mnid:')).toBe(true);
    await client.close();
  });

  it('credits EVERY project’s close to that same agent — one connection, one executor', async () => {
    // A connection opens a run per project it writes to, so the close writes one
    // sealing fact per record. All of them were executed by the one agent that
    // connected — there is no second executor to attribute anything to — and a read
    // in any of those projects has to be able to say so on its own.
    const a = makeProject('alpha');
    const b = makeProject('beta');
    const { client, end } = await connect(
      [a, b].map((p) => pathToFileURL(p).href),
      'agent-two-projects',
    );
    await writeSomething(client);
    await writeSomething(client, { project: 'beta' });

    end();

    for (const project of [a, b]) {
      const ended = endsIn(project);
      expect(ended).toHaveLength(1);
      expect(ended[0]?.which).toBe('agent-two-projects');
    }
    await client.close();
  });

  it('writes ONE end per run even when every trigger fires', async () => {
    // A host that closes the pipe and then terminates the child does both. An
    // append-only record has no way to take a duplicate back.
    const project = makeProject('proj');
    const { client, endTwice } = await connect([pathToFileURL(project).href]);
    await writeSomething(client);

    endTwice();

    expect(runTally(project)).toEqual({ started: 1, ended: 1 });
    expect(logged.filter((line) => line.startsWith('session closed:'))).toHaveLength(1);
    await client.close();
  });

  it('leaves NOTHING behind when it only read', async () => {
    // Closing is the last chance to write, which makes it exactly the place a
    // read-only connection could be given a whole run — a founding, a start and an
    // end — in a project it never touched.
    const project = makeProject('proj');
    const { client, end } = await connect([pathToFileURL(project).href]);
    await client.callTool({ name: 'focus' });
    await client.callTool({ name: 'resume' });

    end();

    expect(kindsIn(project)).toEqual([]);
    expect(logged).toContain('session closed: no run was opened (nothing was written)');
    await client.close();
  });

  it('refuses a write that was still in flight, instead of recording it past the end', async () => {
    // Measured, and it is the defect the close itself introduced: a host that
    // disconnects closes the pipe while a request is in flight, the close runs to
    // completion synchronously, and the tool's continuation resumed AFTER it — landing
    // a fact pinned to the run the close had just ended. `verify` said `ok`, and the
    // record said work happened inside a session it also said was over.
    //
    // So the door refuses once the connection has ended. `run.ended` is the LAST event
    // of the session, and the caller is told the call did not happen.
    const project = makeProject('proj');
    const { client, end } = await connect([pathToFileURL(project).href]);
    await writeSomething(client);

    const inFlight = writeSomething(client, { content: 'written as the connection ended' });
    end('stdin');
    const reply = (await inFlight) as { isError?: boolean; content: { text?: string }[] };

    expect(reply.isError).toBe(true);
    expect(reply.content[0]?.text).toContain('this connection has ended');
    // One fact, and the end after it — nothing pinned to a run the record has closed.
    expect(kindsIn(project)).toEqual([
      'identity.founded',
      'run.started',
      'memory.captured',
      'run.ended',
    ]);
    await client.close();
  });
});

describe('what an open run says about itself', () => {
  it('tells the asker’s own run from the ones left behind, and ages them all', async () => {
    // Ten sessions that were killed (they never reach a close), then an eleventh that
    // asks. The list is not pruned and not ranked — nothing here decides another
    // session is dead — but it is no longer ten identical lines.
    const project = makeProject('proj');
    const root = pathToFileURL(project).href;
    for (let i = 0; i < 10; i += 1) {
      const { client } = await connect([root]);
      await writeSomething(client);
      await client.close();
    }
    const { client, end } = await connect([root]);
    await writeSomething(client);

    const runs = openRunsOf(await client.callTool({ name: 'focus' }));
    expect(runs).toHaveLength(11);
    // Exactly one is this session's, and it is the one this session opened.
    expect(runs.filter((r) => r.thisSession)).toHaveLength(1);
    // Every one of them carries an age, the abandoned included: the reads report what
    // an asker can be told, and "how long has this been open" is that.
    expect(runs.every((r) => typeof r.ageSeconds === 'number')).toBe(true);

    end();
    // Ending this one leaves the other ten open. Nothing closes a run it did not
    // open — the rule two provably-live sessions demand.
    expect(runTally(project)).toEqual({ started: 11, ended: 1 });
    await client.close();
  });

  it('answers `resume` with THIS session’s run while another session is live', async () => {
    // The measured contra-example, and the test that matters most: two sessions alive
    // at once share the machine's anchor, so before this the later `startedAt` won and
    // agent A was handed agent B's open run as "where you left off".
    //
    // The ORDER is what makes this discriminate, and it is the order that was measured:
    // A's run opens FIRST, B's second, and then A asks. With the newest run winning, A
    // is handed B's — so this fails on the old rule instead of agreeing with it by
    // accident. (Written the other way round it passed either way.)
    const project = makeProject('proj');
    const root = pathToFileURL(project).href;
    const a = await connect([root], 'agent-a');
    await writeSomething(a.client);
    const b = await connect([root], 'agent-b');
    await writeSomething(b.client);

    const resume = payloadOf(await a.client.callTool({ name: 'resume' }));
    const lastRun = resume.lastRun as Reported & { agent: string };
    expect(lastRun.thisSession).toBe(true);
    expect(lastRun.agent).toBe('agent-a');
    // B's run is still there, still open, and still reported — as not this session's.
    const runs = openRunsOf(await a.client.callTool({ name: 'focus' }));
    expect(runs).toHaveLength(2);
    expect(runs.filter((r) => !r.thisSession)).toHaveLength(1);

    a.end();
    b.end();
    expect(runTally(project)).toEqual({ started: 2, ended: 2 });
    await a.client.close();
    await b.client.close();
  });

  it('keeps qualifying the runs of a session that HAS already written', async () => {
    // This is what the old note could not do. It was suppressed the moment
    // `session.runs` was non-empty, so a connection an hour into recording work saw
    // every leftover run with no qualifier at all — the state where telling them apart
    // is worth the most. The qualifier is a property of the run now, so writing cannot
    // switch it off.
    const project = makeProject('proj');
    const root = pathToFileURL(project).href;
    const other = await connect([root], 'someone-else');
    await writeSomething(other.client);

    const { client, end } = await connect([root]);
    await writeSomething(client);
    const runs = openRunsOf(await client.callTool({ name: 'focus' }));

    expect(runs).toHaveLength(2);
    expect(runs.filter((r) => r.thisSession)).toHaveLength(1);
    expect(runs.filter((r) => !r.thisSession)).toHaveLength(1);
    // And the sentence about the connection is gone, because this connection HAS a
    // run — the sentence only ever answered that.
    const blocks = ((await client.callTool({ name: 'focus' })) as { content: { text?: string }[] })
      .content;
    expect(blocks).toHaveLength(1);

    end();
    other.end();
    await client.close();
    await other.client.close();
  });

  it('keeps its own run marked as its own after writing to a project it had not touched', async () => {
    // The mark is derived per call from every run the session holds, not captured once
    // — so a connection that reaches a second project mid-session does not lose track
    // of the first project's run being its own. A set fixed at the first write, or one
    // keyed to the session's own tree, would have.
    const a = makeProject('alpha');
    const b = makeProject('beta');
    const { client, end } = await connect([a, b].map((p) => pathToFileURL(p).href));
    await writeSomething(client);
    const beforeSecondProject = openRunsOf(await client.callTool({ name: 'focus' }));
    expect(beforeSecondProject.map((r) => r.thisSession)).toEqual([true]);

    await writeSomething(client, { project: 'beta' });

    const after = openRunsOf(await client.callTool({ name: 'focus' }));
    expect(after.map((r) => r.thisSession)).toEqual([true]);
    expect(after[0]?.id).toBe(beforeSecondProject[0]?.id);

    end();
    for (const project of [a, b]) expect(runTally(project)).toEqual({ started: 1, ended: 1 });
    await client.close();
  });

  it('says a run has recorded NOTHING rather than calling it idle for no time', async () => {
    // A run with no fact pinned to it is a real state, measured: a kill 5 ms after the
    // append leaves exactly this. Reached here the way the surface can reach it — a
    // write refused after its run had opened — and the point is what is NOT reported:
    // `idleSeconds` is absent, because there is no last fact to measure from, and
    // reporting the age there would be answering a different question with this one's
    // name.
    const project = makeProject('proj');
    const { client, end } = await connect([pathToFileURL(project).href]);
    const refused = (await writeSomething(client, { content: 'x'.repeat(70_000) })) as {
      isError?: boolean;
    };
    expect(refused.isError).toBe(true);

    const runs = openRunsOf(await client.callTool({ name: 'focus' }));
    expect(runs).toHaveLength(1);
    expect(runs[0]?.thisSession).toBe(true);
    expect(runs[0]?.ageSeconds).toBeTypeOf('number');
    expect(runs[0]).not.toHaveProperty('idleSeconds');

    end();
    await client.close();
  });

  it('measures idleness from the last fact, not from the start', async () => {
    const project = makeProject('proj');
    const { client, end } = await connect([pathToFileURL(project).href]);
    await writeSomething(client);

    const runs = openRunsOf(await client.callTool({ name: 'focus' }));
    expect(runs).toHaveLength(1);
    // Both present, and idleness cannot exceed the age: the last fact of a run is
    // never older than the run.
    const run = runs[0] as Reported;
    expect(run.idleSeconds).toBeTypeOf('number');
    expect(run.idleSeconds as number).toBeLessThanOrEqual(run.ageSeconds as number);

    end();
    await client.close();
  });
});
