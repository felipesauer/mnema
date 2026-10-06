/**
 * The real repository and the real `mnema`: `git` and the binary of the `@mnema/code` this
 * package depends on, run as child processes in the checked-out repository.
 *
 * `git` is asked to list and show; `mnema` is asked to verify and to say which rules address a
 * path, and those read: they keep a projection cache under `.mnema/locks/`, which the record's
 * own `.gitignore` leaves out. The one command that writes is `mnema check run`, asked only when
 * the workflow hands a checker key: it appends the results to the working tree, and nothing here
 * commits or pushes them.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { World } from './judge.js';

/** Largest output read from one child process. */
const MOST_OUTPUT = 256 * 1024 * 1024;

/** The `mnema` binary of the installed `@mnema/code`, resolved the way `node` would. */
export function theMnemaBinary(): string {
  const entry = createRequire(import.meta.url).resolve('@mnema/code');
  return join(dirname(entry), 'cli.js');
}

/**
 * The environment a check's program is started with: this process's, without one input of the
 * Action. The runner hands every input as an `INPUT_*` variable, and two of them are secrets — the
 * checker key and the GitHub token — which a declared program would otherwise be handed as it
 * starts. It can still read the key file from disk while the run lasts; this narrows what it is
 * handed, not what it can reach.
 */
export function withoutTheInputs(
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(env).filter(([name]) => !name.toUpperCase().startsWith('INPUT_')),
  );
}

const git = (cwd: string, args: readonly string[]): string =>
  execFileSync('git', [...args], { cwd, encoding: 'utf-8', maxBuffer: MOST_OUTPUT });

/**
 * The git and mnema of the repository checked out at `cwd`. `env` is the environment the Action
 * was started with, inputs included — what a check's program must not be handed.
 */
export function worldAt(
  cwd: string,
  github: World['github'],
  log: World['log'],
  env: Readonly<Record<string, string | undefined>> = process.env,
): World {
  const binary = theMnemaBinary();
  const mnema = (args: readonly string[]) =>
    spawnSync(process.execPath, [binary, ...args], {
      cwd,
      encoding: 'utf-8',
      maxBuffer: MOST_OUTPUT,
    });
  return {
    github,
    log,
    git: {
      hasCommit(sha) {
        try {
          git(cwd, ['cat-file', '-e', `${sha}^{commit}`]);
          return true;
        } catch {
          return false;
        }
      },
      recordAt(ref) {
        const files = git(cwd, ['ls-tree', '-r', '--name-only', '-z', ref, '--', '.mnema/tails'])
          .split('\0')
          .filter((path) => path.endsWith('.jsonl') && !path.endsWith('/checkpoints.jsonl'));
        return files.map((path) => git(cwd, ['show', `${ref}:${path}`]));
      },
    },
    mnema: {
      verify() {
        const ran = mnema(['verify', '--require=signed']);
        if (ran.error !== undefined) return { passed: false, said: ran.error.message };
        return { passed: ran.status === 0, said: `${ran.stdout}${ran.stderr}` };
      },
      checkRun(key) {
        // The key is written to a file of its own, readable by this user only, for the length
        // of the run, and removed after it whatever happened.
        // On one line, base and all: the guard that follows every sandbox to its removal reads a
        // making by its line (`every-sandbox-is-removed-where-it-was-made.test.ts`).
        const runnerTemp = env.RUNNER_TEMP ?? process.env.RUNNER_TEMP;
        const dir = mkdtempSync(join(runnerTemp ?? tmpdir(), 'mnema-checker-'));
        try {
          const file = join(dir, 'checker.key');
          writeFileSync(file, `${key}\n`, { mode: 0o600 });
          const ran = spawnSync(process.execPath, [binary, 'check', 'run', '--key', file], {
            cwd,
            encoding: 'utf-8',
            maxBuffer: MOST_OUTPUT,
            env: withoutTheInputs({ ...process.env, ...env }),
          });
          if (ran.error !== undefined) return { passed: false, said: ran.error.message };
          return { passed: ran.status === 0, said: `${ran.stdout}${ran.stderr}` };
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      },
      rules(path) {
        const ran = mnema(['rules', '--json', '--', path]);
        if (ran.error !== undefined || ran.status !== 0) {
          throw new Error(
            `reading the rules for ${path} failed: ${ran.error?.message ?? ran.stderr.trim()}`,
          );
        }
        return JSON.parse(ran.stdout) as unknown;
      },
    },
  };
}
