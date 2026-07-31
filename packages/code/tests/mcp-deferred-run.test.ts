/**
 * What a connection leaves behind, and what it says about where it landed.
 *
 * Three properties, tested over the real transport because each is a property of
 * the SERVER and not of an adapter: a session that only reads appends NOTHING, the
 * host's log names the project the cascade chose, and both the log and the opening
 * read say how many projects it chose FROM.
 *
 * The first used to be false. The run opened as soon as the handshake finished, so a
 * client that attached and called nothing still left an identity founding and a run
 * in whichever project the cascade picked — a record of a session nobody worked in.
 * The second was never true: the line named the agent, the anchor, the scope and the
 * run, and never the project, so a cascade that walked up into the wrong repository
 * did so invisibly. The third is the half the name alone cannot carry: one project
 * and four look identical from inside the session that landed on one of them, so
 * naming the winner does not tell a reader that there was a choice.
 *
 * The tests here are the ones that would go quiet if the run drifted back toward the
 * handshake, or if the line stopped saying where it is: the count of events after a
 * read-only session, the count of runs after concurrent writes, the chain's own
 * verdict after the first write and after the tenth, and what the log and the
 * `bootstrap` reply hold.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { catalogUpcasters, ensureTree, verify } from '@mnema/chain';
import { type DiscoveryEnv, orderedEvents, PROJECT_DIR, resolveTrees } from '@mnema/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildMcpServer } from '../src/mcp/server.js';

let sandbox: string;
let env: DiscoveryEnv;
/** Every line the server wrote to its log, in order. */
let logged: string[];

/** Makes a directory that IS a project (has a `.mnema/` tree), returns its path. */
function makeProject(name: string): string {
  const dir = join(sandbox, name);
  mkdirSync(dir, { recursive: true });
  ensureTree({ root: join(dir, PROJECT_DIR) });
  return dir;
}

/** A server whose log is captured, plus a connected client that exposes `roots`. */
async function connect(
  roots: readonly string[],
  clientName = 'claude-code',
): Promise<{ client: Client }> {
  const { server } = buildMcpServer({ env, log: (line) => logged.push(line) });
  const client = new Client(
    { name: clientName, version: '1.0.0' },
    { capabilities: { roots: {} } },
  );
  client.setRequestHandler(ListRootsRequestSchema, () => ({
    roots: roots.map((uri) => ({ uri })),
  }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return { client };
}

/** Every event in a tree, or none when the tree holds nothing. */
function eventsIn(root: string): readonly { kind: string; subject: string }[] {
  return orderedEvents({ root }, catalogUpcasters());
}

/** The text blocks of a tool reply, in order. */
function blocksOf(reply: unknown): readonly { type: string; text?: string }[] {
  return (reply as { content: { type: string; text?: string }[] }).content;
}

/** The sentence a run-answering read carries when this connection has no run. */
const NO_RUN_NOTE = 'has not opened a run of its own yet';

/**
 * Asserts the reply carries the note as its OWN block, and returns the payload.
 *
 * Every read that answers about runs makes the same two promises — the note is
 * there, and it is NOT in the JSON — so those live here. What each read answers
 * WITH is its own, so the payload goes back to the caller to be named there: that
 * is what keeps one test speaking for one call site instead of for the sentence.
 *
 * `blocks` is how many the reply should hold in all, because the note is always
 * the LAST one: `bootstrap` adds a sentence of its own about where the session
 * landed, and a count fixed at two here would have let that sentence and the note
 * trade places unnoticed.
 */
function payloadBesideTheNote(reply: unknown, blocks = 2): unknown {
  const content = blocksOf(reply);
  // The exact count: a note folded into the payload would still "contain" the
  // sentence while breaking the shape a caller parses.
  expect(content).toHaveLength(blocks);
  expect(content[blocks - 1]?.text).toContain(NO_RUN_NOTE);
  const payload = content[0]?.text ?? '';
  expect(payload).not.toContain(NO_RUN_NOTE);
  return JSON.parse(payload);
}

/** The kinds in a project's three trees, flattened — what the session left behind. */
function kindsLeftBy(project: string): string[] {
  const trees = resolveTrees(project, env);
  return [trees.projectPublic as string, trees.projectPrivate as string, trees.global].flatMap(
    (root) => eventsIn(root).map((e) => e.kind),
  );
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-deferred-run-'));
  const home = join(sandbox, 'home');
  mkdirSync(home, { recursive: true });
  env = { home, xdgDataHome: join(sandbox, 'data') };
  logged = [];
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe('a connection that only reads', () => {
  it('leaves NO events, through every read the surface has and its own close', async () => {
    const project = makeProject('proj');
    const { client } = await connect([pathToFileURL(project).href]);

    // Every read the server exposes, including the three that refuse an id nothing
    // holds and the one read that also writes (`skills`, which has nothing to serve
    // here and so records nothing).
    const unknown = '00000000-0000-7000-8000-000000000000';
    await client.callTool({ name: 'bootstrap' });
    await client.callTool({ name: 'focus' });
    await client.callTool({ name: 'resume' });
    await client.callTool({ name: 'search', arguments: {} });
    await client.callTool({ name: 'skills', arguments: {} });
    await client.callTool({ name: 'next_actions', arguments: { id: unknown } });
    await client.callTool({ name: 'guard', arguments: { id: unknown, action: 'submit' } });
    await client.callTool({ name: 'read_record', arguments: { id: unknown } });
    await client.callTool({ name: 'audit_timeline', arguments: { id: unknown } });
    await client.callTool({ name: 'audit_refs', arguments: { id: unknown } });
    await client.callTool({ name: 'audit_accountability', arguments: {} });
    await client.callTool({ name: 'audit_antipatterns' });
    await client.callTool({ name: 'audit_exposure' });

    await client.close();
    // The run used to be appended by a callback nobody awaited, so the count right
    // after a call was not the count a moment later. Give the old shape time to show.
    //
    // The connection's close is not reached here — this pair has no stdin to end and
    // no process to signal — and what a close leaves behind is the subject of
    // `mcp-session-close.test.ts`, which drives that seam directly.
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(kindsLeftBy(project)).toEqual([]);
  });

  // FOUR reads list the actor's runs, so four of them carry the note, and there is
  // a test per read. They are the same sentence, so what tells them apart is the
  // PAYLOAD each one answers with — `work`/`skills` for bootstrap, a bare
  // `openRuns` for focus, a `lastRun` for resume, a `verdict` for guard. Naming the
  // payload is what makes a missing note fall on the read that lost it: dropping
  // the note from `bootstrap` cannot be absorbed by the `focus` test, and the
  // failure says which.
  //
  // Not a loop over the four: a single parametrized test would report one failure
  // for four broken call sites, and which one broke is the answer worth having.

  it('is told by `bootstrap` — the opening read — that it has no run of its own', async () => {
    const project = makeProject('proj');
    const { client } = await connect([pathToFileURL(project).href]);

    // bootstrap EMBEDS resume, so it answers about runs; being the first thing an
    // agent calls, it is also the answer most likely to be read as a statement
    // about the asking session.
    // Three blocks: the answer, where this session is, then the run note last.
    const payload = payloadBesideTheNote(await client.callTool({ name: 'bootstrap' }), 3);
    // `work` and `skills` are bootstrap's and no other read's.
    expect(payload).toMatchObject({ work: [], skills: [], resume: { focus: { openRuns: [] } } });

    await client.close();
  });

  it('is told it has no run of its own, rather than shown an empty focus', async () => {
    const project = makeProject('proj');
    const { client } = await connect([pathToFileURL(project).href]);

    // The payload is the copilot's answer, unchanged; the note is its own block.
    const payload = payloadBesideTheNote(await client.callTool({ name: 'focus' }));
    // A bare `openRuns` with no `lastRun` beside it is focus's answer alone.
    expect(payload).toMatchObject({ openRuns: [] });
    expect(payload).not.toHaveProperty('lastRun');

    await client.close();
  });

  it('is told by `resume` that the run it is pointed at is not this connection’s', async () => {
    const project = makeProject('proj');
    const roots = [pathToFileURL(project).href];

    // A run that belongs to an EARLIER connection, so resume's answer here is not
    // empty — it names a real run. That is when the note earns its place: the run
    // is the actor's, from elsewhere, and without the sentence the reply reads as
    // "you are in the middle of this".
    const first = await connect(roots);
    await first.client.callTool({ name: 'create_task', arguments: { title: 'the real work' } });
    await first.client.close();

    const second = await connect(roots);
    const payload = payloadBesideTheNote(await second.client.callTool({ name: 'resume' })) as {
      readonly lastRun: { readonly id: string } | null;
    };
    const runs = eventsIn(join(project, PROJECT_DIR, 'private')).filter(
      (e) => e.kind === 'run.started',
    );
    // A `lastRun` naming a run, with no `work` beside it, is resume's answer alone.
    expect(payload.lastRun?.id).toBe(runs[0]?.subject);
    expect(payload).not.toHaveProperty('work');

    await second.client.close();
  });

  it('is told by `guard` too — its verdict travels with the asker’s focus', async () => {
    const project = makeProject('proj');
    const roots = [pathToFileURL(project).href];

    // A verdict needs a task to be about, and creating one is a WRITE — so it
    // happens in an earlier connection. This one only asks, which is the whole
    // point: `guard` is a dry-run, so it is a read that can be the ONLY thing a
    // session does, and its reply says "here is what you are in the middle of".
    const first = await connect(roots);
    const created = await first.client.callTool({
      name: 'create_task',
      arguments: { title: 'a task to ask about' },
    });
    const id = /\(([^)]+)\)/.exec(blocksOf(created)[0]?.text ?? '')?.[1] as string;
    await first.client.close();

    const second = await connect(roots);
    const payload = payloadBesideTheNote(
      await second.client.callTool({ name: 'guard', arguments: { id, action: 'submit' } }),
    ) as { readonly verdict: unknown };
    // A `verdict` next to a focus is guard's answer and no other read's.
    expect(payload.verdict).toMatchObject({ ok: true, to: 'READY' });
    expect(payload).toHaveProperty('focus');

    await second.client.close();
  });

  it('stops being told it once the write opens the run — in all four reads', async () => {
    const project = makeProject('proj');
    const { client } = await connect([pathToFileURL(project).href]);

    // The other half of the same honesty, and the one a note appended
    // unconditionally would break: a session that HAS a run must not be told it
    // has none. One test for the condition, not four — a broken condition is a
    // single fact about `withRunState`, not a fact about any one read.
    const created = await client.callTool({
      name: 'create_task',
      arguments: { title: 'the write that opens it' },
    });
    const id = /\(([^)]+)\)/.exec(blocksOf(created)[0]?.text ?? '')?.[1] as string;

    // `bootstrap` keeps its own second block — where this session landed is true
    // whether or not a run is open, and it is the note alone that must go.
    for (const { call, blocks: expected } of [
      { call: { name: 'bootstrap' }, blocks: 2 },
      { call: { name: 'focus' }, blocks: 1 },
      { call: { name: 'resume' }, blocks: 1 },
      { call: { name: 'guard', arguments: { id, action: 'submit' } }, blocks: 1 },
    ]) {
      const blocks = blocksOf(await client.callTool(call));
      expect(blocks, call.name).toHaveLength(expected);
      for (const block of blocks) expect(block.text, call.name).not.toContain(NO_RUN_NOTE);
    }

    await client.close();
  });

  it('asked where it left off, points at the run the work happened in', async () => {
    const project = makeProject('proj');
    const roots = [pathToFileURL(project).href];

    // One connection does some work.
    const first = await connect(roots);
    await first.client.callTool({ name: 'create_task', arguments: { title: 'the real work' } });
    await first.client.close();

    // A later connection asks the opening question. It used to be answered with the
    // empty run this very connection had just opened at the handshake — the reading a
    // session begins with, pointing at nothing.
    const second = await connect(roots);
    const reply = await second.client.callTool({ name: 'resume' });
    const resumed = JSON.parse(
      ((reply as { content: { text?: string }[] }).content[0]?.text ?? '') as string,
    ) as { lastRun: { id: string } | null };

    const runs = eventsIn(join(project, PROJECT_DIR, 'private')).filter(
      (e) => e.kind === 'run.started',
    );
    expect(runs).toHaveLength(1);
    expect(resumed.lastRun?.id).toBe(runs[0]?.subject);

    await second.client.close();
  });
});

describe('the first write opens the run', () => {
  it('opens exactly ONE run for five CONCURRENT writes', async () => {
    const project = makeProject('proj');
    const { client } = await connect([pathToFileURL(project).href]);

    // The five arrive together, and each one finds the run cell empty unless the
    // open is synchronous from the check to the assignment. A version that awaited
    // in between gave every write in flight the same empty cell to fill, and a
    // connection ended up with one run per write.
    await Promise.all(
      [1, 2, 3, 4, 5].map((n) =>
        client.callTool({ name: 'capture_memory', arguments: { content: `fact ${n}` } }),
      ),
    );

    const privateRoot = join(project, PROJECT_DIR, 'private');
    const events = eventsIn(privateRoot);
    expect(events.filter((e) => e.kind === 'run.started')).toHaveLength(1);
    // And all five facts hang off that one run, so the session's work is one session.
    expect(events.filter((e) => e.kind === 'memory.captured')).toHaveLength(5);

    await client.close();
  });

  it('leaves a chain that verifies — after the first write, and after the tenth', async () => {
    const project = makeProject('proj');
    const { client } = await connect([pathToFileURL(project).href]);
    const privateRoot = join(project, PROJECT_DIR, 'private');

    // The order inside the door is what this measures. Opening the run at the point
    // of USE — after the write's own context exists — puts a second writer on the
    // tree and the write lands with a stale predecessor: same events, same count,
    // and a chain that no longer verifies.
    await client.callTool({ name: 'capture_memory', arguments: { content: 'the first' } });
    expect(verify(privateRoot, catalogUpcasters()).ok).toBe(true);

    for (let n = 2; n <= 10; n += 1) {
      await client.callTool({ name: 'capture_memory', arguments: { content: `number ${n}` } });
    }
    const verdict = verify(privateRoot, catalogUpcasters());
    expect(verdict.ok).toBe(true);
    expect(verdict.fullySigned).toBe(true);
    // Ten writes, one run — the run belongs to the connection, not to the fact.
    expect(eventsIn(privateRoot).filter((e) => e.kind === 'run.started')).toHaveLength(1);

    await client.close();
  });

  it('routes a first write that overrides the scope, and still opens one run', async () => {
    const project = makeProject('proj');
    const { client } = await connect([pathToFileURL(project).href]);

    // The session's default scope is private; this write says public. The run is the
    // authority for the CONNECTION, so it opens where the session lives, and both
    // trees have to verify afterwards.
    await client.callTool({
      name: 'capture_memory',
      arguments: { content: 'a team-visible fact', scope: 'public' },
    });

    const publicRoot = join(project, PROJECT_DIR);
    const privateRoot = join(publicRoot, 'private');
    expect(eventsIn(publicRoot).map((e) => e.kind)).toContain('memory.captured');
    expect(eventsIn(privateRoot).filter((e) => e.kind === 'run.started')).toHaveLength(1);
    expect(verify(publicRoot, catalogUpcasters()).ok).toBe(true);
    expect(verify(privateRoot, catalogUpcasters()).ok).toBe(true);

    await client.close();
  });
});

describe('the log says where the session landed', () => {
  it('names the project the cascade resolved, not the directory the host announced', async () => {
    // The shape that makes this matter: a folder opened INSIDE a project that is not
    // the one the person means. The cascade walks up and lands on the repository
    // above; every step is right and the result can still be a surprise.
    const repo = makeProject('legacy');
    const notes = join(repo, 'notes');
    mkdirSync(notes, { recursive: true });

    const { client } = await connect([pathToFileURL(notes).href]);
    // Awaiting a tool is what guarantees the session has opened: the handshake
    // callback does not await it, so the line may not be written yet on return.
    await client.callTool({ name: 'focus' });

    const opened = logged.find((line) => line.startsWith('session opened:'));
    expect(opened).toContain(`project=${repo}`);
    expect(opened).not.toContain(notes);

    await client.close();
  });

  it('says the global tree when the cascade found no project', async () => {
    const { client } = await connect([]);
    await client.callTool({ name: 'focus' });

    expect(logged.find((line) => line.startsWith('session opened:'))).toContain(
      'project=(none — the global tree)',
    );

    await client.close();
  });

  it('says no run has opened, and then names the tree the run opened in', async () => {
    const project = makeProject('proj');
    const { client } = await connect([pathToFileURL(project).href]);
    await client.callTool({ name: 'focus' });

    expect(logged.find((line) => line.startsWith('session opened:'))).toContain(
      'runs=(none — the first write to a project opens that project’s run)',
    );
    expect(logged.some((line) => line.startsWith('session run '))).toBe(false);

    await client.callTool({ name: 'capture_memory', arguments: { content: 'something' } });
    // The tree is named, not just the run: a connection opens one run per project it
    // writes to, so a line that named only the run would leave a reader of the host's
    // log counting runs with nothing to pair them with on disk.
    const privateRoot = join(project, PROJECT_DIR, 'private');
    expect(
      logged.some((line) =>
        new RegExp(`^session run \\S+ opened in ${privateRoot} for which=claude-code$`).test(line),
      ),
    ).toBe(true);

    await client.close();
  });
});

describe('the session says how many projects it chose from', () => {
  it('the log counts them, and counts the one it walked up to', async () => {
    // The workspace the count exists for: a folder opened inside one project, and
    // another project beside it. The line names where the session landed and says
    // it was one of two — which is the whole of what the server honestly knows.
    const legacy = makeProject('legacy');
    const notes = join(legacy, 'notes');
    mkdirSync(notes, { recursive: true });
    const app = makeProject('app');

    const { client } = await connect([pathToFileURL(notes).href, pathToFileURL(app).href]);
    await client.callTool({ name: 'focus' });

    const opened = logged.find((line) => line.startsWith('session opened:')) as string;
    expect(opened).toContain(`project=${legacy}`);
    expect(opened).toContain('workspaceProjects=2');

    await client.close();
  });

  it('the log says one when the workspace holds one, and none outside a project', async () => {
    const project = makeProject('proj');
    const one = await connect([pathToFileURL(project).href]);
    await one.client.callTool({ name: 'focus' });
    expect(logged.find((line) => line.startsWith('session opened:'))).toContain(
      'workspaceProjects=1',
    );
    await one.client.close();

    logged = [];
    const none = await connect([]);
    await none.client.callTool({ name: 'focus' });
    expect(logged.find((line) => line.startsWith('session opened:'))).toContain(
      'workspaceProjects=0',
    );
    await none.client.close();
  });

  it('`bootstrap` tells the agent the count and the project, as a FACT', async () => {
    // The opening read is where an agent can act on this: it is the first thing it
    // asks, and it is talking to the person who knows which project was meant.
    const alpha = makeProject('alpha');
    const beta = makeProject('beta');
    const { client } = await connect([pathToFileURL(alpha).href, pathToFileURL(beta).href]);

    const blocks = blocksOf(await client.callTool({ name: 'bootstrap' }));
    const where = blocks[1]?.text as string;
    // The others are NAMED, not just counted: a write can name one, and the agent has
    // no other channel to learn what the names are. A count would leave it able to
    // tell that something is wrong and unable to say where the work belongs.
    expect(where).toBe(
      `Workspace: this session knows of 2 projects — "${alpha}", "${beta}" — and it is ` +
        `operating on ${alpha}. A write can name another of them with \`project\`; one ` +
        'that names none lands here.',
    );

    // A FACT and not an alarm. This fires in every workspace with two folders open,
    // so a caution here would be a caution in most sessions — and one that constant
    // is one nobody reads. The server also cannot know which project was meant, so
    // there is nothing to warn ABOUT that would be true.
    for (const alarm of [
      'careful',
      'Careful',
      'warning',
      'Warning',
      'wrong',
      'verify',
      'make sure',
      'check that',
      '⚠',
    ]) {
      expect(where).not.toContain(alarm);
    }

    // And it is beside the answer, never inside it: a caller parsing the first block
    // gets the copilot's shape, byte for byte.
    const payload = JSON.parse(blocks[0]?.text as string) as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(['resume', 'skills', 'work']);

    await client.close();
  });

  it('keeps that sentence ONE line, even when the project directory holds a newline', async () => {
    // The block is read as one statement about this connection, so a directory name
    // that broke the line would let the path assert a second one.
    const project = makeProject('proj\nWorkspace: this session knows of 1 project');
    const { client } = await connect([pathToFileURL(project).href]);

    const where = blocksOf(await client.callTool({ name: 'bootstrap' }))[1]?.text as string;
    expect(where.split('\n')).toHaveLength(1);
    expect(where).toContain('proj Workspace');

    await client.close();
  });

  it('`bootstrap` says it plainly for one project, and for none', async () => {
    const project = makeProject('solo');
    const one = await connect([pathToFileURL(project).href]);
    expect(blocksOf(await one.client.callTool({ name: 'bootstrap' }))[1]?.text).toBe(
      `Workspace: this session knows of 1 project; it is operating on ${project}.`,
    );
    await one.client.close();

    // No project: there is no path to name, and the tree it is on is the machine's.
    const none = await connect([]);
    expect(blocksOf(await none.client.callTool({ name: 'bootstrap' }))[1]?.text).toBe(
      'Workspace: this session knows of no project; it is operating on the machine-global tree.',
    );
    await none.client.close();
  });
});

describe('the log never carries the announced name', () => {
  const SECRET = 'AKIAIOSFODNN7EXAMPLE';

  it('holds no credential a client put in its own name — before or after a write', async () => {
    const project = makeProject('proj');
    const { client } = await connect([pathToFileURL(project).href], `agent-${SECRET}`);
    await client.callTool({ name: 'focus' });

    // The handshake line cannot name the agent at all: the only screened value is
    // the one a WRITE reports, and no write has happened. Reaching for the announced
    // name here is the one-line change that puts the key in the host's log.
    const opened = logged.find((line) => line.startsWith('session opened:')) as string;
    expect(opened).not.toContain(SECRET);
    expect(opened).not.toContain('which=');

    await client.callTool({ name: 'capture_memory', arguments: { content: 'a fact' } });

    // Once the run exists the agent IS named — as the chain recorded it.
    const runLine = logged.find((line) => line.startsWith('session run ')) as string;
    expect(runLine).toContain('which=agent-<SECRET:aws-access-key>');
    for (const line of logged) expect(line).not.toContain(SECRET);

    await client.close();
  });

  it('keeps every line ONE line, even when the name carries a newline', async () => {
    const project = makeProject('proj');
    const { client } = await connect([pathToFileURL(project).href], 'nice\nsession run forged');
    await client.callTool({ name: 'capture_memory', arguments: { content: 'a fact' } });

    // The log is read one event per line, so a name holding a newline would write a
    // second event nothing happened in.
    for (const line of logged) expect(line).not.toContain('\n');

    await client.close();
  });
});
