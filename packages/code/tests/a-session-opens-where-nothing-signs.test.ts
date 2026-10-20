/**
 * A SESSION OPENS AND READS WHERE NOTHING SIGNS, MINTS NOTHING TO READ, AND REFUSES EACH WRITE IN
 * ITS OWN TREE.
 *
 * Opening a session asked "who would sign here?" of the signer, and the signer is made on first use:
 * a machine with no key of its own got one, in its HOME, for a connection that only read. And where
 * nobody could sign at all (the agent asked for is in the record of no tree the session reaches and
 * the person has no key on the machine, or the key is retired, or the record proves it a member of two
 * identities) the session did not open, so even `bootstrap` was refused. What is asserted:
 *
 *   - a connection that only reads, on a machine with no key, leaves HOME and the project's `.mnema/`
 *     exactly as it found them (the listing is compared, and no `identity/` appears), and its first
 *     write is the one that makes the key, founds the identity, and tells `resume` who it is;
 *   - on a machine that holds only the agent's key, the session opens and reads, and each write is
 *     refused with the code the record gives, in the words of the tree it was for.
 *
 * The order of a workspace's roots is held in `the-opening-refusal-says-which-trees-it-checked.test.ts`.
 */

import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { type CatalogEvent, catalogUpcasters } from '@mnema/chain';
import { type DiscoveryEnv, orderedEvents, resolveTrees } from '@mnema/core';
import {
  decodeAgentRequest,
  deferredWrite,
  enrollAgent,
  enrollFromRequest,
  ensureFounded,
  openTreeForWriting,
  requestEnrollment,
  retireAgentKey,
} from '@mnema/core/write';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildMcpServer } from '../src/mcp/server.js';
import { type CliIo, run } from '../src/program.js';
import { isTheDerivedCache } from './support/the-cache-is-not-the-record.js';

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

type Reply = { isError?: boolean; content: { text: string }[] };

let sandbox: string;
let home: string;
let repo: string;
let env: DiscoveryEnv;
let originalCwd: string;
let originalHome: string | undefined;
let originalXdg: string | undefined;

async function did(...argv: string[]): Promise<string> {
  const out: string[] = [];
  const err: string[] = [];
  let failed = false;
  const io: CliIo = {
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    fail: () => {
      failed = true;
    },
  };
  await run(argv, io);
  expect(failed, `${argv.join(' ')}: ${err.join('\n')}`).toBe(false);
  return out.join('\n');
}

const textOf = (reply: Reply): string => reply.content.map((block) => block.text).join('\n');

/** One connection of a host that announces `roots` and is asked to sign as `agentKey`, if any. */
async function connected(
  roots: readonly string[],
  agentKey: string | undefined,
  call: (client: Client) => Promise<void>,
): Promise<string[]> {
  const log: string[] = [];
  const { server } = buildMcpServer({
    cwd: sandbox,
    env,
    log: (line) => log.push(line),
    ...(agentKey === undefined ? {} : { agentKey }),
  });
  const client = new Client(
    { name: 'claude-code', version: '1.0.0' },
    { capabilities: { roots: {} } },
  );
  client.setRequestHandler(ListRootsRequestSchema, () => ({
    roots: roots.map((root) => ({ uri: pathToFileURL(root).href })),
  }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  try {
    await call(client);
  } finally {
    await client.close();
  }
  return log;
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  return (await client.callTool({ name, arguments: args })) as Reply;
}

/** Every directory and file under `dir`, with its size: what `find` would say, minus the derived cache. */
function listing(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (at: string): void => {
    for (const name of readdirSync(at).sort()) {
      const path = join(at, name);
      if (isTheDerivedCache(path)) continue;
      const stat = statSync(path);
      out.push(`${stat.isDirectory() ? 'D' : `F ${stat.size}`} ${path.slice(dir.length)}`);
      if (stat.isDirectory()) walk(path);
    }
  };
  walk(dir);
  return out;
}

function eventsIn(project: string, scope: 'projectPublic' | 'projectPrivate'): CatalogEvent[] {
  return orderedEvents({ root: resolveTrees(project, env)[scope] as string }, catalogUpcasters());
}

/** A machine with no key of its own: an empty HOME the project's record was never written from. */
function aStrangerMachine(): string {
  const stranger = join(sandbox, 'stranger');
  mkdirSync(stranger, { recursive: true });
  process.env.HOME = stranger;
  env = { home: stranger };
  return stranger;
}

/** The agent `claude` requested and, where `enrolled`, put in force in the project's three trees. */
async function theAgent(enrolled: boolean): Promise<string> {
  const identity = (await did('audit', 'accountability')).match(/mnid:[0-9a-f]{8}/)?.[0];
  const requested = await did(
    'key',
    'request',
    '--agent',
    'claude',
    '--anchor',
    identity as string,
  );
  if (enrolled) {
    const line = requested.split('\n').find((one) => one.startsWith('mnema-agent-request:1:'));
    await did('key', 'enroll', '--agent', line as string);
  }
  return requested.match(/\b[0-9a-f]{64}\b/)?.[0] as string;
}

/** A machine whose HOME holds the agent's key and what the record says of it, and no key of a person. */
function holdingOnlyTheAgent(...alsoKept: string[]): string {
  const only = join(sandbox, 'only-the-agent');
  for (const kept of ['agents', ...alsoKept]) {
    const from = join(home, '.mnema', kept);
    if (existsSync(from)) cpSync(from, join(only, '.mnema', kept), { recursive: true });
  }
  process.env.HOME = only;
  env = { home: only };
  return only;
}

beforeEach(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-opens-where-nothing-signs-'));
  home = join(sandbox, 'home');
  repo = join(sandbox, 'repo');
  mkdirSync(home, { recursive: true });
  mkdirSync(repo, { recursive: true });
  originalCwd = process.cwd();
  originalHome = process.env.HOME;
  originalXdg = process.env.XDG_DATA_HOME;
  process.env.HOME = home;
  process.env.XDG_DATA_HOME = join(sandbox, 'data');
  delete process.env.MNEMA_HOME;
  delete process.env.MNEMA_RUN;
  delete process.env.MNEMA_KEY_PASSPHRASE;
  delete process.env.MNEMA_AGENT_KEY;
  env = { home };
  process.chdir(repo);
  await did('init');
});

afterEach(() => {
  process.chdir(originalCwd);
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalXdg === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = originalXdg;
  rmSync(sandbox, { recursive: true, force: true });
});

/** A task and an accepted decision the team's record holds: what a collaborator reads. */
async function theTeamsRecord(): Promise<{ task: string; decision: string }> {
  const task = (await did('task', 'create', 'collate the ledger')).match(UUID)?.[0];
  const decided = await did(
    'decision',
    'record',
    'Keep the parser small',
    'It is read on every start',
  );
  const decision = decided.match(UUID)?.[0];
  await did('decision', 'move', 'accept', decision as string, '--note', 'agreed');
  return { task: task as string, decision: decision as string };
}

describe('a connection that only reads, on a machine with no key', () => {
  it('leaves HOME and the project’s record as it found them, whichever read it makes', async () => {
    const { task, decision } = await theTeamsRecord();
    const stranger = aStrangerMachine();
    const before = { home: listing(stranger), record: listing(join(repo, '.mnema')) };
    expect(before.home).toEqual([]);

    const answers: Record<string, boolean> = {};
    let declaredReads: string[] = [];
    const { tools } = buildMcpServer({ cwd: sandbox, env, log: () => undefined });
    declaredReads = tools.filter((tool) => tool.effect === 'reads').map((tool) => tool.act);
    await connected([repo], undefined, async (client) => {
      const reads: Record<string, Record<string, unknown>> = {
        bootstrap: {},
        focus: {},
        resume: {},
        next_actions: { id: task },
        guard: { id: task, action: 'start' },
        search: { term: 'ledger' },
        read_record: { id: decision },
        audit_timeline: { id: task },
        audit_refs: { id: task },
        governing_rules: { path: 'src/collate.ts' },
        audit_accountability: {},
        audit_exposure: {},
        audit_antipatterns: {},
      };
      for (const [name, args] of Object.entries(reads)) {
        answers[name] = (await call(client, name, args)).isError !== true;
      }
    });

    // The sweep is every tool that declares itself a read: a read added later is asked here too.
    expect(Object.keys(answers).sort()).toEqual([...declaredReads].sort());
    expect(Object.values(answers).every(Boolean), JSON.stringify(answers)).toBe(true);
    expect({ home: listing(stranger), record: listing(join(repo, '.mnema')) }).toEqual(before);
    expect(existsSync(join(stranger, '.mnema', 'identity'))).toBe(false);
  });

  it('makes the key at its first write, founds the identity, and tells resume who it is from then on', async () => {
    await theTeamsRecord();
    const stranger = aStrangerMachine();
    const foundings = (): number =>
      eventsIn(repo, 'projectPublic').filter((event) => event.kind === 'identity.founded').length;
    const was = foundings();

    let atFirst: Record<string, unknown> = {};
    let after: Record<string, unknown> = {};
    let written: Reply | undefined;
    await connected([repo], undefined, async (client) => {
      atFirst = JSON.parse(textOf(await call(client, 'resume')).split('\n')[0] as string);
      written = await call(client, 'record_decision', {
        title: 'Use a queue',
        rationale: 'bursts',
      });
      after = JSON.parse(textOf(await call(client, 'resume')).split('\n')[0] as string);
    });

    expect(written?.isError, textOf(written as Reply)).not.toBe(true);
    expect(textOf(written as Reply)).toContain('If you are new to this record');
    expect(
      readdirSync(join(stranger, '.mnema', 'identity', 'keys')).filter((name) =>
        name.endsWith('.key'),
      ),
    ).toHaveLength(1);
    expect(foundings()).toBe(was + 1);
    const founded = eventsIn(repo, 'projectPublic')
      .filter((event) => event.kind === 'identity.founded')
      .at(-1);
    expect(atFirst.actor).toBe('');
    expect(atFirst.lastRun).toBeNull();
    expect(after.actor).toBe(founded?.subject);
    expect(typeof (after.lastRun as { id?: string } | null)?.id).toBe('string');
  });
});

describe('a machine that holds only the agent, and the agent is not enrolled', () => {
  it('opens, reads what the record holds, and refuses each write in the words of its tree', async () => {
    await theTeamsRecord();
    await theAgent(false);
    const only = holdingOnlyTheAgent();
    const before = { home: listing(only), record: listing(join(repo, '.mnema')) };

    const replies: Record<string, Reply> = {};
    const log = await connected([repo], 'claude', async (client) => {
      replies.bootstrap = await call(client, 'bootstrap');
      replies.search = await call(client, 'search', { term: 'parser' });
      replies.decision = await call(client, 'record_decision', { title: 'No', rationale: 'no' });
      replies.memory = await call(client, 'capture_memory', { content: 'a note' });
      replies.global = await call(client, 'capture_memory', { content: 'a note', scope: 'global' });
    });

    expect(log.join('\n')).not.toContain('could not open session');
    expect(log.find((line) => line.startsWith('session opened'))).toContain(
      "who=(none yet — no key of this machine signs in this session's own trees)",
    );
    expect(replies.bootstrap?.isError).not.toBe(true);
    expect(textOf(replies.bootstrap as Reply)).toContain('Keep the parser small');
    expect(replies.search?.isError).not.toBe(true);
    expect(textOf(replies.search as Reply)).toContain('Keep the parser small');
    const refusal = (tree: string): string =>
      `Refused (AGENT_NOT_ENROLLED): the agent "claude" is not enrolled in ${tree}, and the key that would sign instead, yours, is not on this machine. In a terminal in this project: \`mnema key enroll --agent claude\`. Nothing was written.`;
    expect(textOf(replies.decision as Reply)).toContain(refusal("this project's committed tree"));
    expect(textOf(replies.memory as Reply)).toContain(refusal("this project's private tree"));
    expect(textOf(replies.global as Reply)).toContain(refusal("this machine's global tree"));
    expect(
      [replies.decision, replies.memory, replies.global].map((reply) => reply?.isError),
    ).toEqual([true, true, true]);
    expect({ home: listing(only), record: listing(join(repo, '.mnema')) }).toEqual(before);
  });
});

describe('a server asked to sign as a name that is no agent’s', () => {
  it('says so once at the opening, not once for each tree it reaches', async () => {
    await theTeamsRecord();
    const log = await connected([repo], 'Claude', async (client) => {
      await call(client, 'search', { term: 'parser' });
    });

    const said = log.filter((line) => line.startsWith('agent key "Claude"'));
    expect(said).toHaveLength(1);
    expect(said[0]).toContain('cannot sign: ');
  });
});

describe('a machine that holds only the agent, and the record has retired it', () => {
  async function writesAndReads(): Promise<{ read: Reply; wrote: Reply[]; log: string[] }> {
    let read: Reply | undefined;
    const wrote: Reply[] = [];
    const log = await connected([repo], 'claude', async (client) => {
      read = await call(client, 'search', { term: 'parser' });
      wrote.push(await call(client, 'record_decision', { title: 'No', rationale: 'no' }));
      wrote.push(await call(client, 'capture_memory', { content: 'a note' }));
    });
    return { read: read as Reply, wrote, log };
  }

  it('opens, reads, and refuses with the tree that retired it: in the committed tree', async () => {
    await theTeamsRecord();
    const fingerprint = await theAgent(true);
    const write = deferredWrite(resolveTrees(repo, env), 'public');
    expect(retireAgentKey(write, { fingerprint, reason: 'lent out' }).ok).toBe(true);
    write.checkpoint();
    holdingOnlyTheAgent();

    const { read, wrote, log } = await writesAndReads();

    expect(log.join('\n')).not.toContain('could not open session');
    expect(read.isError).not.toBe(true);
    expect(textOf(read)).toContain('Keep the parser small');
    for (const reply of wrote) {
      expect(reply.isError).toBe(true);
      expect(textOf(reply)).toContain(
        'Refused (REVOKED_KEY): the agent key "claude" was retired in this project\'s committed tree,',
      );
    }
  });

  it('opens, reads, and refuses in every tree when only the machine’s global tree retired it', async () => {
    await theTeamsRecord();
    const fingerprint = await theAgent(true);
    const write = deferredWrite(resolveTrees(repo, env), 'global');
    expect(retireAgentKey(write, { fingerprint, reason: 'lent out' }).ok).toBe(true);
    write.checkpoint();
    // What the machine's global tree says is what retired it: it is kept beside the agent's key.
    holdingOnlyTheAgent('global');

    const { read, wrote } = await writesAndReads();

    expect(read.isError).not.toBe(true);
    for (const reply of wrote) {
      expect(reply.isError).toBe(true);
      expect(textOf(reply)).toContain(
        'Refused (REVOKED_KEY): the agent key "claude" was retired in this machine\'s global tree,',
      );
    }
  });
});

describe('a machine that holds only the agent, and the record proves its key a member of two identities', () => {
  it('opens, reads, and refuses each write as ambiguous', async () => {
    await theTeamsRecord();
    const requested = await did(
      'key',
      'request',
      '--agent',
      'claude',
      '--anchor',
      ((await did('audit', 'accountability')).match(/mnid:[0-9a-f]{8}/) as RegExpMatchArray)[0],
    );
    const line = requested.split('\n').find((one) => one.startsWith('mnema-agent-request:1:'));
    const decoded = decodeAgentRequest(line as string);
    if (decoded === null) throw new Error('setup: the line does not decode');
    const trees = resolveTrees(repo, env);
    const publicRoot = trees.projectPublic as string;
    // Another contributor of the same repository takes the key into their identity first.
    const theirs = { ...trees, keyRoot: join(sandbox, 'the-other-contributor') };
    const theirAnchor = ensureFounded({
      writer: openTreeForWriting(theirs, 'public'),
      layout: { root: publicRoot },
      upcasters: catalogUpcasters(),
    });
    const joining = requestEnrollment({
      anchor: theirAnchor,
      keyRoot: join(home, '.mnema', 'agents', 'claude'),
    });
    if (!joining.ok) throw new Error(joining.message);
    expect(
      enrollFromRequest(deferredWrite(theirs, 'public'), { request: joining.request }).ok,
    ).toBe(true);
    // Then this machine's key enrols it as an agent of its own, which the record now cannot place.
    expect(
      enrollAgent(
        {
          writer: openTreeForWriting(trees, 'public'),
          layout: { root: publicRoot },
          upcasters: catalogUpcasters(),
        },
        { agentFp: decoded.key.fingerprint, name: 'claude', reverseSig: decoded.reverseSig },
      ).ok,
    ).toBe(true);
    holdingOnlyTheAgent();

    let read: Reply | undefined;
    const wrote: Reply[] = [];
    const log = await connected([repo], 'claude', async (client) => {
      read = await call(client, 'search', { term: 'parser' });
      wrote.push(await call(client, 'record_decision', { title: 'No', rationale: 'no' }));
      wrote.push(await call(client, 'capture_memory', { content: 'a note' }));
    });

    expect(log.join('\n')).not.toContain('could not open session');
    expect(read?.isError).not.toBe(true);
    for (const reply of wrote) {
      expect(reply.isError).toBe(true);
      expect(textOf(reply)).toContain(
        'Refused (AMBIGUOUS_MEMBERSHIP): the agent key "claude" cannot sign:',
      );
    }
  });
});

describe('a machine whose own key the record proves a member of two identities', () => {
  it('opens, reads, says why it has no one to open as, and refuses the write as ambiguous', async () => {
    const mine = join(sandbox, 'mine');
    mkdirSync(mine, { recursive: true });
    const nowhere = join(sandbox, 'nowhere');
    mkdirSync(nowhere, { recursive: true });
    const trees = resolveTrees(nowhere, { home: mine });
    const globalRoot = trees.global as string;
    // Two other machines each found an identity in this machine's global tree, and each vouches for
    // the key of this machine.
    for (const other of ['one', 'two']) {
      const theirs = { ...trees, keyRoot: join(sandbox, other) };
      const anchor = ensureFounded({
        writer: openTreeForWriting(theirs, 'global'),
        layout: { root: globalRoot },
        upcasters: catalogUpcasters(),
      });
      const joining = requestEnrollment({ anchor, keyRoot: trees.keyRoot });
      if (!joining.ok) throw new Error(joining.message);
      expect(
        enrollFromRequest(deferredWrite(theirs, 'global'), { request: joining.request }).ok,
      ).toBe(true);
    }
    process.env.HOME = mine;
    env = { home: mine };

    let read: Reply | undefined;
    let wrote: Reply | undefined;
    const log = await connected([nowhere], undefined, async (client) => {
      read = await call(client, 'search', {});
      wrote = await call(client, 'record_decision', { title: 'No', rationale: 'no' });
    });

    expect(log.join('\n')).not.toContain('could not open session');
    expect(log.some((line) => line.startsWith('no identity to open the session as here: '))).toBe(
      true,
    );
    expect(read?.isError).not.toBe(true);
    expect(wrote?.isError).toBe(true);
    expect(textOf(wrote as Reply)).toContain('Refused (AMBIGUOUS_MEMBERSHIP)');
  });
});

describe('the guard of a session that has no one to sign', () => {
  it('answers with the refusal the write would have, in the tree of the task', async () => {
    const { task } = await theTeamsRecord();
    await theAgent(false);
    holdingOnlyTheAgent();

    let reply: Reply | undefined;
    await connected([repo], 'claude', async (client) => {
      reply = await call(client, 'guard', { id: task, action: 'start' });
    });

    expect(reply?.isError).toBe(true);
    expect(textOf(reply as Reply)).toContain(
      'Refused (AGENT_NOT_ENROLLED): the agent "claude" is not enrolled in this project\'s committed tree, and the key that would sign instead, yours, is not on this machine.',
    );
  });

  it('answers the gate’s own refusal where there is no key at all, before the first write', async () => {
    const { task } = await theTeamsRecord();
    aStrangerMachine();

    let reply: Reply | undefined;
    await connected([repo], undefined, async (client) => {
      reply = await call(client, 'guard', { id: task, action: 'start' });
    });

    expect(reply?.isError).not.toBe(true);
    const verdict = JSON.parse(textOf(reply as Reply).split('\n')[0] as string);
    expect(verdict.verdict).toMatchObject({
      ok: false,
      code: 'MISSING_WHO',
      message: 'a transition needs a human who authorized it',
    });
  });
});

/**
 * Two projects in one workspace: `repo` (where the agent is NOT enrolled) and `second` (where it
 * is), the machine's HOME copied once per order of the roots so each order starts from the same bytes.
 */
async function aWorkspaceOfTwo(): Promise<{
  one: string;
  two: string;
  taskOne: string;
  taskTwo: string;
}> {
  const taskOne = (await did('task', 'create', 'in the first')).match(UUID)?.[0] as string;
  const second = join(sandbox, 'second');
  mkdirSync(second, { recursive: true });
  process.chdir(second);
  await did('init');
  const taskTwo = (await did('task', 'create', 'in the second')).match(UUID)?.[0] as string;
  await theAgent(true);
  process.chdir(repo);
  return { one: repo, two: second, taskOne, taskTwo };
}

type Seen = { guard: string; wrote: string };

/** What the guard said of `task` and what an equivalent move then did, in one connection. */
async function seenOf(client: Client, task: string, move = true): Promise<Seen> {
  const asked = await call(client, 'guard', { id: task, action: 'submit' });
  const guard = asked.isError
    ? textOf(asked)
    : JSON.stringify(JSON.parse(textOf(asked).split('\n')[0] as string).verdict);
  if (!move) return { guard, wrote: 'not tried' };
  const moved = await call(client, 'task_transition', { id: task, action: 'submit' });
  return { guard, wrote: moved.isError ? textOf(moved) : 'written' };
}

/** One order of the roots, over copies of the workspace so every order starts from the same bytes. */
async function inOrder(
  w: { one: string; two: string; taskOne: string; taskTwo: string },
  order: 'one-first' | 'two-first',
  holding: 'the person and the agent' | 'only the agent' | 'nothing',
  agentKey: string | undefined,
  moves: boolean,
): Promise<Record<string, Seen | string>> {
  const world = join(sandbox, `world-${order}`);
  cpSync(w.one, join(world, 'p1'), { recursive: true });
  cpSync(w.two, join(world, 'p2'), { recursive: true });
  const kept = join(world, holding === 'the person and the agent' ? 'home' : 'machine');
  if (holding === 'the person and the agent') cpSync(home, kept, { recursive: true });
  else mkdirSync(kept, { recursive: true });
  if (holding === 'only the agent') {
    cpSync(join(home, '.mnema', 'agents'), join(kept, '.mnema', 'agents'), { recursive: true });
  }
  process.env.HOME = kept;
  env = { home: kept };
  const roots =
    order === 'one-first'
      ? [join(world, 'p1'), join(world, 'p2')]
      : [join(world, 'p2'), join(world, 'p1')];
  const seen: Record<string, Seen | string> = {};
  await connected(roots, agentKey, async (client) => {
    for (const [name, task] of [
      ['second', w.taskTwo],
      ['first', w.taskOne],
    ] as const) {
      if (moves) seen[name] = await seenOf(client, task);
      else seen[name] = (await seenOf(client, task, false)).guard;
    }
  });
  return seen;
}

const NOT_ENROLLED =
  'Refused (AGENT_NOT_ENROLLED): the agent "claude" is not enrolled in this project\'s committed tree, and the key that would sign instead, yours, is not on this machine. In a terminal in this project: `mnema key enroll --agent claude`. Nothing was written.';
const ALLOWED = '{"ok":true,"to":"READY","action":"submit"}';
const NO_ONE =
  '{"ok":false,"code":"MISSING_WHO","message":"a transition needs a human who authorized it"}';

describe('the guard of a workspace of two projects, the agent enrolled in the second alone', () => {
  it('answers what the write would do in the TREE OF THE TASK, whichever root comes first', async () => {
    const w = await aWorkspaceOfTwo();
    const oneFirst = await inOrder(w, 'one-first', 'only the agent', 'claude', true);
    rmSync(join(sandbox, 'world-one-first'), { recursive: true, force: true });
    const twoFirst = await inOrder(w, 'two-first', 'only the agent', 'claude', true);

    const expected = {
      second: { guard: ALLOWED, wrote: 'written' },
      first: { guard: NOT_ENROLLED, wrote: `${NOT_ENROLLED} The fact was NOT recorded.` },
    };
    expect(oneFirst).toEqual(expected);
    expect(twoFirst).toEqual(expected);
  });

  it('is the same in both orders where the person’s key signs everywhere, and where nobody holds a key', async () => {
    const w = await aWorkspaceOfTwo();
    const signed = { guard: ALLOWED, wrote: 'written' };
    for (const order of ['one-first', 'two-first'] as const) {
      expect(await inOrder(w, order, 'the person and the agent', 'claude', true)).toEqual({
        second: signed,
        first: signed,
      });
      rmSync(join(sandbox, `world-${order}`), { recursive: true, force: true });
      expect(await inOrder(w, order, 'nothing', undefined, false)).toEqual({
        second: NO_ONE,
        first: NO_ONE,
      });
      rmSync(join(sandbox, `world-${order}`), { recursive: true, force: true });
    }
  });
});

/** What the guard and the write each said of one move of `task`, in one connection. */
async function pairOf(client: Client, task: string, action: string): Promise<Seen> {
  const asked = await call(client, 'guard', { id: task, action });
  const guard = asked.isError
    ? textOf(asked)
    : JSON.stringify(JSON.parse(textOf(asked).split('\n')[0] as string).verdict);
  const moved = await call(client, 'task_transition', { id: task, action });
  return { guard, wrote: moved.isError ? textOf(moved) : 'written' };
}

/** The person's key put under a passphrase, the variable set for that one command and taken away. */
async function protectThePersonsKey(): Promise<string> {
  process.env.MNEMA_KEY_PASSPHRASE = 'correct horse';
  try {
    await did('key', 'protect');
  } finally {
    delete process.env.MNEMA_KEY_PASSPHRASE;
  }
  const keys = join(home, '.mnema', 'identity', 'keys');
  return join(keys, readdirSync(keys).filter((name) => name.endsWith('.key'))[0] as string);
}

const NOT_RECORDED = ' The fact was NOT recorded.';

describe('the guard asks the key this machine would sign with, and answers the refusal the write gives', () => {
  it('says the person’s key is protected where no passphrase is at hand', async () => {
    const { task } = await theTeamsRecord();
    const file = await protectThePersonsKey();
    const refusal = `Refused (KEY_IS_PROTECTED): the private key at ${file} is protected by a passphrase and MNEMA_KEY_PASSPHRASE is not set, and there is no terminal to ask at. Run the command in a terminal, which asks. A host that signs for an agent has no terminal, and is not given the passphrase: it is given a key of its own — \`mnema key request --agent <name> --anchor <your identity>\` makes one, and \`mnema key enroll --agent <the line it prints>\` puts it in force, then tell the host to sign with it (\`mnema mcp --agent-key <name>\`, the plugin's \`agent_key\` option).`;

    const seen: Seen[] = [];
    await connected([repo], undefined, async (client) => {
      seen.push(await pairOf(client, task, 'cancel'));
      seen.push(await pairOf(client, task, 'submit'));
    });

    expect(seen).toEqual([
      { guard: refusal, wrote: `${refusal}${NOT_RECORDED}` },
      { guard: refusal, wrote: `${refusal}${NOT_RECORDED}` },
    ]);
  });

  it('lets the move through, as the write does, where the person’s key is protected and the passphrase is at hand', async () => {
    const { task } = await theTeamsRecord();
    await protectThePersonsKey();

    const seen: Seen[] = [];
    process.env.MNEMA_KEY_PASSPHRASE = 'correct horse';
    try {
      await connected([repo], undefined, async (client) => {
        seen.push(await pairOf(client, task, 'submit'));
      });
    } finally {
      delete process.env.MNEMA_KEY_PASSPHRASE;
    }

    expect(seen).toEqual([{ guard: ALLOWED, wrote: 'written' }]);
  });

  it('says the agent is not enrolled in the task’s tree where the person’s key that would sign instead is protected, and lets the project that enrols it through', async () => {
    const w = await aWorkspaceOfTwo();
    await protectThePersonsKey();
    const refusal =
      'Refused (AGENT_NOT_ENROLLED): the agent "claude" is not enrolled in this project\'s committed tree, and the key that would sign instead, yours, is protected by a passphrase and MNEMA_KEY_PASSPHRASE is not in the environment. In a terminal in this project: `mnema key enroll --agent claude`. Nothing was written.';

    const seen: Record<string, Seen> = {};
    await connected([w.one, w.two], 'claude', async (client) => {
      seen.cancelFirst = await pairOf(client, w.taskOne, 'cancel');
      seen.submitFirst = await pairOf(client, w.taskOne, 'submit');
      seen.submitSecond = await pairOf(client, w.taskTwo, 'submit');
    });

    expect(seen).toEqual({
      cancelFirst: { guard: refusal, wrote: `${refusal}${NOT_RECORDED}` },
      submitFirst: { guard: refusal, wrote: `${refusal}${NOT_RECORDED}` },
      submitSecond: { guard: ALLOWED, wrote: 'written' },
    });
  });

  it('says the agent key was retired where the person’s key is in the clear', async () => {
    const { task } = await theTeamsRecord();
    const fingerprint = await theAgent(true);
    const write = deferredWrite(resolveTrees(repo, env), 'global');
    expect(retireAgentKey(write, { fingerprint, reason: 'lent out' }).ok).toBe(true);
    write.checkpoint();
    const refusal =
      'Refused (REVOKED_KEY): the agent key "claude" was retired in this machine\'s global tree, and a retired key signs nothing in any tree it reaches from here. In a terminal, `mnema key request --agent claude --anchor <your identity>` makes the agent a new key and `mnema key enroll --agent <the line it prints>` puts it in force. Nothing was written.';

    const seen: Seen[] = [];
    await connected([repo], 'claude', async (client) => {
      seen.push(await pairOf(client, task, 'cancel'));
      seen.push(await pairOf(client, task, 'submit'));
    });

    expect(seen).toEqual([
      { guard: refusal, wrote: `${refusal}${NOT_RECORDED}` },
      { guard: refusal, wrote: `${refusal}${NOT_RECORDED}` },
    ]);
  });
});
