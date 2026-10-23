/**
 * A conversation that was compacted is handed back what its session had recorded, from the session's
 * journal, by a `SessionStart` hook that runs only after a compaction; and nothing is told to a
 * conversation about to be compacted, because the host throws that away.
 *
 * The sentence is `src/commands/compacted.ts`'s; the journal is the one `mnema tally` keeps
 * (`src/session-journal.ts`); the handler is `plugin/hooks/session-compacted.mjs`, exercised end to
 * end over the built binary, together with the `Stop` hook that writes the journal it reads.
 */

import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type DiscoveryEnv, resolveTrees } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { afterACompactionSentence, runAfterACompaction } from '../src/commands/compacted.js';
import { type CliIo, run } from '../src/program.js';
import { type Journal, journalFile, writeJournal } from '../src/session-journal.js';
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

const SESSION = '44444444-aaaa-4bbb-8ccc-444444444444';
const GOAL = 'GOALSENTINEL move the ledger to UTC';

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

function aJournal(over: Partial<Journal> = {}): Journal {
  return {
    version: 1,
    session: SESSION,
    updatedAt: new Date().toISOString(),
    openedAt: null,
    decisions: [],
    notes: [],
    questionsWithoutDecision: 0,
    decisionFilesUncited: 0,
    filesEdited: 0,
    tasksInProgress: [],
    runsOpen: [],
    trees: { public: { goal: GOAL, outcome: null }, private: { goal: null, outcome: null } },
    reading: emptyReading(),
    ...over,
  };
}

function keep(journal: Journal): void {
  writeJournal(
    journalFile(resolveTrees(repo, env), journal.session) as string,
    journal,
    new Date(),
  );
}

function afterwards(session: string | undefined = SESSION): string | undefined {
  const done = runAfterACompaction({ cwd: repo, env, session });
  if (!done.ok) throw new Error(`refused: ${JSON.stringify(done)}`);
  return done.text;
}

beforeEach(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-compacted-'));
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

describe('the sentence', () => {
  it('says what the journal holds, each part left out when it is zero, and none of the session’s words', () => {
    const labels = new Map([['d1', 'ADR-12']]);
    expect(
      afterACompactionSentence(
        aJournal({
          decisions: [{ id: 'd1', state: 'proposed' }],
          notes: ['n1'],
          questionsWithoutDecision: 2,
          decisionFilesUncited: 1,
          tasksInProgress: ['t1'],
          filesEdited: 5,
        }),
        labels,
      ),
    ).toBe(
      'Before this conversation was compacted, this session had: 1 decision recorded in this project’s record (ADR-12: proposed); 1 note of this host’s memory copied into this machine’s private tree; 2 questions answered with no decision recorded after; 1 file of decisions that the record cites nowhere; 1 task in progress; its own tool calls wrote 5 files.',
    );
    expect(afterACompactionSentence(aJournal({ filesEdited: 2 }), labels)).toBe(
      'Before this conversation was compacted, this session had: its own tool calls wrote 2 files.',
    );
    expect(afterACompactionSentence(aJournal(), labels)).toBeUndefined();
  });

  it('is about a hundred tokens at the most, and never carries the goal', () => {
    const labels = new Map(
      Array.from({ length: 4 }, (_, n) => [`d${n}`, `ADR-${n + 10}`] as const),
    );
    const sentence = afterACompactionSentence(
      aJournal({
        decisions: [0, 1, 2, 3].map((n) => ({ id: `d${n}`, state: 'proposed' })),
        notes: ['a', 'b'],
        questionsWithoutDecision: 3,
        decisionFilesUncited: 2,
        tasksInProgress: ['t'],
        filesEdited: 12,
      }),
      labels,
    ) as string;
    expect(Buffer.byteLength(sentence)).toBeLessThan(700);
    expect(sentence).not.toContain('GOALSENTINEL');
  });
});

describe('the read', () => {
  it('names the decisions by the record’s own label and state', async () => {
    const out = await doing('decision', 'record', 'Use UTC', 'The ledger is UTC');
    const id = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.exec(
      out.join('\n'),
    )?.[0];
    keep(aJournal({ decisions: [{ id: id ?? '', state: 'proposed' }], filesEdited: 3 }));
    expect(afterwards()).toMatch(
      /1 decision recorded in this project’s record \(ADR-\d+: proposed\)/,
    );
  });

  it('takes the decisions from the record since the session opened, with the state they have now, not from a journal that is behind', async () => {
    const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
    const first = await doing('decision', 'record', 'Use UTC', 'The ledger is UTC');
    const second = await doing('decision', 'record', 'Keep the cents', 'Money is integer cents');
    const idOf = (out: string[]) =>
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.exec(out.join('\n'))?.[0] ??
      '';
    // The journal was written before the second decision was recorded, and the first was proposed then.
    keep(
      aJournal({
        openedAt: hourAgo,
        decisions: [{ id: idOf(first), state: 'proposed' }],
        filesEdited: 3,
      }),
    );
    await doing('decision', 'move', 'accept', idOf(first), '--note', 'Agreed');
    const text = afterwards() ?? '';
    expect(text).toMatch(/2 decisions recorded in this project’s record/);
    expect(text).toMatch(/ADR-\d+: accepted/);
    expect(text).toMatch(/ADR-\d+: proposed/);
    expect(text).not.toMatch(/ADR-\d+: proposed; ADR-\d+: proposed/);
    expect(idOf(second)).not.toBe('');
  });

  it('leaves out a decision recorded before the session opened', async () => {
    await doing('decision', 'record', 'Use UTC', 'The ledger is UTC');
    const later = new Date(Date.now() + 3_600_000).toISOString();
    keep(aJournal({ openedAt: later, filesEdited: 3 }));
    expect(afterwards()).not.toContain('decision');
  });

  it('says nothing for a session with no journal, one that named no session, or one that did nothing', () => {
    expect(afterwards('55555555-aaaa-4bbb-8ccc-555555555555')).toBeUndefined();
    expect(afterwards(undefined)).toBeUndefined();
    keep(aJournal());
    expect(afterwards()).toBeUndefined();
  });

  it('is read through the verb: the sentence when the session did something, nothing for one that did not, a refusal when switched off', async () => {
    keep(aJournal({ filesEdited: 3 }));
    expect((await doing('recall', '--after-a-compaction', '--session', SESSION)).join('\n')).toBe(
      'Before this conversation was compacted, this session had: its own tool calls wrote 3 files.',
    );
    expect(
      await doing(
        'recall',
        '--after-a-compaction',
        '--session',
        '55555555-aaaa-4bbb-8ccc-555555555555',
      ),
    ).toEqual([]);
    await doing('switch', 'off', 'after-a-compaction');
    const err: string[] = [];
    let failed = false;
    await run(['recall', '--after-a-compaction', '--session', SESSION], {
      out: () => {},
      err: (line) => err.push(line),
      fail: () => {
        failed = true;
      },
    });
    expect(failed).toBe(true);
    expect(err.join('\n')).toContain('after-a-compaction');
  });

  it('is its own switch, and the journal switch silences it too', async () => {
    keep(aJournal({ filesEdited: 3 }));
    expect(afterwards()).toContain('Before this conversation was compacted');
    await doing('switch', 'off', 'after-a-compaction');
    const off = runAfterACompaction({ cwd: repo, env, session: SESSION });
    expect(off.ok).toBe(false);
    await doing('switch', 'on', 'after-a-compaction');
    expect(afterwards()).toContain('Before this conversation was compacted');
    await doing('switch', 'off', 'session-journal');
    expect(afterwards()).toBeUndefined();
  });
});

describe('the plugin, end to end', () => {
  function host() {
    const bin = join(sandbox, 'bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(
      join(bin, 'mnema'),
      ['#!/bin/sh', `exec "${process.execPath}" "${CLI}" "$@"`, ''].join('\n'),
    );
    chmodSync(join(bin, 'mnema'), 0o755);
    return (hook: string, payload: Record<string, unknown>, path = bin) =>
      spawnSync(process.execPath, [join(PLUGIN, 'hooks', hook)], {
        cwd: repo,
        input: JSON.stringify({ cwd: repo, ...payload }),
        encoding: 'utf-8',
        env: {
          HOME: join(sandbox, 'home'),
          XDG_DATA_HOME: join(sandbox, 'data'),
          PATH: `${path}:${dirname(process.execPath)}:/usr/bin:/bin`,
          CLAUDE_PROJECT_DIR: repo,
        },
      });
  }

  function stopsAfterWriting(run: ReturnType<typeof host>, session: string) {
    const transcript = join(sandbox, `${session}.jsonl`);
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
              {
                type: 'tool_use',
                id: 'b',
                name: 'Write',
                input: { file_path: join(repo, 'src', 'b.ts') },
              },
            ],
          },
        }),
      ].join('\n')}\n`,
    );
    const stopped = run('session-tally.mjs', {
      hook_event_name: 'Stop',
      transcript_path: transcript,
      session_id: session,
    });
    expect(stopped.status).toBe(0);
  }

  const compacted = (session?: string) => ({
    hook_event_name: 'SessionStart',
    source: 'compact',
    ...(session === undefined ? {} : { session_id: session }),
  });

  it('hands the conversation what the Stop of its own session kept, and nothing of another one', () => {
    const run = host();
    stopsAfterWriting(run, SESSION);
    const same = run('session-compacted.mjs', compacted(SESSION));
    expect(same.status).toBe(0);
    const body = JSON.parse(same.stdout) as {
      hookSpecificOutput: { hookEventName: string; additionalContext: string };
    };
    expect(body.hookSpecificOutput.hookEventName).toBe('SessionStart');
    expect(body.hookSpecificOutput.additionalContext).toBe(
      'Before this conversation was compacted, this session had: its own tool calls wrote 2 files.',
    );
    expect(
      run('session-compacted.mjs', compacted('66666666-aaaa-4bbb-8ccc-666666666666')).stdout,
    ).toBe('');
    expect(run('session-compacted.mjs', compacted()).stdout).toBe('');
  });

  it('is silent for a mnema older than the flag, and does not hand over the notes document instead', () => {
    const old = join(sandbox, 'old-bin');
    mkdirSync(old, { recursive: true });
    writeFileSync(
      join(old, 'mnema'),
      [
        '#!/bin/sh',
        'case "$*" in',
        '  *--after-a-compaction*) echo "mnema recall does not take \\"--after-a-compaction\\"." >&2; exit 1;;',
        'esac',
        'echo "# What was noted here"',
        '',
      ].join('\n'),
    );
    chmodSync(join(old, 'mnema'), 0o755);
    const run = host();
    const ran = run('session-compacted.mjs', compacted(SESSION), old);
    expect(ran.status).toBe(0);
    expect(ran.stdout).toBe('');
  });

  it('is declared once, after a compaction only, and nothing runs before one', () => {
    const file = JSON.parse(readFileSync(join(PLUGIN, 'hooks', 'hooks.json'), 'utf-8')) as {
      hooks: Record<string, { matcher?: string; hooks: { command?: string }[] }[]>;
    };
    expect(file.hooks.PreCompact).toBeUndefined();
    const groups = file.hooks.SessionStart ?? [];
    const after = groups.filter((group) =>
      group.hooks.some((hook) => hook.command?.includes('session-compacted.mjs')),
    );
    expect(after).toHaveLength(1);
    expect(after[0]?.matcher).toBe('compact');
    expect(after[0]?.hooks).toHaveLength(1);
    // The two handlers that run at every start are in a group with no matcher.
    expect(groups[0]?.matcher).toBeUndefined();
  });
});
