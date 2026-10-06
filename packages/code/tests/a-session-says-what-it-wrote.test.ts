/**
 * A session says what it wrote: at the end of a response that wrote a file, and before a
 * conversation is compacted, one line with two counts — the files its own tool calls wrote and
 * the decisions recorded since it opened.
 *
 * WHAT IS HELD HERE AND WHAT IS NOT. The product's half: that the counts are the ones the
 * transcript and the record hold, that the line says what each is a count OF, and that every
 * outcome that is not a count is the empty reply. What the host does with a `systemMessage` — which
 * host shows it, to whom — was not measured and is not asserted.
 *
 * THE TRANSCRIPTS ARE BUILT HERE in the shape the host writes them (one JSON object per line, a
 * `tool_use` block per tool call, tool results as `user` lines): every case that makes a claim
 * about a count states the lines it was made from.
 */

import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DiscoveryEnv } from '@mnema/core';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type CliIo, run } from '../src/cli.js';
import { runSessionTally } from '../src/commands/tally.js';
import { renderPlain } from '../src/presentation/plain.js';
import { WRITING_TOOLS, whatTheSessionDid } from '../src/what-the-session-did.js';
import { registerTally } from '../src/wiring/tally.js';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const CLI = join(REPO, 'packages', 'code', 'dist', 'cli.js');
const PLUGIN = join(REPO, 'plugin');

let sandbox: string;
let repo: string;
let env: DiscoveryEnv;
let originalCwd: string;
let originalHome: string | undefined;
let originalXdg: string | undefined;

/** Runs `mnema <argv>` in process and refuses to continue if it failed — setup, not assertion. */
async function did(...argv: string[]): Promise<void> {
  const err: string[] = [];
  let failed = false;
  const io: CliIo = {
    out: () => {},
    err: (line) => err.push(line),
    fail: () => {
      failed = true;
    },
  };
  await run(argv, io);
  expect(failed, `${argv.join(' ')}: ${err.join(' / ')}`).toBe(false);
}

/** An assistant line carrying one tool call. */
function call(at: string, name: string, input: Record<string, unknown>): string {
  return JSON.stringify({
    type: 'assistant',
    timestamp: at,
    cwd: repo,
    message: { role: 'assistant', content: [{ type: 'tool_use', id: `t-${at}`, name, input }] },
  });
}

/** What a person typed. */
function prompt(at: string, text: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: 'user',
    timestamp: at,
    cwd: repo,
    origin: { kind: 'human' },
    message: { role: 'user', content: text },
    ...extra,
  });
}

/** A tool result, which the host writes as a `user` line too. */
function result(at: string): string {
  return JSON.stringify({
    type: 'user',
    timestamp: at,
    cwd: repo,
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: `t-${at}`, content: 'ok' }],
    },
  });
}

/** A tool result the host marks as an error — what a refused tool call comes back as. */
function refusedResult(at: string): string {
  return JSON.stringify({
    type: 'user',
    timestamp: at,
    cwd: repo,
    message: {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: `t-${at}`,
          content: 'PreToolUse:Edit hook error: refused',
          is_error: true,
        },
      ],
    },
  });
}

/** Writes a transcript and answers its path. */
function transcript(lines: readonly string[]): string {
  const path = join(sandbox, 'session.jsonl');
  writeFileSync(path, `${lines.join('\n')}\n`);
  return path;
}

/** The payload a host hands a hook, naming a transcript. */
function payload(event: string, file: string): string {
  return JSON.stringify({ hook_event_name: event, transcript_path: file, cwd: repo });
}

/** What the verb answers, as the host parses it. */
function answer(input: string): { reply: Record<string, unknown>; notes: readonly string[] } {
  const done = runSessionTally({ cwd: repo, env }, { payload: input });
  return {
    reply: JSON.parse(JSON.stringify(done.reply)) as Record<string, unknown>,
    notes: done.notes,
  };
}

/** The instant a session opens, long before anything this suite records. */
const LONG_AGO = '2020-01-01T00:00:00.000Z';

/** A response that wrote two files, one of them twice, and a third that did not exist as a tool. */
function aWritingSession(): string[] {
  return [
    prompt(LONG_AGO, 'rename the module'),
    call('2020-01-01T00:00:01.000Z', 'Write', { file_path: join(repo, 'src', 'a.ts') }),
    result('2020-01-01T00:00:02.000Z'),
    call('2020-01-01T00:00:03.000Z', 'Edit', { file_path: join(repo, 'src', 'a.ts') }),
    result('2020-01-01T00:00:04.000Z'),
    call('2020-01-01T00:00:05.000Z', 'Edit', { file_path: 'src/b.ts' }),
    result('2020-01-01T00:00:06.000Z'),
    call('2020-01-01T00:00:07.000Z', 'Read', { file_path: join(repo, 'src', 'c.ts') }),
    result('2020-01-01T00:00:08.000Z'),
  ];
}

beforeEach(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-tally-'));
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

describe('what a transcript says the session wrote', () => {
  it('counts each file once, however it was named, and only the tools that write', () => {
    const did = whatTheSessionDid(transcript(aWritingSession()), repo);
    expect(did?.editedFiles).toEqual([join(repo, 'src', 'a.ts'), join(repo, 'src', 'b.ts')]);
    expect(did?.openedAt).toBe(LONG_AGO);
    expect(did?.lastResponseEdited).toBe(true);
  });

  it('does not count a tool call the host refused, only the write that happened', () => {
    // The result carries `is_error` and the same id as the call: what a hook's refusal looks like.
    const refused = [
      prompt(LONG_AGO, 'change the generated api'),
      call('2020-01-01T00:00:01.000Z', 'Edit', { file_path: join(repo, 'src', 'gen.ts') }),
      refusedResult('2020-01-01T00:00:01.000Z'),
    ];
    const none = whatTheSessionDid(transcript(refused), repo);
    expect(none?.editedFiles).toEqual([]);
    expect(none?.lastResponseEdited).toBe(false);
    // A refused attempt beside a write that went through: one file, and the response did write.
    const both = [
      ...refused,
      call('2020-01-01T00:00:03.000Z', 'Edit', { file_path: join(repo, 'src', 'ok.ts') }),
      result('2020-01-01T00:00:03.000Z'),
    ];
    const one = whatTheSessionDid(transcript(both), repo);
    expect(one?.editedFiles).toEqual([join(repo, 'src', 'ok.ts')]);
    expect(one?.lastResponseEdited).toBe(true);
  });

  it('knows a response that wrote nothing from one that did, by the last prompt', () => {
    const lines = [...aWritingSession(), prompt('2020-01-01T00:01:00.000Z', 'thanks, and why?')];
    expect(whatTheSessionDid(transcript(lines), repo)?.lastResponseEdited).toBe(false);
    // A tool result, a line the host injected and a subagent's hand-back are `user` lines, and
    // none of them is a person: they do not end the response that wrote.
    const notPeople = [
      ...aWritingSession(),
      prompt('2020-01-01T00:01:00.000Z', 'injected', { isMeta: true }),
      JSON.stringify({
        type: 'user',
        timestamp: '2020-01-01T00:01:01.000Z',
        origin: { kind: 'task-notification' },
        message: { role: 'user', content: 'a notification' },
      }),
    ];
    expect(whatTheSessionDid(transcript(notPeople), repo)?.lastResponseEdited).toBe(true);
  });

  it('names the tools it counts, so a host that renames one reads low and never high', () => {
    expect(Object.keys(WRITING_TOOLS).sort()).toEqual([
      'Edit',
      'MultiEdit',
      'NotebookEdit',
      'Write',
    ]);
    const notebook = call(LONG_AGO, 'NotebookEdit', { notebook_path: join(repo, 'n.ipynb') });
    expect(whatTheSessionDid(transcript([notebook]), repo)?.editedFiles).toEqual([
      join(repo, 'n.ipynb'),
    ]);
    const unknown = call(LONG_AGO, 'SomeNewWriter', { file_path: join(repo, 'x.ts') });
    expect(whatTheSessionDid(transcript([unknown]), repo)?.editedFiles).toEqual([]);
  });

  it('answers nothing for a transcript that is not there or is empty', () => {
    expect(whatTheSessionDid(join(sandbox, 'no-such.jsonl'), repo)).toBeUndefined();
    expect(whatTheSessionDid(transcript([]), repo)?.editedFiles ?? []).toEqual([]);
  });
});

describe('mnema tally', () => {
  it('says what the session wrote and what the record holds from it, as a fact', async () => {
    await did('decision', 'record', 'Use UTC', 'The ledger is UTC');
    const { reply, notes } = answer(payload('Stop', transcript(aWritingSession())));
    expect(reply).toEqual({
      systemMessage:
        'Since this session opened, its own tool calls wrote 2 files, and 1 decision was recorded in this project’s record.',
    });
    expect(notes).toEqual([]);
  });

  it('counts only decisions recorded since the session opened', async () => {
    await did('decision', 'record', 'Use UTC', 'The ledger is UTC');
    const opened = aWritingSession().map((line) => line.replaceAll('2020-01-01', '2099-01-01'));
    expect(answer(payload('Stop', transcript(opened))).reply).toEqual({
      systemMessage:
        'Since this session opened, its own tool calls wrote 2 files, and 0 decisions were recorded in this project’s record.',
    });
  });

  it('says it before a compaction, and says so', async () => {
    const { reply } = answer(payload('PreCompact', transcript(aWritingSession())));
    expect(reply).toEqual({
      systemMessage:
        'This conversation is about to be compacted. Since this session opened, its own tool calls wrote 2 files, and 0 decisions were recorded in this project’s record.',
    });
  });

  it('at Stop says nothing after a response that wrote no file, and before a compaction still does', () => {
    const lines = [...aWritingSession(), prompt('2020-01-01T00:01:00.000Z', 'and why?')];
    expect(answer(payload('Stop', transcript(lines)))).toEqual({ reply: {}, notes: [] });
    expect(answer(payload('PreCompact', transcript(lines))).reply).toHaveProperty('systemMessage');
  });

  it('says nothing for a session that wrote no file, at either event', () => {
    const reading = [prompt(LONG_AGO, 'what is this?'), call(LONG_AGO, 'Read', { file_path: 'x' })];
    expect(answer(payload('Stop', transcript(reading)))).toEqual({ reply: {}, notes: [] });
    expect(answer(payload('PreCompact', transcript(reading)))).toEqual({ reply: {}, notes: [] });
  });

  it('says nothing for any other hook, with the payload it was handed', () => {
    const file = transcript(aWritingSession());
    expect(
      answer(JSON.stringify({ hook_event_name: 'PreToolUse', transcript_path: file })),
    ).toEqual({
      reply: {},
      notes: [],
    });
    expect(answer('[]')).toEqual({ reply: {}, notes: [] });
  });

  it('says on the second stream what it could not read, and still answers nothing', () => {
    expect(answer('not json')).toEqual({
      reply: {},
      notes: ['The hook input was not JSON, so nothing was counted.'],
    });
    expect(answer(JSON.stringify({ hook_event_name: 'Stop' }))).toEqual({
      reply: {},
      notes: ['The Stop input named no transcript, so nothing was counted.'],
    });
    const missing = join(sandbox, 'gone.jsonl');
    expect(answer(payload('Stop', missing))).toEqual({
      reply: {},
      notes: [`The transcript ${missing} could not be read.`],
    });
  });

  it('says nothing when the channel is switched off, and nothing outside a project', async () => {
    await did('switch', 'off', 'session-tally');
    expect(answer(payload('Stop', transcript(aWritingSession())))).toEqual({
      reply: {},
      notes: [],
    });
    const elsewhere = join(sandbox, 'elsewhere');
    mkdirSync(elsewhere);
    const done = runSessionTally(
      { cwd: elsewhere, env },
      { payload: payload('Stop', transcript(aWritingSession())) },
    );
    expect(done).toEqual({ ok: true, reply: {}, notes: [] });
  });
});

describe('the verb as the command line routes it', () => {
  /** Runs `mnema tally` with `input` on the standard input, and answers what it wrote where. */
  async function typed(input: string): Promise<{ out: string[]; err: string[]; failed: boolean }> {
    const seen = { out: [] as string[], err: [] as string[], failed: false };
    const io = {
      out: (line: string) => seen.out.push(line),
      err: (line: string) => seen.err.push(line),
      fail: () => {
        seen.failed = true;
      },
      input: async () => input,
    };
    const program = new Command('mnema').exitOverride();
    registerTally(program, { io, render: renderPlain } as unknown as Parameters<
      typeof registerTally
    >[1]);
    await program.parseAsync(['tally'], { from: 'user' });
    return seen;
  }

  it('prints the reply as one JSON line, and a note beside it on the second stream', async () => {
    const spoke = await typed(payload('Stop', transcript(aWritingSession())));
    expect(spoke.failed).toBe(false);
    expect(spoke.out.map((line) => JSON.parse(line))).toEqual([
      {
        systemMessage:
          'Since this session opened, its own tool calls wrote 2 files, and 0 decisions were recorded in this project’s record.',
      },
    ]);
    const quiet = await typed('not json');
    expect(quiet.out).toEqual(['{}']);
    expect(quiet.err.join('\n')).toContain('The hook input was not JSON, so nothing was counted.');
    expect(quiet.failed).toBe(false);
  });

  it('is a read, and takes no option', () => {
    const program = new Command('mnema');
    const declared = registerTally(program, {
      io: {},
      render: renderPlain,
    } as unknown as Parameters<typeof registerTally>[1]);
    expect(declared.effect).toBe('reads');
    expect(declared.act.options).toEqual([]);
  });
});

describe('the plugin command a host runs at Stop and PreCompact', () => {
  it('hands the payload to the verb and prints what it answers, and nothing on silence', async () => {
    await did('decision', 'record', 'Use UTC', 'The ledger is UTC');
    const bin = join(sandbox, 'bin');
    mkdirSync(bin);
    writeFileSync(
      join(bin, 'mnema'),
      ['#!/bin/sh', `exec "${process.execPath}" "${CLI}" "$@"`, ''].join('\n'),
    );
    chmodSync(join(bin, 'mnema'), 0o755);
    const host = (input: string) =>
      spawnSync(process.execPath, [join(PLUGIN, 'hooks', 'session-tally.mjs')], {
        cwd: repo,
        input,
        encoding: 'utf-8',
        env: {
          HOME: join(sandbox, 'home'),
          PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`,
          CLAUDE_PROJECT_DIR: repo,
        },
      });
    const spoke = host(payload('Stop', transcript(aWritingSession())));
    expect(spoke.status).toBe(0);
    expect(JSON.parse(spoke.stdout)).toEqual({
      systemMessage:
        'Since this session opened, its own tool calls wrote 2 files, and 1 decision was recorded in this project’s record.',
    });
    const quiet = host(payload('Stop', transcript([prompt(LONG_AGO, 'hello')])));
    expect(quiet.status).toBe(0);
    expect(quiet.stdout).toBe('');
  });
});
