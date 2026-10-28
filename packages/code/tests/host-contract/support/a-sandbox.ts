/**
 * THE SANDBOX A HOST SESSION STANDS IN: a `HOME` of its own, a project that is a git repository
 * with a mnema record in it, and a `mnema` shim that runs this tree's build.
 *
 * Whoever makes the sandbox removes it, here: {@link TheSandbox.remove}. The project is written
 * through the product's own verbs, in the sandbox's home, so nothing of the machine's (not its
 * key, not its global tree) is read or written.
 */

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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
  /**
   * From now on the shim keeps, byte for byte, what a host's hook handler hands the verbs that
   * read a hook's payload (`before-a-write`, `after-a-write` and `settled`) on stdin, and then runs the verb on it.
   * Read it back with {@link thePayloadsKept}.
   */
  keepThePayloads(): void;
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

/**
 * Files a case puts in the project after its record is written, by path from the project's root.
 * A file that is already there (`mnema init` writes `AGENTS.md`) keeps what it holds and gets the
 * text after a blank line, as a person adding a rule to a file the project already had; any other
 * is created whole.
 */
export type TheFilesToPut = Readonly<Record<string, string>>;

/** Puts the files a case asked for in `project`. */
function putTheFiles(project: string, files: TheFilesToPut): void {
  for (const [relative, text] of Object.entries(files)) {
    const target = join(project, relative);
    mkdirSync(dirname(target), { recursive: true });
    if (existsSync(target)) {
      writeFileSync(target, `${readFileSync(target, 'utf-8').trimEnd()}\n\n${text}`);
    } else {
      writeFileSync(target, text);
    }
  }
}

/** Makes a sandbox and writes the record, and then the files, the case stands on. */
export function aSandbox(
  prefix: string,
  write?: (project: TheProjectToWrite) => void,
  files?: TheFilesToPut,
): TheSandbox {
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
  const keeping = join(root, 'keep-the-payloads');
  const kept = join(root, 'payloads');
  mkdirSync(kept, { recursive: true });
  writeFileSync(
    join(bin, 'mnema'),
    [
      '#!/bin/sh',
      `printf '%s\\n' "$*" >> "${log}"`,
      `if [ "$1" = mcp ] && [ -e "${measuring}" ]; then exec "${process.execPath}" "${A_SERVER_THAT_SAYS}" "${join(root, 'what-the-server-was-handed.json')}"; fi`,
      // The verbs that read a hook's payload on stdin: keep it, then run the verb on the same bytes.
      `if [ -e "${keeping}" ] && { [ "$1" = before-a-write ] || [ "$1" = after-a-write ] || [ "$1" = settled ]; }; then f="${kept}/$$.$1.json"; cat > "$f"; exec "${process.execPath}" "${CLI}" "$@" < "$f"; fi`,
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
    write?.({
      dir: project,
      mnema,
      measureTheServer: () => writeFileSync(measuring, ''),
      keepThePayloads: () => writeFileSync(keeping, ''),
    });
    if (files !== undefined) putTheFiles(project, files);
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
  /** The value of `MNEMA_AGENT_KEY` and of `MNEMA_HOME` where the server had them; nothing else. */
  readonly declared: Readonly<Record<string, string>>;
}

/** Reads what the measuring server wrote for the session of `project`; throws where it wrote nothing. */
export function theServerWasHanded(project: string): WhatTheServerWasHanded {
  const file = join(dirname(project), 'what-the-server-was-handed.json');
  if (!existsSync(file)) {
    throw new Error('the server that was to measure it wrote no report');
  }
  return JSON.parse(readFileSync(file, 'utf-8')) as WhatTheServerWasHanded;
}

/** One payload a host's hook handler handed a verb of the product, as the host wrote it. */
export interface ThePayloadKept {
  /** The verb it was handed to: `before-a-write`, `after-a-write` or `settled`. */
  readonly verb: string;
  /** The JSON the host wrote on stdin. */
  readonly payload: Readonly<Record<string, unknown>>;
}

/** The payloads kept for the session of `project`, in the order the shim ran them; see {@link TheProjectToWrite.keepThePayloads}. */
export function thePayloadsKept(project: string): readonly ThePayloadKept[] {
  const dir = join(dirname(project), 'payloads');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10))
    .map((name) => ({
      verb: name.split('.')[1] ?? '',
      payload: JSON.parse(readFileSync(join(dir, name), 'utf-8')) as Record<string, unknown>,
    }));
}
