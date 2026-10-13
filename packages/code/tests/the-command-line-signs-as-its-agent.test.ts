/**
 * THE COMMAND LINE SIGNS AS THE AGENT IT IS ASKED FOR, AND NEVER MAKES A KEY OR AN IDENTITY FOR IT.
 *
 * `MNEMA_AGENT_KEY` is read by the verbs that write a fact an agent's key may sign, as the server
 * reads it: where the record enrols the agent, the fact is signed by it and names it, as the
 * record does; where it does not, the person's key signs, when it opens, and the `which` is
 * declared; where it does not open, the write is refused and nothing is made. The verbs of the
 * person (`init`, `key …`, `check run`) do not read it.
 *
 * WHAT IS HELD HERE: a machine that holds only the agent's folder, asked for the agent, writes as
 * it and founds no identity; the `which` is the record's name, whatever `--which` says, because
 * `verify` refuses any other and no gate of the core does; a memory with no `--scope` goes to the
 * private tree, as the server's does, and is refused there; and a verb of the person written in a
 * shell that has the variable is still the person's. What is not held here is any separation:
 * the agent's shell reads the files of the same user.
 */

import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type CatalogEvent, catalogUpcasters } from '@mnema/chain';
import { type DiscoveryEnv, orderedEvents, resolveTrees } from '@mnema/core';
import { deferredWrite, enrollAgentFromRequest } from '@mnema/core/write';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  originOfTheWrite,
  treesToWrite,
  whichOfTheWrite,
} from '../src/commands/write-as-the-agent.js';
import { type CliIo, run } from '../src/program.js';

const STACK = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'stacks',
  'examples',
  'evidence-first',
);
const AGENT = 'MNEMA_AGENT_KEY';
const PASSPHRASE = 'MNEMA_KEY_PASSPHRASE';

let sandbox: string;
let home: string;
let repo: string;
let env: DiscoveryEnv;
let originalCwd: string;
const saved: Record<string, string | undefined> = {};

interface Said {
  readonly out: string;
  readonly err: string;
  readonly failed: boolean;
}

/** Runs `mnema <argv>` in process, with `MNEMA_AGENT_KEY` set only where given. */
async function mnema(agent: string | undefined, ...argv: string[]): Promise<Said> {
  return await mnemaReading(agent, undefined, ...argv);
}

async function mnemaReading(
  agent: string | undefined,
  input: string | undefined,
  ...argv: string[]
): Promise<Said> {
  const out: string[] = [];
  const err: string[] = [];
  let failed = false;
  const io: CliIo = {
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    fail: () => {
      failed = true;
    },
    ...(input === undefined ? {} : { input: async () => input }),
  };
  if (agent === undefined) delete process.env[AGENT];
  else process.env[AGENT] = agent;
  try {
    await run(argv, io);
  } finally {
    delete process.env[AGENT];
  }
  return { out: out.join('\n'), err: err.join('\n'), failed };
}

async function did(agent: string | undefined, ...argv: string[]): Promise<string> {
  const said = await mnema(agent, ...argv);
  expect(said.failed, `${argv.join(' ')}: ${said.err}`).toBe(false);
  return said.out;
}

async function identity(): Promise<string> {
  const said = await did(undefined, 'audit', 'accountability');
  const anchor = said.match(/mnid:[0-9a-f]{8}/)?.[0];
  if (anchor === undefined) throw new Error(`setup: no identity in ${said}`);
  return anchor;
}

function lineOf(said: string): string {
  const line = said.split('\n').find((one) => one.startsWith('mnema-agent-request:1:'));
  if (line === undefined) throw new Error(`setup: no request line in ${said}`);
  return line;
}

/**
 * Makes the agent `name` and has the record enrol it in the committed tree ALONE (`key enroll`
 * enrols it in the private and the global tree as well, which is not the case under test);
 * returns its fingerprint.
 */
async function anAgent(name: string): Promise<string> {
  const requested = await did(
    undefined,
    'key',
    'request',
    '--agent',
    name,
    '--anchor',
    await identity(),
  );
  const write = deferredWrite(resolveTrees(repo, env), 'public');
  const done = enrollAgentFromRequest(write, { request: lineOf(requested) });
  expect(done.ok, JSON.stringify(done)).toBe(true);
  write.checkpoint();
  const fp = requested.match(/\b[0-9a-f]{64}\b/)?.[0];
  if (fp === undefined) throw new Error(`setup: no fingerprint in ${requested}`);
  return fp;
}

type Scope = 'public' | 'private' | 'global';

function eventsOf(scope: Scope): CatalogEvent[] {
  const trees = resolveTrees(repo, env);
  const root =
    scope === 'public'
      ? trees.projectPublic
      : scope === 'private'
        ? trees.projectPrivate
        : trees.global;
  if (root === undefined || !existsSync(root)) return [];
  return orderedEvents({ root }, catalogUpcasters());
}

const ofKind = (scope: Scope, kind: string): CatalogEvent[] =>
  eventsOf(scope).filter((event) => event.kind === kind);

/** From here on the machine holds the agents' folder and nothing else: no key of the person's. */
function onlyTheAgents(): string {
  const only = join(sandbox, 'only-the-agents');
  cpSync(join(home, '.mnema', 'agents'), join(only, '.mnema', 'agents'), { recursive: true });
  process.env.HOME = only;
  env = { home: only };
  return only;
}

async function census(): Promise<readonly { kind: string; name?: string; which?: string }[]> {
  const said = await mnema(undefined, 'verify', '--json', '--verbose');
  expect(said.failed, said.out + said.err).toBe(false);
  const verified = JSON.parse(said.out) as {
    readonly trees: readonly {
      readonly result?: {
        readonly census: readonly { kind: string; name?: string; which?: string }[];
      };
    }[];
  };
  return verified.trees.flatMap((tree) => tree.result?.census ?? []);
}

beforeEach(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-cli-agent-'));
  home = join(sandbox, 'home');
  repo = join(sandbox, 'repo');
  mkdirSync(home, { recursive: true });
  mkdirSync(join(repo, 'src', 'billing'), { recursive: true });
  originalCwd = process.cwd();
  for (const name of ['HOME', 'XDG_DATA_HOME', 'MNEMA_HOME', 'MNEMA_RUN', AGENT, PASSPHRASE]) {
    saved[name] = process.env[name];
  }
  process.env.HOME = home;
  process.env.XDG_DATA_HOME = join(sandbox, 'data');
  for (const name of ['MNEMA_HOME', 'MNEMA_RUN', AGENT, PASSPHRASE]) delete process.env[name];
  env = { home };
  process.chdir(repo);
  await did(undefined, 'init');
});

afterEach(() => {
  process.chdir(originalCwd);
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  rmSync(sandbox, { recursive: true, force: true });
});

describe('a machine that holds only the agent, asked for it by the variable', () => {
  it('records as the agent, founds no identity and makes no key, and `verify` attests the which', async () => {
    const fingerprint = await anAgent('ci');
    const only = onlyTheAgents();
    const foundings = ofKind('public', 'identity.founded').length;

    const said = await mnema('ci', 'decision', 'record', 'Use the agent', 'because it is enrolled');

    expect(said.failed, said.err).toBe(false);
    const decision = ofKind('public', 'decision.recorded').at(-1);
    expect(decision?.which).toBe('ci');
    expect(decision?.signerFp).toBe(fingerprint);
    expect(ofKind('public', 'identity.founded')).toHaveLength(foundings);
    expect(existsSync(join(only, '.mnema', 'identity'))).toBe(false);
    expect(await census()).toContainEqual(
      expect.objectContaining({ kind: 'attested-which', name: 'ci' }),
    );
  });

  it('sends a memory with no --scope to the private tree, where the agent is not enrolled: refused, nothing written', async () => {
    await anAgent('ci');
    const only = onlyTheAgents();
    const before = eventsOf('public').length;

    const said = await mnema('ci', 'memory', 'a note');

    expect(said.failed, said.out + said.err).toBe(true);
    expect(said.out + said.err).toContain('AGENT_NOT_ENROLLED');
    expect(said.out + said.err).toContain("this project's private tree");
    expect(eventsOf('public')).toHaveLength(before);
    expect(ofKind('private', 'memory.captured')).toEqual([]);
    expect(existsSync(join(only, '.mnema', 'identity'))).toBe(false);
  });

  it('records a memory in the committed tree as the agent when it is asked to', async () => {
    const fingerprint = await anAgent('ci');
    onlyTheAgents();

    const said = await mnema('ci', 'memory', 'a note', '--scope', 'public');

    expect(said.failed, said.err).toBe(false);
    const written = ofKind('public', 'memory.captured').at(-1);
    expect(written?.which).toBe('ci');
    expect(written?.signerFp).toBe(fingerprint);
  });

  it('writes nothing, and makes nothing, where the variable is absent and nobody holds a key', async () => {
    await anAgent('ci');
    const only = onlyTheAgents();

    const said = await mnema(undefined, 'decision', 'record', 'No variable', 'because');

    // The behaviour this PR leaves as it was: a person's first write on a new machine founds.
    expect(said.failed, said.err).toBe(false);
    expect(existsSync(join(only, '.mnema', 'identity'))).toBe(true);
  });
});

describe('the name the record gives the agent is the which of what it signs', () => {
  it('overrides a --which that names another, and says so on the second stream', async () => {
    const fingerprint = await anAgent('ci');
    onlyTheAgents();

    const said = await mnema(
      'ci',
      'decision',
      'record',
      'Named otherwise',
      'why',
      '--which',
      'someone',
    );

    expect(said.failed, said.err).toBe(false);
    // NO DOOR OF THE CORE REFUSES A FACT THE AGENT'S KEY SIGNS UNDER ANOTHER NAME: only `verify`
    // does, so the first thing asked is whether `verify` still accepts the record.
    const verified = await mnema(undefined, 'verify');
    expect(verified.failed, verified.out + verified.err).toBe(false);
    const decision = ofKind('public', 'decision.recorded').at(-1);
    expect(decision?.which).toBe('ci');
    expect(decision?.signerFp).toBe(fingerprint);
    expect(said.err).toContain(
      '--which "someone" was ignored: this is signed by the agent "ci", and the fact names it as the record does.',
    );
    expect(await census()).toContainEqual(
      expect.objectContaining({ kind: 'attested-which', name: 'ci' }),
    );
  });

  it('says nothing of it where --which is the name the record gives', async () => {
    await anAgent('ci');
    onlyTheAgents();

    const said = await mnema('ci', 'decision', 'record', 'Same name', 'why', '--which', 'ci');

    expect(said.failed, said.err).toBe(false);
    expect(said.err).toBe('');
  });
});

describe('an agent the record does not enrol, and a person who can sign', () => {
  it('is signed by the person and declares the name the variable asked for', async () => {
    await did(undefined, 'key', 'request', '--agent', 'ci', '--anchor', await identity());

    const said = await mnema('ci', 'decision', 'record', 'Before the enrolment', 'why');

    expect(said.failed, said.err).toBe(false);
    const decision = ofKind('public', 'decision.recorded').at(-1);
    expect(decision?.which).toBe('ci');
    const notes = await census();
    expect(notes.some((note) => note.kind === 'attested-which')).toBe(false);
    expect(notes).toContainEqual(expect.objectContaining({ kind: 'declared-which', which: 'ci' }));
  });

  it('is refused where the person’s key is protected and its passphrase is in no environment', async () => {
    await did(undefined, 'key', 'request', '--agent', 'ci', '--anchor', await identity());
    process.env[PASSPHRASE] = 'correct horse';
    await did(undefined, 'key', 'protect');
    delete process.env[PASSPHRASE];
    const before = eventsOf('public').length;

    const said = await mnema('ci', 'decision', 'record', 'No key can sign', 'why');

    expect(said.failed).toBe(true);
    expect(said.out + said.err).toContain('AGENT_NOT_ENROLLED');
    expect(said.out + said.err).toContain('is protected by a passphrase');
    expect(eventsOf('public')).toHaveLength(before);
  });
});

describe('a name that is not one this product enrols', () => {
  it('is ignored, says so once, and the person signs', async () => {
    const said = await mnema('../escape', 'decision', 'record', 'A misspelt variable', 'why');

    expect(said.failed, said.err).toBe(false);
    expect(
      said.err.split('\n').filter((line) => line.includes('agent key was ignored')),
    ).toHaveLength(1);
    expect(ofKind('public', 'decision.recorded').at(-1)?.which).toBeUndefined();
    expect(existsSync(join(home, '.mnema', 'escape'))).toBe(false);
  });
});

describe('a name that is not one this product enrols, on the verbs that install and remove a stack', () => {
  const ignoredLines = (said: Said): string[] =>
    said.err.split('\n').filter((line) => line.includes('The agent key was ignored'));

  async function installed(agent: string | undefined): Promise<Said[]> {
    const digest = (
      await did(undefined, 'stack', 'add', STACK, '--scope', 'public', '--dry-run')
    ).match(/digest\s+([0-9a-f]{64})/)?.[1] as string;
    const add = await mnema(agent, 'stack', 'add', STACK, '--scope', 'public', '--expect', digest);
    const remove = await mnema(agent, 'stack', 'remove', 'evidence-first', '--scope', 'public');
    return [add, remove];
  }

  it('says once, on the error stream, that the key was ignored, for add and for remove', async () => {
    const [add, remove] = await installed('../x');

    expect(add?.failed, add?.out + (add?.err ?? '')).toBe(false);
    expect(remove?.failed, remove?.out + (remove?.err ?? '')).toBe(false);
    expect(ignoredLines(add as Said)).toHaveLength(1);
    expect(ignoredLines(remove as Said)).toHaveLength(1);
    expect((add as Said).out).toContain('The adoption is recorded in the public tree.');
    expect((remove as Said).out).toContain('The removal is recorded.');
  });

  it('says nothing of it for a name that is one', async () => {
    const [add, remove] = await installed('ci');

    expect(ignoredLines(add as Said)).toEqual([]);
    expect(ignoredLines(remove as Said)).toEqual([]);
  });
});

describe('the verbs of the person do not read the variable', () => {
  it('enrols a second agent as the person, with the variable naming the first', async () => {
    await anAgent('ci');
    const requested = await did(
      undefined,
      'key',
      'request',
      '--agent',
      'bot',
      '--anchor',
      await identity(),
    );

    const said = await mnema('ci', 'key', 'enroll', '--agent', lineOf(requested));

    expect(said.failed, said.err).toBe(false);
    const verified = await mnema(undefined, 'verify');
    expect(verified.failed, verified.out + verified.err).toBe(false);
    // The person's key vouched for it: the agent's own never signs an enrolment, and the format
    // refuses one that does.
    const enrolled = ofKind('public', 'agent.enrolled').at(-1);
    const founded = ofKind('public', 'identity.founded')[0];
    expect(enrolled?.signerFp).toBe(founded?.signerFp);
  });
});

describe('the hook reads the variable, and the flag still wins', () => {
  async function charged(): Promise<string> {
    const decision = (await did(undefined, 'decision', 'record', 'Billing is frozen', 'why')).match(
      /\(([0-9a-f-]{20,})\)/,
    )?.[1];
    await did(undefined, 'decision', 'move', 'accept', decision as string, '--note', 'agreed');
    await did(undefined, 'link', decision as string, 'src/billing', '--rel', 'refuses-a-write');
    return JSON.stringify({
      hook_event_name: 'PreToolUse',
      tool_name: 'create_file',
      tool_input: { filePath: join(repo, 'src', 'billing', 'invoice.ts'), content: 'x' },
      cwd: repo,
    });
  }

  it('signs as the agent of the variable where the record enrols it', async () => {
    const payload = await charged();
    const fingerprint = await anAgent('vscode');

    const said = await mnemaReading('vscode', payload, 'before-a-write', '--host', 'vscode');

    expect(said.failed, said.err).toBe(false);
    const refused = ofKind('public', 'channel.refused');
    expect(refused).toHaveLength(1);
    expect(refused[0]?.which).toBe('vscode');
    expect(refused[0]?.signerFp).toBe(fingerprint);
  });

  it('records nothing and makes no key on a machine that holds only the agent, but asks for one that is not enrolled', async () => {
    const payload = await charged();
    await did(undefined, 'key', 'request', '--agent', 'vscode', '--anchor', await identity());
    const only = onlyTheAgents();

    const said = await mnemaReading('vscode', payload, 'before-a-write', '--host', 'vscode');

    expect(said.out).toContain('could not be recorded');
    expect(ofKind('public', 'channel.refused')).toEqual([]);
    expect(existsSync(join(only, '.mnema', 'identity'))).toBe(false);
  });

  it('is won by the flag', async () => {
    const payload = await charged();
    const fingerprint = await anAgent('vscode');
    await anAgent('other');

    await mnemaReading(
      'other',
      payload,
      'before-a-write',
      '--host',
      'vscode',
      '--agent-key',
      'vscode',
    );

    const refused = ofKind('public', 'channel.refused');
    expect(refused[0]?.which).toBe('vscode');
    expect(refused[0]?.signerFp).toBe(fingerprint);
  });
});

describe('the three questions a verb asks before it writes', () => {
  it('builds the trees for the agent asked for, and for no agent where the name is not one', () => {
    const lines: string[] = [];
    const say = (line: string): void => {
      lines.push(line);
    };

    const asked = treesToWrite({ cwd: repo, env, agentKey: 'ci', say });
    const unnamed = treesToWrite({ cwd: repo, env, agentKey: '../escape', say });
    const none = treesToWrite({ cwd: repo, env, say });

    expect(asked.agentKey).toBe('ci');
    expect(asked.trees.agent?.name).toBe('ci');
    expect(unnamed.agentKey).toBeUndefined();
    expect(unnamed.trees.agent).toBeUndefined();
    expect(none.agentKey).toBeUndefined();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^The agent key was ignored: /);
  });

  it('takes the origin from what was declared, else from the agent asked for', () => {
    const writing = treesToWrite({ cwd: repo, env, agentKey: 'ci' });

    expect(originOfTheWrite(writing, undefined)).toEqual({ which: 'ci' });
    expect(originOfTheWrite(writing, 'someone')).toEqual({ which: 'someone' });
    expect(originOfTheWrite(treesToWrite({ cwd: repo, env }), undefined)).toEqual({});
  });

  it('names the agent the record gives the key where it signs, and what was declared where it does not', async () => {
    await anAgent('ci');
    const writing = treesToWrite({ cwd: repo, env, agentKey: 'ci' });

    // Enrolled in the committed tree alone: the private tree's key is the person's, so the which is declared.
    expect(whichOfTheWrite(writing, 'public', 'someone')).toBe('ci');
    expect(whichOfTheWrite(writing, 'private', 'someone')).toBe('someone');
    expect(whichOfTheWrite(writing, 'private', undefined)).toBe('ci');
    expect(whichOfTheWrite(treesToWrite({ cwd: repo, env }), 'public', undefined)).toBeUndefined();
  });
});
