/**
 * THE COMMAND LINE, THE MCP SERVER AND THE LIBRARY DOOR ARE ONE: the same input through each leaves
 * the same events in the record and gets the same verdict, and a refusal carries the same code.
 *
 * WHAT IS COMPARED. Each scenario is run three times, from a project of its own each time, founded
 * the same way: once by typing the command (`dist/cli.js`), once by calling the tool over an
 * in-memory MCP connection, once by calling `@mnema/sdk`. After it, every event of every tree is
 * read off the disk — the kind, the tree it landed in, who it was attributed to and its payload —
 * with what a door cannot be expected to share taken out: the time, the key that signed, the run an
 * MCP connection pins (and the `run.*` events that open and close it), and the ids, which are
 * replaced by the order they first appear in, so a payload that cites a decision still has to cite
 * the same decision. What each step answered is reduced to `ok` or the code it was refused with.
 *
 * AN OPERATION ON ONE DOOR WITHOUT THE OTHERS LIGHTS THIS FILE. The library door's methods are
 * enumerated off the object `openRecord` returns, the tools the server declares as writing and the
 * verbs the program declares as writing are enumerated off their own declarations, and every one of
 * them has to be either a row of {@link OPERATIONS} or named in {@link NOT_IN_THE_LIBRARY} with the
 * reason it is not there. A new method, tool or verb that is neither is red by its name.
 */

import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { catalogUpcasters } from '@mnema/chain';
import { type DiscoveryEnv, orderedEvents, PROJECT_DIR } from '@mnema/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mnemaHooks } from '../../sdk/src/hooks.js';
import { type MnemaRecord, openRecord } from '../../sdk/src/record.js';
import type { CliIo } from '../src/cli.js';
import { runBeforeAPath as beforeAPath } from '../src/commands/before-a-write.js';
import { runBrief as brief } from '../src/commands/brief.js';
import { runDecision as decision } from '../src/commands/decision.js';
import { runDecisionTransition as transition } from '../src/commands/decision-transition.js';
import { runMemory as memory } from '../src/commands/memory.js';
import { runRecall as recall } from '../src/commands/recall.js';
import { runRules as rules } from '../src/commands/rules.js';
import { runVerify as verify } from '../src/commands/verify.js';
import {
  runBeforeAPath as libraryBeforeAPath,
  runBrief as libraryBrief,
  runDecision as libraryDecision,
  runMemory as libraryMemory,
  runRecall as libraryRecall,
  runRules as libraryRules,
  runDecisionTransition as libraryTransition,
  runVerify as libraryVerify,
} from '../src/library.js';
import { buildMcpServer } from '../src/mcp/server.js';
import { renderPlain } from '../src/presentation/plain.js';
import { HOOK_TEXT_CEILING } from '../src/presentation/within-a-hook.js';
import { registerVerbs } from '../src/wiring/index.js';
import { NO_PROJECT } from '../src/wiring/report.js';
import type { PinnedRun } from '../src/wiring/run-pin.js';

const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
/** The name every door writes as. */
const AGENT = 'the-agent';

let sandbox: string;
beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-three-doors-'));
});
afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// One door each
// ---------------------------------------------------------------------------

/** What a step answered, the same whichever door it went through. */
type Verdict = 'ok' | `refused ${string}`;

/** One project, and the three ways of acting on it. */
interface Door {
  readonly name: 'cli' | 'mcp' | 'sdk';
  readonly repo: string;
  readonly home: string;
  /** `mnema <argv>` as the key of this door's home, for the set-up every door shares. */
  readonly mnema: (...argv: string[]) => { status: number | null; out: string; err: string };
  close(): Promise<void>;
}

/**
 * The code a refusal carries, wherever it is printed: `Refused (CODE): …`, or — for the two the
 * command line says in a sentence of its own — that sentence, which the wiring owns.
 */
function codeIn(text: string): string | undefined {
  const coded = /Refused \(([A-Z_]+)\)/.exec(text)?.[1];
  if (coded !== undefined) return coded;
  if (text.includes(NO_PROJECT)) return 'NO_PROJECT';
  if (text.includes('No decision no-such-decision here.')) return 'UNKNOWN_DECISION';
  return undefined;
}

function typed(repo: string, home: string, argv: readonly string[], stdin?: string) {
  const ran = spawnSync(process.execPath, [CLI, ...argv], {
    cwd: repo,
    encoding: 'utf-8',
    env: { PATH: process.env.PATH ?? '', HOME: home },
    ...(stdin !== undefined ? { input: stdin } : {}),
  });
  return { status: ran.status, out: ran.stdout, err: ran.stderr };
}

/** A founded project — `init` is the one step of the set-up that is the command line's alone. */
function founded(name: Door['name'], founding = true): Door {
  const repo = join(sandbox, name, 'repo');
  const home = join(sandbox, name, 'home');
  mkdirSync(repo, { recursive: true });
  mkdirSync(home, { recursive: true });
  if (founding) {
    const init = typed(repo, home, ['init']);
    if (init.status !== 0) throw new Error(`init failed: ${init.err}`);
  }
  return {
    name,
    repo,
    home,
    mnema: (...argv) => typed(repo, home, argv),
    close: async () => undefined,
  };
}

/** The tools a connection to this project's server declares as writing, and a way to call one. */
async function connected(door: Door): Promise<{
  call: (tool: string, args: Record<string, unknown>) => Promise<Verdict>;
  /** What the last call said, whole. */
  said: () => string;
  close: () => Promise<void>;
}> {
  let lastText = '';
  const env: DiscoveryEnv = { home: door.home };
  const { server } = buildMcpServer({ cwd: sandbox, env, log: () => {} });
  const client = new Client({ name: AGENT, version: '1.0.0' }, { capabilities: { roots: {} } });
  client.setRequestHandler(ListRootsRequestSchema, () => ({
    roots: [{ uri: pathToFileURL(door.repo).href, name: 'repo' }],
  }));
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientSide), server.connect(serverSide)]);
  return {
    call: async (tool, args) => {
      const reply = (await client.callTool({ name: tool, arguments: args })) as {
        isError?: boolean;
        content: { text: string }[];
      };
      lastText = reply.content[0]?.text ?? '';
      if (reply.isError !== true) return 'ok';
      return `refused ${codeIn(reply.content[0]?.text ?? '') ?? 'UNCODED'}`;
    },
    said: () => lastText,
    close: () => client.close(),
  };
}

// ---------------------------------------------------------------------------
// The operations, each as the three doors take it
// ---------------------------------------------------------------------------

/** The ids of what a door has recorded so far, read off its own record. */
interface Ids {
  /** The id of the nth decision recorded (from 0). */
  decision(n: number): string;
}

interface Operation {
  /** The method of the library door. */
  readonly method: keyof MnemaRecord;
  /** The verb of the command line, which the program declares. */
  readonly verb: string;
  /** The subcommand of that verb, when the verb is a group (`decision move`). */
  readonly sub?: string;
  /** The MCP tool, or why there is none. */
  readonly tool: string | { readonly none: string };
  /** Whether it appends to the record. */
  readonly writes: boolean;
}

/** What each operation of the library door is, on the other two. */
const OPERATIONS: readonly Operation[] = [
  {
    method: 'recordDecision',
    verb: 'decision',
    sub: 'record',
    tool: 'record_decision',
    writes: true,
  },
  {
    method: 'acceptDecision',
    verb: 'decision',
    sub: 'move',
    tool: 'decision_transition',
    writes: true,
  },
  {
    method: 'rejectDecision',
    verb: 'decision',
    sub: 'move',
    tool: 'decision_transition',
    writes: true,
  },
  { method: 'addNote', verb: 'memory', tool: 'capture_memory', writes: true },
  { method: 'rulesFor', verb: 'rules', tool: 'governing_rules', writes: false },
  {
    method: 'brief',
    verb: 'brief',
    tool: {
      none: 'the server hands the document at the handshake and through `bootstrap`, which is not this text',
    },
    writes: false,
  },
  {
    method: 'recall',
    verb: 'recall',
    tool: {
      none: 'the server answers a question with `search` and `read_record`, not with the session notes',
    },
    writes: false,
  },
  {
    method: 'verify',
    verb: 'verify',
    tool: {
      none: 'the server declares no verdict over the record; `verify` is the command line’s',
    },
    writes: false,
  },
];

/** Every tool the server declares as writing that the library door does not have, and why not. */
const NOT_IN_THE_LIBRARY: Readonly<Record<string, string>> = {
  record_observation:
    'an observation is what the work notices about an entity; no program asked for it yet',
  retract_note: 'taking a note back is a person’s decision, not an agent loop’s',
  record_handoff:
    'a handoff is between agents of one host, which a program built on its own does not have',
  link_knowledge: 'a link is written by the person who sets a rule, from the command line',
  create_task: 'work items are the host’s; the library door records decisions and notes',
  task_transition: 'work items are the host’s; the library door records decisions and notes',
  create_skill: 'a pattern is written by a person and adopted by a person',
  skill_transition: 'a pattern is written by a person and adopted by a person',
  skills: 'it records the use of a pattern in a session, which the library door has none of',
  decision_transition: 'covered: `acceptDecision` and `rejectDecision`',
  rules_before_an_edit: 'covered: the `PreToolUse` hook',
};

/** Every verb that writes the record and the library door has no method for, and why not. */
const VERBS_NOT_IN_THE_LIBRARY: Readonly<Record<string, string>> = {
  init: 'founding an identity is a person’s act, on their machine',
  task: 'work items are the host’s',
  skill: 'a pattern is written by a person and adopted by a person',
  observe: 'see `record_observation`',
  handoff: 'see `record_handoff`',
  link: 'a link is written by the person who sets a rule',
  retract: 'see `retract_note`',
  key: 'keys are a person’s',
  switch: 'a switch is a person’s',
  tail: 'a tail is pruned by a person',
  'before-a-write': 'covered: the `PreToolUse` hook',
  run: 'a run is pinned by the host',
  corrections: 'covered by nothing: a hook the plugin switches on, not an operation',
  witness: 'an outside witness is a person’s',
  'commit-hook':
    'it writes a file into a git repository’s hooks, which only a person at a shell asks for',
  mcp: 'it serves the MCP door, which is the second of the three',
  check: 'a rule’s check is declared by a person and run by a machine with a key of its own',
  inherit: 'trusting another repository’s record is a person’s decision',
};

/**
 * Every subcommand of a verb the library door covers that it has no method for, and why not,
 * as `<verb> <subcommand>`. The verb's own declaration is one word for all of its subcommands,
 * so a writing subcommand added to a covered verb would pass the census above by its name
 * alone: this is the table that makes it be counted.
 */
const SUBCOMMANDS_NOT_IN_THE_LIBRARY: Readonly<Record<string, string>> = {
  'decision supersede':
    'on the MCP door, in `decision_transition` the `supersede` action; the library has no method',
  'decision import': 'reading a directory or source format; only from the shell',
};

// ---------------------------------------------------------------------------
// The scenarios
// ---------------------------------------------------------------------------

/** One step, as each door takes it. */
interface Step {
  readonly cli: (ids: Ids) => readonly string[];
  readonly tool: string;
  readonly args: (ids: Ids) => Record<string, unknown>;
  readonly sdk: (record: MnemaRecord, ids: Ids) => Verdict;
}

/** The verdict a library call gave: `ok`, or the code the command line prints for it. */
function verdictOf(result: {
  readonly ok: boolean;
  readonly reason?: string;
  readonly code?: string;
}): Verdict {
  if (result.ok) return 'ok';
  return `refused ${result.reason === 'REFUSED' ? result.code : result.reason}`;
}

const record = (title: string, alternatives?: string): Step => ({
  cli: () => [
    'decision',
    'record',
    title,
    `why ${title}`,
    ...(alternatives !== undefined ? ['--alternatives', alternatives] : []),
    '--which',
    AGENT,
  ],
  tool: 'record_decision',
  args: () => ({
    title,
    rationale: `why ${title}`,
    ...(alternatives !== undefined ? { alternatives } : {}),
  }),
  sdk: (r) =>
    verdictOf(
      r.recordDecision({
        title,
        rationale: `why ${title}`,
        ...(alternatives !== undefined ? { alternatives } : {}),
      }),
    ),
});

const move = (action: 'accept' | 'reject', n: number, note?: string): Step => ({
  cli: (ids) => [
    'decision',
    'move',
    action,
    ids.decision(n),
    ...(note !== undefined ? ['--note', note] : []),
    '--which',
    AGENT,
  ],
  tool: 'decision_transition',
  args: (ids) => ({ id: ids.decision(n), action, ...(note !== undefined ? { note } : {}) }),
  sdk: (r, ids) => {
    const given = { id: ids.decision(n), note: note as string };
    return verdictOf(action === 'accept' ? r.acceptDecision(given) : r.rejectDecision(given));
  },
});

const note = (content: string, scope?: 'public' | 'private'): Step => ({
  cli: () => [
    'memory',
    content,
    ...(scope !== undefined ? ['--scope', scope] : []),
    '--which',
    AGENT,
  ],
  tool: 'capture_memory',
  args: () => ({ content, ...(scope !== undefined ? { scope } : {}) }),
  sdk: (r) => verdictOf(r.addNote({ content, ...(scope !== undefined ? { scope } : {}) })),
});

/** What every door is set up with before the steps: nothing, or a switch. */
interface Scenario {
  readonly name: string;
  readonly setup?: readonly (readonly string[])[];
  readonly steps: readonly Step[];
}

const SCENARIOS: readonly Scenario[] = [
  {
    name: 'a decision is recorded, accepted and then cannot be accepted again',
    steps: [
      record('use postgres', 'sqlite, because of the concurrent writers'),
      move('accept', 0, 'it is what the team runs'),
      move('accept', 0, 'once more'),
    ],
  },
  {
    name: 'a decision is rejected, and a verdict without its note is refused',
    steps: [
      record('use mongo'),
      record('use redis'),
      move('reject', 0),
      move('reject', 1, 'not now'),
    ],
  },
  {
    name: 'a move on a decision that is not there is refused',
    steps: [
      {
        ...move('accept', 0, 'x'),
        cli: () => [
          'decision',
          'move',
          'accept',
          'no-such-decision',
          '--note',
          'x',
          '--which',
          AGENT,
        ],
        args: () => ({ id: 'no-such-decision', action: 'accept', note: 'x' }),
        sdk: (r) => verdictOf(r.acceptDecision({ id: 'no-such-decision', note: 'x' })),
      },
    ],
  },
  {
    name: 'an agent’s accept is refused once the switch is off',
    setup: [['switch', 'off', 'agent-accepts']],
    steps: [record('use kafka'), move('accept', 0, 'agreed')],
  },
  {
    name: 'a note lands where an agent’s note lands, and where it is told to',
    steps: [
      note('the build is flaky on node 22'),
      note('the staging key rotates monthly', 'public'),
    ],
  },
];

// ---------------------------------------------------------------------------
// Running one door
// ---------------------------------------------------------------------------

/** The kinds that are bookkeeping of a door and not of the operation. */
const NOT_COMPARED = (kind: string): boolean =>
  kind === 'identity.founded' || kind === 'key.enrolled' || kind.startsWith('run.');

interface Seen {
  readonly tree: 'public' | 'private';
  readonly kind: string;
  readonly which: string | undefined;
  readonly body: string;
}

/** Every event of the project, off the disk, with what a door cannot share taken out. */
function eventsOf(door: Door, keepWhich = true): Seen[] {
  const found: { tree: Seen['tree']; event: ReturnType<typeof orderedEvents>[number] }[] = [];
  for (const tree of ['public', 'private'] as const) {
    const root =
      tree === 'public' ? join(door.repo, PROJECT_DIR) : join(door.repo, PROJECT_DIR, 'private');
    for (const event of orderedEvents({ root }, catalogUpcasters())) found.push({ tree, event });
  }
  const placeholders = new Map<string, string>();
  const named = (text: string): string =>
    text.replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|mnid:[0-9a-f]{64}/g,
      (id) => {
        if (!placeholders.has(id)) placeholders.set(id, `<id ${placeholders.size}>`);
        return placeholders.get(id) as string;
      },
    );
  return found
    .filter(({ event }) => !NOT_COMPARED(event.kind))
    .map(({ tree, event }) => ({
      tree,
      kind: event.kind,
      which: keepWhich ? (event as { which?: string }).which : undefined,
      body: named(JSON.stringify({ subject: event.subject, payload: event.payload })),
    }));
}

/** Runs a scenario through one door: what each step answered, and what the record holds after. */
async function through(
  name: Door['name'],
  scenario: Scenario,
): Promise<{ said: Verdict[]; held: Seen[] }> {
  const door = founded(name);
  for (const argv of scenario.setup ?? []) {
    const ran = door.mnema(...argv);
    if (ran.status !== 0) throw new Error(`set-up ${argv.join(' ')} failed: ${ran.err}`);
  }
  const ids: Ids = {
    decision: (n) => {
      const born = [
        ...orderedEvents({ root: join(door.repo, PROJECT_DIR) }, catalogUpcasters()),
        ...orderedEvents({ root: join(door.repo, PROJECT_DIR, 'private') }, catalogUpcasters()),
      ].filter((event) => event.kind === 'decision.recorded');
      return born[n]?.subject as string;
    },
  };
  const said: Verdict[] = [];
  if (name === 'cli') {
    for (const step of scenario.steps) {
      const ran = typed(door.repo, door.home, step.cli(ids));
      said.push(ran.status === 0 ? 'ok' : `refused ${codeIn(ran.err) ?? 'UNCODED'}`);
    }
  } else if (name === 'mcp') {
    const server = await connected(door);
    for (const step of scenario.steps) said.push(await server.call(step.tool, step.args(ids)));
    await server.close();
  } else {
    const library = openRecord({ cwd: door.repo, agent: AGENT, env: { home: door.home } });
    for (const step of scenario.steps) said.push(step.sdk(library, ids));
  }
  return { said, held: eventsOf(door) };
}

describe('an ADR label typed where an id belongs', () => {
  it('is refused on the three doors with the id that carries it', async () => {
    const said = async (name: Door['name']): Promise<{ id: string; text: string }> => {
      const door = founded(name);
      door.mnema('decision', 'record', 'use postgres', 'why', '--which', AGENT);
      const born = orderedEvents({ root: join(door.repo, PROJECT_DIR) }, catalogUpcasters()).filter(
        (event) => event.kind === 'decision.recorded',
      );
      const id = born[0]?.subject as string;
      if (name === 'cli') {
        const ran = door.mnema('decision', 'move', 'accept', 'ADR-1', '--note', 'x');
        return { id, text: ran.err };
      }
      if (name === 'mcp') {
        const server = await connected(door);
        await server.call('decision_transition', { id: 'ADR-1', action: 'accept', note: 'x' });
        const text = server.said();
        await server.close();
        return { id, text };
      }
      const library = openRecord({ cwd: door.repo, agent: AGENT, env: { home: door.home } });
      const refused = library.acceptDecision({ id: 'ADR-1', note: 'x' });
      return { id, text: refused.ok ? '' : ((refused as { message?: string }).message ?? '') };
    };
    for (const name of ['cli', 'mcp', 'sdk'] as const) {
      const { id, text } = await said(name);
      expect(text, name).toContain(
        `ADR-1 is a label, not an id: in this project it names the decision ${id}. Use the id.`,
      );
    }
  });
});

describe('the library door calls the command line’s own functions', () => {
  it('is the very function, not a copy of it', () => {
    expect(libraryDecision).toBe(decision);
    expect(libraryTransition).toBe(transition);
    expect(libraryMemory).toBe(memory);
    expect(libraryBrief).toBe(brief);
    expect(libraryRecall).toBe(recall);
    expect(libraryRules).toBe(rules);
    expect(libraryVerify).toBe(verify);
    expect(libraryBeforeAPath).toBe(beforeAPath);
  });
});

describe('the same input through the three doors', () => {
  for (const scenario of SCENARIOS) {
    it(scenario.name, async () => {
      const cli = await through('cli', scenario);
      const mcp = await through('mcp', scenario);
      const sdk = await through('sdk', scenario);
      expect(cli.said.length).toBe(scenario.steps.length);
      // The three give the same answers…
      expect(mcp.said).toEqual(cli.said);
      expect(sdk.said).toEqual(cli.said);
      // …and leave the same record.
      expect(mcp.held).toEqual(cli.held);
      expect(sdk.held).toEqual(cli.held);
    });
  }
});

// ---------------------------------------------------------------------------
// The doors that read
// ---------------------------------------------------------------------------

describe('the reads', () => {
  it('say the same from a project and the same refusal from outside one', async () => {
    const cli = founded('cli');
    cli.mnema(
      'decision',
      'record',
      'keep the api versioned',
      'clients pin to it',
      '--which',
      AGENT,
    );
    const id = /\(([0-9a-f-]{36})\)/.exec(cli.mnema('decision', 'record', 'x', 'y').out)?.[1];
    expect(id).toBeDefined();
    const library = openRecord({ cwd: cli.repo, agent: AGENT, env: { home: cli.home } });
    // `brief` and `rules`: what the command prints is what the library door returns.
    const printed = cli.mnema('brief');
    expect(library.brief()).toEqual({ ok: true, document: printed.out.replace(/\n$/, '') });
    const rules = cli.mnema('rules', 'src/api', '--json');
    const asked = library.rulesFor('src/api');
    expect(asked.ok && JSON.stringify(asked.governed, null, 2)).toBe(rules.out.replace(/\n$/, ''));
    const verified = cli.mnema('verify', '--json');
    const verdict = library.verify();
    expect(verified.status).toBe(verdict.ok && verdict.requirementMet ? 0 : 1);

    // From outside a project every read refuses the same, and the CLI's words say so.
    const outside = founded('sdk', false);
    const away = openRecord({ cwd: outside.repo, agent: AGENT, env: { home: outside.home } });
    for (const [verb, result] of [
      ['brief', away.brief()],
      ['recall', away.recall()],
      ['rules', away.rulesFor('x')],
      ['verify', away.verify()],
    ] as const) {
      expect(result).toMatchObject({ ok: false, reason: 'NO_PROJECT' });
      const ran = outside.mnema(...(verb === 'rules' ? ['rules', 'x'] : [verb]));
      expect(ran.status, verb).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// The hook
// ---------------------------------------------------------------------------

describe('the hook before a write', () => {
  /** A project where a rule refuses a write under `src/vault`. */
  function withARule(door: Door): void {
    const recorded = door.mnema('decision', 'record', 'keep out of the vault', 'it holds secrets');
    const id = /\(([0-9a-f-]{36})\)/.exec(recorded.out)?.[1] as string;
    expect(door.mnema('decision', 'move', 'accept', id, '--note', 'agreed').status).toBe(0);
    expect(door.mnema('link', id, 'src/vault', '--rel', 'refuses-a-write').status).toBe(0);
  }

  it('refuses the same write and records the same facts, whichever door the host is', async () => {
    const payload = (repo: string, tool: string) =>
      JSON.stringify({
        tool_name: tool,
        tool_input: { filePath: join(repo, 'src/vault/key.txt') },
      });
    const cli = founded('cli');
    withARule(cli);
    const ranCli = typed(
      cli.repo,
      cli.home,
      ['before-a-write', '--host', 'vscode'],
      payload(cli.repo, 'create_file'),
    );
    expect(JSON.parse(ranCli.out).hookSpecificOutput.permissionDecision).toBe('deny');

    const mcp = founded('mcp');
    withARule(mcp);
    const server = await connected(mcp);
    expect(
      await server.call('rules_before_an_edit', { path: join(mcp.repo, 'src/vault/key.txt') }),
    ).toBe('ok');
    await server.close();

    const sdk = founded('sdk');
    withARule(sdk);
    const hooks = mnemaHooks({ cwd: sdk.repo, env: { home: sdk.home }, agent: AGENT });
    const matcher = hooks.PreToolUse[0];
    expect(matcher?.matcher).toBe('Write|Edit|NotebookEdit');
    const reply = (await matcher?.hooks[0]?.(
      {
        cwd: sdk.repo,
        tool_name: 'Write',
        tool_input: { file_path: join(sdk.repo, 'src/vault/key.txt') },
      },
      undefined,
      { signal: new AbortController().signal },
    )) as { hookSpecificOutput: { hookEventName: string; permissionDecision: string } };
    expect(reply.hookSpecificOutput).toMatchObject({
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
    });

    // The facts each recorded: one `channel.refused`, citing the rule and the path.
    const facts = (door: Door) =>
      eventsOf(door, false).filter((seen) => seen.kind.startsWith('channel.'));
    expect(facts(cli).map((seen) => seen.kind)).toEqual(['channel.refused']);
    expect(facts(mcp)).toEqual(facts(cli));
    expect(facts(sdk)).toEqual(facts(cli));
  });
});

describe('the hook at the start of a session', () => {
  const signal = { signal: new AbortController().signal };

  it('hands over the document the plugin hands over, and nothing from outside a project', async () => {
    const cli = founded('cli');
    const id = /\(([0-9a-f-]{36})\)/.exec(
      cli.mnema('decision', 'record', 'keep the api versioned', 'clients pin to it').out,
    )?.[1];
    expect(cli.mnema('decision', 'move', 'accept', id as string, '--note', 'agreed').status).toBe(
      0,
    );
    const printed = cli.mnema('brief', '--hook').out.replace(/\n$/, '');
    expect(printed).toContain('keep the api versioned');
    const hooks = mnemaHooks({ cwd: cli.repo, env: { home: cli.home } });
    expect(hooks.SessionStart[0]?.matcher).toBeUndefined();
    const reply = await hooks.SessionStart[0]?.hooks[0]?.({ cwd: cli.repo }, undefined, signal);
    expect(reply).toEqual({
      hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: printed },
    });

    const away = founded('sdk', false);
    const none = mnemaHooks({ cwd: away.repo, env: { home: away.home } });
    expect(await none.SessionStart[0]?.hooks[0]?.({ cwd: away.repo }, undefined, signal)).toEqual(
      {},
    );
    expect(
      await none.PreToolUse[0]?.hooks[0]?.(
        { cwd: away.repo, tool_name: 'Write', tool_input: { file_path: join(away.repo, 'a.txt') } },
        undefined,
        signal,
      ),
    ).toEqual({});
    expect(
      await none.PreToolUse[0]?.hooks[0]?.(
        { cwd: away.repo, tool_name: 'Write', tool_input: {} },
        undefined,
        signal,
      ),
    ).toEqual({});
  });

  it('carries, under the document, what the plugin carries about a record that does not chain', async () => {
    // A DOCUMENT THAT FILLS WHAT A HOOK CARRIES, to within a few characters: the notice is
    // part of what has to fit, so only a document this full is cut differently by one that
    // reserves room for it and one that does not. The pad rule's title is sized off a probe
    // project, so the figure is measured and not written down.
    const record = (door: Door, title: string) => {
      const made = door.mnema('decision', 'record', title, 'agreed with finance').out;
      const id = /\(([0-9a-f-]{36})\)/.exec(made)?.[1] as string;
      expect(door.mnema('decision', 'move', 'accept', id, '--note', 'agreed').status).toBe(0);
    };
    const titled = (n: number, length: number) => `Rule ${n}: ${'x'.repeat(length)}`;
    const fill = (door: Door, padLength: number) => {
      record(door, titled(1, 2500));
      record(door, titled(2, 2500));
      record(door, titled(3, padLength));
      return door.mnema('brief', '--hook').out.length;
    };
    const aim = HOOK_TEXT_CEILING - 20;
    const probeLength = 100;
    const probed = fill(founded('sdk'), probeLength);
    const door = founded('cli');
    const unbroken = fill(door, probeLength + (aim - probed));
    expect(unbroken).toBe(aim);

    // A line repeated on the tail: bytes the product wrote, in a place where they do not chain.
    const tails = join(door.repo, '.mnema', 'tails');
    const file = join(tails, readdirSync(tails)[0] as string, '000001.jsonl');
    const lines = readFileSync(file, 'utf-8').trimEnd().split('\n');
    appendFileSync(file, `${lines[lines.length - 1] as string}\n`, 'utf-8');

    const printed = door.mnema('brief', '--hook');
    expect(printed.err).toContain('issue [T1]');
    // The plugin hands over the verb's two streams, a blank line between: the document as
    // printed, then the notice. The host's callback has no terminator to keep.
    const asThePluginHandsIt = `${printed.out.replace(/\n$/, '')}\n\n${printed.err.trim()}`;
    // The notice really did change what fits: without room for it the whole of what was
    // printed above would not be the document.
    expect(printed.out.length).toBeLessThan(unbroken);
    expect(asThePluginHandsIt.length).toBeLessThanOrEqual(HOOK_TEXT_CEILING);
    const hooks = mnemaHooks({ cwd: door.repo, env: { home: door.home } });
    const reply = await hooks.SessionStart[0]?.hooks[0]?.({ cwd: door.repo }, undefined, signal);
    expect(reply).toEqual({
      hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: asThePluginHandsIt },
    });
  }, 90_000);
});

// ---------------------------------------------------------------------------
// Nothing is on one door alone
// ---------------------------------------------------------------------------

describe('an operation on one door has the others', () => {
  it('has a row for every method the library door has', () => {
    const door = founded('sdk');
    const methods = Object.keys(
      openRecord({ cwd: door.repo, agent: AGENT, env: { home: door.home } }),
    );
    expect(methods.sort()).toEqual(OPERATIONS.map((row) => row.method).sort());
  });

  it('has, for every tool the server writes with, a method or a reason', () => {
    const { tools } = buildMcpServer({ cwd: sandbox, env: { home: sandbox }, log: () => {} });
    const writing = tools.filter((tool) => tool.effect === 'mutates').map((tool) => tool.act);
    const covered = new Set(
      OPERATIONS.flatMap((row) => (typeof row.tool === 'string' ? [row.tool] : [])),
    );
    const lacking = writing.filter(
      (tool) => !covered.has(tool) && NOT_IN_THE_LIBRARY[tool] === undefined,
    );
    expect(lacking).toEqual([]);
    // And no reason outlives its tool.
    const stale = Object.keys(NOT_IN_THE_LIBRARY).filter((tool) => !writing.includes(tool));
    expect(stale).toEqual([]);
  });

  it('has, for every verb that writes, a method or a reason', () => {
    const io: CliIo = { out: () => undefined, err: () => undefined, fail: () => undefined };
    const pinned: PinnedRun = () => undefined;
    const declared = registerVerbs(new Command(), {
      io,
      render: renderPlain,
      renderingAt: () => renderPlain,
      pinnedRun: pinned,
    });
    const writing = declared
      .filter((verb) => verb.effect === 'mutates')
      .map((verb) => verb.act.name());
    const covered = new Set(OPERATIONS.filter((row) => row.writes).map((row) => row.verb));
    const lacking = writing.filter(
      (verb) => !covered.has(verb) && VERBS_NOT_IN_THE_LIBRARY[verb] === undefined,
    );
    expect(lacking).toEqual([]);
    const stale = Object.keys(VERBS_NOT_IN_THE_LIBRARY).filter((verb) => !writing.includes(verb));
    expect(stale).toEqual([]);
  });

  it('has, for every subcommand of a verb the library covers, a method or a reason', () => {
    const io: CliIo = { out: () => undefined, err: () => undefined, fail: () => undefined };
    const pinned: PinnedRun = () => undefined;
    const declared = registerVerbs(new Command(), {
      io,
      render: renderPlain,
      renderingAt: () => renderPlain,
      pinnedRun: pinned,
    });
    const rows = OPERATIONS.filter((row) => row.writes);
    const covered = new Set(rows.map((row) => row.verb));
    const coveredSubs = new Set(rows.flatMap((row) => (row.sub ? [`${row.verb} ${row.sub}`] : [])));
    const subcommands = declared
      .filter((verb) => verb.effect === 'mutates' && covered.has(verb.act.name()))
      .flatMap((verb) => verb.act.commands.map((sub) => `${verb.act.name()} ${sub.name()}`));
    // Non-vacuity: the group this census exists for is among what it walked.
    expect(subcommands).toContain('decision move');
    const lacking = subcommands.filter(
      (sub) => !coveredSubs.has(sub) && SUBCOMMANDS_NOT_IN_THE_LIBRARY[sub] === undefined,
    );
    expect(lacking).toEqual([]);
    const stale = Object.keys(SUBCOMMANDS_NOT_IN_THE_LIBRARY).filter(
      (sub) => !subcommands.includes(sub),
    );
    expect(stale).toEqual([]);
    // And a row that names a subcommand the verb does not have is not a row.
    expect([...coveredSubs].filter((sub) => !subcommands.includes(sub))).toEqual([]);
  });
});
