/**
 * THE PLUGIN'S HOOKS FILE RUNS NO SHELL: every command of `plugin/hooks/hooks.json` is `node`, the
 * handler named from `${CLAUDE_PLUGIN_ROOT}`, and its arguments, and nothing else. Anthropic's
 * directory blocks a plugin that lives in a subfolder of its repository when a hook's command holds
 * a variable other than `${CLAUDE_PLUGIN_ROOT}`, a command substitution or an inline program
 * (https://claude.com/docs/plugins/pre-submission-checklist), and a hook command is the shell's
 * line where it holds any of them (https://code.claude.com/docs/en/hooks, "Exec form" and "Shell
 * form").
 *
 * WHAT THE SHELL USED TO DO, AND WHO DOES IT NOW. The commands that were shell lines turned a call
 * away before any `mnema` started, in a host that runs every command of the plugin on every tool
 * call whatever the matcher says (VS Code), or in one that reads this file and says it is there
 * (Cursor, Qwen Code). The handler does it now, from the arguments the file hands it: `--tools` (the
 * payload names none of them), `--where` (the variable that says it is the host is unset) and
 * `--unless` (the variable of a host that has a handler of its own is set). The gates carry the
 * first two in `a-host-that-runs-commands-asks-for-a-person.test.ts` and
 * `a-rule-that-refuses-a-write.test.ts`, and the question's hook in `a-settled-choice-is-said.test.ts`;
 * this file holds the file itself, and the two hooks that had no other test of that: the one after a
 * write (`plugin/hooks/after-a-write.mjs`, which reads the path out of the payload) and the one after
 * a dispatch (`plugin/hooks/agent-dispatched.mjs`).
 */

import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const ROOT = new URL('../../../', import.meta.url).pathname;
const PLUGIN = join(ROOT, 'plugin');
const CLI = join(ROOT, 'packages', 'code', 'dist', 'cli.js');

type Group = { matcher?: string; hooks: { type: string; command?: string }[] };
const HOOKS = (
  JSON.parse(readFileSync(join(PLUGIN, 'hooks', 'hooks.json'), 'utf-8')) as {
    hooks: Record<string, Group[]>;
  }
).hooks;

/** Every command the file declares, with the event it is declared under. */
const COMMANDS = Object.entries(HOOKS).flatMap(([event, groups]) =>
  groups.flatMap((group) =>
    group.hooks.flatMap((hook) =>
      hook.type === 'command'
        ? [{ event, command: hook.command ?? '', matcher: group.matcher }]
        : [],
    ),
  ),
);

/** The command of the one hook of `event` that runs `handler`, with `matcher` where it is given. */
function commandOf(event: string, handler: string, matcher?: string): string {
  const found = COMMANDS.filter(
    (one) =>
      one.event === event &&
      one.command.includes(`/hooks/${handler}"`) &&
      (matcher === undefined || one.matcher === matcher),
  );
  expect(found.length).toBe(1);
  return found[0]?.command ?? '';
}

let sandbox: string;
let project: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-no-shell-'));
  project = join(sandbox, 'project');
  mkdirSync(project);
  mkdirSync(join(sandbox, 'bin'));
  // `mnema`, as a shim that says it was started and then is the real one.
  writeFileSync(
    join(sandbox, 'bin', 'mnema'),
    `#!/bin/sh\nprintf '%s\\n' "$*" >> "$CALLS"\nexec "${process.execPath}" "${CLI}" "$@"\n`,
  );
  chmodSync(join(sandbox, 'bin', 'mnema'), 0o755);
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** The verbs `mnema` was started with, for a run of `command` over `payload` in `env`. */
function verbsStartedBy(
  command: string,
  payload: string,
  env: Record<string, string> = {},
): string[] {
  const calls = join(sandbox, 'calls.txt');
  rmSync(calls, { force: true });
  const run = spawnSync('/bin/sh', ['-c', command], {
    cwd: project,
    input: payload,
    encoding: 'utf-8',
    timeout: 20_000,
    env: {
      HOME: join(sandbox, 'home'),
      PATH: `${join(sandbox, 'bin')}:${dirname(process.execPath)}:/usr/bin:/bin`,
      CALLS: calls,
      CLAUDE_PLUGIN_ROOT: PLUGIN,
      CLAUDE_PROJECT_DIR: project,
      ...env,
    },
  });
  expect(run.status).toBe(0);
  return existsSync(calls)
    ? readFileSync(calls, 'utf-8')
        .trim()
        .split('\n')
        .map((line) => line.split(' ')[0] ?? '')
        .filter((verb) => verb !== '--identify')
    : [];
}

describe('the plugin hooks file', () => {
  it('declares only commands that are node, a handler from the plugin root and plain arguments', () => {
    expect(COMMANDS.length).toBeGreaterThan(10);
    for (const { command } of COMMANDS) {
      const [, handler, rest] =
        /^node "\$\{CLAUDE_PLUGIN_ROOT\}\/hooks\/([a-z-]+\.mjs)"((?: --[a-z-]+ [A-Za-z0-9_,-]+)*)$/.exec(
          command,
        ) ?? [];
      expect({ command, handler: handler !== undefined }).toEqual({ command, handler: true });
      expect(existsSync(join(PLUGIN, 'hooks', handler ?? ''))).toBe(true);
      expect(rest).toBeDefined();
    }
  });

  it('holds the check against the shell it replaced', () => {
    // NON-VACUITY: the line the Cursor gate was, and the one the question's hook was.
    const shell = [
      '[ -n "$QWEN_PROJECT_DIR" ] && exit 0; [ -n "$CURSOR_VERSION" ] && node "${CLAUDE_PLUGIN_ROOT}/hooks/edit-refuses-a-write.mjs" --host cursor; exit 0',
      'IN=$(cat); case "$IN" in *\'"AskUserQuestion"\'*) printf \'%s\' "$IN" | node "${CLAUDE_PLUGIN_ROOT}/hooks/choice-settled.mjs";; esac',
    ];
    const plain =
      /^node "\$\{CLAUDE_PLUGIN_ROOT\}\/hooks\/([a-z-]+\.mjs)"((?: --[a-z-]+ [A-Za-z0-9_,-]+)*)$/;
    for (const line of shell) expect(plain.test(line)).toBe(false);
  });
});

describe('the hook after a write', () => {
  const command = commandOf('PostToolUse', 'after-a-write.mjs');
  const write = (file: string) =>
    JSON.stringify({ tool_name: 'Write', tool_input: { file_path: file } });
  const reaches = (file: string, env: Record<string, string> = {}) =>
    verbsStartedBy(command, write(file), env).includes('after-a-write');

  it.each([
    'docs/PLANO.md',
    'docs/LIVRO-0.1.3.md',
    'PLAN.md',
    'notes/LEDGER.md',
    'notes/Handoff-2.md',
    'notes/plan.md',
    'notes/ledger.md',
    'notes/handoff.md',
    'docs/adr/0001-a-choice.md',
    'CLAUDE.md',
    '.claude/rules/mnema.md',
  ])('hands %s, in the project, to the verb', (file) => {
    expect(reaches(join(project, file))).toBe(true);
  });

  it.each(['README.md', 'CHANGELOG.md', 'docs/guide.md', 'src/index.ts', 'notes/PLAN.MD'])(
    'hands %s, in the project, to no verb',
    (file) => {
      expect(reaches(join(project, file))).toBe(false);
    },
  );

  it('hands a note of the host memory, and any .md outside the project, to the verb', () => {
    expect(reaches('/home/someone/.claude/projects/p/memory/a-note.md')).toBe(true);
    expect(reaches('/elsewhere/notes.md')).toBe(true);
    expect(reaches('/elsewhere/index.ts')).toBe(false);
  });

  it('hands nothing to the verb where a host that has a handler of its own says it is there', () => {
    const file = join(project, 'docs', 'PLANO.md');
    expect(reaches(file)).toBe(true);
    expect(reaches(file, { CURSOR_VERSION: '2026.09.18' })).toBe(false);
    expect(reaches(file, { QWEN_PROJECT_DIR: '/tmp/a-qwen-project' })).toBe(false);
  });

  it('hands nothing to the verb for a payload that names no path or is not JSON', () => {
    expect(verbsStartedBy(command, '{}')).toEqual([]);
    expect(verbsStartedBy(command, 'not json')).toEqual([]);
    expect(verbsStartedBy(command, JSON.stringify({ tool_input: { file_path: 7 } }))).toEqual([]);
  });
});

describe('the hook after a dispatch and the one at the end of a session', () => {
  const after = commandOf('PostToolUse', 'agent-dispatched.mjs');
  const ending = commandOf('SessionEnd', 'agent-dispatched.mjs');

  it('hands a dispatch, by either name of the tool, to the verb', () => {
    for (const tool of ['Agent', 'Task']) {
      expect(verbsStartedBy(after, JSON.stringify({ tool_name: tool }))).toEqual(['dispatched']);
    }
  });

  it('hands nothing to the verb for another tool, where a host ignores the matcher', () => {
    expect(verbsStartedBy(after, JSON.stringify({ tool_name: 'read_file' }))).toEqual([]);
    expect(verbsStartedBy(after, JSON.stringify({ tool_name: 'Agentic' }))).toEqual([]);
  });

  it('hands the end of a session to the verb, which names no tool', () => {
    expect(ending).not.toContain('--tools');
    expect(verbsStartedBy(ending, JSON.stringify({ hook_event_name: 'SessionEnd' }))).toEqual([
      'dispatched',
    ]);
  });
});
