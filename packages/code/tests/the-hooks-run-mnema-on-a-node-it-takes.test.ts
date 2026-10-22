/**
 * THE HOOKS RUN `mnema` ON A NODE IT TAKES, AND A GATE THAT CANNOT RUN IT REFUSES THE WRITE.
 *
 * WHERE THIS COMES FROM. Cursor's command-line agent (2026.09.18) puts the Node it embeds, 24.5.0,
 * in front of the PATH of a plugin's hooks. `mnema` starts through `#!/usr/bin/env node`, so it died
 * on its own floor ("mnema needs Node 24.15.0 ... this is Node 24.5.0", exit 1) in every hook, and
 * the gate's handler read that as nothing to say: the write a rule refuses went through. Two
 * things were wrong and each has its own cases: the hook trusted the first `node`, and the gate
 * let a write through because it could not read the record.
 *
 * THE STAND-INS ARE REAL ENOUGH TO FAIL THE SAME WAY. The first `node` is a program that says it is
 * 24.5.0 when asked and runs the real Node for everything else (the hook has to run to be tested);
 * `mnema` is a script that asks `node` what it is and dies on 24.5.0 with the product's own words
 * (`floorRefusal`), and otherwise runs the built binary. The probe of the same defect on the real
 * Node 24.5.0 of the Cursor agent was run by hand; this is what holds it.
 *
 * NOT HELD: that Cursor puts a Node of its own there on a machine other than the one measured, or
 * that the hook of a host that is not Cursor ever meets one. The search is the same for all of them.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { acceptedBy, floorRefusal } from '../src/node-floor.js';
import { type CliIo, run } from '../src/program.js';
import { GIT_WITHOUT_MAINTENANCE } from './support/git-without-maintenance.js';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const CLI = join(REPO, 'packages', 'code', 'dist', 'cli.js');
const PLUGIN = join(REPO, 'plugin');
const HOOKS = join(PLUGIN, 'hooks', 'hooks.json');
const BELOW_THE_FLOOR = '24.5.0';

let sandbox: string;
let repo: string;
let plain: string;
let home: string;
let originalCwd: string;
let originalHome: string | undefined;
let originalMnemaHome: string | undefined;
let rule: string;
/** The directories a PATH is made of, by what is in each. */
const dirs: Record<'slow' | 'mnema' | 'real' | 'tools', string> = {
  slow: '',
  mnema: '',
  real: '',
  tools: '',
};

async function did(...argv: string[]): Promise<string> {
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
  return out.join('\n');
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.org', ...args], {
    cwd,
    encoding: 'utf-8',
    env: { ...process.env, GIT_CONFIG_GLOBAL: GIT_WITHOUT_MAINTENANCE, GIT_CONFIG_NOSYSTEM: '1' },
  });
}

/** The command `hooks.json` declares for a handler, under the event it is declared in. */
function declared(event: string, handler: string): string {
  const config = JSON.parse(readFileSync(HOOKS, 'utf-8')) as {
    hooks: Record<string, { hooks: { type: string; command?: string }[] }[]>;
  };
  const found = (config.hooks[event] ?? [])
    .flatMap((group) => group.hooks)
    .filter((hook) => hook.type === 'command' && (hook.command ?? '').includes(handler));
  expect(found.length).toBe(1);
  return found[0]?.command as string;
}

/** A `node` that says it is `version` when asked, and is the real one for everything else. */
function aNodeThatSays(dir: string, version: string): void {
  writeFileSync(
    join(dir, 'node'),
    [
      '#!/bin/sh',
      `if [ "$1" = "-p" ] && [ "$2" = "process.versions.node" ]; then echo ${version}; exit 0; fi`,
      `exec "${process.execPath}" "$@"`,
      '',
    ].join('\n'),
    { mode: 0o755 },
  );
}

/** A `mnema` that starts as the `#!/usr/bin/env node` one does: on whichever `node` is first. */
function aMnemaOnTheFirstNode(dir: string, then = `exec node "${CLI}" "$@"`): void {
  writeFileSync(
    join(dir, 'mnema'),
    [
      '#!/bin/sh',
      'v=$(node -p process.versions.node)',
      'case "$v" in',
      `  ${BELOW_THE_FLOOR}) echo "mnema needs Node 24.15.0 or a later 24, or 26 or later; this is Node $v. Install a newer Node and run it again." >&2; exit 1;;`,
      'esac',
      then,
      '',
    ].join('\n'),
    { mode: 0o755 },
  );
}

/** The PATH of a hook, from the directories named, in that order. */
const pathOf = (...names: (keyof typeof dirs)[]): string => names.map((n) => dirs[n]).join(':');

interface Said {
  readonly stdout: string;
  readonly status: number | null;
  readonly decision: string | undefined;
  readonly reason: string;
}

/** What a host reads when it runs `command` with `payload` on stdin, from `at`, on `path`. */
function aHook(
  command: string,
  payload: string,
  path: string,
  extra: Record<string, string> = {},
  at = repo,
  root = PLUGIN,
): Said {
  const ran = spawnSync('/bin/sh', ['-c', command], {
    cwd: at,
    input: payload,
    encoding: 'utf-8',
    env: {
      HOME: home,
      PATH: path,
      CLAUDE_PLUGIN_ROOT: root,
      GIT_CONFIG_GLOBAL: GIT_WITHOUT_MAINTENANCE,
      GIT_CONFIG_NOSYSTEM: '1',
      ...extra,
    },
  });
  const stdout = ran.stdout;
  const said =
    stdout.trim() === ''
      ? undefined
      : (JSON.parse(stdout) as { hookSpecificOutput?: Record<string, string> }).hookSpecificOutput;
  return {
    stdout,
    status: ran.status,
    decision: said?.permissionDecision,
    reason: said?.permissionDecisionReason ?? '',
  };
}

const CURSOR = () => declared('PreToolUse', 'edit-refuses-a-write.mjs');
const cursorWrite = (at = repo): string =>
  JSON.stringify({
    hook_event_name: 'preToolUse',
    tool_name: 'Write',
    tool_input: { file_path: join(at, 'src', 'billing', 'invoice.ts'), content: 'x\n' },
  });
const CURSOR_ENV = { CURSOR_VERSION: '2026.09.18' };

beforeEach(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-the-node-it-takes-'));
  repo = join(sandbox, 'repo');
  plain = join(sandbox, 'plain');
  home = join(sandbox, 'home');
  for (const name of Object.keys(dirs) as (keyof typeof dirs)[]) {
    dirs[name] = join(sandbox, name);
    mkdirSync(dirs[name]);
  }
  mkdirSync(home);
  symlinkSync(process.execPath, join(dirs.real, 'node'));
  for (const tool of ['git', 'cat']) {
    const where = execFileSync('/bin/sh', ['-c', `command -v ${tool}`], {
      encoding: 'utf-8',
    }).trim();
    symlinkSync(where, join(dirs.tools, tool));
  }
  aNodeThatSays(dirs.slow, BELOW_THE_FLOOR);
  aMnemaOnTheFirstNode(dirs.mnema);
  originalCwd = process.cwd();
  originalHome = process.env.HOME;
  originalMnemaHome = process.env.MNEMA_HOME;
  process.env.HOME = home;
  delete process.env.MNEMA_HOME;
  delete process.env.MNEMA_RUN;
  for (const where of [repo, plain]) {
    mkdirSync(join(where, 'src', 'billing'), { recursive: true });
    git(sandbox, 'init', '-q', where);
    process.chdir(where);
    await did('init');
  }
  process.chdir(repo);
  const said = await did('decision', 'record', 'Nobody writes billing', 'Because it was agreed');
  rule = said.match(/\(([0-9a-f-]{20,})\)/)?.[1] as string;
  await did('decision', 'move', 'accept', rule, '--note', 'agreed');
  await did('link', rule, 'src/billing', '--rel', 'refuses-a-write');
});

afterEach(() => {
  process.chdir(originalCwd);
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalMnemaHome === undefined) delete process.env.MNEMA_HOME;
  else process.env.MNEMA_HOME = originalMnemaHome;
  rmSync(sandbox, { recursive: true, force: true });
});

describe('a node below the floor in front of the PATH', () => {
  it('is gone around: the gate runs mnema on the node that takes it, and the rule refuses the write', () => {
    // The control: the same record on a PATH whose first node takes mnema refuses it.
    const control = aHook(CURSOR(), cursorWrite(), pathOf('real', 'mnema', 'tools'), CURSOR_ENV);
    expect(control.decision).toBe('deny');
    expect(control.reason).toContain(rule);

    const met = aHook(
      CURSOR(),
      cursorWrite(),
      pathOf('slow', 'mnema', 'real', 'tools'),
      CURSOR_ENV,
    );
    expect(met.status).toBe(0);
    expect(met.decision).toBe('deny');
    expect(met.reason).toContain(rule);
  });

  it('is gone around for the document too: the session opens with the record', () => {
    const opened = aHook(
      declared('SessionStart', 'session-start.mjs'),
      '',
      pathOf('slow', 'mnema', 'real', 'tools'),
    );
    const text = (
      JSON.parse(opened.stdout) as { hookSpecificOutput: { additionalContext: string } }
    ).hookSpecificOutput.additionalContext;
    expect(text).toContain('Nobody writes billing');
    expect(text).not.toContain('could not run');
  });

  it('refuses the write where no node takes mnema, and says which node it met and what to do', () => {
    const met = aHook(CURSOR(), cursorWrite(), pathOf('slow', 'mnema', 'tools'), CURSOR_ENV);
    expect(met.status).toBe(0);
    expect(met.decision).toBe('deny');
    expect(met.reason).toContain('mnema could not run');
    expect(met.reason).toContain(`is ${BELOW_THE_FLOOR}`);
    expect(met.reason).toContain('Node 24.15.0 or a later 24, or 26 or later');
    expect(met.reason).toContain('nvm install 24');
  });

  it('says so to the session where none takes mnema, instead of naming a stranger', () => {
    const opened = aHook(
      declared('SessionStart', 'session-start.mjs'),
      '',
      pathOf('slow', 'mnema', 'tools'),
    );
    const text = (
      JSON.parse(opened.stdout) as { hookSpecificOutput: { additionalContext: string } }
    ).hookSpecificOutput.additionalContext;
    expect(text).toContain('mnema could not run: mnema needs Node 24.15.0');
    expect(text).not.toContain('is not @mnema/code');
  });

  it('does not refuse a write no rule can meet, whatever node is first', () => {
    const met = aHook(
      CURSOR(),
      cursorWrite(plain),
      pathOf('slow', 'mnema', 'tools'),
      CURSOR_ENV,
      plain,
    );
    expect(met).toMatchObject({ stdout: '', status: 0 });
  });

  it('does not refuse where there is no mnema at all', () => {
    const met = aHook(CURSOR(), cursorWrite(), pathOf('slow', 'tools'), CURSOR_ENV);
    expect(met).toMatchObject({ stdout: '', status: 0 });
  });
});

describe('a mnema that is there and does not answer', () => {
  it.each([
    ['exits non-zero', 'echo boom >&2; exit 3', 'it exited 3: boom'],
    ['prints what is not JSON', 'echo "no json here"', 'what it printed is not a JSON reply'],
    ['prints nothing', 'exit 0', 'what it printed is not a JSON reply'],
    ['prints a JSON that is not an object', 'echo "[]"', 'what it printed is not a JSON reply'],
  ])('refuses the write when it %s', (_, then, because) => {
    aMnemaOnTheFirstNode(dirs.mnema, then);
    const met = aHook(CURSOR(), cursorWrite(), pathOf('real', 'mnema', 'tools'), CURSOR_ENV);
    expect(met.status).toBe(0);
    expect(met.decision).toBe('deny');
    expect(met.reason).toContain('mnema could not answer for this write');
    expect(met.reason).toContain(because);
  });

  it('lets the write through when it answers nothing to say', () => {
    aMnemaOnTheFirstNode(dirs.mnema, 'echo "{}"');
    const met = aHook(CURSOR(), cursorWrite(), pathOf('real', 'mnema', 'tools'), CURSOR_ENV);
    expect(met).toMatchObject({ stdout: '', status: 0 });
  });

  it('refuses the same way in the host that asks for a person', () => {
    aMnemaOnTheFirstNode(dirs.mnema, 'exit 1');
    const met = aHook(
      declared('PreToolUse', 'edit-asks-a-person.mjs'),
      JSON.stringify({
        hook_event_name: 'PreToolUse',
        tool_name: 'create_file',
        tool_input: { filePath: join(repo, 'src', 'billing', 'invoice.ts'), content: 'x\n' },
      }),
      pathOf('real', 'mnema', 'tools'),
    );
    expect(met.decision).toBe('deny');
    expect(met.reason).toContain('it exited 1');
  });
});

describe('a fault of the handler itself', () => {
  /** The plugin's hooks with the module the handler imports taken out, so the import throws. */
  function aBrokenPlugin(): string {
    const root = join(sandbox, 'broken-plugin');
    cpSync(join(PLUGIN, 'hooks'), join(root, 'hooks'), { recursive: true });
    rmSync(join(root, 'hooks', 'hand-over.mjs'));
    return root;
  }
  const handler = (root: string, args: string): string =>
    `node "${join(root, 'hooks', 'edit-asks-a-person.mjs')}" ${args}`;

  it('refuses the write the call is about, with the fault said', () => {
    const met = aHook(
      declared('PreToolUse', 'edit-refuses-a-write.mjs'),
      cursorWrite(),
      pathOf('real', 'tools'),
      CURSOR_ENV,
      repo,
      aBrokenPlugin(),
    );
    expect(met.decision).toBe('deny');
    expect(met.reason).toContain('The mnema gate could not run');
  });

  it('refuses nothing where the host is not the one the call is for, or the tool is not a write', () => {
    const root = aBrokenPlugin();
    const where = aHook(
      handler(root, '--host cursor --where CURSOR_VERSION'),
      cursorWrite(),
      pathOf('real', 'tools'),
    );
    expect(where).toMatchObject({ stdout: '', status: 0 });

    const read = aHook(
      handler(root, '--host vscode --tools create_file,replace_string_in_file'),
      JSON.stringify({ tool_name: 'read_file', tool_input: { filePath: 'x' } }),
      pathOf('real', 'tools'),
    );
    expect(read).toMatchObject({ stdout: '', status: 0 });

    const write = aHook(
      handler(root, '--host vscode --tools create_file,replace_string_in_file'),
      JSON.stringify({ tool_name: 'create_file', tool_input: { filePath: 'x' } }),
      pathOf('real', 'tools'),
    );
    expect(write.decision).toBe('deny');
  });
});

describe('the floor the plugin repeats', () => {
  it('is the one `engines.node` declares', async () => {
    const { NODE_RANGE } = await import('../../../plugin/hooks/hand-over.mjs');
    const declaredRange = (
      JSON.parse(readFileSync(join(REPO, 'packages', 'code', 'package.json'), 'utf-8')) as {
        engines: { node: string };
      }
    ).engines.node;
    expect(NODE_RANGE).toBe(declaredRange);
  });

  it('takes the versions the product takes, and refuses the ones it refuses', async () => {
    const { NODE_RANGE, nodeIsTaken } = await import('../../../plugin/hooks/hand-over.mjs');
    expect(acceptedBy(NODE_RANGE)).toBeDefined();
    for (const [version, taken] of [
      ['24.5.0', false],
      ['24.14.9', false],
      ['24.15.0', true],
      ['24.99.0', true],
      ['25.0.0', false],
      ['25.9.9', false],
      ['26.0.0', true],
      ['27.1.0', true],
      ['22.12.0', false],
      ['v24.15.0', true],
      ['not a version', false],
    ] as const) {
      expect(nodeIsTaken(version), version).toBe(taken);
      if (version !== 'not a version') {
        expect(floorRefusal(version.replace(/^v/, ''), NODE_RANGE) === undefined, version).toBe(
          taken,
        );
      }
    }
  });
});
