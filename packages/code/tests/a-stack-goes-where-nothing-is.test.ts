/**
 * A STACK GOES WHERE NOTHING IS — held on the built binary, the layer a person runs.
 *
 * `commands/stack-install.test.ts` holds every refusal at the function; this file holds that the
 * verb shows the plan whole, writes nothing without the digest the plan showed, refuses a link in
 * the way through the same door, keeps a file the person changed when it removes, and leaves a
 * record `mnema verify` passes.
 */

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
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

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-stack-verb-'));
  home = join(sandbox, 'home');
  project = join(sandbox, 'project');
  mkdirSync(home);
  mkdirSync(project);
  expect(mnema('init').status).toBe(0);
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

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

const digestOf = (plan: string): string => /digest {3}([0-9a-f]{64})/.exec(plan)?.[1] ?? '';

describe('mnema stack, on the built binary', () => {
  it('shows the plan whole and writes nothing on a dry run, nor without --expect', () => {
    const dry = mnema('stack', 'add', HELLO, '--dry-run');
    expect(dry.status).toBe(0);
    expect(dry.out).toContain('.claude/skills/hello/SKILL.md');
    expect(dry.out).toContain('No agent is written for: Codex, Factory Droid');
    expect(dry.out).toContain('Hooks: none.');
    expect(digestOf(dry.out)).toMatch(/^[0-9a-f]{64}$/);
    const unconfirmed = mnema('stack', 'add', HELLO);
    expect(unconfirmed.status).not.toBe(0);
    expect(unconfirmed.err).toContain(`--expect ${digestOf(dry.out)}`);
    expect(existsSync(join(project, '.claude'))).toBe(false);
  });

  it('writes with the digest it showed, records it, and the record verifies', () => {
    const digest = digestOf(mnema('stack', 'add', HELLO, '--dry-run').out);
    const added = mnema('stack', 'add', HELLO, '--expect', digest);
    expect(added.status).toBe(0);
    expect(added.out).toContain('The adoption is recorded in the public tree.');
    expect(readFileSync(join(project, '.claude/skills/hello/SKILL.md'))).toEqual(
      readFileSync(join(HELLO, 'skills/hello/SKILL.md')),
    );
    expect(mnema('verify').status).toBe(0);
  });

  it('refuses a link in the way, and writes nothing through it', () => {
    mkdirSync(join(sandbox, 'elsewhere'));
    symlinkSync(join(sandbox, 'elsewhere'), join(project, '.claude'));
    const digest = digestOf(mnema('stack', 'add', HELLO, '--dry-run', '--to', 'x').out);
    const added = mnema('stack', 'add', HELLO, '--expect', digest);
    expect(added.status).not.toBe(0);
    expect(added.err).toContain('STACK_DESTINATION_TAKEN');
    expect(added.err).toContain('.claude is a symbolic link');
    expect(readdirSync(join(sandbox, 'elsewhere'))).toEqual([]);
    expect(existsSync(join(project, '.factory'))).toBe(false);
  });

  it('removes what is as it was written, and keeps a file the person changed', () => {
    const digest = digestOf(mnema('stack', 'add', HELLO, '--dry-run').out);
    expect(mnema('stack', 'add', HELLO, '--expect', digest).status).toBe(0);
    writeFileSync(join(project, '.claude/agents/greeter.md'), 'my own greeter\n');
    const removed = mnema('stack', 'remove', 'hello-stack');
    expect(removed.status).toBe(0);
    expect(removed.out).toContain('kept, changed since it was written: .claude/agents/greeter.md');
    expect(readFileSync(join(project, '.claude/agents/greeter.md'), 'utf8')).toBe(
      'my own greeter\n',
    );
    expect(existsSync(join(project, '.claude/skills/hello'))).toBe(false);
    expect(mnema('verify').status).toBe(0);
  });

  it('refuses a receipt planted under another name, and records nothing on its word', () => {
    const digest = digestOf(mnema('stack', 'add', HELLO, '--dry-run').out);
    expect(mnema('stack', 'add', HELLO, '--expect', digest).status).toBe(0);
    const stacks = join(project, '.mnema', 'stacks');
    writeFileSync(join(stacks, 'ghost.json'), readFileSync(join(stacks, 'hello-stack.json')));
    const ghost = mnema('stack', 'remove', 'ghost');
    expect(ghost.status).toBe(1);
    expect(ghost.err).toContain('STACK_RECEIPT_REFUSED');
    expect(ghost.out).not.toContain('Removed');
    const real = JSON.parse(readFileSync(join(stacks, 'hello-stack.json'), 'utf8'));
    writeFileSync(
      join(stacks, 'ghost.json'),
      JSON.stringify({ ...real, installedAs: 'ghost', files: [null] }),
    );
    const broken = mnema('stack', 'remove', 'ghost');
    expect(broken.status).toBe(1);
    expect(broken.err).toContain('STACK_RECEIPT_REFUSED');
    expect(mnema('stack', 'remove', 'hello-stack').status).toBe(0);
    expect(mnema('verify').status).toBe(0);
  });
});
