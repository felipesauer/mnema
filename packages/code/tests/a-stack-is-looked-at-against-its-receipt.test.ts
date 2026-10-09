/**
 * A STACK IS LOOKED AT AGAINST ITS RECEIPT — held on the built binary.
 *
 * `list`, `show`, `diff` and `check` say whether the files an installation wrote are still the
 * ones written and whether the record still stands on the same digest; `export` copies the skills
 * and agents back out. The receipt of the public tree is committed, so every case that matters is
 * a receipt somebody edited: a digest the record never adopted, a path that climbs out of the
 * folders a host reads, a receipt filed under another name.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

function mnema(...argv: string[]) {
  const ran = spawnSync(process.execPath, [CLI, ...argv], {
    cwd: project,
    encoding: 'utf-8',
    env: {
      PATH: process.env.PATH ?? '',
      HOME: home,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: GIT_WITHOUT_MAINTENANCE,
    },
  });
  return { status: ran.status, out: ran.stdout, err: ran.stderr };
}

const receiptPath = () => join(project, '.mnema', 'stacks', 'hello-stack.json');
const readReceipt = () => JSON.parse(readFileSync(receiptPath(), 'utf8'));

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-stack-look-'));
  home = join(sandbox, 'home');
  project = join(sandbox, 'project');
  mkdirSync(home);
  mkdirSync(project);
  expect(mnema('init').status).toBe(0);
  const plan = mnema('stack', 'add', HELLO, '--dry-run').out;
  const digest = /digest {3}([0-9a-f]{64})/.exec(plan)?.[1] ?? '';
  expect(mnema('stack', 'add', HELLO, '--expect', digest).status).toBe(0);
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe('mnema stack list, show, diff and check, on the built binary', () => {
  it('say a fresh installation is sound, and where every file is', () => {
    const list = mnema('stack', 'list');
    expect(list.status).toBe(0);
    expect(list.out).toMatch(/^hello-stack@1\.0\.0 \([0-9a-f]{12}\) {2}public {2}5 files/);
    expect(list.out).toContain('sound');
    const show = mnema('stack', 'show', 'hello-stack');
    expect(show.out).toContain('record    the record adopted this digest');
    expect(show.out).toContain('.claude/agents/greeter.md  as written');
    const check = mnema('stack', 'check');
    expect(check.status).toBe(0);
    expect(check.out).toContain('1 stacks checked: every file is as written');
  });

  it('name a changed file and a gone one, and fail', () => {
    writeFileSync(join(project, '.claude/agents/greeter.md'), 'my own greeter\n');
    rmSync(join(project, '.claude/skills/hello/SKILL.md'));
    const diff = mnema('stack', 'diff', 'hello-stack');
    expect(diff.status).toBe(1);
    expect(diff.out).toContain('~ .claude/agents/greeter.md  changed');
    expect(diff.out).toContain('- .claude/skills/hello/SKILL.md  gone');
    const check = mnema('stack', 'check');
    expect(check.status).toBe(1);
    expect(check.out).toContain('hello-stack (public): .claude/agents/greeter.md is changed');
    expect(check.out).toContain('2 departures');
    expect(mnema('stack', 'list').out).toContain('DEPARTS');
  });

  it('refuse a receipt whose digest the record never adopted, in diff and in check', () => {
    writeFileSync(receiptPath(), JSON.stringify({ ...readReceipt(), digest: 'a'.repeat(64) }));
    const diff = mnema('stack', 'diff', 'hello-stack');
    expect(diff.status).toBe(1);
    expect(diff.out).toContain("not the receipt's digest");
    const check = mnema('stack', 'check');
    expect(check.status).toBe(1);
    expect(check.out).toContain("not the receipt's digest");
  });

  it('refuse a receipt that names a path outside the folders a host reads, without opening it', () => {
    const outside = join(sandbox, 'secret.txt');
    writeFileSync(outside, 'not for a receipt\n');
    const real = readReceipt();
    writeFileSync(
      receiptPath(),
      JSON.stringify({
        ...real,
        files: [...real.files, { path: '../../secret.txt', sha256: 'b'.repeat(64) }],
      }),
    );
    for (const argv of [
      ['stack', 'diff', 'hello-stack'],
      ['stack', 'check'],
      ['stack', 'export', 'hello-stack', join(sandbox, 'out')],
    ]) {
      const ran = mnema(...argv);
      expect(ran.status).toBe(1);
      expect(ran.out + ran.err).toContain('outside the folders a host reads');
    }
    expect(existsSync(join(sandbox, 'out'))).toBe(false);
  });

  it('refuse a receipt filed under another name, and a receipt that is not JSON', () => {
    writeFileSync(join(project, '.mnema/stacks/ghost.json'), readFileSync(receiptPath()));
    writeFileSync(join(project, '.mnema/stacks/broken.json'), '{ not json');
    const check = mnema('stack', 'check');
    expect(check.status).toBe(1);
    expect(check.out).toContain('ghost (public): receipt refused: it says it is of "hello-stack"');
    expect(check.out).toContain('broken (public): receipt refused: it is not JSON');
    expect(mnema('stack', 'show', 'ghost').out).toContain('The receipt is refused');
  });

  it('say a record that adopted a stack no receipt answers for', () => {
    rmSync(receiptPath());
    const check = mnema('stack', 'check');
    expect(check.status).toBe(1);
    expect(check.out).toContain(
      'hello-stack (public): the record adopted it and no receipt is here',
    );
  });
});

describe('mnema stack export, on the built binary', () => {
  it('copies the skills and agents once each, and says it is not the stack', () => {
    const out = join(sandbox, 'out');
    const exported = mnema('stack', 'export', 'hello-stack', out);
    expect(exported.status).toBe(0);
    expect(readFileSync(join(out, 'skills/hello/SKILL.md'))).toEqual(
      readFileSync(join(HELLO, 'skills/hello/SKILL.md')),
    );
    expect(readFileSync(join(out, 'agents/greeter.md'))).toEqual(
      readFileSync(join(HELLO, 'agents/greeter.md')),
    );
    expect(existsSync(join(out, 'stack.json'))).toBe(false);
    expect(exported.out).toContain('this folder is not the stack');
  });

  it('skips a file changed since, and writes nothing into a folder that is taken', () => {
    writeFileSync(join(project, '.claude/agents/greeter.md'), 'my own greeter\n');
    const out = join(sandbox, 'out');
    const exported = mnema('stack', 'export', 'hello-stack', out);
    expect(exported.out).toContain(
      'skipped, changed since it was written: .claude/agents/greeter.md',
    );
    expect(existsSync(join(out, 'agents/greeter.md'))).toBe(false);
    const taken = mnema('stack', 'export', 'hello-stack', out);
    expect(taken.status).toBe(1);
    expect(taken.err).toContain('STACK_DESTINATION_TAKEN');
  });
});
