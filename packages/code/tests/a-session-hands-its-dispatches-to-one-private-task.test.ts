/**
 * What a session hands to other agents is kept as one private task with a handoff for each dispatch,
 * and the task is closed when the session ends. The prompt of a dispatch is never kept, nothing goes
 * to the tree a clone gets, and the task is the session journal's to remember.
 *
 * The files under test are `src/commands/dispatched.ts` (the verb's command) and the field it adds to
 * `src/session-journal.ts`, and `src/wiring/dispatched.ts`, the verb as the command line routes it. The payloads are in the shape the host's `PostToolUse` on its `Agent` tool
 * hands a hook (`tool_input` with `description`, `prompt` and `subagent_type`, `tool_response`,
 * `session_id`, `cwd`, `tool_use_id`) and the `SessionEnd` the host hands at the end.
 */

import { spawn } from 'node:child_process';
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
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { DiscoveryEnv } from '@mnema/core';
import { resolveTrees } from '@mnema/core';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  briefFileOf,
  briefOf,
  type DispatchedDone,
  runDispatched,
} from '../src/commands/dispatched.js';
import { runSessionTally } from '../src/commands/tally.js';
import { renderPlain } from '../src/presentation/plain.js';
import { type CliIo, run } from '../src/program.js';
import {
  journalAfter,
  journalFile,
  journalsDir,
  markEnded,
  readJournal,
  STALE_AFTER_MS,
} from '../src/session-journal.js';
import { withScopedCaches } from '../src/tree-sources.js';
import { emptyReading } from '../src/what-the-session-did.js';
import { registerDispatched } from '../src/wiring/dispatched.js';

// Each case makes real writes to a tree it signs, a few dozen milliseconds apiece, and the suite runs
// beside other heavy files: a case says so at its own `it`, and waits this long.
const WAITS_ON_WRITES = 30_000;

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
  it(
    'make one private task in progress and three private handoffs with a brief each',
    () => {
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
    },
    WAITS_ON_WRITES,
  );

  it(
    'close with the session: the task is done, and its note is the count',
    () => {
      for (let i = 0; i < 3; i++) mirror(dispatch());
      expect(mirror(theEnd()).notes).toEqual([]);
      const [task] = whatTheRecordHolds().tasks;
      expect(task?.state).toBe('DONE');
      expect(task?.proof).toContain('3 handoffs recorded in this session.');
    },
    WAITS_ON_WRITES,
  );

  it(
    'keep the task in the session journal, and the journal on its own is not the goal of the session',
    () => {
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
      expect(after?.trees.private.goal).toBeNull();
      expect(after?.trees.public.goal).toBeNull();
      expect(after?.tasksInProgress).toEqual([]);
    },
    WAITS_ON_WRITES,
  );

  it(
    'are kept by every later write of the journal, whoever makes it',
    () => {
      mirror(dispatch());
      const file = journalFile(resolveTrees(repo, env), SESSION) as string;
      const previous = readJournal(file);
      expect(previous?.handedOver?.handoffs).toBe(1);
      const next = withScopedCaches(resolveTrees(repo, env), (sources) =>
        journalAfter({
          session: SESSION,
          previous,
          reading: emptyReading(),
          sources,
          now: new Date(),
        }),
      );
      expect(next.handedOver).toEqual(previous?.handedOver);
    },
    WAITS_ON_WRITES,
  );

  it(
    'never carry the prompt: not in the record, not in the journal, not on this machine',
    () => {
      for (let i = 0; i < 3; i++) mirror(dispatch());
      mirror(theEnd());
      expect(snapshot(sandbox)).not.toContain('PROMPTSENTINEL');
      expect(snapshot(sandbox)).not.toContain('migration');
    },
    WAITS_ON_WRITES,
  );
});

describe('a prompt that cites a file', () => {
  it(
    'puts that file’s path in the brief, and nothing of what the prompt says',
    () => {
      mkdirSync(join(repo, 'notes'), { recursive: true });
      writeFileSync(join(repo, 'notes', 'brief.md'), 'the long brief');
      mirror(dispatch({ prompt: `${PROMPT_WORDS}. Read notes/brief.md first.` }));
      const [one] = whatTheRecordHolds().handoffs;
      expect(one?.brief).toContain('Brief in the file: notes/brief.md');
      expect(one?.brief).not.toContain('PROMPTSENTINEL');
      expect(one?.brief).not.toContain('the long brief');
    },
    WAITS_ON_WRITES,
  );

  it(
    'names no path that is not a file there',
    () => {
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
    },
    WAITS_ON_WRITES,
  );

  it(
    'keeps a brief short whatever the description is',
    () => {
      expect(briefOf(`${'a'.repeat(500)}`, undefined)).toHaveLength(200);
      expect(briefOf(undefined, undefined)).toBe('Work handed to a subagent.');
    },
    WAITS_ON_WRITES,
  );
});

describe('a session that is resumed', () => {
  it(
    'reopens its task and closes it again with the whole count',
    () => {
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
    },
    WAITS_ON_WRITES,
  );
});

describe('a session that ended with no word', () => {
  it(
    'has its task closed by the next session that dispatches, once its journal is a day old',
    () => {
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
      expect(
        whatTheRecordHolds().tasks.filter((task) => task.state === 'IN_PROGRESS'),
      ).toHaveLength(2);
      expect(journalsDir(trees)).toBeDefined();
    },
    WAITS_ON_WRITES,
  );
});

describe('where it stays silent, and never fails', () => {
  it(
    'does nothing for another tool, another event, or a session that names no id',
    () => {
      expect(mirror(dispatch({ tool: 'Bash' })).notes).toEqual([]);
      expect(
        mirror(JSON.stringify({ hook_event_name: 'Stop', session_id: SESSION })).notes,
      ).toEqual([]);
      expect(mirror(dispatch({ session: '../../x' })).notes).toEqual([]);
      expect(whatTheRecordHolds().tasks).toEqual([]);
    },
    WAITS_ON_WRITES,
  );

  it(
    'says a payload that is not JSON was not read, and records nothing',
    () => {
      const done = mirror('not json');
      expect(done.reply).toEqual({});
      expect(done.notes).toHaveLength(1);
      expect(whatTheRecordHolds().tasks).toEqual([]);
    },
    WAITS_ON_WRITES,
  );

  it(
    'stays silent when the journal’s lock is not had in time: no task, no handoff, and the skip is counted',
    () => {
      const file = journalFile(resolveTrees(repo, env), SESSION) as string;
      mirror(dispatch());
      const held = readJournal(file)?.handedOver;
      expect(held?.handoffs).toBe(1);
      // Another process holds the lock, freshly: this one is not let in within the time it waits.
      mkdirSync(`${file}.lock`);
      const before = whatTheRecordHolds();
      const skipped = runDispatched(
        { cwd: repo, env, lockWaitMs: 50 },
        { payload: dispatch({ type: 'revisar' }) },
      );
      expect(skipped.reply).toEqual({});
      expect(skipped.notes.join(' ')).toMatch(/not mirrored/);
      expect(whatTheRecordHolds()).toEqual(before);
      expect(readJournal(file)?.handedOver).toEqual(held);
      // A first dispatch of another session, with the lock held, opens no task either.
      const other = '7e7e7e7e-0000-4000-8000-0123456789ab';
      const otherFile = journalFile(resolveTrees(repo, env), other) as string;
      mkdirSync(`${otherFile}.lock`);
      runDispatched({ cwd: repo, env, lockWaitMs: 50 }, { payload: dispatch({ session: other }) });
      expect(whatTheRecordHolds().tasks).toHaveLength(before.tasks.length);
      // The lock let go, the session goes on, and its end says how many dispatches were not mirrored.
      rmSync(`${file}.lock`, { recursive: true });
      mirror(dispatch());
      mirror(theEnd());
      const [task] = whatTheRecordHolds().tasks.filter((one) => one.state === 'DONE');
      expect(task?.proof).toContain('2 handoffs recorded in this session');
      expect(task?.proof).toContain('1 dispatch was not mirrored');
    },
    WAITS_ON_WRITES,
  );

  it(
    'is listed by `mnema switch` as doing nothing while the journal’s switch is off',
    async () => {
      const row = (lines: string[]) => lines.find((line) => line.includes('agent-mirror')) ?? '';
      expect(row(await doing('switch'))).not.toContain('does nothing');
      await doing('switch', 'off', 'session-journal');
      const listed = row(await doing('switch'));
      expect(listed).toMatch(/agent-mirror\s+on\b/);
      expect(listed).toContain('does nothing while session-journal is off');
      // Off by its own switch, the line says it is off and nothing about the journal.
      await doing('switch', 'off', 'agent-mirror');
      expect(row(await doing('switch'))).not.toContain('does nothing while');
    },
    WAITS_ON_WRITES,
  );

  it(
    'clears a lock left by a process that died long ago, and mirrors the dispatch',
    () => {
      const file = journalFile(resolveTrees(repo, env), SESSION) as string;
      mirror(dispatch());
      mkdirSync(`${file}.lock`);
      const longAgo = new Date(Date.now() - 600_000);
      utimesSync(`${file}.lock`, longAgo, longAgo);
      mirror(dispatch({ type: 'revisar' }));
      expect(existsSync(`${file}.lock`)).toBe(false);
      expect(readJournal(file)?.handedOver?.handoffs).toBe(2);
    },
    WAITS_ON_WRITES,
  );

  it(
    'says so, and records nothing, when the mirror throws',
    () => {
      const thrown = runDispatched(
        { cwd: repo, env, agentKey: join(sandbox, 'no-such-key') },
        { payload: dispatch() },
      );
      expect(thrown.reply).toEqual({});
      expect(thrown.notes.join(' ')).toMatch(/^The mirror of the dispatch failed: /);
    },
    WAITS_ON_WRITES,
  );

  it(
    'does nothing outside a project',
    () => {
      const away = join(sandbox, 'away');
      mkdirSync(away);
      const done = runDispatched({ cwd: away, env }, { payload: dispatch() });
      expect(done).toEqual({ ok: true, reply: {}, notes: [] });
    },
    WAITS_ON_WRITES,
  );

  it(
    'does nothing where its switch is off, or the journal’s',
    async () => {
      await doing('switch', 'off', 'agent-mirror');
      mirror(dispatch());
      expect(whatTheRecordHolds().tasks).toEqual([]);
      await doing('switch', 'on', 'agent-mirror');
      await doing('switch', 'off', 'session-journal');
      mirror(dispatch());
      expect(whatTheRecordHolds().tasks).toEqual([]);
      expect(statSync(sandbox).isDirectory()).toBe(true);
    },
    WAITS_ON_WRITES,
  );
});

describe('the verb as the command line routes it', () => {
  it(
    'is a write, takes no option, and prints {} whatever it did',
    async () => {
      const seen = { out: [] as string[], err: [] as string[] };
      const io = {
        out: (line: string) => seen.out.push(line),
        err: (line: string) => seen.err.push(line),
        fail: () => {},
        input: async () => dispatch(),
      };
      const program = new Command('mnema').exitOverride();
      const declared = registerDispatched(program, {
        io,
        render: renderPlain,
      } as unknown as Parameters<typeof registerDispatched>[1]);
      expect(declared.effect).toBe('mutates');
      expect(declared.act.options).toEqual([]);
      await program.parseAsync(['dispatched'], { from: 'user' });
      expect(seen.out).toEqual(['{}']);
      expect(whatTheRecordHolds().handoffs).toHaveLength(1);
    },
    WAITS_ON_WRITES,
  );
});

describe('the lock on a journal', () => {
  // A child that waits for a shared instant, then asks for the lock and, inside it, makes a directory
  // only one at a time can make: a second one in at once is an overlap, which is two dispatches that
  // would each open the session's task.
  const CHILD = `
    import { appendFileSync, mkdirSync, rmSync } from 'node:fs';
    const [, , mod, file, start, inside, log] = process.argv;
    const { exclusivelyOn } = await import(mod);
    while (Date.now() < Number(start)) {}
    const ran = exclusivelyOn(file, () => {
      let overlap = false;
      try { mkdirSync(inside); } catch { overlap = true; }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30);
      if (!overlap) rmSync(inside, { recursive: true });
      appendFileSync(log, overlap ? 'O' : 'R');
      return true;
    }, 4000);
    if (ran === undefined) appendFileSync(log, 'S');
  `;

  it(
    'lets one of many processes that find the same old lock take it, and never two',
    async () => {
      const module = pathToFileURL(
        fileURLToPath(new URL('../dist/session-journal.js', import.meta.url)),
      ).href;
      const script = join(sandbox, 'child.mjs');
      writeFileSync(script, CHILD);
      const old = new Date(Date.now() - 600_000);
      let overlapped = 0;
      let entered = 0;
      for (let round = 0; round < 4; round++) {
        const file = join(sandbox, `race-${round}.json`);
        const log = join(sandbox, `race-${round}.log`);
        writeFileSync(log, '');
        mkdirSync(`${file}.lock`);
        utimesSync(`${file}.lock`, old, old);
        const start = String(Date.now() + 500);
        await Promise.all(
          Array.from(
            { length: 12 },
            () =>
              new Promise<void>((done) => {
                spawn(
                  process.execPath,
                  [script, module, file, start, join(sandbox, `inside-${round}`), log],
                  { stdio: 'ignore' },
                ).on('close', () => done());
              }),
          ),
        );
        const marks = readFileSync(log, 'utf8');
        overlapped += [...marks].filter((mark) => mark === 'O').length;
        entered += [...marks].filter((mark) => mark === 'R').length;
      }
      expect(overlapped).toBe(0);
      expect(entered).toBe(48);
    },
    WAITS_ON_WRITES,
  );

  it(
    'is seen by the Stop of the same session: a journal it cannot lock is left as it was',
    () => {
      const file = journalFile(resolveTrees(repo, env), SESSION) as string;
      mirror(dispatch());
      const before = readFileSync(file, 'utf8');
      const transcript = join(sandbox, 'transcript.jsonl');
      writeFileSync(
        transcript,
        `${JSON.stringify({ type: 'user', timestamp: '2020-01-01T00:00:00.000Z', message: { role: 'user', content: 'go' } })}\n`,
      );
      const payload = JSON.stringify({
        hook_event_name: 'Stop',
        session_id: SESSION,
        transcript_path: transcript,
        cwd: repo,
      });
      mkdirSync(`${file}.lock`);
      runSessionTally({ cwd: repo, env, lockWaitMs: 50 }, { payload });
      expect(readFileSync(file, 'utf8')).toBe(before);
      rmSync(`${file}.lock`, { recursive: true });
      runSessionTally({ cwd: repo, env, lockWaitMs: 50 }, { payload });
      expect(readFileSync(file, 'utf8')).not.toBe(before);
      expect(readJournal(file)?.handedOver?.handoffs).toBe(1);
    },
    WAITS_ON_WRITES,
  );

  it(
    'keeps the instant the connection ended through the Stop that follows it',
    () => {
      const file = journalFile(resolveTrees(repo, env), SESSION) as string;
      mirror(dispatch());
      markEnded(file, new Date('2026-01-01T00:00:00.000Z'));
      const transcript = join(sandbox, 'transcript-ended.jsonl');
      writeFileSync(
        transcript,
        `${JSON.stringify({ type: 'user', timestamp: '2020-01-01T00:00:00.000Z', message: { role: 'user', content: 'go' } })}\n`,
      );
      const payload = JSON.stringify({
        hook_event_name: 'Stop',
        session_id: SESSION,
        transcript_path: transcript,
        cwd: repo,
      });
      runSessionTally({ cwd: repo, env }, { payload });
      expect(readJournal(file)?.endedAt).toBe('2026-01-01T00:00:00.000Z');
      mirror(dispatch({ type: 'revisar' }));
      expect(readJournal(file)?.endedAt).toBe('2026-01-01T00:00:00.000Z');
    },
    WAITS_ON_WRITES,
  );
});
