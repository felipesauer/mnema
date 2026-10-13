/**
 * EVERY VERB THAT WRITES, RUN AS THE AGENT THE VARIABLE NAMES, LEAVES A RECORD `verify` ACCEPTS.
 *
 * No door of the core refuses a fact an agent's key signs under another name, or with no name: only
 * `verify` does. So the property of the command line is not "it passes the agent to the core" but
 * "what it wrote, `verify` reads back as attested". This runs each verb that writes a fact an
 * agent's key may sign (and `corrections` and `promote`, which write through others) on a machine
 * that holds the agent `ci` in all three trees and no key of a person, with `MNEMA_AGENT_KEY=ci`,
 * and asks of each, with its own words:
 *   - it succeeded, and wrote;
 *   - every fact it appended is signed by the agent's key and names `ci`;
 *   - `verify` of the project and of the machine's tree still exit 0;
 *   - no identity was founded and no `identity/` folder was made;
 *   - where the verb takes `--which` and was given another name, the second stream says it was
 *     ignored and the fact names `ci`.
 *
 * The verbs are found by what they CALL, so a verb that begins to write as the agent and has no
 * case here lights this test, and one that forgets the agent lights the cases.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type CatalogEvent, catalogUpcasters } from '@mnema/chain';
import { type DiscoveryEnv, orderedEvents, resolveTrees } from '@mnema/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CliIo, run } from '../src/program.js';

const AGENT = 'MNEMA_AGENT_KEY';
const PASSPHRASE = 'MNEMA_KEY_PASSPHRASE';
const IGNORED =
  '--which "bot" was ignored: this is signed by the agent "ci", and the fact names it as the record does.';
const here = dirname(fileURLToPath(import.meta.url));
const commands = join(here, '..', 'src', 'commands');
const STACK = join(here, '..', '..', 'stacks', 'examples', 'evidence-first');

interface Said {
  readonly out: string;
  readonly err: string;
  readonly failed: boolean;
}

interface Verb {
  /** The argv of the first run: the agent signs as the variable says. */
  readonly argv?: () => readonly string[];
  /** The same verb with `--which bot` on another entity, where the verb takes `--which`. */
  readonly named?: () => readonly string[];
  /** What the host hands on stdin, for a hook. */
  readonly stdin?: string;
  /** Reads what it printed, for the id the next case needs. */
  readonly after?: (out: string) => void;
}

let sandbox: string;
let home: string;
let repo: string;
let other: string;
let env: DiscoveryEnv;
let fingerprint: string;
const ids: Record<string, string> = {};
const seen = new Set<string>();
const saved: Record<string, string | undefined> = {};
let originalCwd: string;

async function mnema(
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

/** Setup, as the person: it must succeed. */
async function did(...argv: string[]): Promise<string> {
  const said = await mnema(undefined, undefined, ...argv);
  expect(said.failed, `${argv.join(' ')}: ${said.out}${said.err}`).toBe(false);
  return said.out;
}

const uuidIn = (text: string): string => {
  const found = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)?.[0];
  if (found === undefined) throw new Error(`setup: no id in ${text}`);
  return found;
};

const trees = () => resolveTrees(repo, env);

function allEvents(): CatalogEvent[] {
  const t = trees();
  return [t.projectPublic, t.projectPrivate, t.global].flatMap((root) =>
    root === undefined || !existsSync(root) ? [] : orderedEvents({ root }, catalogUpcasters()),
  );
}

/** What was appended since the last call. */
function appended(): CatalogEvent[] {
  const fresh: CatalogEvent[] = [];
  for (const event of allEvents()) {
    const key = JSON.stringify(event);
    if (!seen.has(key)) {
      seen.add(key);
      fresh.push(event);
    }
  }
  return fresh;
}

/** Makes the agent, and has the record enrol it in the three trees. */
async function enrolled(name: string): Promise<string> {
  const anchor = (await did('audit', 'accountability')).match(/mnid:[0-9a-f]{8}/)?.[0];
  const requested = await did('key', 'request', '--agent', name, '--anchor', anchor as string);
  const line = requested.split('\n').find((one) => one.startsWith('mnema-agent-request:1:'));
  await did('key', 'enroll', '--agent', line as string);
  return requested.match(/\b[0-9a-f]{64}\b/)?.[0] as string;
}

const typed = (text: string): string =>
  JSON.stringify({
    type: 'user',
    sessionId: 's-1',
    uuid: `u-${text.length}`,
    timestamp: '2026-10-01T10:00:00.000Z',
    origin: { kind: 'human' },
    message: { role: 'user', content: text },
  });

/** The verbs, by the file that holds them. */
const VERBS: Record<string, readonly Verb[]> = {
  'decision.ts': [
    {
      argv: () => ['decision', 'record', 'Agent decision', 'because it is enrolled'],
      named: () => ['decision', 'record', 'Agent decision two', 'why', '--which', 'bot'],
    },
  ],
  'decision-import.ts': [{ argv: () => ['decision', 'import', 'adr', '--write'] }],
  'decision-transition.ts': [
    {
      argv: () => ['decision', 'move', 'accept', ids.d1 as string, '--note', 'agreed'],
      named: () => [
        'decision',
        'move',
        'accept',
        ids.d2 as string,
        '--note',
        'agreed',
        '--which',
        'bot',
      ],
    },
  ],
  'handoff.ts': [
    {
      argv: () => ['task', 'handoff', ids.t1 as string, 'ci', 'someone'],
      named: () => ['task', 'handoff', ids.t2 as string, 'ci', 'someone', '--which', 'bot'],
    },
  ],
  'link.ts': [
    {
      argv: () => ['link', ids.d3 as string, ids.d4 as string, '--rel', 'relates-to'],
      named: () => [
        'link',
        ids.d4 as string,
        ids.d3 as string,
        '--rel',
        'relates-to',
        '--which',
        'bot',
      ],
    },
  ],
  'unlink.ts': [
    {
      argv: () => [
        'unlink',
        ids.d3 as string,
        ids.d4 as string,
        '--rel',
        'relates-to',
        '--reason',
        'r',
      ],
      named: () => [
        'unlink',
        ids.d4 as string,
        ids.d3 as string,
        '--rel',
        'relates-to',
        '--reason',
        'r',
        '--which',
        'bot',
      ],
    },
  ],
  'memory.ts': [
    {
      argv: () => ['memory', 'a note of the agent', '--scope', 'public'],
      named: () => ['memory', 'another note of the agent', '--scope', 'public', '--which', 'bot'],
    },
  ],
  'observe.ts': [
    {
      argv: () => ['observe', ids.d1 as string, '--topic', 't', '--text', 'seen'],
      named: () => [
        'observe',
        ids.d2 as string,
        '--topic',
        't',
        '--text',
        'seen',
        '--which',
        'bot',
      ],
    },
  ],
  'retract.ts': [
    {
      argv: () => ['retract', ids.m1 as string, '--reason', 'r'],
      named: () => ['retract', ids.m2 as string, '--reason', 'r', '--which', 'bot'],
    },
  ],
  'run-start.ts': [
    {
      argv: () => ['run', 'start', '--which', 'ci'],
      after: (out) => {
        ids.run1 = uuidIn(out);
      },
    },
    {
      named: () => ['run', 'start', '--which', 'bot'],
      after: (out) => {
        ids.run2 = uuidIn(out);
      },
    },
  ],
  'run-end.ts': [
    { argv: () => ['run', 'end', ids.run1 as string, '--which', 'ci'] },
    { named: () => ['run', 'end', ids.run2 as string, '--which', 'bot'] },
  ],
  'skill.ts': [
    {
      argv: () => ['skill', 'create', 'Agent skill', '--body', 'b'],
      named: () => ['skill', 'create', 'Agent skill two', '--body', 'b', '--which', 'bot'],
    },
  ],
  'skill-transition.ts': [
    {
      argv: () => ['skill', 'move', 'review', ids.k1 as string, '--note', 'read'],
      named: () => [
        'skill',
        'move',
        'review',
        ids.k2 as string,
        '--note',
        'read',
        '--which',
        'bot',
      ],
    },
  ],
  'stack-install.ts': [
    { argv: () => ['stack', 'add', STACK, '--scope', 'public', '--expect', ids.digest as string] },
    { argv: () => ['stack', 'remove', 'evidence-first', '--scope', 'public'] },
    { argv: () => ['stack', 'add', STACK, '--scope', 'global', '--expect', ids.digest as string] },
    { argv: () => ['stack', 'remove', 'evidence-first', '--scope', 'global'] },
  ],
  'switch.ts': [
    {
      argv: () => ['switch', 'off', 'edit-asks-a-person'],
      named: () => ['switch', 'on', 'edit-asks-a-person', '--which', 'bot'],
    },
  ],
  'tail-prune.ts': [
    {
      argv: () => ['tail', 'prune', ids.tail as string, '--reason', 'r'],
      named: () => ['tail', 'prune', ids.tail as string, '--reason', 'r', '--which', 'bot'],
    },
  ],
  'task.ts': [
    {
      argv: () => ['task', 'create', 'Agent task'],
      named: () => ['task', 'create', 'Agent task two', '--which', 'bot'],
    },
  ],
  'task-transition.ts': [
    {
      argv: () => ['task', 'move', 'submit', ids.t1 as string],
      named: () => ['task', 'move', 'submit', ids.t2 as string, '--which', 'bot'],
    },
  ],
  'check.ts': [
    {
      argv: () => ['check', 'declare', ids.d1 as string, 'node', '--', '-v'],
      named: () => ['check', 'declare', ids.d2 as string, '--which', 'bot', 'node', '--', '-v'],
    },
  ],
  'before-a-write.ts': [
    {
      argv: () => ['before-a-write', '--host', 'vscode'],
      stdin: '',
    },
  ],
  'corrections.ts': [{ argv: () => ['corrections'], stdin: '' }],
  'promote.ts': [{ argv: () => ['promote', ids.p1 as string, '--evidence', `${other}:${ids.p2}`] }],
};

/** The files of the commands that write as the agent: found by what they call. */
function theAgentsFiles(): string[] {
  const WRITES = /\b(openTreeForWriting|deferredWrite)\(/;
  return readdirSync(commands)
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
    .filter((file) => {
      const source = readFileSync(join(commands, file), 'utf-8');
      return WRITES.test(source) && /write-as-the-agent|withAgentKey\(/.test(source);
    })
    .sort();
}

beforeAll(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-every-verb-agent-'));
  home = join(sandbox, 'home');
  repo = join(sandbox, 'repo');
  other = join(sandbox, 'other');
  mkdirSync(home, { recursive: true });
  mkdirSync(join(repo, 'src', 'billing'), { recursive: true });
  mkdirSync(other, { recursive: true });
  originalCwd = process.cwd();
  for (const name of ['HOME', 'XDG_DATA_HOME', 'MNEMA_HOME', 'MNEMA_RUN', AGENT, PASSPHRASE]) {
    saved[name] = process.env[name];
  }
  process.env.HOME = home;
  process.env.XDG_DATA_HOME = join(sandbox, 'data');
  for (const name of ['MNEMA_HOME', 'MNEMA_RUN', AGENT, PASSPHRASE]) delete process.env[name];
  env = { home };

  // The person sets the project up: init, the entities the agent will act on, the agent.
  process.chdir(other);
  await did('init');
  const skill = async (): Promise<string> => {
    const id = uuidIn(
      await did('skill', 'create', 'Run the suite', '--body', 'Run it before every push.'),
    );
    await did('skill', 'move', 'review', id, '--note', 'read');
    await did('skill', 'move', 'adopt', id, '--note', 'good');
    return id;
  };
  ids.p2 = await skill();
  process.chdir(repo);
  await did('init');
  ids.p1 = await skill();
  for (const n of ['d1', 'd2', 'd3', 'd4']) {
    ids[n] = uuidIn(await did('decision', 'record', `Seed ${n}`, 'because'));
  }
  await did('decision', 'move', 'accept', ids.d3 as string, '--note', 'agreed');
  await did('link', ids.d3 as string, 'src/billing', '--rel', 'refuses-a-write');
  for (const n of ['t1', 't2']) ids[n] = uuidIn(await did('task', 'create', `Seed ${n}`));
  for (const n of ['k1', 'k2'])
    ids[n] = uuidIn(await did('skill', 'create', `Seed ${n}`, '--body', 'b'));
  for (const n of ['m1', 'm2'])
    ids[n] = uuidIn(await did('memory', `Seed note ${n}`, '--scope', 'public'));
  await did('switch', 'on', 'user-corrections');
  mkdirSync(join(repo, 'adr'), { recursive: true });
  writeFileSync(
    join(repo, 'adr', '0001-use-x.md'),
    '# 1. Use X\n\n## Status\n\nAccepted\n\n## Context\n\nWe need X.\n\n## Decision\n\nUse X.\n',
  );
  fingerprint = await enrolled('ci');
  ids.digest = (await did('stack', 'add', STACK, '--scope', 'public', '--dry-run')).match(
    /digest\s+([0-9a-f]{64})/,
  )?.[1] as string;
  const listing = await did('tail', 'list');
  ids.tail = listing.match(/\b[0-9a-f]{64}-[0-9a-zA-Z-]+\b/)?.[0] as string;

  // From here the machine holds the agent's folder and no key of a person's.
  rmSync(join(home, '.mnema', 'identity'), { recursive: true, force: true });
  appended();
}, 240_000);

afterAll(() => {
  process.chdir(originalCwd);
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  rmSync(sandbox, { recursive: true, force: true });
});

/** What a case asks of every run of a verb. */
async function runIt(
  file: string,
  verb: Verb,
  argv: readonly string[],
  named: boolean,
): Promise<void> {
  const label = `${file}: ${argv.join(' ')}`;
  const transcript = join(sandbox, 'session.jsonl');
  writeFileSync(
    transcript,
    `${[typed('Fix it'), typed('No, use pnpm instead of npm.')].join('\n')}\n`,
  );
  const stdin =
    file === 'before-a-write.ts'
      ? JSON.stringify({
          hook_event_name: 'PreToolUse',
          tool_name: 'create_file',
          tool_input: { filePath: join(repo, 'src', 'billing', 'invoice.ts'), content: 'x' },
          cwd: repo,
        })
      : file === 'corrections.ts'
        ? JSON.stringify({ hook_event_name: 'Stop', transcript_path: transcript, cwd: repo })
        : verb.stdin;
  process.chdir(repo);
  const said = await mnema('ci', stdin, ...argv);
  expect(said.failed, `${label}: ${said.out}${said.err}`).toBe(false);
  verb.after?.(said.out);

  const fresh = appended();
  expect(fresh.length, `${label} wrote nothing`).toBeGreaterThan(0);
  for (const event of fresh) {
    expect(event.kind, label).not.toBe('identity.founded');
    expect({ kind: event.kind, which: event.which, signer: event.signerFp }, label).toEqual({
      kind: event.kind,
      which: 'ci',
      signer: fingerprint,
    });
  }
  // `corrections` declares a name of its own for what it records, and the record's name wins; no
  // `--which` was typed, so no line speaks of one.
  if (file !== 'corrections.ts' && named) expect(said.err, label).toContain(IGNORED);
  else expect(said.err, label).not.toContain('was ignored');

  for (const verify of [['verify'], ['verify', '--global']]) {
    const checked = await mnema(undefined, undefined, ...verify);
    expect(checked.failed, `${label}: ${verify.join(' ')} said ${checked.out}${checked.err}`).toBe(
      false,
    );
  }
  expect(existsSync(join(home, '.mnema', 'identity')), `${label} made an identity`).toBe(false);
}

describe('every verb that writes, run as the agent the variable names', () => {
  it('has a case for each verb found by what it calls, and for none that is not one', () => {
    const found = theAgentsFiles();
    const covered = Object.keys(VERBS).filter(
      (file) => file !== 'corrections.ts' && file !== 'promote.ts',
    );
    expect(covered.sort()).toEqual(found);
  });

  for (const [file, verbs] of Object.entries(VERBS)) {
    it(`${file} signs as the agent, names it, and leaves a record \`verify\` accepts`, async () => {
      for (const verb of verbs) {
        if (verb.argv !== undefined) await runIt(file, verb, verb.argv(), false);
      }
    });
  }

  for (const [file, verbs] of Object.entries(VERBS)) {
    const named = verbs.filter((verb) => verb.named !== undefined);
    if (named.length === 0) continue;
    it(`${file} names the agent the record gives it, whatever --which says`, async () => {
      for (const verb of named) {
        const argv = (verb.named as () => readonly string[])();
        const bot = argv.includes('--which') && argv[argv.indexOf('--which') + 1] === 'bot';
        await runIt(file, verb, argv, bot);
      }
    });
  }
});
