/**
 * Where the last session stopped is told to the next one, in the notes document `mnema recall`
 * prints, when the last session was another one and a recent one, and not otherwise.
 *
 * The journal under test is the one `mnema tally` keeps at `Stop` (`src/session-journal.ts`); the
 * section is `src/presentation/recall.ts`'s and its read is `src/commands/recall.ts`'s. The plugin
 * handler is exercised end to end: the Stop hook of one session writes its journal, and the
 * SessionStart hook of another reads it back through the verb, over the built binary.
 */

import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type DiscoveryEnv, resolveTrees } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runRecall } from '../src/commands/recall.js';
import { recallDocument } from '../src/presentation/recall.js';
import { type CliIo, run } from '../src/program.js';
import {
  type Journal,
  journalFile,
  LIVE_MS,
  lastJournalOf,
  markEnded,
  RECENT_MS,
  writeJournal,
} from '../src/session-journal.js';
import { emptyReading } from '../src/what-the-session-did.js';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const CLI = join(REPO, 'packages', 'code', 'dist', 'cli.js');
const PLUGIN = join(REPO, 'plugin');

let sandbox: string;
let repo: string;
let env: DiscoveryEnv;
let originalCwd: string;
let originalHome: string | undefined;
let originalXdg: string | undefined;

const FIRST = '11111111-aaaa-4bbb-8ccc-111111111111';
const SECOND = '22222222-aaaa-4bbb-8ccc-222222222222';
const GOAL = 'Move the ledger to UTC';

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

/** What a test may set on a journal: the goal is told for the public tree, where a task is born. */
type Over = Partial<Journal> & { readonly goal?: string | null };

function aJournal(session: string, over: Over = {}): Journal {
  const { goal = GOAL, ...rest } = over;
  return {
    version: 1,
    session,
    // Half an hour ago: a session that has stopped. One written to a moment ago may be going on.
    updatedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    openedAt: null,
    decisions: [],
    notes: [],
    questionsWithoutDecision: 0,
    decisionFilesUncited: 0,
    filesEdited: 4,
    tasksInProgress: [],
    runsOpen: [],
    trees: { public: { goal, outcome: null }, private: { goal: null, outcome: null } },
    reading: emptyReading(),
    ...rest,
  };
}

function keep(journal: Journal): void {
  const file = journalFile(resolveTrees(repo, env), journal.session) as string;
  writeJournal(file, journal, new Date());
}

/** What `mnema recall` prints for a session, as lines. */
function recalled(session?: string): string[] {
  const done = runRecall({ cwd: repo, env, ...(session === undefined ? {} : { session }) });
  if (!done.ok) throw new Error(`recall refused: ${JSON.stringify(done)}`);
  return recallDocument(done);
}

beforeEach(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-last-session-'));
  repo = join(sandbox, 'repo');
  mkdirSync(join(repo, 'src'), { recursive: true });
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

describe('the section', () => {
  it('says where another, recent session stopped: its goal, its decisions by label, and what it left', async () => {
    const out = await doing('decision', 'record', 'Use UTC', 'The ledger is UTC');
    const id = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.exec(
      out.join('\n'),
    )?.[0];
    keep(
      aJournal(FIRST, {
        decisions: [{ id: id ?? '', state: 'proposed' }],
        decisionFilesUncited: 1,
        questionsWithoutDecision: 2,
        tasksInProgress: ['t'],
      }),
    );
    const text = recalled(SECOND).join('\n');
    expect(text).toContain('## Where the last session stopped');
    expect(text).toContain(`- Its goal: ${GOAL}`);
    expect(text).toMatch(/- Decisions it recorded: ADR-\d+: proposed/);
    expect(text).toContain(
      '- It left: 4 files edited; 1 file of decisions the record cites nowhere; 2 questions answered with no decision recorded after; 1 task in progress',
    );
    expect(text).toMatch(/wrote to this record (\d+s|\d+m)/);
  });

  it('says which tree each label is of when two trees number a decision the same', async () => {
    const idOf = (out: string[]) =>
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.exec(out.join('\n'))?.[0] ??
      '';
    const pub = await doing('decision', 'record', 'Use UTC', 'The ledger is UTC');
    const priv = await doing(
      'decision',
      'record',
      'Keep cents',
      'Money is cents',
      '--scope',
      'private',
    );
    keep(
      aJournal(FIRST, {
        decisions: [
          { id: idOf(pub), state: 'proposed' },
          { id: idOf(priv), state: 'proposed' },
        ],
      }),
    );
    const text = recalled(SECOND).join('\n');
    expect(text).toContain(
      '- Decisions it recorded: ADR-1 (public): proposed; ADR-1 (private): proposed',
    );
  });

  it('says it wrote to the record only when the session did: files edited alone are not a write', () => {
    keep(aJournal(FIRST, { tasksInProgress: [], decisions: [], notes: [] }));
    const only = recalled(SECOND).join('\n');
    expect(only).toContain('## Where the last session stopped');
    expect(only).not.toContain('wrote to this record');
    expect(only).toMatch(/stopped (\d+s|\d+m) ago and wrote nothing to this record/);
    keep(aJournal(FIRST, { notes: ['a-note'] }));
    expect(recalled(SECOND).join('\n')).toMatch(/wrote to this record (\d+s|\d+m) ago/);
    keep(aJournal(FIRST, { tasksInProgress: ['t'] }));
    expect(recalled(SECOND).join('\n')).toMatch(/wrote to this record (\d+s|\d+m) ago/);
  });

  it('does not call a session that is still going the one that stopped, unless its connection ended', () => {
    const justNow = new Date().toISOString();
    keep(aJournal(FIRST, { updatedAt: justNow }));
    expect(recalled(SECOND).join('\n')).not.toContain('Where the last session stopped');
    // The same journal, once the connection of that session ended, is the one that stopped.
    keep(aJournal(FIRST, { updatedAt: justNow, endedAt: justNow }));
    expect(recalled(SECOND).join('\n')).toContain('Where the last session stopped');
    // And quiet for longer than a session stays quiet between two responses, it stopped too.
    keep(aJournal(FIRST, { updatedAt: new Date(Date.now() - LIVE_MS - 60_000).toISOString() }));
    expect(recalled(SECOND).join('\n')).toContain('Where the last session stopped');
  });

  it('is about a hundred tokens: a few lines, and well under a thousand bytes', () => {
    keep(
      aJournal(FIRST, {
        decisionFilesUncited: 1,
        questionsWithoutDecision: 2,
        tasksInProgress: ['t'],
      }),
    );
    const section = recalled(SECOND)
      .join('\n')
      .split('## Where the last session stopped')[1] as string;
    expect(Buffer.byteLength(section)).toBeLessThan(700);
  });

  it('is not said to the session that is the last one: the id the hook names is left out', () => {
    keep(aJournal(FIRST));
    expect(recalled(FIRST).join('\n')).not.toContain('Where the last session stopped');
    expect(recalled(SECOND).join('\n')).toContain('Where the last session stopped');
  });

  it('is not said when the last session is older than a day, or did nothing worth saying', () => {
    const old = new Date(Date.now() - RECENT_MS - 60_000).toISOString();
    keep(aJournal(FIRST, { updatedAt: old }));
    keep(aJournal(SECOND, { filesEdited: 0, goal: null }));
    expect(recalled('33333333-aaaa-4bbb-8ccc-333333333333').join('\n')).not.toContain(
      'Where the last session stopped',
    );
  });

  it('takes the newest of several, and the newest that has something to say', () => {
    const earlier = new Date(Date.now() - 3_600_000).toISOString();
    keep(aJournal(FIRST, { updatedAt: earlier, goal: 'The earlier goal' }));
    keep(aJournal(SECOND, { goal: 'The later goal' }));
    const found = lastJournalOf(resolveTrees(repo, env), {
      except: '33333333-aaaa-4bbb-8ccc-333333333333',
      now: new Date(),
    });
    expect(found?.trees.public.goal).toBe('The later goal');
  });

  it('withholds a goal that holds a credential in a recognized format', () => {
    keep(aJournal(FIRST, { goal: 'Rotate AKIAIOSFODNN7EXAMPLE today' }));
    const text = recalled(SECOND).join('\n');
    expect(text).toContain('Where the last session stopped');
    expect(text).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(text).not.toContain('Its goal');
  });

  it('stands alone when no note is recorded, and prints nothing when there is neither', () => {
    expect(recalled(SECOND)).toEqual([]);
    keep(aJournal(FIRST));
    const lines = recalled(SECOND);
    expect(lines[0]).toBe('# What was noted here');
    expect(lines.join('\n')).toContain('## Where the last session stopped');
    expect(lines.join('\n')).not.toContain('## Memories');
  });

  it('is its own switch, and follows the journal switch', async () => {
    keep(aJournal(FIRST));
    await doing('switch', 'off', 'last-session');
    expect(recalled(SECOND)).toEqual([]);
    await doing('switch', 'on', 'last-session');
    expect(recalled(SECOND).join('\n')).toContain('Where the last session stopped');
    await doing('switch', 'off', 'session-journal');
    expect(recalled(SECOND)).toEqual([]);
  });
});

describe('the plugin hooks, end to end', () => {
  function hooks() {
    const bin = join(sandbox, 'bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(
      join(bin, 'mnema'),
      ['#!/bin/sh', `exec "${process.execPath}" "${CLI}" "$@"`, ''].join('\n'),
    );
    chmodSync(join(bin, 'mnema'), 0o755);
    const host = (hook: string, payload: Record<string, unknown>) =>
      spawnSync(process.execPath, [join(PLUGIN, 'hooks', hook)], {
        cwd: repo,
        input: JSON.stringify({ cwd: repo, ...payload }),
        encoding: 'utf-8',
        env: {
          HOME: join(sandbox, 'home'),
          XDG_DATA_HOME: join(sandbox, 'data'),
          PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`,
          CLAUDE_PROJECT_DIR: repo,
        },
      });
    return host;
  }

  it('hands the next session what the Stop of the last one kept, and not to the session itself', () => {
    const host = hooks();
    const transcript = join(sandbox, 'first.jsonl');
    const line = (n: number, body: Record<string, unknown>) =>
      JSON.stringify({ timestamp: `2020-01-01T00:00:0${n}.000Z`, cwd: repo, ...body });
    writeFileSync(
      transcript,
      `${[
        line(0, {
          type: 'user',
          origin: { kind: 'human' },
          message: { role: 'user', content: 'go' },
        }),
        line(1, {
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: 'a',
                name: 'Write',
                input: { file_path: join(repo, 'src', 'a.ts') },
              },
            ],
          },
        }),
      ].join('\n')}\n`,
    );
    const stopped = host('session-tally.mjs', {
      hook_event_name: 'Stop',
      transcript_path: transcript,
      session_id: FIRST,
    });
    expect(stopped.status).toBe(0);
    // The journal is fresh to the second, so the first session may be going on: it is not told as the
    // one that stopped until its connection ended or it went quiet. Here it ended.
    const kept = journalFile(resolveTrees(repo, env), FIRST) as string;
    markEnded(kept, new Date());
    const next = host('session-recall.mjs', {
      hook_event_name: 'SessionStart',
      session_id: SECOND,
    });
    expect(next.status).toBe(0);
    expect(next.stdout).toContain('Where the last session stopped');
    expect(next.stdout).toContain('1 file edited');
    const same = host('session-recall.mjs', { hook_event_name: 'SessionStart', session_id: FIRST });
    expect(same.status).toBe(0);
    expect(same.stdout).not.toContain('Where the last session stopped');
  });

  it('keeps an old journal quiet by its age on disk, not by its name', () => {
    keep(aJournal(FIRST, { updatedAt: new Date(Date.now() - 2 * RECENT_MS).toISOString() }));
    const file = journalFile(resolveTrees(repo, env), FIRST) as string;
    const long = new Date(Date.now() - 2 * RECENT_MS);
    utimesSync(file, long, long);
    const host = hooks();
    const next = host('session-recall.mjs', {
      hook_event_name: 'SessionStart',
      session_id: SECOND,
    });
    expect(next.stdout).not.toContain('Where the last session stopped');
  });
});
