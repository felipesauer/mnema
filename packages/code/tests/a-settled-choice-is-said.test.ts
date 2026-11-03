/**
 * A question to the person, once answered, is followed by one sentence of fact beside the answer:
 * that a choice may have been settled, and which tool records one. Nothing is recorded.
 *
 * WHAT IS HELD HERE AND WHAT IS NOT. The product's half: which payloads are answered (a question
 * tool of each host, after it ran), the sentence and the reply shapes, the silence where the product
 * has no standing (no project, the channel off, a tool that asks nothing), that the record does not
 * move, and that the plugin's hook starts no `mnema` for a tool that is not a question. What the real
 * host does with the reply is held by `host-contract/a-settled-choice-reaches-the-model.test.ts`.
 */

import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DiscoveryEnv } from '@mnema/core';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { QUESTION_TOOLS, runSettled, settledSentence } from '../src/commands/settled.js';
import { renderPlain } from '../src/presentation/plain.js';
import { type CliIo, run } from '../src/program.js';
import { tellsWhatToDo } from '../src/record-framing.js';
import { registerSettled } from '../src/wiring/settled.js';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const CLI = join(REPO, 'packages', 'code', 'dist', 'cli.js');
const PLUGIN = join(REPO, 'plugin');

/** What a project that never touched `agent-accepts` is handed: the switch is on by default. */
const ACCEPTING = settledSentence('on');

let sandbox: string;
let repo: string;
let env: DiscoveryEnv;
let originalCwd: string;
let originalHome: string | undefined;
let originalXdg: string | undefined;

/** Runs `mnema <argv>` in process and refuses to continue if it failed: setup, not assertion. */
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

/** The payload a host hands the hook after a tool ran. */
function payload(tool: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    hook_event_name: 'PostToolUse',
    session_id: 'abc123',
    cwd: repo,
    tool_name: tool,
    tool_input: { questions: [{ question: 'Which store?', options: [] }] },
    tool_response: { answers: { 'Which store?': 'SQLite' } },
    ...extra,
  });
}

/** What the verb answers, as the host parses it. */
function answer(input: string, reply?: 'flat'): Record<string, unknown> {
  const done = runSettled({ cwd: repo, env }, { payload: input, reply });
  return JSON.parse(JSON.stringify(done.reply)) as Record<string, unknown>;
}

/**
 * Every file under `dir` with its size and modification time: what "the record did not move" reads.
 * The `locks/` directory is left out: it holds the projection a reader keeps, which any read builds
 * and the record's own `.gitignore` names as machinery, not record.
 */
function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (at: string): void => {
    for (const name of readdirSync(at)) {
      const path = join(at, name);
      if (name === 'locks') continue;
      const stat = statSync(path);
      if (stat.isDirectory()) walk(path);
      else out.push(`${relative(dir, path)} ${stat.size} ${stat.mtimeMs}`);
    }
  };
  walk(dir);
  return out.sort();
}

beforeEach(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-settled-'));
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

describe('mnema settled', () => {
  it('answers a question tool of each host with the sentence, in the event the host named', () => {
    expect([...QUESTION_TOOLS].sort()).toEqual([
      'AskUserQuestion',
      'ask_user',
      'question',
      'request_user_input',
    ]);
    expect(answer(payload('AskUserQuestion'))).toEqual({
      hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: ACCEPTING },
    });
    expect(answer(payload('ask_user', { hook_event_name: 'AfterTool' }))).toEqual({
      hookSpecificOutput: { hookEventName: 'AfterTool', additionalContext: ACCEPTING },
    });
    for (const tool of ['request_user_input', 'question']) {
      expect(answer(payload(tool)), tool).toEqual({
        hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: ACCEPTING },
      });
    }
  });

  it('answers flat where the host reads a top-level additionalContext', () => {
    expect(answer(payload('AskUserQuestion'), 'flat')).toEqual({
      additionalContext: ACCEPTING,
    });
  });

  it('says a fact, names the tool that records and the one that accepts, and says it recorded nothing', () => {
    expect(ACCEPTING).toBe(
      'A question to the person was answered here. Where the answer settled a choice, ' +
        '`record_decision` records it in this project’s record, with the options not taken as ' +
        '`alternatives`, and `decision_transition` (action `accept`) accepts it, the note quoting ' +
        'the answer; nothing has been recorded from this answer.',
    );
  });

  it('says a person accepts it where the switch agent-accepts is off, and the agent accepts again once it is on', async () => {
    await did('switch', 'off', 'agent-accepts');
    const off = answer(payload('AskUserQuestion')) as {
      hookSpecificOutput: { additionalContext: string };
    };
    expect(off.hookSpecificOutput.additionalContext).toBe(
      'A question to the person was answered here. Where the answer settled a choice, ' +
        '`record_decision` records it in this project’s record, with the options not taken as ' +
        '`alternatives`; `agent-accepts` is off, so a person accepts it (`mnema decision review`); ' +
        'nothing has been recorded from this answer.',
    );
    expect(off.hookSpecificOutput.additionalContext).not.toContain('decision_transition');
    await did('switch', 'on', 'agent-accepts');
    expect(answer(payload('AskUserQuestion'))).toEqual({
      hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: ACCEPTING },
    });
  });

  it('says the switch could not be read, and not that it is off, where it cannot be read', () => {
    expect(settledSentence('unreadable')).toBe(
      'A question to the person was answered here. Where the answer settled a choice, ' +
        '`record_decision` records it in this project’s record, with the options not taken as ' +
        '`alternatives`; the switch `agent-accepts` could not be read, so a person accepts it ' +
        '(`mnema decision review`); nothing has been recorded from this answer.',
    );
    expect(settledSentence('unreadable')).not.toContain('is off');
  });

  it('tells the agent nothing to do: no word the framing tripwire knows, in either state', () => {
    for (const agentsAccept of ['on', 'off', 'unreadable'] as const) {
      expect(tellsWhatToDo(settledSentence(agentsAccept)), agentsAccept).toBeUndefined();
    }
    // The tripwire is awake: the same sentence with an order in it is caught.
    expect(tellsWhatToDo(`${ACCEPTING} You must record it.`)).toBe('you must');
  });

  it('is silent for a tool that asks nothing, before a tool runs, and for what is not a payload', () => {
    expect(answer(payload('Write'))).toEqual({});
    expect(answer(payload('AskUserQuestion', { hook_event_name: 'PreToolUse' }))).toEqual({});
    expect(answer(payload('AskUserQuestion', { hook_event_name: 'Stop' }))).toEqual({});
    expect(answer('not json')).toEqual({});
    expect(answer('null')).toEqual({});
  });

  it('is silent outside a project', () => {
    const outside = join(sandbox, 'elsewhere');
    mkdirSync(outside);
    const done = runSettled({ cwd: outside, env }, { payload: payload('AskUserQuestion') });
    expect(done.reply).toEqual({});
  });

  it('is silent with the channel switched off, and speaks again switched on', async () => {
    await did('switch', 'off', 'choice-settled');
    expect(answer(payload('AskUserQuestion'))).toEqual({});
    await did('switch', 'on', 'choice-settled');
    expect(answer(payload('AskUserQuestion'))).toEqual({
      hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: ACCEPTING },
    });
  });

  it('records nothing: no file of the project or of the home moves', () => {
    const before = [...filesUnder(repo), ...filesUnder(join(sandbox, 'home'))];
    for (let i = 0; i < 3; i += 1) answer(payload('AskUserQuestion'));
    expect([...filesUnder(repo), ...filesUnder(join(sandbox, 'home'))]).toEqual(before);
  });

  it('is a read, and takes one option', () => {
    const program = new Command('mnema');
    const declared = registerSettled(program, {
      io: {},
      render: renderPlain,
    } as unknown as Parameters<typeof registerSettled>[1]);
    expect(declared.effect).toBe('reads');
    expect(declared.act.options.map((option) => option.long)).toEqual(['--reply']);
  });

  it('prints the reply as one JSON line, as the command line routes it', async () => {
    const out: string[] = [];
    const io: CliIo = {
      out: (line) => out.push(line),
      err: () => {},
      fail: () => {},
      input: async () => payload('AskUserQuestion'),
    };
    const program = new Command('mnema').exitOverride();
    registerSettled(program, { io, render: renderPlain } as unknown as Parameters<
      typeof registerSettled
    >[1]);
    await program.parseAsync(['settled', '--reply', 'flat'], { from: 'user' });
    expect(out.map((line) => JSON.parse(line))).toEqual([{ additionalContext: ACCEPTING }]);
  });
});

describe('the plugin hook a host runs after a question', () => {
  /** The `PostToolUse` group of the plugin's hooks file that runs this handler: one, beside the write's. */
  function theGroup(): { matcher: string; hooks: { command: string }[] } {
    const file = JSON.parse(readFileSync(join(PLUGIN, 'hooks', 'hooks.json'), 'utf-8')) as {
      hooks: { PostToolUse?: { matcher: string; hooks: { command: string }[] }[] };
    };
    const groups = (file.hooks.PostToolUse ?? []).filter((group) =>
      group.hooks.some((hook) => hook.command.includes('choice-settled.mjs')),
    );
    expect(groups.length).toBe(1);
    return groups[0] as { matcher: string; hooks: { command: string }[] };
  }

  /**
   * Runs the hook's command line, as the host does, with a `mnema` on the PATH that leaves a mark
   * before it runs the real one: the mark says whether `mnema` was started at all. The command is one
   * program and its arguments, so `node` starts whatever the tool and the handler ends before `mnema`.
   */
  function host(input: string) {
    const bin = join(sandbox, 'bin');
    mkdirSync(bin, { recursive: true });
    const mark = join(sandbox, 'mnema-started');
    writeFileSync(
      join(bin, 'mnema'),
      [
        '#!/bin/sh',
        `echo started >> "${mark}"`,
        `exec "${process.execPath}" "${CLI}" "$@"`,
        '',
      ].join('\n'),
    );
    chmodSync(join(bin, 'mnema'), 0o755);
    const sent = spawnSync('/bin/sh', ['-c', theGroup().hooks[0]?.command ?? 'exit 9'], {
      cwd: repo,
      input,
      encoding: 'utf-8',
      timeout: 20_000,
      env: {
        HOME: join(sandbox, 'home'),
        PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`,
        CLAUDE_PLUGIN_ROOT: PLUGIN,
        CLAUDE_PROJECT_DIR: repo,
      },
    });
    const started = existsSync(mark);
    rmSync(mark, { force: true });
    return { ...sent, started };
  }

  it('is matched to the question tool alone', () => {
    expect(theGroup().matcher).toBe('AskUserQuestion');
  });

  it('hands the sentence back for a question that was answered', () => {
    const sent = host(payload('AskUserQuestion'));
    expect(sent.status).toBe(0);
    expect(JSON.parse(sent.stdout)).toEqual({
      hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: ACCEPTING },
    });
    expect(sent.started).toBe(true);
  });

  it('starts no mnema for a tool that is not a question, where a host ignores the matcher', () => {
    const sent = host(payload('read_file'));
    expect(sent.status).toBe(0);
    expect(sent.stdout).toBe('');
    expect(sent.started).toBe(false);
  });
});
