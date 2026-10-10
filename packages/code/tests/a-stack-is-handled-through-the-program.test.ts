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

/** What `stack remove` says of who may remove: the record keeps no author rule for it. */
const WHO_MAY_REMOVE =
  'The record does not check who removes a stack: a removal signed by any key that writes to this tree stands, whoever adopted it.';
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
async function mnema(
  argv: readonly string[],
  person?: { typed: string; here?: boolean },
): Promise<Heard> {
  const out: string[] = [];
  const err: string[] = [];
  let failed = false;
  const io: CliIo = {
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    fail: () => {
      failed = true;
    },
    ...(person === undefined
      ? {}
      : { aPersonIsHere: person.here !== false, ask: async () => person.typed }),
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
    expect(check.out).toContain('1 stacks checked: every file the receipts name is as written');
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

describe('a session and the doctor are told what is adopted', () => {
  const OPENING_LINE = 'Stacks adopted for this project (1): hello-stack 1.0.0 (public).';

  it('opens a session with the stacks adopted, and the file a person commits without them', async () => {
    const hook = await mnema(['brief', '--hook']);
    expect(hook.failed, hook.err).toBe(false);
    expect(hook.out).toContain(OPENING_LINE);
    expect(hook.out).not.toContain('part ways');
    const file = await mnema(['brief']);
    expect(file.out).not.toContain('Stacks adopted');
  });

  it('counts the places the files and the record part, in the opening and in the doctor', async () => {
    rmSync(join(project, '.claude/agents/greeter.md'));
    const hook = await mnema(['brief', '--hook']);
    expect(hook.out).toContain(
      'The files and the record part ways in 1 place; `mnema stack check` lists them.',
    );
    const doctor = await mnema(['doctor']);
    expect(doctor.out).toContain(
      'to do · stack: hello-stack (public): .claude/agents/greeter.md is gone',
    );
    const check = await mnema(['stack', 'check']);
    expect(check.failed).toBe(true);
    expect(check.out).toContain('hello-stack (public): .claude/agents/greeter.md is gone');
  });

  it('says in the doctor that every file is as written, where it is', async () => {
    const doctor = await mnema(['doctor']);
    expect(doctor.out).toContain(
      'ok · stack: 1 stack is adopted for this project, and every file the receipts name is as written and the record agrees; files they do not name are not looked at: nothing to do.',
    );
  });
});

describe('turning a hook on and off', () => {
  const enable = ['stack', 'enable', 'hello-stack', 'format', '--from'];

  it('refuses with no person at a terminal, before reading the source', async () => {
    const none = await mnema([...enable, '/nowhere']);
    expect(none.failed).toBe(true);
    expect(none.err).toContain('STACK_HOOK_NEEDS_A_PERSON');
  });

  it('refuses when a way to ask is there and no person is: the right answer is not enough', async () => {
    const piped = await mnema([...enable, hooked], { typed: 'format', here: false });
    expect(piped.failed).toBe(true);
    expect(piped.err).toContain('STACK_HOOK_NEEDS_A_PERSON');
    expect(existsSync(join(project, '.mnema/private/stack-hooks'))).toBe(false);
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

  it('refuses a hook name that holds a control byte, so the question never carries one', async () => {
    const receipt = join(project, '.mnema/stacks/hello-stack.json');
    const real = JSON.parse(readFileSync(receipt, 'utf8'));
    const forged = '\u001b[31mEVIL';
    real.hooks[0].name = forged;
    writeFileSync(receipt, JSON.stringify(real));
    const heard = await mnema(['stack', 'enable', 'hello-stack', forged, '--from', hooked], {
      typed: forged,
    });
    expect(heard.err).toContain('STACK_RECEIPT_REFUSED');
    expect(`${heard.out}${heard.err}`).not.toContain('\u001b');
  });
});

describe('installing and removing, in process', () => {
  it('writes nothing without the digest, and refuses two places or a source that is not there', async () => {
    const unconfirmed = await mnema(['stack', 'add', HELLO, '--to', join(sandbox, 'elsewhere')]);
    expect(unconfirmed.failed).toBe(true);
    expect(unconfirmed.err).toContain('STACK_UNCONFIRMED');
    expect(existsSync(join(sandbox, 'elsewhere'))).toBe(false);
    const two = await mnema(['stack', 'add', HELLO, '--scope', 'public', '--to', project]);
    expect(two.err).toContain('--scope and --to name two places');
    const nowhere = await mnema(['stack', 'add', join(sandbox, 'nowhere')]);
    expect(nowhere.failed).toBe(true);
    const wrong = await mnema(['stack', 'add', hooked, '--expect', 'a'.repeat(64)]);
    expect(wrong.failed).toBe(true);
  });

  it('removes a stack, keeps the file changed since, and says so on a dry run first', async () => {
    writeFileSync(join(project, '.claude/agents/greeter.md'), 'mine\n');
    const dry = await mnema(['stack', 'remove', 'hello-stack', '--dry-run']);
    expect(dry.out).toContain('Would remove hello-stack 1.0.0');
    expect(dry.out).toContain('kept, changed since it was written: .claude/agents/greeter.md');
    expect(dry.out).toContain('Dry run: nothing was removed.');
    expect(dry.out).toContain(WHO_MAY_REMOVE);
    expect(existsSync(join(project, '.mnema/stacks/hello-stack.json'))).toBe(true);
    const done = await mnema(['stack', 'remove', 'hello-stack']);
    expect(done.failed, done.err).toBe(false);
    expect(done.out).toContain('The removal is recorded.');
    expect(done.out).toContain(WHO_MAY_REMOVE);
    const help = await mnema(['stack', 'remove', '--help']);
    expect(help.out.replace(/\s+/g, ' ')).toContain(WHO_MAY_REMOVE);
    expect(readFileSync(join(project, '.claude/agents/greeter.md'), 'utf8')).toBe('mine\n');
    const gone = await mnema(['stack', 'remove', 'hello-stack']);
    expect(gone.failed).toBe(true);
  });
});
