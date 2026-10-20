/**
 * A WRITE ROUTED TO A PROJECT THAT DOES NOT ENROL THE AGENT SAYS THE PERSON SIGNED IT.
 *
 * A server asked to sign as an agent says, at the opening, where the agent is not in force in the
 * trees of its own session. A write can be routed to ANOTHER project of the workspace (by the
 * `project` argument, or by a transition on an id only that project holds) and where that project
 * does not enrol the agent the person's key signs, with a `which` the client merely declared. That
 * is true and was said nowhere. The reply of such a write says it, once, in the words of the
 * opening's notice.
 *
 * Seven verbs take `project`; each is driven over the real transport, and the claim is checked
 * against the disk: the event the write left is signed by the person's key, under the declared
 * name, not by the agent's.
 */

import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
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
import { openSession } from '../src/mcp/session.js';
import { runLinkKnowledge, runRetractLink } from '../src/mcp/tools.js';
import { type CliIo, run } from '../src/program.js';

type Scope = 'public' | 'private' | 'global';

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

const requestLineOf = (said: string): string => {
  const line = said.split('\n').find((one) => one.startsWith('mnema-agent-request:1:'));
  if (line === undefined) throw new Error(`setup: no request line in ${said}`);
  return line;
};

const fingerprintIn = (said: string): string => {
  const fp = said.match(/\b[0-9a-f]{64}\b/)?.[0];
  if (fp === undefined) throw new Error(`setup: no fingerprint in ${said}`);
  return fp;
};

function eventsIn(project: string, scope: Scope): CatalogEvent[] {
  const trees = resolveTrees(project, env);
  const root =
    scope === 'public'
      ? trees.projectPublic
      : scope === 'private'
        ? trees.projectPrivate
        : trees.global;
  return orderedEvents({ root: root as string }, catalogUpcasters());
}

/** Every event of `kind` the project holds, in any of its trees. */
const ofKind = (project: string, kind: string): CatalogEvent[] =>
  (['public', 'private'] as const).flatMap((scope) =>
    eventsIn(project, scope).filter((event) => event.kind === kind),
  );

/** Makes the agent `claude`, enrols it in the three trees of `repo`, and returns its fingerprint. */
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
  await did('key', 'enroll', '--agent', requestLineOf(requested));
  return { line: requestLineOf(requested), fingerprint: fingerprintIn(requested) };
}

/** A second project the person's key founded, which does not enrol the agent. */
async function aSecondProject(): Promise<void> {
  mkdirSync(other, { recursive: true });
  process.chdir(other);
  await did('init');
  process.chdir(repo);
}

async function connected(
  agentKey: string | undefined,
  call: (client: Client) => Promise<void>,
  moreRoots: readonly string[] = [],
): Promise<void> {
  const { server } = buildMcpServer({
    cwd: sandbox,
    env,
    log: () => {},
    ...(agentKey !== undefined ? { agentKey } : {}),
  });
  const client = new Client({ name: 'evil', version: '1.0.0' }, { capabilities: { roots: {} } });
  client.setRequestHandler(ListRootsRequestSchema, () => ({
    roots: [repo, other, ...moreRoots].map((dir) => ({ uri: pathToFileURL(dir).href })),
  }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  try {
    await call(client);
  } finally {
    await client.close();
  }
}

async function say(client: Client, name: string, args: Record<string, unknown>): Promise<string> {
  const reply = await client.callTool({ name, arguments: args });
  const blocks = reply.content as { type: string; text: string }[];
  const text = blocks.map((block) => block.text).join('\n');
  expect(reply.isError, text).not.toBe(true);
  return text;
}

/** The sentence, as the reply must say it for a write that fell in `dir`. */
const THE_LINE = (dir: string): string =>
  `  The agent key "claude" is not enrolled in the project at ${dir}: this write is signed with the person's key, so the agent it names is declared, not attested.`;

const NOTICE = 'is not enrolled in the project at';
const noticesIn = (text: string): string[] =>
  text.split('\n').filter((line) => line.includes(NOTICE));

const VERBS: readonly { name: string; kind: string; args: Record<string, unknown> }[] = [
  { name: 'capture_memory', kind: 'memory.captured', args: { content: 'the fact' } },
  {
    name: 'record_observation',
    kind: 'observation.recorded',
    args: { about: 'some-id', topic: 'shape', text: 'it looks so' },
  },
  {
    name: 'record_handoff',
    kind: 'handoff.recorded',
    args: { task: 'some-id', from: 'claude-code', to: 'claude-code' },
  },
  {
    name: 'link_knowledge',
    kind: 'knowledge.linked',
    args: { subject: 'some-id', target: 'other-id', rel: 'relates-to' },
  },
  { name: 'create_task', kind: 'task.created', args: { title: 'the task' } },
  {
    name: 'record_decision',
    kind: 'decision.recorded',
    args: { title: 'the decision', rationale: 'because' },
  },
  {
    name: 'create_skill',
    kind: 'skill.created',
    args: { name: 'the pattern', body: 'do it this way' },
  },
];

beforeEach(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-person-signed-'));
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

describe('a write routed by `project` to a project that does not enrol the agent', () => {
  for (const verb of VERBS) {
    it(`${verb.name}: says once that the person signed it, and the disk agrees`, async () => {
      const agent = await anAgent();
      await aSecondProject();

      let text = '';
      await connected('claude', async (client) => {
        text = await say(client, verb.name, { ...verb.args, project: other });
      });

      expect(noticesIn(text)).toEqual([THE_LINE(other)]);
      const written = ofKind(other, verb.kind);
      expect(written).toHaveLength(1);
      expect(written[0]?.which).toBe('evil');
      expect(written[0]?.signerFp).not.toBe(agent.fingerprint);
    });
  }

  it('says nothing when no agent is configured', async () => {
    await anAgent();
    await aSecondProject();

    let text = '';
    await connected(undefined, async (client) => {
      text = await say(client, 'record_decision', { ...VERBS[5]?.args, project: other });
    });

    expect(noticesIn(text)).toEqual([]);
  });

  it('says nothing when the project enrols the agent, which then signs', async () => {
    const agent = await anAgent();
    cpSync(repo, other, { recursive: true });

    let text = '';
    await connected('claude', async (client) => {
      text = await say(client, 'record_decision', { ...VERBS[5]?.args, project: other });
    });

    expect(noticesIn(text)).toEqual([]);
    expect(ofKind(other, 'decision.recorded')[0]?.signerFp).toBe(agent.fingerprint);
  });

  it('says nothing for a write in the global tree, even where the machine does not enrol the agent', async () => {
    // The agent is enrolled in the committed and private trees of `repo` and NOT in the global one,
    // so the person's key does sign there: the global tree is the machine's, and no directory of a
    // project is a place for that sentence.
    const identity = (await did('audit', 'accountability')).match(/mnid:[0-9a-f]{8}/)?.[0];
    const line = requestLineOf(
      await did('key', 'request', '--agent', 'claude', '--anchor', identity as string),
    );
    for (const scope of ['public', 'private'] as const) {
      const write = deferredWrite(resolveTrees(repo, env), scope);
      expect(enrollAgentFromRequest(write, { request: line }).ok).toBe(true);
      write.checkpoint();
    }
    await aSecondProject();

    let text = '';
    await connected('claude', async (client) => {
      text = await say(client, 'capture_memory', {
        content: 'the fact',
        project: other,
        scope: 'global',
      });
    });

    expect(noticesIn(text)).toEqual([]);
  });

  it('says it per tree: the project enrols the agent in its committed tree only', async () => {
    const agent = await anAgent();
    // A copy of the record enrols the agent in all three trees; a project that enrols it in the
    // committed tree alone is the second one, enrolled there by hand.
    await aSecondProject();
    const write = deferredWrite(resolveTrees(other, env), 'public');
    expect(enrollAgentFromRequest(write, { request: agent.line }).ok).toBe(true);
    write.checkpoint();

    let decision = '';
    let memory = '';
    await connected('claude', async (client) => {
      decision = await say(client, 'record_decision', { ...VERBS[5]?.args, project: other });
      memory = await say(client, 'capture_memory', { content: 'a private note', project: other });
    });

    expect(noticesIn(decision)).toEqual([]);
    expect(noticesIn(memory)).toEqual([THE_LINE(other)]);
  });
});

describe("a write that names the session's own project", () => {
  it('says nothing for it, which the opening already spoke of, and says it for another project', async () => {
    // The agent is enrolled in the committed tree of `repo` alone, so the person's key signs the
    // private one: what the opening says. Naming `repo` is not routing the write elsewhere.
    const identity = (await did('audit', 'accountability')).match(/mnid:[0-9a-f]{8}/)?.[0];
    const line = requestLineOf(
      await did('key', 'request', '--agent', 'claude', '--anchor', identity as string),
    );
    const write = deferredWrite(resolveTrees(repo, env), 'public');
    expect(enrollAgentFromRequest(write, { request: line }).ok).toBe(true);
    write.checkpoint();
    await aSecondProject();

    let own = '';
    let ownByPath = '';
    let elsewhere = '';
    await connected('claude', async (client) => {
      own = await say(client, 'capture_memory', { content: 'a note', project: repo });
      ownByPath = await say(client, 'capture_memory', { content: 'a note', project: repo });
      elsewhere = await say(client, 'capture_memory', { content: 'a note', project: other });
    });

    expect(noticesIn(own)).toEqual([]);
    expect(noticesIn(ownByPath)).toEqual([]);
    expect(noticesIn(elsewhere)).toEqual([THE_LINE(other)]);
  });
});

describe("a write routed to a directory that only shares the session's project name", () => {
  it('says it: the project is the directory, not its name', async () => {
    // The agent is enrolled in `repo` alone; `x/repo` is ANOTHER project that happens to be named
    // like the session's, and is addressed by its path.
    await anAgent();
    const homonym = join(sandbox, 'x', 'repo');
    mkdirSync(homonym, { recursive: true });
    process.chdir(homonym);
    await did('init');
    process.chdir(repo);

    let text = '';
    await connected(
      'claude',
      async (client) => {
        text = await say(client, 'capture_memory', { content: 'a note', project: homonym });
      },
      [homonym],
    );

    expect(noticesIn(text)).toEqual([THE_LINE(homonym)]);
  });
});

describe('a transition that lands in a project that does not enrol the agent', () => {
  /** Births `args` of `tool` in `other` as the person, and hands back the id minted. */
  async function bornInOther(tool: string, args: Record<string, unknown>): Promise<string> {
    let said = '';
    await connected(undefined, async (client) => {
      said = await say(client, tool, { ...args, project: other });
    });
    const id = said.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)?.[0];
    if (id === undefined) throw new Error(`setup: no id in ${said}`);
    return id;
  }

  it('says the person signed it, and says so once', async () => {
    await anAgent();
    await aSecondProject();
    process.chdir(other);
    await did('decision', 'record', 'Held only by the other', 'because');
    process.chdir(repo);

    let text = '';
    await connected('claude', async (client) => {
      text = await say(client, 'decision_transition', {
        id: 'ADR-1',
        action: 'reject',
        note: 'turned down',
      });
    });

    expect(noticesIn(text)).toEqual([THE_LINE(other)]);
  });

  it('says it for a task moved by its id', async () => {
    await anAgent();
    await aSecondProject();
    const task = await bornInOther('create_task', { title: 'held by the other' });

    let text = '';
    await connected('claude', async (client) => {
      text = await say(client, 'task_transition', { id: task, action: 'submit' });
    });

    expect(noticesIn(text)).toEqual([THE_LINE(other)]);
  });

  it('says it for a note retracted by its id', async () => {
    await anAgent();
    await aSecondProject();
    const note = await bornInOther('capture_memory', { content: 'held by the other' });

    let text = '';
    await connected('claude', async (client) => {
      text = await say(client, 'retract_note', { id: note, reason: 'it was wrong' });
    });

    expect(noticesIn(text)).toEqual([THE_LINE(other)]);
  });

  it('says it for a pattern moved by its id', async () => {
    await anAgent();
    await aSecondProject();
    const skill = await bornInOther('create_skill', { name: 'the pattern', body: 'do it so' });

    let text = '';
    await connected('claude', async (client) => {
      text = await say(client, 'skill_transition', {
        id: skill,
        action: 'review',
        note: 'it reads well',
      });
    });

    expect(noticesIn(text)).toEqual([THE_LINE(other)]);
  });
});

describe('a link taken back from the project that holds it', () => {
  const LANDED =
    '  Landed in the public tree: committed with the repository, so it reaches every clone.';

  async function retractedAs(target: string, holder: string): Promise<string> {
    mkdirSync(join(holder, 'src'), { recursive: true });
    let linked = '';
    await connected(undefined, async (client) => {
      linked = await say(client, 'link_knowledge', {
        subject: 'rule-1',
        target: join(holder, 'src'),
        rel: 'governs',
        project: holder,
      });
    });
    expect(linked).toContain('Landed');
    let text = '';
    await connected('claude', async (client) => {
      text = await say(client, 'retract_link', {
        subject: 'rule-1',
        target,
        rel: 'governs',
        reason: 'wrong path',
      });
    });
    return text;
  }

  /** The tool's own result, with a session that signs as the agent `claude`. */
  function resultOf(holder: string, target: string) {
    const active = openSession({
      clientName: 'evil',
      roots: [repo, other].map((dir) => pathToFileURL(dir).href),
      env,
      agentKey: 'claude',
      log: () => {},
    });
    const linked = runLinkKnowledge(active, {
      subject: 'rule-1',
      target: join(holder, 'src'),
      rel: 'governs',
      project: holder,
    });
    expect(linked, JSON.stringify(linked)).toMatchObject({ ok: true });
    return runRetractLink(active, { subject: 'rule-1', target, rel: 'governs', reason: 'wrong' });
  }

  it('says where the retraction fell and that the person signed it, when that is another project', async () => {
    await anAgent();
    await aSecondProject();
    const text = await retractedAs(join(other, 'src'), other);

    expect(text.split('\n')).toContain(`  In the project at ${other}.`);
    expect(noticesIn(text)).toEqual([THE_LINE(other)]);
    expect(ofKind(other, 'link.retracted')).toHaveLength(1);
  });

  it("says nothing more than before when the link is the session's own project's", async () => {
    await anAgent();
    await aSecondProject();
    const text = await retractedAs(join(repo, 'src'), repo);

    expect(text.split('\n').slice(0, 2)).toEqual(['Retracted link rule-1 —governs→ src', LANDED]);
    expect(text).not.toContain('In the project at');
    expect(noticesIn(text)).toEqual([]);
  });

  it('carries the project and who signed in the result, for a link of another project', async () => {
    await anAgent();
    await aSecondProject();
    mkdirSync(join(other, 'src'), { recursive: true });
    expect(resultOf(other, join(other, 'src'))).toMatchObject({
      ok: true,
      scope: 'public',
      project: other,
      personSigned: { agent: 'claude', project: other },
    });
  });

  it("carries neither in the result for the session's own project's link", async () => {
    await anAgent();
    await aSecondProject();
    mkdirSync(join(repo, 'src'), { recursive: true });
    const result = resultOf(repo, join(repo, 'src'));
    expect(result).toMatchObject({ ok: true, scope: 'public' });
    expect(result).not.toHaveProperty('project');
    expect(result).not.toHaveProperty('personSigned');
  });
});
