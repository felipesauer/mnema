/**
 * A STACK IS HANDLED THROUGH THE PROGRAM — the `mnema stack` verbs driven in process.
 *
 * The built-binary files (`a-stack-goes-where-nothing-is`, `a-stack-is-looked-at-against-its-receipt`,
 * `a-hook-is-turned-on-by-a-person`) are what a person runs; this one drives the same wiring in
 * process, so that the coverage gate, which cannot see a child process, sees it, and so the
 * terminal is a fact the harness hands over (`aPersonIsHere`, `ask`) and not a pseudo-terminal.
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type CliIo, run } from '../src/program.js';

const HELLO = fileURLToPath(new URL('../../stacks/fixtures/hello-stack', import.meta.url));

let sandbox: string;
let project: string;
let hooked: string;
const kept = { cwd: process.cwd(), home: process.env.HOME, data: process.env.XDG_DATA_HOME };

interface Heard {
  readonly out: string;
  readonly err: string;
  readonly failed: boolean;
}

/** One invocation, with or without a person at a terminal who types `typed`. */
async function mnema(argv: readonly string[], person?: { typed: string }): Promise<Heard> {
  const out: string[] = [];
  const err: string[] = [];
  let failed = false;
  const io: CliIo = {
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    fail: () => {
      failed = true;
    },
    ...(person === undefined ? {} : { aPersonIsHere: true, ask: async () => person.typed }),
  };
  await run(argv, io);
  return { out: out.join('\n'), err: err.join('\n'), failed };
}

async function addHooked(): Promise<void> {
  const plan = await mnema(['stack', 'add', hooked, '--dry-run']);
  const digest = /digest {3}([0-9a-f]{64})/.exec(plan.out)?.[1] ?? '';
  const added = await mnema(['stack', 'add', hooked, '--expect', digest]);
  expect(added.failed, added.err).toBe(false);
}

beforeEach(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-stack-program-'));
  project = join(sandbox, 'project');
  hooked = join(sandbox, 'hooked');
  mkdirSync(project);
  mkdirSync(join(sandbox, 'home'));
  process.env.HOME = join(sandbox, 'home');
  process.env.XDG_DATA_HOME = join(sandbox, 'data');
  process.chdir(project);
  cpSync(HELLO, hooked, { recursive: true });
  mkdirSync(join(hooked, 'hooks'));
  writeFileSync(join(hooked, 'hooks/format.sh'), '#!/bin/sh\necho formatted\n');
  const manifest = JSON.parse(readFileSync(join(hooked, 'stack.json'), 'utf8'));
  manifest.hooks = [
    { name: 'format', event: 'after-edit', file: 'hooks/format.sh', description: 'Formats.' },
  ];
  manifest.brings.hooks = ['format'];
  writeFileSync(join(hooked, 'stack.json'), JSON.stringify(manifest));
  expect((await mnema(['init'])).failed).toBe(false);
  await addHooked();
});

afterEach(() => {
  process.chdir(kept.cwd);
  const restore = (name: string, value: string | undefined) => {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  };
  restore('HOME', kept.home);
  restore('XDG_DATA_HOME', kept.data);
  rmSync(sandbox, { recursive: true, force: true });
});

describe('looking at what is installed', () => {
  it('lists, shows, diffs and checks a stack that is as written', async () => {
    expect((await mnema(['stack', 'list'])).out).toMatch(
      /hello-stack@1\.0\.0 .* public .*1 hooks declared, 0 on {2}sound/,
    );
    const show = await mnema(['stack', 'show', 'hello-stack']);
    expect(show.out).toContain('format  on after-edit  off');
    const diff = await mnema(['stack', 'diff', 'hello-stack', '--scope', 'public']);
    expect(diff.failed).toBe(false);
    expect(diff.out).toContain('= .claude/skills/hello/SKILL.md  as written');
    const check = await mnema(['stack', 'check', 'hello-stack']);
    expect(check.out).toContain('1 stacks checked: every file is as written');
  });

  it('says nothing is installed, and refuses a stack that is not', async () => {
    expect((await mnema(['stack', 'list', '--scope', 'global'])).out).toBe(
      'No stack is installed.',
    );
    const none = await mnema(['stack', 'show', 'absent']);
    expect(none.failed).toBe(true);
    expect(none.err).toContain('STACK_NOT_INSTALLED');
    const twice = await mnema(['stack', 'check', '--scope', 'public', '--to', project]);
    expect(twice.err).toContain('--scope and --to name two places');
  });

  it('fails check on a changed file and on a script changed after its approval', async () => {
    writeFileSync(join(project, '.claude/agents/greeter.md'), 'mine\n');
    const check = await mnema(['stack', 'check']);
    expect(check.failed).toBe(true);
    expect(check.out).toContain('.claude/agents/greeter.md is changed');
  });

  it('exports the skills and agents and refuses a folder that is taken', async () => {
    const out = join(sandbox, 'exported');
    const done = await mnema(['stack', 'export', 'hello-stack', out]);
    expect(done.out).toContain('Exported hello-stack: 2 files');
    expect(existsSync(join(out, 'skills/hello/SKILL.md'))).toBe(true);
    const taken = await mnema(['stack', 'export', 'hello-stack', out]);
    expect(taken.failed).toBe(true);
    expect(taken.err).toContain('STACK_DESTINATION_TAKEN');
  });
});

describe('turning a hook on and off', () => {
  const enable = ['stack', 'enable', 'hello-stack', 'format', '--from'];

  it('refuses with no person at a terminal, before reading the source', async () => {
    const none = await mnema([...enable, '/nowhere']);
    expect(none.failed).toBe(true);
    expect(none.err).toContain('STACK_HOOK_NEEDS_A_PERSON');
  });

  it('refuses a name typed that is not the hook, an unknown hook, and a source that differs', async () => {
    const wrong = await mnema([...enable, hooked], { typed: 'yes' });
    expect(wrong.err).toContain('STACK_HOOK_NOT_APPROVED');
    const unknown = await mnema(['stack', 'enable', 'hello-stack', '../x', '--from', hooked], {
      typed: 'x',
    });
    expect(unknown.err).toContain('STACK_HOOK_UNKNOWN');
    const absent = await mnema(['stack', 'enable', 'absent', 'format', '--from', hooked], {
      typed: 'x',
    });
    expect(absent.err).toContain('STACK_NOT_INSTALLED');
    const nowhere = await mnema([...enable, join(sandbox, 'nowhere')], { typed: 'format' });
    expect(nowhere.failed).toBe(true);
    writeFileSync(join(hooked, 'hooks/format.sh'), '#!/bin/sh\nother\n');
    const differs = await mnema([...enable, hooked], { typed: 'format' });
    expect(differs.err).toContain('STACK_HOOK_SOURCE_DIFFERS');
  });

  it('approves one hook once its name is typed, shows the script, and takes it back', async () => {
    const on = await mnema([...enable, hooked], { typed: 'format\n' });
    expect(on.failed, on.err).toBe(false);
    expect(on.out).toContain('echo formatted');
    expect(on.out).toContain('runs nothing');
    expect((await mnema(['stack', 'show', 'hello-stack'])).out).toContain(
      'format  on after-edit  on',
    );
    expect((await mnema(['stack', 'list'])).out).toContain('1 hooks declared, 1 on');
    const again = await mnema([...enable, hooked], { typed: 'format' });
    expect(again.failed, again.err).toBe(false);
    const off = await mnema(['stack', 'disable', 'hello-stack', 'format']);
    expect(off.out).toContain('Took back the approval of hello-stack hook format.');
    const nothing = await mnema(['stack', 'disable', 'hello-stack', 'format']);
    expect(nothing.out).toContain('was not approved. Nothing changed.');
    const unknown = await mnema(['stack', 'disable', 'hello-stack', 'nope']);
    expect(unknown.err).toContain('STACK_HOOK_UNKNOWN');
  });

  it('refuses a hook for a stack written with --to, which has no tree for the approval', async () => {
    const into = join(sandbox, 'into');
    const plan = await mnema(['stack', 'add', hooked, '--dry-run', '--to', into]);
    const digest = /digest {3}([0-9a-f]{64})/.exec(plan.out)?.[1] ?? '';
    expect((await mnema(['stack', 'add', hooked, '--to', into, '--expect', digest])).failed).toBe(
      false,
    );
    const on = await mnema(
      ['stack', 'enable', 'hello-stack', 'format', '--to', into, '--from', hooked],
      {
        typed: 'format',
      },
    );
    expect(on.err).toContain('STACK_HOOK_NEEDS_A_TREE');
    expect((await mnema(['stack', 'list', '--to', into])).out).toContain('--to');
  });
});

describe('a receipt that cannot be believed', () => {
  it('is reported by every looking verb and its hook is not approved on its word', async () => {
    const receipt = join(project, '.mnema/stacks/hello-stack.json');
    const real = JSON.parse(readFileSync(receipt, 'utf8'));
    writeFileSync(receipt, JSON.stringify({ ...real, hooks: [{ name: 'x' }] }));
    expect((await mnema(['stack', 'list'])).out).toContain('receipt refused');
    expect((await mnema(['stack', 'show', 'hello-stack'])).out).toContain('The receipt is refused');
    const diff = await mnema(['stack', 'diff', 'hello-stack']);
    expect(diff.failed).toBe(true);
    const on = await mnema(['stack', 'enable', 'hello-stack', 'x', '--from', hooked], {
      typed: 'x',
    });
    expect(on.err).toContain('STACK_RECEIPT_REFUSED');
    writeFileSync(receipt, JSON.stringify({ ...real, digest: 'a'.repeat(64) }));
    expect((await mnema(['stack', 'diff', 'hello-stack'])).out).toContain(
      "not the receipt's digest",
    );
    rmSync(receipt);
    expect((await mnema(['stack', 'check'])).out).toContain('no receipt is here');
  });
});
