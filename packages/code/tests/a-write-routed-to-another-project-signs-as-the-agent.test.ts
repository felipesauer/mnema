/**
 * A WRITE ROUTED TO ANOTHER PROJECT OF THE WORKSPACE SIGNS AS THE AGENT THAT PROJECT ENROLS.
 *
 * A connection asked to sign as an agent finds the key per tree. The trees of the project the
 * session opened in are given the agent; so must the trees of every OTHER project of the workspace,
 * because a write can land there too: by the `project` argument, or because a transition names an
 * id that only another project holds. Without it the write there found no agent, fell to the
 * person's root, and either minted a key (a machine that holds only the agent's) or signed as the
 * person in silence (a machine that holds both) while the project enrols the agent.
 *
 * And the close of a run: its `which` is read from the record at the moment it is written, because
 * the key is chosen then, not when the run opened.
 */

import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { type CatalogEvent, catalogUpcasters } from '@mnema/chain';
import { type DiscoveryEnv, orderedEvents, resolveTrees } from '@mnema/core';
import { deferredWrite, enrollAgentFromRequest } from '@mnema/core/write';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildMcpServer } from '../src/mcp/server.js';
import { closeSession, openSession, refreshWorkspace } from '../src/mcp/session.js';
import { runCaptureMemory, runRecordDecision } from '../src/mcp/tools.js';
import { type CliIo, run } from '../src/program.js';

type Scope = 'public' | 'private' | 'global';
type Reply = { isError?: boolean; content: { text: string }[] };

let sandbox: string;
let home: string;
let repo: string;
let other: string;
let env: DiscoveryEnv;
let originalCwd: string;
let originalHome: string | undefined;
let originalXdg: string | undefined;

async function mnema(...argv: string[]): Promise<{ out: string; err: string; failed: boolean }> {
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
  return { out: out.join('\n'), err: err.join('\n'), failed };
}

async function did(...argv: string[]): Promise<string> {
  const said = await mnema(...argv);
  expect(said.failed, `${argv.join(' ')}: ${said.err}`).toBe(false);
  return said.out;
}

const lineOf = (said: string): string => {
  const line = said.split('\n').find((one) => one.startsWith('mnema-agent-request:1:'));
  if (line === undefined) throw new Error(`setup: no request line in ${said}`);
  return line;
};

const fingerprintIn = (said: string): string => {
  const fp = said.match(/\b[0-9a-f]{64}\b/)?.[0];
  if (fp === undefined) throw new Error(`setup: no fingerprint in ${said}`);
  return fp;
};

function treeRoot(project: string, scope: Scope): string {
  const trees = resolveTrees(project, env);
  return (
    scope === 'public'
      ? trees.projectPublic
      : scope === 'private'
        ? trees.projectPrivate
        : trees.global
  ) as string;
}

function eventsIn(project: string, scope: Scope): CatalogEvent[] {
  return orderedEvents({ root: treeRoot(project, scope) }, catalogUpcasters());
}

/** Enrols the agent in one tree of one project, as `key enroll --agent` does for each tree it writes. */
function enrolledIn(project: string, scope: Scope, line: string): void {
  const write = deferredWrite(resolveTrees(project, env), scope);
  const done = enrollAgentFromRequest(write, { request: line });
  expect(done.ok, JSON.stringify(done)).toBe(true);
  write.checkpoint();
}

const keysIn = (root: string): string[] =>
  existsSync(join(root, 'keys'))
    ? readdirSync(join(root, 'keys')).filter((name) => name.endsWith('.key'))
    : [];

/** One connection that announces every one of `projects` as a root. */
async function connected(
  announced: string,
  agentKey: string,
  projects: readonly string[],
  call: (client: Client) => Promise<void>,
): Promise<void> {
  const { server } = buildMcpServer({ cwd: sandbox, env, log: () => {}, agentKey });
  const client = new Client({ name: announced, version: '1.0.0' }, { capabilities: { roots: {} } });
  client.setRequestHandler(ListRootsRequestSchema, () => ({
    roots: projects.map((project) => ({ uri: pathToFileURL(project).href })),
  }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  try {
    await call(client);
  } finally {
    await client.close();
  }
}

/** Makes the agent `claude`, enrols it in the three trees of the project, and returns its line. */
async function anAgent(): Promise<{ line: string; fingerprint: string }> {
  const identity = (await did('audit', 'accountability')).match(/mnid:[0-9a-f]{8}/)?.[0];
  const requested = await did(
    'key',
    'request',
    '--agent',
    'claude',
    '--anchor',
    identity as string,
  );
  await did('key', 'enroll', '--agent', lineOf(requested));
  return { line: lineOf(requested), fingerprint: fingerprintIn(requested) };
}

beforeEach(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-routed-agent-'));
  home = join(sandbox, 'home');
  repo = join(sandbox, 'repo');
  other = join(sandbox, 'other');
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

describe('a write routed to another project of the workspace', () => {
  it('signs as the agent that project enrols, and mints no key, on a machine that holds only the agent’s', async () => {
    const agent = await anAgent();
    // The other project: a copy of the record, which enrols the agent in its committed tree.
    cpSync(repo, other, { recursive: true });
    // A machine that mounts the agent's folder and nothing of the person's.
    const only = join(sandbox, 'only-the-agent');
    cpSync(join(home, '.mnema', 'agents'), join(only, '.mnema', 'agents'), { recursive: true });
    process.env.HOME = only;
    env = { home: only };
    const founded = (): number =>
      eventsIn(other, 'public').filter((event) => event.kind === 'identity.founded').length;
    expect(founded()).toBe(1);

    let reply: Reply | undefined;
    await connected('evil', 'claude', [repo, other], async (client) => {
      reply = (await client.callTool({
        name: 'record_decision',
        arguments: { title: 'Routed away', rationale: 'because', project: other },
      })) as Reply;
    });

    expect(reply?.isError, reply?.content[0]?.text).not.toBe(true);
    const recorded = eventsIn(other, 'public').filter(
      (event) => event.kind === 'decision.recorded',
    );
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.signerFp).toBe(agent.fingerprint);
    expect(recorded[0]?.which).toBe('claude');
    expect(founded()).toBe(1);
    expect(keysIn(join(only, '.mnema', 'identity'))).toEqual([]);
  });

  it('signs as the agent, not the person, where the person’s key is present too', async () => {
    const agent = await anAgent();
    cpSync(repo, other, { recursive: true });

    await connected('evil', 'claude', [repo, other], async (client) => {
      await client.callTool({
        name: 'record_decision',
        arguments: { title: 'Routed away', rationale: 'because', project: other },
      });
    });

    const recorded = eventsIn(other, 'public').filter(
      (event) => event.kind === 'decision.recorded',
    );
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.signerFp).toBe(agent.fingerprint);
    expect(recorded[0]?.which).toBe('claude');
  });

  it('signs as the agent a transition that lands there because the id is held there', async () => {
    const agent = await anAgent();
    cpSync(repo, other, { recursive: true });
    process.chdir(other);
    await did('decision', 'record', 'Held only by the other', 'because');
    process.chdir(repo);

    let reply: Reply | undefined;
    await connected('evil', 'claude', [repo, other], async (client) => {
      reply = (await client.callTool({
        name: 'decision_transition',
        arguments: { id: 'ADR-1', action: 'reject', note: 'turned down' },
      })) as Reply;
    });

    expect(reply?.isError, reply?.content[0]?.text).not.toBe(true);
    const moved = eventsIn(other, 'public').filter(
      (event) => event.kind === 'decision.transitioned',
    );
    const last = moved[moved.length - 1];
    expect(last?.signerFp).toBe(agent.fingerprint);
    expect(last?.which).toBe('claude');
  });
});

describe('a project the workspace learns of after the session opened', () => {
  it('signs there as the agent too, where the client announced its roots later', async () => {
    const agent = await anAgent();
    cpSync(repo, other, { recursive: true });
    const session = openSession({
      roots: [],
      clientName: 'evil',
      env,
      agentKey: 'claude',
      log: () => {},
    });
    refreshWorkspace(session, [pathToFileURL(repo).href, pathToFileURL(other).href]);

    const done = runRecordDecision(session, {
      title: 'Routed after a refresh',
      rationale: 'because',
      project: other,
    });
    closeSession(session);

    expect(done.ok, JSON.stringify(done)).toBe(true);
    const recorded = eventsIn(other, 'public').filter(
      (event) => event.kind === 'decision.recorded',
    );
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.signerFp).toBe(agent.fingerprint);
    expect(recorded[0]?.which).toBe('claude');
  });
});

describe('the close of a run', () => {
  it('stamps the agent the record names NOW when the agent was enrolled while the host was open', async () => {
    const requested = await did(
      'key',
      'request',
      '--agent',
      'claude',
      '--anchor',
      (await did('audit', 'accountability')).match(/mnid:[0-9a-f]{8}/)?.[0] as string,
    );
    const line = lineOf(requested);

    const session = openSession({
      roots: [pathToFileURL(repo).href],
      clientName: 'claude-code',
      env,
      agentKey: 'claude',
      log: () => {},
    });
    // The run opens before the agent is enrolled: the person signs it, declared.
    // The private tree and the global one open their runs here; the committed tree's opens after.
    expect(runCaptureMemory(session, { content: 'before the enrolment' }).ok).toBe(true);
    expect(runCaptureMemory(session, { content: 'a global one', scope: 'global' }).ok).toBe(true);
    for (const scope of ['public', 'private', 'global'] as const) enrolledIn(repo, scope, line);
    expect(
      runRecordDecision(session, { title: 'After the enrolment', rationale: 'because' }).ok,
    ).toBe(true);
    closeSession(session);

    // The run that opened BEFORE the enrolment is the one that tells: the public run opened after
    // it and would say the same with a name frozen at the opening.
    for (const scope of ['public', 'private', 'global'] as const) {
      const ended = eventsIn(repo, scope).filter((event) => event.kind === 'run.ended');
      expect(
        ended.map((event) => [event.which, event.signerFp]),
        scope,
      ).toEqual([['claude', fingerprintIn(requested)]]);
    }
    const opened = (scope: Scope): (string | undefined)[] =>
      eventsIn(repo, scope)
        .filter((event) => event.kind === 'run.started')
        .map((event) => event.which);
    expect(opened('private')).toEqual(['claude-code']);
    expect(opened('global')).toEqual(['claude-code']);
    expect(opened('public')).toEqual(['claude']);
    const verified = await mnema('verify');
    expect(verified.failed, verified.out + verified.err).toBe(false);
  });
});

describe('a record that enrols the agent in one tree only', () => {
  const scenario = async (
    enrolled: 'public' | 'private',
  ): Promise<{ fingerprint: string; memory: CatalogEvent; decision: CatalogEvent }> => {
    const requested = await did(
      'key',
      'request',
      '--agent',
      'claude',
      '--anchor',
      (await did('audit', 'accountability')).match(/mnid:[0-9a-f]{8}/)?.[0] as string,
    );
    enrolledIn(repo, enrolled, lineOf(requested));
    await connected('claude-code', 'claude', [repo], async (client) => {
      await client.callTool({
        name: 'capture_memory',
        arguments: { content: 'a private note' },
      });
      await client.callTool({
        name: 'record_decision',
        arguments: { title: 'A public decision', rationale: 'because' },
      });
    });
    const memory = eventsIn(repo, 'private').find((event) => event.kind === 'memory.captured');
    const decision = eventsIn(repo, 'public').find((event) => event.kind === 'decision.recorded');
    return {
      fingerprint: fingerprintIn(requested),
      memory: memory as CatalogEvent,
      decision: decision as CatalogEvent,
    };
  };

  it('names the agent only on the write of the tree that enrols it (private)', async () => {
    const seen = await scenario('private');
    expect(seen.memory.which).toBe('claude');
    expect(seen.memory.signerFp).toBe(seen.fingerprint);
    expect(seen.decision.which).toBe('claude-code');
    expect(seen.decision.signerFp).not.toBe(seen.fingerprint);
    const verified = await mnema('verify');
    expect(verified.failed, verified.out + verified.err).toBe(false);
  });

  it('names the agent only on the write of the tree that enrols it (public)', async () => {
    const seen = await scenario('public');
    expect(seen.decision.which).toBe('claude');
    expect(seen.decision.signerFp).toBe(seen.fingerprint);
    expect(seen.memory.which).toBe('claude-code');
    expect(seen.memory.signerFp).not.toBe(seen.fingerprint);
    const verified = await mnema('verify');
    expect(verified.failed, verified.out + verified.err).toBe(false);
  });
});
