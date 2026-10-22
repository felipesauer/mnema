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
import { runDoctor } from '../src/commands/doctor.js';
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
  readonly stderr: string;
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
    stderr: ran.stderr,
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
  for (const tool of ['git', 'cat', 'sleep']) {
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
    expect(met.reason).toContain('mnema needs Node 24.15.0');
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
    [
      'prints what is not JSON',
      'echo "no json here"',
      'what it printed is not a reply a host reads',
    ],
    ['prints nothing', 'exit 0', 'what it printed is not a reply a host reads'],
    [
      'prints a JSON no host reads',
      'echo \'{"foo":1}\'',
      'what it printed is not a reply a host reads',
    ],
    [
      'prints a JSON that is not an object',
      'echo "[]"',
      'what it printed is not a reply a host reads',
    ],
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

/** A `node` that never says its version: the probe the search runs hangs. */
function aNodeThatHangs(dir: string): void {
  writeFileSync(
    join(dir, 'node'),
    [
      '#!/bin/sh',
      'if [ "$1" = "-p" ]; then sleep 30; exit 0; fi',
      `exec "${process.execPath}" "$@"`,
      '',
    ].join('\n'),
    { mode: 0o755 },
  );
}

const writeAt = (relative: string, at = repo): string =>
  JSON.stringify({
    hook_event_name: 'preToolUse',
    tool_name: 'Write',
    tool_input: { file_path: join(at, relative), content: 'x\n' },
  });

describe('where mnema cannot answer, only a path a rule addresses is refused', () => {
  const stuck = () => pathOf('slow', 'mnema', 'tools');

  it('refuses the path a rule that refuses addresses, and lets another through', () => {
    const governed = aHook(CURSOR(), writeAt('src/billing/invoice.ts'), stuck(), CURSOR_ENV);
    expect(governed.decision).toBe('deny');
    const elsewhere = aHook(CURSOR(), writeAt('README.md'), stuck(), CURSOR_ENV);
    expect(elsewhere).toMatchObject({ stdout: '', status: 0 });
    // A sibling whose name only begins the same is not under the address.
    const sibling = aHook(CURSOR(), writeAt('src/billing-old/x.ts'), stuck(), CURSOR_ENV);
    expect(sibling).toMatchObject({ stdout: '', status: 0 });
  });

  it('refuses where a rule asks for a person, in the host that asks', () => {
    const asked = aHook(
      declared('PreToolUse', 'edit-asks-a-person.mjs'),
      JSON.stringify({
        hook_event_name: 'PreToolUse',
        tool_name: 'create_file',
        tool_input: { filePath: join(repo, 'src', 'billing', 'invoice.ts'), content: 'x\n' },
      }),
      pathOf('slow', 'mnema', 'tools'),
    );
    expect(asked.decision).toBe('deny');
  });

  /** A decision recorded, linked at `address` with `relation`, and moved on as `then` says. */
  async function aRuleAt(
    title: string,
    address: string,
    then: (id: string) => Promise<void> = async () => undefined,
  ): Promise<string> {
    const said = await did('decision', 'record', title, 'Because it was agreed');
    const id = said.match(/\(([0-9a-f-]{20,})\)/)?.[1] as string;
    await did('link', id, address, '--rel', 'refuses-a-write');
    await then(id);
    return id;
  }

  it('lets a path through whose rule is only proposed, rejected or superseded, and refuses the one in force', async () => {
    await aRuleAt('Proposed only', 'src/proposed');
    await aRuleAt('Turned down', 'src/rejected', async (id) => {
      await did('decision', 'move', 'reject', id, '--note', 'no');
    });
    const old = await aRuleAt('Replaced', 'src/old', async (id) => {
      await did('decision', 'move', 'accept', id, '--note', 'agreed');
    });
    const successor = (await did('decision', 'record', 'The replacement', 'Because')).match(
      /\(([0-9a-f-]{20,})\)/,
    )?.[1] as string;
    await did('decision', 'supersede', old, successor, '--reason', 'moved on');
    for (const path of ['src/proposed/a.ts', 'src/rejected/a.ts', 'src/old/a.ts']) {
      const met = aHook(CURSOR(), writeAt(path), stuck(), CURSOR_ENV);
      expect(met, path).toMatchObject({ stdout: '', status: 0 });
    }
    expect(aHook(CURSOR(), writeAt('src/billing/a.ts'), stuck(), CURSOR_ENV).decision).toBe('deny');
    // Once the rule in force is superseded too, nothing is addressed any more.
    await did('decision', 'supersede', rule, successor, '--reason', 'moved on');
    expect(aHook(CURSOR(), writeAt('src/billing/a.ts'), stuck(), CURSOR_ENV)).toMatchObject({
      stdout: '',
      status: 0,
    });
  });

  it('lets everything through in a project whose only link is one that governs', async () => {
    process.chdir(plain);
    const said = await did('decision', 'record', 'The ledger is UTC', 'Because it was agreed');
    const governs = said.match(/\(([0-9a-f-]{20,})\)/)?.[1] as string;
    await did('decision', 'move', 'accept', governs, '--note', 'agreed');
    await did('link', governs, 'src/billing', '--rel', 'governs');
    for (const path of ['README.md', 'src/billing/invoice.ts']) {
      const met = aHook(CURSOR(), writeAt(path, plain), stuck(), CURSOR_ENV, plain);
      expect(met, path).toMatchObject({ stdout: '', status: 0 });
    }
  });

  it('lets the path through once the link that refused it was taken back', async () => {
    await did('unlink', rule, 'src/billing', '--rel', 'refuses-a-write', '--reason', 'no longer');
    const met = aHook(CURSOR(), writeAt('src/billing/invoice.ts'), stuck(), CURSOR_ENV);
    expect(met).toMatchObject({ stdout: '', status: 0 });
  });

  it('refuses a patch that names the governed file, in the host whose payload is a patch', () => {
    const patched = aHook(
      declared('PreToolUse', 'edit-asks-a-person.mjs'),
      JSON.stringify({
        hook_event_name: 'PreToolUse',
        tool_name: 'apply_patch',
        tool_input: {
          input: '*** Begin Patch\n*** Update File: src/billing/invoice.ts\n*** End Patch',
        },
      }),
      stuck(),
    );
    expect(patched.decision).toBe('deny');
  });

  it('is the record that decides where mnema runs: a switched off refusal lets the write through', async () => {
    await did('switch', 'off', 'edit-refuses-a-write');
    const met = aHook(
      CURSOR(),
      writeAt('src/billing/invoice.ts'),
      pathOf('real', 'mnema', 'tools'),
      CURSOR_ENV,
    );
    expect(met).toMatchObject({ stdout: '', status: 0 });
  });
});

describe("Gemini CLI's script and OpenCode's plugin", () => {
  const GEMINI = join(PLUGIN, 'gemini', 'hooks', 'mnema.mjs');
  const OPENCODE = join(PLUGIN, 'opencode', 'mnema.js');

  /** What Gemini CLI reads when its gate runs on a write at `relative`. */
  const gemini = (relative: string, path: string): Said =>
    aHook(
      `node "${GEMINI}" gate`,
      JSON.stringify({
        cwd: repo,
        tool_name: 'write_file',
        tool_input: { file_path: join(repo, relative), content: 'x\n' },
      }),
      path,
    );

  /** What OpenCode's plugin does before a write at `relative`: it throws the refusal, or it does not. */
  const opencode = (relative: string, path: string, writes = 1): string => {
    const driver = join(sandbox, 'driver.mjs');
    writeFileSync(
      driver,
      [
        `import { Mnema } from ${JSON.stringify(OPENCODE)};`,
        `const hooks = await Mnema({ directory: ${JSON.stringify(repo)} });`,
        `for (let write = 0; write < ${writes}; write++) {`,
        '  try {',
        `    await hooks['tool.execute.before']({ tool: 'write' }, { args: { filePath: ${JSON.stringify(join(repo, relative))}, content: 'x' } });`,
        "    console.log('went through');",
        '  } catch (refusal) {',
        "    console.log('refused: ' + refusal.message);",
        '  }',
        '}',
        '',
      ].join('\n'),
    );
    return spawnSync(process.execPath, [driver], {
      cwd: repo,
      encoding: 'utf-8',
      env: {
        HOME: home,
        PATH: path,
        GIT_CONFIG_GLOBAL: GIT_WITHOUT_MAINTENANCE,
        GIT_CONFIG_NOSYSTEM: '1',
      },
    }).stdout.trim();
  };

  it('run mnema on the node that takes it, and the rule refuses the write', () => {
    const around = pathOf('slow', 'mnema', 'real', 'tools');
    const said = gemini('src/billing/invoice.ts', around);
    expect(JSON.parse(said.stdout)).toMatchObject({ decision: 'deny' });
    expect(said.stdout).toContain(rule);
    expect(opencode('src/billing/invoice.ts', around)).toContain(rule);
  });

  it('refuse the write a rule addresses where no node takes mnema, and let another path through', () => {
    const stuck = pathOf('slow', 'mnema', 'tools');
    const said = gemini('src/billing/invoice.ts', stuck);
    expect(JSON.parse(said.stdout)).toMatchObject({ decision: 'deny' });
    expect(said.stdout).toContain('mnema needs Node 24.15.0');
    expect(opencode('src/billing/invoice.ts', stuck)).toMatch(
      /^refused: mnema could not answer for this write: mnema needs Node 24\.15\.0/,
    );

    expect(gemini('README.md', stuck)).toMatchObject({ stdout: '', status: 0 });
    expect(opencode('README.md', stuck)).toBe('went through');
  });

  it('refuse where mnema exits without an answer, and let a path no rule addresses through', () => {
    aMnemaOnTheFirstNode(dirs.mnema, 'echo boom >&2; exit 3');
    // `--identify` is answered by the stand-in only when it asks as this product does.
    writeFileSync(
      join(dirs.mnema, 'mnema'),
      [
        '#!/bin/sh',
        'if [ "$1" = "--identify" ]; then echo "@mnema/code 9.9.9"; exit 0; fi',
        'echo boom >&2',
        'exit 3',
        '',
      ].join('\n'),
      { mode: 0o755 },
    );
    const path = pathOf('real', 'mnema', 'tools');
    expect(gemini('src/billing/invoice.ts', path).stdout).toContain('it exited 3: boom');
    expect(opencode('src/billing/invoice.ts', path)).toContain('it exited 3: boom');
    expect(gemini('README.md', path)).toMatchObject({ stdout: '', status: 0 });
    expect(opencode('README.md', path)).toBe('went through');
  });

  /** A `mnema` that answers `--identify` as this product does and then never answers anything else. */
  const aGateThatHangs = (): void =>
    writeFileSync(
      join(dirs.mnema, 'mnema'),
      [
        '#!/bin/sh',
        'if [ "$1" = "--identify" ]; then echo "@mnema/code 9.9.9"; exit 0; fi',
        'exec sleep 60',
        '',
      ].join('\n'),
      { mode: 0o755 },
    );
  /** A `mnema` that never answers `--identify`. */
  const anIdentifyThatHangs = (): void =>
    writeFileSync(join(dirs.mnema, 'mnema'), '#!/bin/sh\nexec sleep 60\n', { mode: 0o755 });

  /** The 15 seconds the host gives a hook, less what a host needs to read the answer. */
  const INSIDE_THE_HOSTS_CAP = 12_000;

  it('refuse a write a rule addresses where --identify hangs, before the host kills the hook', () => {
    anIdentifyThatHangs();
    const path = pathOf('real', 'mnema', 'tools');
    const started = Date.now();
    const said = gemini('src/billing/invoice.ts', path);
    const took = Date.now() - started;
    expect(JSON.parse(said.stdout)).toMatchObject({ decision: 'deny' });
    expect(said.stdout).toContain('it did not answer `mnema --identify`');
    expect(took).toBeLessThan(5000);
    const opened = Date.now();
    expect(opencode('src/billing/invoice.ts', path)).toContain('--identify');
    expect(Date.now() - opened).toBeLessThan(5000);
  }, 30_000);

  it('refuse a write a rule addresses where the gate hangs, inside the 15 seconds of the host', () => {
    aGateThatHangs();
    const path = pathOf('real', 'mnema', 'tools');
    const started = Date.now();
    const said = gemini('src/billing/invoice.ts', path);
    const took = Date.now() - started;
    expect(JSON.parse(said.stdout)).toMatchObject({ decision: 'deny' });
    expect(said.stdout).toContain('it did not answer in 6 seconds');
    expect(took).toBeLessThan(INSIDE_THE_HOSTS_CAP);
    const opened = Date.now();
    expect(opencode('src/billing/invoice.ts', path)).toContain('it did not answer in 6 seconds');
    expect(Date.now() - opened).toBeLessThan(INSIDE_THE_HOSTS_CAP);
  }, 40_000);

  it('keep the search, --identify and the gate under the cap together, with a hung node too', async () => {
    const { SEARCH_BUDGET } = await import('../../../plugin/hooks/the-gate-kit.mjs');
    for (const file of [GEMINI, OPENCODE]) {
      const text = readFileSync(file, 'utf-8');
      const identify = Number(/const IDENTIFY_WAIT = (\d+);/.exec(text)?.[1]);
      const gate = Number(/const GATE_WAIT = (\d+);/.exec(text)?.[1]);
      expect(SEARCH_BUDGET + identify + gate).toBeLessThanOrEqual(INSIDE_THE_HOSTS_CAP);
    }
    // And the whole of it, with every node of the search hanging and a gate that hangs.
    aNodeThatHangs(dirs.slow);
    aGateThatHangs();
    const started = Date.now();
    const said = gemini('src/billing/invoice.ts', pathOf('slow', 'mnema', 'real', 'tools'));
    expect(JSON.parse(said.stdout)).toMatchObject({ decision: 'deny' });
    expect(Date.now() - started).toBeLessThan(INSIDE_THE_HOSTS_CAP);
  }, 40_000);

  it('do not keep one failed --identify for the whole session: OpenCode asks again at the next write', () => {
    const state = join(sandbox, 'asked-once');
    writeFileSync(
      join(dirs.mnema, 'mnema'),
      [
        '#!/bin/sh',
        'if [ "$1" = "--identify" ]; then',
        `  if [ ! -e "${state}" ]; then : > "${state}"; exit 1; fi`,
        '  echo "@mnema/code 9.9.9"; exit 0',
        'fi',
        'echo "{}"',
        '',
      ].join('\n'),
      { mode: 0o755 },
    );
    const lines = opencode('src/billing/invoice.ts', pathOf('real', 'mnema', 'tools'), 2).split(
      '\n',
    );
    expect(lines[0]).toContain('refused: mnema could not answer for this write');
    expect(lines[1]).toBe('went through');
  });

  it('do nothing where there is no mnema at all', () => {
    const none = pathOf('slow', 'tools');
    expect(gemini('src/billing/invoice.ts', none)).toMatchObject({ stdout: '', status: 0 });
    expect(opencode('src/billing/invoice.ts', none)).toBe('went through');
  });
});

describe('a node that hangs on its version', () => {
  it("is given a second and gone around, and the gate still answers inside the host's 15 seconds", () => {
    aNodeThatHangs(dirs.slow);
    const started = Date.now();
    const met = aHook(
      CURSOR(),
      cursorWrite(),
      pathOf('slow', 'mnema', 'real', 'tools'),
      CURSOR_ENV,
    );
    expect(met.decision).toBe('deny');
    expect(met.reason).toContain(rule);
    expect(Date.now() - started).toBeLessThan(8000);
  }, 20_000);

  it("refuses with the reason where it is the only node, well inside the host's 15 seconds", () => {
    aNodeThatHangs(dirs.slow);
    const started = Date.now();
    const met = aHook(CURSOR(), cursorWrite(), pathOf('slow', 'mnema', 'tools'), CURSOR_ENV);
    expect(met.decision).toBe('deny');
    expect(met.reason).toContain('did not say its version');
    expect(Date.now() - started).toBeLessThan(8000);
  }, 20_000);

  it('keeps the search and the run of mnema under the 15 seconds the host gives a hook', async () => {
    const { GATE_TIMEOUT } = await import('../../../plugin/hooks/hand-over.mjs');
    const { SEARCH_BUDGET } = await import('../../../plugin/hooks/the-gate-kit.mjs');
    expect(GATE_TIMEOUT + SEARCH_BUDGET).toBeLessThan(15_000);
  });
});

describe('a mnema that does not finish', () => {
  it('is cut at the timeout the gate is given, and the write it was asked about is refused', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mnema-never-answers-'));
    const slow = join(dir, 'mnema');
    writeFileSync(slow, '#!/bin/sh\nexec sleep 5\n', { mode: 0o755 });
    const before = process.env.CLAUDE_PLUGIN_OPTION_MNEMA_PATH;
    process.env.CLAUDE_PLUGIN_OPTION_MNEMA_PATH = slow;
    try {
      const { whatTheGateAnswers } = await import('../../../plugin/hooks/hand-over.mjs');
      const started = Date.now();
      const answered = await whatTheGateAnswers(
        ['--host', 'cursor', '--where', 'CURSOR_VERSION'],
        CURSOR_ENV,
        repo,
        async () => cursorWrite(),
        { timeout: 300 },
      );
      expect(answered).toContain('"permissionDecision":"deny"');
      expect(answered).toContain('it did not answer in 0.3 seconds');
      expect(Date.now() - started).toBeLessThan(3000);
    } finally {
      if (before === undefined) delete process.env.CLAUDE_PLUGIN_OPTION_MNEMA_PATH;
      else process.env.CLAUDE_PLUGIN_OPTION_MNEMA_PATH = before;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('a child the gate starts that ignores SIGTERM', () => {
  /** A program that ignores SIGTERM and never finishes: only SIGKILL ends it. */
  const stubborn = (file: string, header = ''): void =>
    writeFileSync(
      file,
      [
        '#!/bin/sh',
        header,
        `exec "${process.execPath}" -e "process.on('SIGTERM', () => {}); setTimeout(() => {}, 60000)"`,
        '',
      ].join('\n'),
      { mode: 0o755 },
    );

  it('cannot hang the version probe: the node that ignores it is killed at the probe', () => {
    stubborn(
      join(dirs.slow, 'node'),
      `if [ "$1" != "-p" ]; then exec "${process.execPath}" "$@"; fi`,
    );
    const started = Date.now();
    const met = aHook(
      CURSOR(),
      cursorWrite(),
      pathOf('slow', 'mnema', 'real', 'tools'),
      CURSOR_ENV,
    );
    expect(met.decision).toBe('deny');
    expect(Date.now() - started).toBeLessThan(8000);
  }, 20_000);

  it('cannot hang the verb: the mnema that ignores it is killed at the gate timeout', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mnema-ignores-sigterm-'));
    const stuck = join(dir, 'mnema');
    stubborn(stuck);
    const before = process.env.CLAUDE_PLUGIN_OPTION_MNEMA_PATH;
    process.env.CLAUDE_PLUGIN_OPTION_MNEMA_PATH = stuck;
    try {
      const { whatTheGateAnswers } = await import('../../../plugin/hooks/hand-over.mjs');
      const started = Date.now();
      const answered = await whatTheGateAnswers(
        ['--host', 'cursor', '--where', 'CURSOR_VERSION'],
        CURSOR_ENV,
        repo,
        async () => cursorWrite(),
        { timeout: 300 },
      );
      expect(answered).toContain('"permissionDecision":"deny"');
      expect(Date.now() - started).toBeLessThan(3000);
    } finally {
      if (before === undefined) delete process.env.CLAUDE_PLUGIN_OPTION_MNEMA_PATH;
      else process.env.CLAUDE_PLUGIN_OPTION_MNEMA_PATH = before;
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20_000);

  it("cannot hang Gemini CLI's gate: its mnema is killed at the gate's wait", () => {
    stubborn(
      join(dirs.mnema, 'mnema'),
      'if [ "$1" = "--identify" ]; then echo "@mnema/code 9.9.9"; exit 0; fi',
    );
    const started = Date.now();
    const said = aHook(
      `node "${join(PLUGIN, 'gemini', 'hooks', 'mnema.mjs')}" gate`,
      JSON.stringify({
        cwd: repo,
        tool_name: 'write_file',
        tool_input: { file_path: join(repo, 'src/billing/invoice.ts'), content: 'x\n' },
      }),
      pathOf('real', 'mnema', 'tools'),
    );
    expect(JSON.parse(said.stdout)).toMatchObject({ decision: 'deny' });
    expect(Date.now() - started).toBeLessThan(12_000);
  }, 30_000);
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
      JSON.stringify({
        tool_name: 'create_file',
        tool_input: { filePath: join(repo, 'src', 'billing', 'invoice.ts') },
      }),
      pathOf('real', 'tools'),
    );
    expect(write.decision).toBe('deny');
  });
});

describe('the floor the plugin repeats', () => {
  it('is the one `engines.node` declares', async () => {
    const { NODE_RANGE } = await import('../../../plugin/hooks/the-gate-kit.mjs');
    const declaredRange = (
      JSON.parse(readFileSync(join(REPO, 'packages', 'code', 'package.json'), 'utf-8')) as {
        engines: { node: string };
      }
    ).engines.node;
    expect(NODE_RANGE).toBe(declaredRange);
  });

  it('takes the versions the product takes, and refuses the ones it refuses', async () => {
    const { NODE_RANGE, nodeIsTaken } = await import('../../../plugin/hooks/the-gate-kit.mjs');
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

describe('mnema doctor says which node mnema starts on', () => {
  const embedded = () =>
    join(home, '.local', 'share', 'cursor-agent', 'versions', '2026.09.18-x', 'node');

  /** The node findings for a PATH, with every `node` named saying the version `says` gives it. */
  const nodeLines = (path: string, says: (node: string) => string | undefined): string[] =>
    runDoctor({
      cwd: repo,
      env: { home },
      processEnv: { PATH: path },
      running: { file: join(sandbox, 'mnema'), version: '9.9.9' },
      nodeVersionOf: says,
    })
      .findings.filter((one) => one.topic === 'node')
      .map((one) => `${one.state} ${one.line}`);

  it('is fine where the first node takes mnema', () => {
    const lines = nodeLines(pathOf('real'), () => '24.21.0');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(
      /^fine the first “node” on the PATH, .*, is 24\.21\.0 and takes mnema/,
    );
  });

  it('says what to do where the first node is below the floor', () => {
    const lines = nodeLines(pathOf('slow', 'real'), (node) =>
      node.startsWith(dirs.slow) ? '24.5.0' : '24.21.0',
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('attention the first “node” on the PATH');
    expect(lines[0]).toContain('is 24.5.0, below what mnema takes');
    expect(lines[0]).toContain('nvm install 24');
  });

  it('says there is no node where there is none', () => {
    const lines = nodeLines(pathOf('tools'), () => undefined);
    expect(lines).toEqual([expect.stringContaining('attention no “node” on the PATH')]);
  });

  it('names the node Cursor carries, and whether the hooks go around it', () => {
    mkdirSync(join(embedded(), '..'), { recursive: true });
    writeFileSync(embedded(), '#!/bin/sh\n', { mode: 0o755 });
    const says = (node: string) => (node === embedded() ? BELOW_THE_FLOOR : '24.21.0');
    const around = nodeLines(pathOf('real'), says);
    expect(around).toHaveLength(2);
    expect(around[1]).toMatch(
      /^fine Cursor's command-line agent carries a Node of its own, .* \(24\.5\.0\)/,
    );
    expect(around[1]).toContain('go around it');

    const stuck = nodeLines(pathOf('tools'), says);
    expect(stuck[1]).toMatch(/^attention Cursor's command-line agent carries a Node of its own/);
    expect(stuck[1]).toContain('refuse writes');
    expect(stuck[1]).toContain('nvm install 24');
  });
});
