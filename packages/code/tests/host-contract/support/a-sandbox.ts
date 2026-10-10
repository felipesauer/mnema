/**
 * THE SANDBOX A HOST SESSION STANDS IN: a `HOME` of its own, a project that is a git repository
 * with a mnema record in it, and a `mnema` shim that runs this tree's build.
 *
 * Whoever makes the sandbox removes it, here: {@link TheSandbox.remove}. The project is written
 * through the product's own verbs, in the sandbox's home, so nothing of the machine's — not its
 * key, not its global tree — is read or written.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GIT_WITHOUT_MAINTENANCE } from '../../support/git-without-maintenance.js';

/** The root of this working tree. */
export const REPO = fileURLToPath(new URL('../../../../../', import.meta.url));
const CLI = join(REPO, 'packages', 'code', 'dist', 'cli.js');

/** The plugin of this tree, as a host loads it from its directory. */
export const PLUGIN = join(REPO, 'plugin');

/** The stand-in that is started where a host asks for `mnema mcp`, and writes down what it was handed. */
const A_SERVER_THAT_SAYS = fileURLToPath(
  new URL('./a-server-that-says-what-it-was-handed.mjs', import.meta.url),
);

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
  /**
   * From now on the shim, asked for `mnema mcp`, starts a server that serves nothing and writes
   * down what the host handed it, in place of the product's. Read it back with
   * {@link theServerWasHanded}. Every other verb still runs the build.
   */
  measureTheServer(): void;
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
  /** Every command line the host ran the shim with, one to a line, in order. */
  calls(): string[];
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
  // The shim runs this tree's build, so the host starts the product the suite just built, and
  // it writes down each command line it was run with, so a case can say which door ran.
  const log = join(root, 'calls.log');
  const measuring = join(root, 'measure-the-server');
  writeFileSync(
    join(bin, 'mnema'),
    [
      '#!/bin/sh',
      `printf '%s\\n' "$*" >> "${log}"`,
      `if [ "$1" = mcp ] && [ -e "${measuring}" ]; then exec "${process.execPath}" "${A_SERVER_THAT_SAYS}" "${join(root, 'what-the-server-was-handed.json')}"; fi`,
      `exec "${process.execPath}" "${CLI}" "$@"`,
      '',
    ].join('\n'),
    { mode: 0o755 },
  );
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
    calls: () => (existsSync(log) ? readFileSync(log, 'utf-8').split('\n').filter(Boolean) : []),
    mnema,
    remove: () => rmSync(root, { recursive: true, force: true }),
  };
  try {
    execFileSync('git', ['init', '-q', '-b', 'main'], {
      cwd: project,
      env: sandboxEnv(home, base),
    });
    mnema('init');
    write?.({ dir: project, mnema, measureTheServer: () => writeFileSync(measuring, '') });
  } catch (error) {
    sandbox.remove();
    throw error;
  }
  return sandbox;
}

/** What a server started in place of `mnema mcp` was handed: see {@link TheProjectToWrite.measureTheServer}. */
export interface WhatTheServerWasHanded {
  /** The name the client announced in its handshake. */
  readonly client: string | undefined;
  /** The base names of the executables from the server up to the root, nearest first. */
  readonly chain: readonly string[];
  /** Which of a closed list of variables were present in its environment, by name; never a value. */
  readonly present: readonly string[];
}

/** Reads what the measuring server wrote for the session of `project`; throws where it wrote nothing. */
export function theServerWasHanded(project: string): WhatTheServerWasHanded {
  const file = join(dirname(project), 'what-the-server-was-handed.json');
  if (!existsSync(file)) {
    throw new Error('the host never started the server that was to measure it');
  }
  return JSON.parse(readFileSync(file, 'utf-8')) as WhatTheServerWasHanded;
}
