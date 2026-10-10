/**
 * THE CONSOLE READS THE STACKS AND TURNS NO HOOK ON — held on the built binary, at a real
 * pseudo-terminal.
 *
 * The console is the surface a person reaches by typing `mnema` and it only reads the record: a verb
 * that can change it is refused there and named for the shell. The stack verbs ride that rule and
 * nothing else — the readers (`list`, `show`, `diff`, `check`, `index`) run, and `add`, `remove`,
 * `export`, `enable` and `disable` are refused — so a person in the console sees what is adopted,
 * the hooks a stack declares with their state, and the index, and is sent to the shell for any act.
 *
 * The case that matters is the hook. A pseudo-terminal IS a terminal, so the console is the one
 * place `stack enable` would find a "person" to ask; it must be refused before it asks, and no script
 * may be kept. Putting `enable` among the readers is the defect that makes this red.
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
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { THE_FLOOR } from '../src/repl/floor.js';
import { GIT_WITHOUT_MAINTENANCE } from './support/git-without-maintenance.js';
import { arrivedUnpainted, inPty, leavesTheSession, opensAConsole } from './support/pty.js';

const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const HELLO = fileURLToPath(new URL('../../stacks/fixtures/hello-stack', import.meta.url));
const INDEX = fileURLToPath(new URL('../../../stack-index', import.meta.url));
const PROMPT = 'mnema>';
const COLUMNS = 140;

let sandbox: string;
let home: string;
let project: string;
let hooked: string;

const environment = (): NodeJS.ProcessEnv => ({
  PATH: process.env.PATH ?? '',
  HOME: home,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: GIT_WITHOUT_MAINTENANCE,
});

/** One invocation of the binary at a shell with no terminal. */
function mnema(...argv: string[]) {
  const ran = spawnSync(process.execPath, [CLI, ...argv], {
    cwd: project,
    encoding: 'utf-8',
    env: environment(),
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
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-console-stacks-'));
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
    { name: 'format', event: 'after-edit', file: 'hooks/format.sh', description: 'Formats.' },
  ];
  manifest.brings.hooks = ['format'];
  writeFileSync(join(hooked, 'stack.json'), JSON.stringify(manifest, null, 2));
  expect(mnema('init').status).toBe(0);
  const plan = mnema('stack', 'add', hooked, '--dry-run').out;
  const digest = /digest {3}([0-9a-f]{64})/.exec(plan)?.[1] ?? '';
  expect(mnema('stack', 'add', hooked, '--expect', digest).status).toBe(0);
});

afterEach(() => rmSync(sandbox, { recursive: true, force: true }));

/** Types `lines` into the console, each waiting for `waits` to arrive, then leaves. */
async function typed(lines: readonly (readonly [string, string])[]) {
  return await inPty(
    { cli: CLI, verb: 'repl', project, scratch: sandbox, environment: environment() },
    {
      columns: COLUMNS,
      rows: THE_FLOOR.rows,
      steps: [
        opensAConsole(PROMPT),
        ...lines.map(([line, waits]) => ({
          types: `${line}\r`,
          until: arrivedUnpainted(waits),
          what: `answered ${line}`,
        })),
        leavesTheSession,
      ],
    },
  );
}

describe('the console, over a project that adopted a stack with a hook', () => {
  it('shows what is adopted, the hook as declared and off, and the index', async () => {
    const ran = await typed([
      ['stack list', '1 hooks declared, 0 on'],
      ['stack show hello-stack', 'format  on after-edit  off'],
      ['stack check', 'stacks checked: every file the receipts name is as written'],
      [`stack index ${INDEX}`, 'Being listed does not make a stack safe'],
    ]);
    expect(ran.bytes).toContain('hello-stack@1.0.0');
    expect(ran.bytes).toContain('evidence-first 1.0.0');
  }, 120_000);

  it('refuses every act on a stack and names the shell for it, though a terminal is there to ask', async () => {
    const ran = await typed([
      [`stack enable hello-stack format --from ${hooked}`, 'can change the record'],
      ['stack add somewhere', 'can change the record'],
      ['stack remove hello-stack', 'can change the record'],
    ]);
    const page = ran.bytes;
    expect(page).toContain('`stack enable` can change the record');
    expect(page).toContain('mnema stack enable');
    expect(page).not.toContain("Type the hook's name");
    // Nothing was kept as approved, and the stack is still installed and its hook still off.
    expect(find(sandbox, 'format.sh').filter((p) => !p.startsWith(hooked))).toEqual([]);
    expect(mnema('stack', 'show', 'hello-stack').out).toContain('format  on after-edit  off');
    expect(mnema('stack', 'list').out).toContain('hello-stack@1.0.0');
  }, 120_000);
});
