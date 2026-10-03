/**
 * The real repository and the real `mnema`: `git` and the binary of the `@mnema/code` this
 * package depends on, run as child processes in the checked-out repository.
 *
 * Every command here reads. `git` is asked to list and show; `mnema` is asked to verify and to
 * say which rules address a path. The commands it runs keep a projection cache under
 * `.mnema/locks/`, which the record's own `.gitignore` leaves out, and neither signs, appends
 * nor pushes anything.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { World } from './judge.js';

/** Largest output read from one child process. */
const MOST_OUTPUT = 256 * 1024 * 1024;

/** The `mnema` binary of the installed `@mnema/code`, resolved the way `node` would. */
export function theMnemaBinary(): string {
  const entry = createRequire(import.meta.url).resolve('@mnema/code');
  return join(dirname(entry), 'cli.js');
}

const git = (cwd: string, args: readonly string[]): string =>
  execFileSync('git', [...args], { cwd, encoding: 'utf-8', maxBuffer: MOST_OUTPUT });

/** The git and mnema of the repository checked out at `cwd`. */
export function worldAt(cwd: string, github: World['github'], log: World['log']): World {
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
