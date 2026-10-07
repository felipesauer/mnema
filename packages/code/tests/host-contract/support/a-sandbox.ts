/**
 * THE SANDBOX A HOST SESSION STANDS IN: a `HOME` of its own, a project that is a git repository
 * with a mnema record in it, and a `mnema` shim that runs this tree's build.
 *
 * Whoever makes the sandbox removes it, here: {@link TheSandbox.remove}. The project is written
 * through the product's own verbs, in the sandbox's home, so nothing of the machine's — not its
 * key, not its global tree — is read or written.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GIT_WITHOUT_MAINTENANCE } from '../../support/git-without-maintenance.js';

/** The root of this working tree. */
export const REPO = fileURLToPath(new URL('../../../../../', import.meta.url));
const CLI = join(REPO, 'packages', 'code', 'dist', 'cli.js');

/** The plugin of this tree, as a host loads it from its directory. */
export const PLUGIN = join(REPO, 'plugin');

/** The environment a process of the sandbox runs in: its own home, nothing of the machine's. */
export function sandboxEnv(home: string, path: string): NodeJS.ProcessEnv {
  return {
    HOME: home,
    PATH: path,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: GIT_WITHOUT_MAINTENANCE,
    GIT_AUTHOR_NAME: 'Contract',
    GIT_AUTHOR_EMAIL: 'contract@example.invalid',
    GIT_COMMITTER_NAME: 'Contract',
    GIT_COMMITTER_EMAIL: 'contract@example.invalid',
    LANG: 'C.UTF-8',
  };
}

/** What a case is handed to write its record with. */
export interface TheProjectToWrite {
  readonly dir: string;
  mnema(...args: string[]): string;
}

/** A sandbox, ready for a host. */
export interface TheSandbox {
  /** The directory the whole sandbox is under. */
  readonly root: string;
  /** The `HOME` of every process in it. */
  readonly home: string;
  /** The project: a git repository with a mnema record. */
  readonly project: string;
  /** A directory holding the `mnema` shim. */
  readonly bin: string;
  /** The PATH of a process that has node, git and the shell, and no `mnema`. */
  readonly base: string;
  /** `mnema <args>` in the project, as the sandbox's own user. */
  mnema(...args: string[]): string;
  /** Removes it all. */
  remove(): void;
}

/** Makes a sandbox and writes the record the case stands on. */
export function aSandbox(prefix: string, write?: (project: TheProjectToWrite) => void): TheSandbox {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const home = join(root, 'home');
  const project = join(root, 'project');
  const bin = join(root, 'bin');
  for (const dir of [home, project, bin]) mkdirSync(dir, { recursive: true });
  const base = `${dirname(process.execPath)}:/usr/bin:/bin`;
  // The shim runs this tree's build, so the host starts the product the suite just built.
  writeFileSync(join(bin, 'mnema'), `#!/bin/sh\nexec "${process.execPath}" "${CLI}" "$@"\n`, {
    mode: 0o755,
  });
  const mnema = (...args: string[]): string =>
    execFileSync(process.execPath, [CLI, ...args], {
      cwd: project,
      env: sandboxEnv(home, `${bin}:${base}`),
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  const sandbox: TheSandbox = {
    root,
    home,
    project,
    bin,
    base,
    mnema,
    remove: () => rmSync(root, { recursive: true, force: true }),
  };
  try {
    execFileSync('git', ['init', '-q', '-b', 'main'], {
      cwd: project,
      env: sandboxEnv(home, base),
    });
    mnema('init');
    write?.({ dir: project, mnema });
  } catch (error) {
    sandbox.remove();
    throw error;
  }
  return sandbox;
}
