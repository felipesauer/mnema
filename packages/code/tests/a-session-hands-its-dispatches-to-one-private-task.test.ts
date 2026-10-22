/**
 * What a session hands to other agents is kept as one private task with a handoff for each dispatch,
 * and the task is closed when the session ends. The prompt of a dispatch is never kept, nothing goes
 * to the tree a clone gets, and the task is the session journal's to remember.
 *
 * The files under test are `src/commands/dispatched.ts` (the verb's command) and the field it adds to
 * `src/session-journal.ts`. The payloads are in the shape the host's `PostToolUse` on its `Agent` tool
 * hands a hook (`tool_input` with `description`, `prompt` and `subagent_type`, `tool_response`,
 * `session_id`, `cwd`, `tool_use_id`) and the `SessionEnd` the host hands at the end.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DiscoveryEnv } from '@mnema/core';
import { resolveTrees } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  briefFileOf,
  briefOf,
  type DispatchedDone,
  runDispatched,
} from '../src/commands/dispatched.js';
import { runSessionTally } from '../src/commands/tally.js';
import { type CliIo, run } from '../src/program.js';
import { journalFile, journalsDir, readJournal, STALE_AFTER_MS } from '../src/session-journal.js';
import { withScopedCaches } from '../src/tree-sources.js';

let sandbox: string;
let repo: string;
let env: DiscoveryEnv;
let originalCwd: string;
let originalHome: string | undefined;
let originalXdg: string | undefined;

const SESSION = '5d1f0a52-0000-4000-8000-0123456789ab';
const PROMPT_WORDS = 'PROMPTSENTINEL rename the ledger to utc and do not touch the migration';

async function doing(...argv: string[]): Promise<string[]> {
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
  expect(failed, `${argv.join(' ')}: ${err.join(' / ')}`).toBe(false);
  return out;
}

/** The payload the host hands a hook after the `Agent` tool. */
function dispatch(over: { prompt?: string; type?: string; tool?: string; session?: string } = {}) {
  return JSON.stringify({
    hook_event_name: 'PostToolUse',
    session_id: over.session ?? SESSION,
    cwd: repo,
    tool_use_id: 'toolu_01',
    tool_name: over.tool ?? 'Agent',
    tool_input: {
      description: 'Fix the ledger date',
      prompt: over.prompt ?? PROMPT_WORDS,
      ...(over.type === undefined
        ? { subagent_type: 'implementar' }
        : { subagent_type: over.type }),
    },
    tool_response: {
      status: 'completed',
      agentId: 'a1',
      description: 'Fix the ledger date',
      outputFile: '/tmp/out.output',
    },
  });
}

function theEnd(session = SESSION): string {
  return JSON.stringify({
    hook_event_name: 'SessionEnd',
    session_id: session,
    cwd: repo,
    reason: 'prompt_input_exit',
  });
}

function mirror(payload: string, now?: Date): DispatchedDone {
  return runDispatched({ cwd: repo, env, ...(now === undefined ? {} : { now }) }, { payload });
}

interface Seen {
  readonly scope: string;
  readonly id: string;
  readonly title: string;
  readonly state: string;
  readonly proof: string;
}

/** The tasks of every tree, and the handoffs on each, as the projection holds them. */
function whatTheRecordHolds(): {
  tasks: Seen[];
  handoffs: { scope: string; task: string; from: string; to: string; brief: string }[];
} {
  return withScopedCaches(resolveTrees(repo, env), (sources) => {
    const tasks: Seen[] = [];
    const handoffs: { scope: string; task: string; from: string; to: string; brief: string }[] = [];
    for (const source of sources) {
      for (const task of source.cache.listTasks()) {
        tasks.push({
          scope: source.scope,
          id: task.id,
          title: task.title,
          state: task.state,
          proof: JSON.stringify(task.proof ?? null),
        });
        const briefs = source.cache
          .listObservationsAbout(task.id)
          .filter((note) => note.topic === 'brief')
          .sort((x, y) => (x.recordedAt < y.recordedAt ? -1 : 1))
          .map((note) => note.text);
        source.cache.listHandoffs(task.id).forEach((one, index) => {
          handoffs.push({
            scope: source.scope,
            task: task.id,
            from: one.fromAgent,
            to: one.toAgent,
            brief: briefs[index] ?? '',
          });
        });
      }
    }
    return { tasks, handoffs };
  });
}

/** Every file under `dir`, with its size and content, so a before and an after can be compared. */
function snapshot(dir: string, leaving: readonly string[] = []): string {
  const parts: string[] = [];
  const walk = (at: string): void => {
    if (!existsSync(at)) return;
    for (const entry of readdirSync(at, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const path = join(at, entry.name);
      if (entry.isDirectory()) {
        if (!leaving.includes(entry.name)) walk(path);
      } else parts.push(`${path}\n${readFileSync(path, 'utf-8')}`);
    }
  };
  walk(dir);
  return parts.join('\n---\n');
}

beforeEach(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-dispatched-'));
  repo = join(sandbox, 'repo');
  mkdirSync(repo, { recursive: true });
  mkdirSync(join(sandbox, 'home'), { recursive: true });
  originalCwd = process.cwd();
  originalHome = process.env.HOME;
  originalXdg = process.env.XDG_DATA_HOME;
  process.env.HOME = join(sandbox, 'home');
  process.env.XDG_DATA_HOME = join(sandbox, 'data');
  delete process.env.MNEMA_RUN;
  env = { home: join(sandbox, 'home') };
  process.chdir(repo);
  await doing('init');
});

afterEach(() => {
  process.chdir(originalCwd);
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalXdg === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = originalXdg;
  rmSync(sandbox, { recursive: true, force: true });
});

describe('three dispatches of one session', () => {
  it('make one private task in progress and three private handoffs with a brief each', () => {
    // What the tree a clone gets holds: the projection cache under locks/ is a read's own, and private/ is the other tree.
    const publicBefore = snapshot(join(repo, '.mnema'), ['locks', 'private']);
    for (const type of ['implementar', 'revisar', 'probe']) {
      expect(mirror(dispatch({ type })).notes).toEqual([]);
    }
    const held = whatTheRecordHolds();
    expect(held.tasks).toHaveLength(1);
    const [task] = held.tasks;
    expect(task?.scope).toBe('private');
    expect(task?.state).toBe('IN_PROGRESS');
    expect(task?.title).toMatch(
      /^Work handed over in this session, \d{4}-\d\d-\d\d \d\d:\d\d UTC$/,
    );
    expect(held.handoffs.map((one) => [one.scope, one.from, one.to])).toEqual(
      expect.arrayContaining([
        ['private', 'orchestrator', 'implementar'],
        ['private', 'orchestrator', 'revisar'],
        ['private', 'orchestrator', 'probe'],
      ]),
    );
    expect(held.handoffs).toHaveLength(3);
    for (const one of held.handoffs) expect(one.brief).toContain('Fix the ledger date');
    // The tree a clone gets was not touched.
    expect(snapshot(join(repo, '.mnema'), ['locks', 'private'])).toBe(publicBefore);
  });

  it('close with the session: the task is done, and its note is the count', () => {
    for (let i = 0; i < 3; i++) mirror(dispatch());
    expect(mirror(theEnd()).notes).toEqual([]);
    const [task] = whatTheRecordHolds().tasks;
    expect(task?.state).toBe('DONE');
    expect(task?.proof).toContain('3 handoffs recorded in this session.');
  });

  it('keep the task in the session journal, and the journal on its own is not the goal of the session', () => {
    mirror(dispatch());
    const file = journalFile(resolveTrees(repo, env), SESSION);
    const held = readJournal(file as string)?.handedOver;
    expect(held?.handoffs).toBe(1);
    expect(held?.closed).toBe(false);
    const transcript = join(sandbox, 't.jsonl');
    writeFileSync(
      transcript,
      `${JSON.stringify({ type: 'user', timestamp: '2020-01-01T00:00:00.000Z', message: { role: 'user', content: 'go' } })}\n`,
    );
    runSessionTally(
      { cwd: repo, env },
      {
        payload: JSON.stringify({
          hook_event_name: 'Stop',
          transcript_path: transcript,
          session_id: SESSION,
        }),
      },
    );
    const after = readJournal(file as string);
    expect(after?.handedOver).toEqual(held);
    expect(after?.goal).toBeNull();
    expect(after?.tasksInProgress).toEqual([]);
  });

  it('never carry the prompt: not in the record, not in the journal, not on this machine', () => {
    for (let i = 0; i < 3; i++) mirror(dispatch());
    mirror(theEnd());
    expect(snapshot(sandbox)).not.toContain('PROMPTSENTINEL');
    expect(snapshot(sandbox)).not.toContain('migration');
  });
});

describe('a prompt that cites a file', () => {
  it('puts that file’s path in the brief, and nothing of what the prompt says', () => {
    mkdirSync(join(repo, 'notes'), { recursive: true });
    writeFileSync(join(repo, 'notes', 'brief.md'), 'the long brief');
    mirror(dispatch({ prompt: `${PROMPT_WORDS}. Read notes/brief.md first.` }));
    const [one] = whatTheRecordHolds().handoffs;
    expect(one?.brief).toContain('Brief in the file: notes/brief.md');
    expect(one?.brief).not.toContain('PROMPTSENTINEL');
    expect(one?.brief).not.toContain('the long brief');
  });

  it('names no path that is not a file there', () => {
    expect(briefFileOf('see docs/missing.md and ./nothing.txt', repo, repo)).toBeUndefined();
    mkdirSync(join(repo, 'docs'));
    writeFileSync(join(repo, 'docs', 'real.md'), 'x');
    expect(briefFileOf('see docs/missing.md then (docs/real.md).', repo, repo)).toBe(
      'docs/real.md',
    );
    expect(briefFileOf(`at ${join(repo, 'docs', 'real.md')}`, '/', repo)).toBe('docs/real.md');
    const outside = join(sandbox, 'outside.md');
    writeFileSync(outside, 'x');
    expect(briefFileOf(`at ${outside}`, repo, repo)).toBe(outside);
  });

  it('keeps a brief short whatever the description is', () => {
    expect(briefOf(`${'a'.repeat(500)}`, undefined)).toHaveLength(200);
    expect(briefOf(undefined, undefined)).toBe('Work handed to a subagent.');
  });
});

describe('a session that is resumed', () => {
  it('reopens its task and closes it again with the whole count', () => {
    mirror(dispatch());
    mirror(theEnd());
    mirror(dispatch());
    const after = whatTheRecordHolds();
    expect(after.tasks).toHaveLength(1);
    expect(after.tasks[0]?.state).toBe('IN_PROGRESS');
    mirror(theEnd());
    const done = whatTheRecordHolds();
    expect(done.tasks[0]?.state).toBe('DONE');
    expect(done.tasks[0]?.proof).toContain('2 handoffs recorded in this session.');
    expect(done.handoffs).toHaveLength(2);
  });
});

describe('a session that ended with no word', () => {
  it('has its task closed by the next session that dispatches, once its journal is a day old', () => {
    mirror(dispatch({ session: 'old-session' }));
    const trees = resolveTrees(repo, env);
    const old = journalFile(trees, 'old-session') as string;
    const longAgo = new Date(Date.now() - STALE_AFTER_MS - 60_000);
    utimesSync(old, longAgo, longAgo);
    mirror(dispatch({ session: 'new-session' }));
    const held = whatTheRecordHolds();
    expect(held.tasks).toHaveLength(2);
    expect(held.tasks.map((task) => task.state).sort()).toEqual(['DONE', 'IN_PROGRESS']);
    expect(readJournal(old)?.handedOver?.closed).toBe(true);
    // One that is recent is a live session's: it is left alone.
    mirror(dispatch({ session: 'third-session' }));
    expect(whatTheRecordHolds().tasks.filter((task) => task.state === 'IN_PROGRESS')).toHaveLength(
      2,
    );
    expect(journalsDir(trees)).toBeDefined();
  });
});

describe('where it stays silent, and never fails', () => {
  it('does nothing for another tool, another event, or a session that names no id', () => {
    expect(mirror(dispatch({ tool: 'Bash' })).notes).toEqual([]);
    expect(mirror(JSON.stringify({ hook_event_name: 'Stop', session_id: SESSION })).notes).toEqual(
      [],
    );
    expect(mirror(dispatch({ session: '../../x' })).notes).toEqual([]);
    expect(whatTheRecordHolds().tasks).toEqual([]);
  });

  it('says a payload that is not JSON was not read, and records nothing', () => {
    const done = mirror('not json');
    expect(done.reply).toEqual({});
    expect(done.notes).toHaveLength(1);
    expect(whatTheRecordHolds().tasks).toEqual([]);
  });

  it('does nothing outside a project', () => {
    const away = join(sandbox, 'away');
    mkdirSync(away);
    const done = runDispatched({ cwd: away, env }, { payload: dispatch() });
    expect(done).toEqual({ ok: true, reply: {}, notes: [] });
  });

  it('does nothing where its switch is off, or the journal’s', async () => {
    await doing('switch', 'off', 'agent-mirror');
    mirror(dispatch());
    expect(whatTheRecordHolds().tasks).toEqual([]);
    await doing('switch', 'on', 'agent-mirror');
    await doing('switch', 'off', 'session-journal');
    mirror(dispatch());
    expect(whatTheRecordHolds().tasks).toEqual([]);
    expect(statSync(sandbox).isDirectory()).toBe(true);
  });
});
