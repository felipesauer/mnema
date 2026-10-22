/**
 * `mnema workspace` AND THE WORKBENCH, THROUGH THE BINARY. What a person at a terminal reads: init
 * says what it made and never shows git the link, the second run says nothing changed, `status`
 * prints names and counts and never what a note says, and `doctor` says when `git clean -x` took the
 * link and `--fix workbench` brings it back with the notes untouched.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GIT_WITHOUT_MAINTENANCE } from './support/git-without-maintenance.js';

const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

let sandbox: string;
let repo: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-workbench-'));
  repo = join(sandbox, 'repo');
  mkdirSync(repo, { recursive: true });
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function mnema(...argv: string[]) {
  const ran = spawnSync(process.execPath, [CLI, ...argv], {
    cwd: repo,
    encoding: 'utf-8',
    env: { PATH: process.env.PATH ?? '', HOME: join(sandbox, 'home') },
  });
  return { status: ran.status, out: ran.stdout, err: ran.stderr };
}

function git(...args: string[]): string {
  const ran = spawnSync(
    'git',
    [
      '-c',
      'user.name=t',
      '-c',
      'user.email=t@example.invalid',
      '-c',
      'commit.gpgsign=false',
      ...args,
    ],
    {
      cwd: repo,
      encoding: 'utf-8',
      env: {
        PATH: process.env.PATH ?? '',
        HOME: join(sandbox, 'git-home'),
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: GIT_WITHOUT_MAINTENANCE,
      },
    },
  );
  return ran.stdout;
}

describe('mnema workspace, through the binary', () => {
  it('refuses before a founding, then makes the workbench without ever showing git the link', () => {
    git('init', '-q', '-b', 'main');
    const refused = mnema('workspace', 'init');
    expect(refused.status).not.toBe(0);
    expect(refused.err + refused.out).toContain('mnema init');
    expect(existsSync(join(repo, '.mnema'))).toBe(false);

    expect(mnema('init').status).toBe(0);
    const made = mnema('workspace', 'init');
    expect(made.status).toBe(0);
    expect(made.out).toContain('not proof');
    expect(made.out).toContain('.mnema/workbench/local ->');

    const shown = git('status', '--porcelain', '-uall');
    expect(shown).toContain('.mnema/workbench/shared/.gitkeep');
    expect(shown).toContain('.mnema/workbench/README.md');
    expect(shown).not.toContain('workbench/local');

    const again = mnema('workspace', 'init');
    expect(again.status).toBe(0);
    expect(again.out.trim()).toBe('The workbench is already here: nothing changed.');
  });

  it('prints names and counts in status, never what a note says', () => {
    git('init', '-q', '-b', 'main');
    mnema('init');
    expect(mnema('workspace', 'status').out).toContain('No workbench here');
    mnema('workspace', 'init');
    const folder = join(repo, '.mnema', 'workbench', 'local', 'changes', '2026-10-22-first');
    mkdirSync(folder, { recursive: true });
    writeFileSync(
      join(folder, 'change.md'),
      '---\nstatus: open\nclaimed_by: SECRET-CLAIMANT\n---\n# SECRET-TITLE\nSECRET-BODY\n',
    );

    const said = mnema('workspace', 'status');
    expect(said.status).toBe(0);
    expect(said.out).toContain('open · local/changes/2026-10-22-first');
    expect(said.out).toContain('1 file');
    expect(said.out + said.err).not.toContain('SECRET');
  });

  it('after git clean -x, doctor names the missing link and --fix workbench makes it, keeping the notes', () => {
    git('init', '-q', '-b', 'main');
    mnema('init');
    mnema('workspace', 'init');
    git('add', '-A', '.mnema');
    git('commit', '-qm', 'record');
    const note = join(repo, '.mnema', 'workbench', 'local', 'studies', 'n.md');
    writeFileSync(note, 'kept\n');

    git('clean', '-xfdq');
    expect(existsSync(join(repo, '.mnema', 'workbench', 'local'))).toBe(false);
    const said = mnema('doctor')
      .out.split('\n')
      .find((line) => line.includes('workbench:'));
    expect(said).toMatch(
      /^to do · workbench: .*missing.*git clean -x.*mnema doctor --fix workbench/,
    );

    const fixed = mnema('doctor', '--fix', 'workbench');
    expect(fixed.status).toBe(0);
    expect(fixed.out).toContain('now points to');
    expect(existsSync(note)).toBe(true);
    expect(mnema('doctor').out).toContain('ok · workbench:');
  });
});
