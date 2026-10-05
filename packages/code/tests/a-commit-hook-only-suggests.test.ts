/**
 * The optional `prepare-commit-msg` hook suggests the `Mnema-Decision:` trailer, and costs a
 * commit nothing when it is not wanted.
 *
 * WHAT IS HELD:
 *   - it is installed by `commit-hook install` and by nothing else (`init` does not), into the
 *     directory git reads hooks from — `core.hooksPath` when it is set — and `uninstall` takes
 *     it out;
 *   - a hook that is not its own, however it came to be there, is never overwritten or removed,
 *     and the refusal names the path;
 *   - a commit made with the hook installed does not fail with the binary absent, nor with one
 *     that fails, and its message is the one it would have been without the hook;
 *   - in an editor-bound commit the staged files' governing decision is suggested as a `# `
 *     line git drops, and an unrelated file draws nothing; a commit with `-m` is untouched;
 *   - removing the `# ` in front of the suggestion makes it the trailer `mnema commits` reads.
 *
 * The hook runs through the BUILT binary (`dist/cli.js`), the way a commit meets it.
 */

import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type CliIo, run } from '../src/cli.js';
import {
  HOOK_SCRIPT,
  installCommitHook,
  suggestTrailer,
  uninstallCommitHook,
} from '../src/commands/commit-hook.js';
import { discoveryEnv } from '../src/env.js';
import { GIT_WITHOUT_MAINTENANCE } from './support/git-without-maintenance.js';

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'cli.js');

let sandbox: string;
let repo: string;
let originalCwd: string;
let originalXdg: string | undefined;
let originalHome: string | undefined;

/** `mnema <argv>` in process; the text of its output, and whether it failed. */
async function mnema(...argv: string[]): Promise<{ text: string; err: string; failed: boolean }> {
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
  return { text: out.join('\n'), err: err.join('\n'), failed };
}

/** The environment git (and the hook it runs) gets: the sandbox's, with `path` as PATH. */
function envWith(path: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    PATH: path,
    HOME: join(sandbox, 'home'),
    XDG_DATA_HOME: join(sandbox, 'data'),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: GIT_WITHOUT_MAINTENANCE,
    GIT_AUTHOR_NAME: 'a',
    GIT_AUTHOR_EMAIL: 'a@example.com',
    GIT_COMMITTER_NAME: 'a',
    GIT_COMMITTER_EMAIL: 'a@example.com',
    ...extra,
  };
}

/** `git <args>` in the sandbox repository. */
function git(args: string[], env: Record<string, string> = envWith(process.env.PATH ?? '')) {
  return spawnSync('git', args, {
    cwd: repo,
    encoding: 'utf-8',
    env: { ...env, GIT_CONFIG_GLOBAL: GIT_WITHOUT_MAINTENANCE },
  });
}

/** A directory of programs: `mnema` as the script `body` (when given), and `git` itself. */
function bin(name: string, body?: string): string {
  const dir = join(sandbox, name);
  mkdirSync(dir, { recursive: true });
  const gitPath = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf-8' }).stdout.trim();
  symlinkSync(gitPath, join(dir, 'git'));
  if (body !== undefined) {
    writeFileSync(join(dir, 'mnema'), `#!/bin/sh\n${body}\n`);
    chmodSync(join(dir, 'mnema'), 0o755);
  }
  return dir;
}

/** The editor: keeps what it was opened on in `seen`, then types the subject (and `edit`). */
function editor(edit = ''): { command: string; seen: string } {
  const seen = join(sandbox, 'seen.txt');
  const command = join(sandbox, 'editor.sh');
  writeFileSync(
    command,
    `#!/bin/sh\nPATH="${process.env.PATH}"\ncp "$1" "${seen}"\n${edit}\n{ printf 'subject\\n\\n'; cat "$1"; } > "$1.new" && mv "$1.new" "$1"\n`,
  );
  chmodSync(command, 0o755);
  return { command, seen };
}

/** Stages `file` and commits in the editor; returns what git said and what the editor saw. */
function commitInEditor(
  file: string,
  edit = '',
  path = bin('real-bin', `exec "${process.execPath}" "${CLI}" "$@"`),
) {
  mkdirSync(dirname(join(repo, file)), { recursive: true });
  writeFileSync(join(repo, file), `${Math.random()}`);
  git(['add', file]);
  const { command, seen } = editor(edit);
  const ran = git(['commit', '-q'], envWith(path, { GIT_EDITOR: command }));
  return { ran, seen: existsSync(seen) ? readFileSync(seen, 'utf-8') : '' };
}

/** The message of HEAD. */
function message(): string {
  return git(['log', '-1', '--format=%B']).stdout.trim();
}

beforeEach(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-commit-hook-'));
  repo = join(sandbox, 'repo');
  mkdirSync(repo, { recursive: true });
  mkdirSync(join(sandbox, 'home'), { recursive: true });
  originalCwd = process.cwd();
  originalXdg = process.env.XDG_DATA_HOME;
  originalHome = process.env.HOME;
  process.env.XDG_DATA_HOME = join(sandbox, 'data');
  process.env.HOME = join(sandbox, 'home');
  delete process.env.MNEMA_RUN;
  process.chdir(repo);
  git(['init', '-q', '-b', 'main']);
});

afterEach(() => {
  delete process.env.MNEMA_RUN;
  process.chdir(originalCwd);
  if (originalXdg === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = originalXdg;
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(sandbox, { recursive: true, force: true });
});

/** A project whose accepted decision ADR-1 governs `src`. */
async function aGovernedProject(): Promise<void> {
  await mnema('init');
  const recorded = await mnema('decision', 'record', 'keep the parser small', 'because');
  const id = recorded.text.match(/Recorded decision \S+ \(([^)]+)\)/)?.[1] ?? '';
  await mnema('decision', 'move', 'accept', id, '--note', 'agreed');
  await mnema('link', id, 'src', '--rel', 'governs');
}

const HOOK = (): string => join(repo, '.git', 'hooks', 'prepare-commit-msg');

describe('installing and removing the hook', () => {
  it('is written by the verb, executable, and taken out by the same verb', () => {
    const ctx = { cwd: repo };
    expect(existsSync(HOOK())).toBe(false);
    expect(installCommitHook(ctx)).toEqual({ ok: true, path: HOOK(), state: 'installed' });
    expect(readFileSync(HOOK(), 'utf-8')).toBe(HOOK_SCRIPT);
    expect(statSync(HOOK()).mode & 0o111).not.toBe(0);
    expect(installCommitHook(ctx)).toEqual({ ok: true, path: HOOK(), state: 'already' });
    expect(uninstallCommitHook(ctx)).toEqual({ ok: true, path: HOOK(), state: 'removed' });
    expect(existsSync(HOOK())).toBe(false);
    expect(uninstallCommitHook(ctx)).toEqual({ ok: true, path: HOOK(), state: 'absent' });
  });

  it('says, on the command line, where it put the hook and where it took it from', async () => {
    const put = await mnema('commit-hook', 'install');
    expect(put.failed, put.err).toBe(false);
    expect(put.text.trim()).toBe(`Installed the prepare-commit-msg hook: ${HOOK()}`);
    const took = await mnema('commit-hook', 'uninstall');
    expect(took.failed, took.err).toBe(false);
    expect(took.text.trim()).toBe(`Removed the prepare-commit-msg hook: ${HOOK()}`);
    expect(existsSync(HOOK())).toBe(false);
  });

  it('is not written by init', async () => {
    await mnema('init');
    expect(existsSync(HOOK())).toBe(false);
  });

  it('goes where core.hooksPath says, relative or absolute', () => {
    git(['config', 'core.hooksPath', '.githooks']);
    expect(installCommitHook({ cwd: repo })).toMatchObject({
      state: 'installed',
      path: join(repo, '.githooks', 'prepare-commit-msg'),
    });
    expect(existsSync(HOOK())).toBe(false);
    const elsewhere = join(sandbox, 'shared-hooks');
    git(['config', 'core.hooksPath', elsewhere]);
    expect(installCommitHook({ cwd: repo })).toMatchObject({
      state: 'installed',
      path: join(elsewhere, 'prepare-commit-msg'),
    });
  });

  it('refuses outside a repository', () => {
    const outside = mkdtempSync(join(tmpdir(), 'mnema-no-repo-'));
    try {
      expect(installCommitHook({ cwd: outside })).toEqual({
        ok: false,
        reason: 'NOT_A_REPOSITORY',
      });
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('never overwrites or removes a hook that is not its own, and names its path', async () => {
    mkdirSync(dirname(HOOK()), { recursive: true });
    const theirs = '#!/bin/sh\necho theirs\n';
    writeFileSync(HOOK(), theirs);
    expect(installCommitHook({ cwd: repo })).toEqual({
      ok: false,
      reason: 'FOREIGN_HOOK',
      path: HOOK(),
    });
    expect(uninstallCommitHook({ cwd: repo })).toEqual({
      ok: false,
      reason: 'FOREIGN_HOOK',
      path: HOOK(),
    });
    expect(readFileSync(HOOK(), 'utf-8')).toBe(theirs);

    const said = await mnema('commit-hook', 'install');
    expect(said.failed).toBe(true);
    expect(said.err).toContain(HOOK());
    expect(readFileSync(HOOK(), 'utf-8')).toBe(theirs);
  });

  it('leaves a copy of its own that somebody edited', () => {
    installCommitHook({ cwd: repo });
    const edited = `${HOOK_SCRIPT}echo mine\n`;
    writeFileSync(HOOK(), edited);
    expect(uninstallCommitHook({ cwd: repo })).toMatchObject({ reason: 'FOREIGN_HOOK' });
    expect(readFileSync(HOOK(), 'utf-8')).toBe(edited);
  });
});

describe('a commit with the hook installed', () => {
  it('does not fail with mnema absent from the PATH, and its message is its own', () => {
    installCommitHook({ cwd: repo });
    const { ran, seen } = commitInEditor('src/a.ts', '', bin('no-mnema'));
    expect(ran.status, ran.stderr).toBe(0);
    expect(seen).not.toContain('Mnema-Decision');
    expect(message()).toBe('subject');
  });

  it('does not fail with a mnema that fails', () => {
    installCommitHook({ cwd: repo });
    const { ran } = commitInEditor('src/a.ts', '', bin('broken-mnema', 'echo boom >&2; exit 70'));
    expect(ran.status, ran.stderr).toBe(0);
    expect(message()).toBe('subject');
  });

  it('suggests, as a line git drops, the decision that governs the staged file', async () => {
    await aGovernedProject();
    installCommitHook({ cwd: repo });
    const { ran, seen } = commitInEditor('src/billing/invoice.ts');
    expect(ran.status, ran.stderr).toBe(0);
    expect(seen).toContain('# ADR-1 "keep the parser small" governs 1 staged file:');
    expect(seen).toContain('# Mnema-Decision: ADR-1');
    expect(message()).toBe('subject');
  });

  it('suggests nothing for a file no decision governs', async () => {
    await aGovernedProject();
    installCommitHook({ cwd: repo });
    const { ran, seen } = commitInEditor('docs/readme.md');
    expect(ran.status, ran.stderr).toBe(0);
    expect(seen).not.toContain('Mnema-Decision');
  });

  it('is untouched when the message came from -m', async () => {
    await aGovernedProject();
    installCommitHook({ cwd: repo });
    mkdirSync(join(repo, 'src'), { recursive: true });
    writeFileSync(join(repo, 'src', 'b.ts'), 'x');
    git(['add', 'src/b.ts']);
    const ran = git(
      ['commit', '-q', '-m', 'plain'],
      envWith(bin('real-bin', `exec "${process.execPath}" "${CLI}" "$@"`)),
    );
    expect(ran.status, ran.stderr).toBe(0);
    expect(git(['log', '-1', '--format=%B']).stdout).toBe('plain\n\n');
  });

  it('becomes the trailer mnema commits reads once the "# " is removed', async () => {
    await aGovernedProject();
    installCommitHook({ cwd: repo });
    const accept = `sed 's/^# Mnema-Decision:/Mnema-Decision:/' "$1" > "$1.x" && mv "$1.x" "$1"`;
    const { ran } = commitInEditor('src/billing/invoice.ts', accept);
    expect(ran.status, ran.stderr).toBe(0);
    expect(message()).toContain('Mnema-Decision: ADR-1');
    const read = await mnema('commits', 'ADR-1');
    expect(read.text).toContain('subject');
  });
});

describe('the suggestion itself', () => {
  it('writes nothing when commit.cleanup keeps comments, and nothing when the file is gone', async () => {
    await aGovernedProject();
    mkdirSync(join(repo, 'src'), { recursive: true });
    writeFileSync(join(repo, 'src', 'c.ts'), 'x');
    git(['add', 'src/c.ts']);
    const file = join(sandbox, 'MSG');
    writeFileSync(file, '\n');
    const ctx = { cwd: repo, env: discoveryEnv() };
    git(['config', 'commit.cleanup', 'whitespace']);
    expect(suggestTrailer(ctx, { messageFile: file, source: '' })).toBe(false);
    expect(readFileSync(file, 'utf-8')).toBe('\n');
    git(['config', '--unset', 'commit.cleanup']);
    expect(suggestTrailer(ctx, { messageFile: join(sandbox, 'missing'), source: '' })).toBe(false);
    expect(suggestTrailer(ctx, { messageFile: file, source: 'message' })).toBe(false);
    expect(suggestTrailer(ctx, { messageFile: file, source: '' })).toBe(true);
    expect(readFileSync(file, 'utf-8')).toContain('# Mnema-Decision: ADR-1');
  });
});
