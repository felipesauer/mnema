/**
 * What the gate does when `mnema` cannot answer, written once for every door that runs it as a
 * process: the hooks of Cursor, Codex, VS Code and Copilot CLI (`hand-over.mjs`), Gemini CLI's script
 * and OpenCode's plugin (their copies are made from this file by the host-file generator, so there
 * is one reading).
 *
 * THE NODE. `mnema` starts through `#!/usr/bin/env node`, so it runs on the first `node` of the PATH
 * the host gives the hook, and a host may put one of its own there: Cursor's command-line agent puts
 * the Node it embeds (24.5.0 on 2026.09.18) in front. {@link settleTheRuntime} asks the first `node`
 * what it is and, below the floor, goes on to the one beside `mnema`, then every other `node` of the
 * PATH, within a budget that keeps the whole gate inside the host's 15 seconds; the first that takes
 * `mnema` is put in front of the PATH of every run. Where none does, `refusal` says why.
 *
 * THE REFUSAL. A write is refused for a `mnema` that could not answer only where a rule that
 * refuses it or asks for a person at it addresses that path (`where-the-record-is.mjs`); any other
 * path, and any machine with no `mnema` at all, is let through.
 */

import { spawnSync } from 'node:child_process';
import { accessSync, constants, realpathSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';

/**
 * The Node versions `mnema` takes, as `engines.node` of `@mnema/code` says them. A copy, because the
 * plugin runs with no build and cannot import the product's reader (`packages/code/src/node-floor.ts`);
 * `the-hooks-run-mnema-on-a-node-it-takes.test.ts` holds it to the manifest and to that reader over
 * a table of versions, so a floor raised there turns this red.
 */
export const NODE_RANGE = '^24.15.0 || >=26.0.0';

/** The versions as the page says them, for a reason a person reads. */
const NODE_SAID = '24.15.0 or a later 24, or 26 or later';

/**
 * How long the whole search for a node may take, and how long one `node` is given to say its version:
 * a `node` that hangs on `-p` must not use up the host's 15 seconds, which the run of `mnema` that
 * follows (10 seconds at most) needs the rest of.
 */
export const SEARCH_BUDGET = 3000;
const PROBE = 1000;

/** @typedef {{ readonly env: Readonly<Record<string, string | undefined>>, readonly refusal: string | null }} Runtime */

/**
 * Whether a Node of this version is one `mnema` takes: each `||` alternative of {@link NODE_RANGE}
 * is `^x.y.z` (that major from there) or `>=x.y.z`.
 *
 * @param {string} version
 * @returns {boolean}
 */
export function nodeIsTaken(version) {
  const have = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version.trim())?.slice(1).map(Number);
  if (have === undefined) return false;
  const reaches = (/** @type {number[]} */ from) => {
    for (let at = 0; at < 3; at += 1) {
      if ((have[at] ?? 0) !== (from[at] ?? 0)) return (have[at] ?? 0) > (from[at] ?? 0);
    }
    return true;
  };
  return NODE_RANGE.split('||').some((alternative) => {
    const said = /^\s*(\^|>=)\s*(\d+)\.(\d+)\.(\d+)\s*$/.exec(alternative);
    if (said === null) return false;
    const from = [Number(said[2]), Number(said[3]), Number(said[4])];
    return reaches(from) && (said[1] === '>=' || have[0] === from[0]);
  });
}

/** The file name of a Node on this platform. */
const NODE_NAME = process.platform === 'win32' ? 'node.exe' : 'node';

/**
 * Where a program is, on `env`'s PATH or by its own path, or `null`.
 *
 * @param {string} name A bare name (searched on the PATH) or a path.
 * @param {Readonly<Record<string, string | undefined>>} env
 * @returns {string | null}
 */
export function whereIs(name, env) {
  const executable = (/** @type {string} */ path) => {
    try {
      accessSync(path, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  };
  if (name.includes('/') || name.includes('\\')) return executable(name) ? name : null;
  for (const dir of (env.PATH ?? '').split(delimiter)) {
    if (dir !== '' && executable(join(dir, name))) return join(dir, name);
  }
  return null;
}

/**
 * The version a Node says it is, or `null` where it did not say one in `timeout` milliseconds.
 *
 * @param {string} node
 * @param {Readonly<Record<string, string | undefined>>} env
 * @param {number} timeout
 * @returns {string | null}
 */
function versionOf(node, env, timeout) {
  const ran = spawnSync(node, ['-p', 'process.versions.node'], {
    env,
    encoding: 'utf-8',
    timeout,
    // A node that ignores SIGTERM must not outlive its probe: the gate's answer waits on it.
    killSignal: 'SIGKILL',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const said = (ran.stdout ?? '').trim();
  return ran.error === undefined && ran.status === 0 && /^\d+\.\d+\.\d+/.test(said) ? said : null;
}

/** @param {string} path */
function realOf(path) {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/**
 * WHICH NODE `mnema` RUNS ON, and what to say where none takes it.
 *
 * The first `node` is asked what it is (not asked at all where it is the one running this file,
 * which already answers). Below the floor the search goes on: the `node` beside the `mnema` that was
 * found, which is the one that installed it, then every other `node` of the PATH, in order, while
 * the {@link SEARCH_BUDGET} lasts. The first that takes `mnema` is put in front of the PATH.
 *
 * NO `mnema` AT ALL IS NOT A REFUSAL: nothing is checked where there is no program to run, which is
 * the plugin installed on a machine without the product.
 *
 * @param {string} binary What is run: a bare name or a path.
 * @param {Readonly<Record<string, string | undefined>>} env
 * @returns {Runtime}
 */
export function settleTheRuntime(binary, env) {
  const asIs = { env, refusal: null };
  const mnema = whereIs(binary, env);
  if (mnema === null) return asIs;
  const deadline = Date.now() + SEARCH_BUDGET;
  const probe = () => Math.min(PROBE, Math.max(1, deadline - Date.now()));
  const first = whereIs(NODE_NAME, env);
  const firstVersion =
    first === null
      ? null
      : realOf(first) === realOf(process.execPath)
        ? process.versions.node
        : versionOf(first, env, probe());
  if (firstVersion !== null && nodeIsTaken(firstVersion)) return asIs;
  const candidates = [
    join(dirname(mnema), NODE_NAME),
    ...(env.PATH ?? '').split(delimiter).map((dir) => join(dir, NODE_NAME)),
  ];
  const tried = new Set(first === null ? [] : [first]);
  for (const candidate of candidates) {
    if (Date.now() >= deadline) break;
    if (tried.has(candidate) || whereIs(candidate, env) === null) continue;
    tried.add(candidate);
    const version = versionOf(candidate, env, probe());
    if (version !== null && nodeIsTaken(version)) {
      const path = `${dirname(candidate)}${delimiter}${env.PATH ?? ''}`;
      return { env: { ...env, PATH: path }, refusal: null };
    }
  }
  const found =
    first === null
      ? 'there is no node on the PATH the host gives its hooks'
      : `the first node on the PATH the host gives its hooks is ${firstVersion ?? 'one that did not say its version'} (${first})`;
  return {
    env,
    refusal:
      `mnema needs Node ${NODE_SAID}, and ${found}; no other node on that PATH takes it. ` +
      'Install one with your Node manager (for example `nvm install 24`) and put it first on the PATH the host ' +
      "gives its hooks; for a host that carries a Node of its own (Cursor's command-line agent), start the host " +
      'from a shell where it comes first. `mnema doctor` in a terminal says which node it runs on there.',
  };
}

/** The characters a word of a command line may hold and need no quoting for a shell. */
const SAFE_IN_A_SHELL = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_.:@=,+/-';

/**
 * What `cmd.exe` cannot be handed as part of one quoted word: a `"` ends the quoting, `%` expands a
 * variable even inside it, `^` and a line break are read by the shell before the program is.
 * There is no escape for them that holds in every case, so a word that has one is not run.
 */
const NOT_QUOTABLE = /["%^\r\n]/;

/** The `code` of the error a start carries when a word could not be quoted for `cmd.exe`. */
export const NOT_QUOTABLE_CODE = 'EMNEMA_NOT_QUOTABLE';

/**
 * How to start `program` with `args`: on Windows as one command line for a shell, each word quoted
 * where it needs it, because Node refuses to start the `.cmd` npm writes any other way (`EINVAL`)
 * and warns of arguments handed to a shell as a list; elsewhere as they are. A word `cmd.exe`
 * cannot be given safely (`"`, `%`, `^`, a line break) makes the target `refused`, and nothing is run.
 *
 * @param {string} program
 * @param {readonly string[]} args
 * @param {NodeJS.Platform} [platform]
 * @returns {{ readonly command: string, readonly args: readonly string[], readonly shell: boolean, readonly refused: boolean }}
 */
export function spawnTarget(program, args, platform = process.platform) {
  if (platform !== 'win32') return { command: program, args, shell: false, refused: false };
  if ([program, ...args].some((text) => NOT_QUOTABLE.test(text)))
    return { command: program, args, shell: false, refused: true };
  const word = (/** @type {string} */ text) =>
    [...text].every((char) => SAFE_IN_A_SHELL.includes(char)) ? text : '"' + text + '"';
  return {
    command: ['"' + program + '"', ...args.map(word)].join(' '),
    args: [],
    shell: true,
    refused: false,
  };
}

/**
 * The run that stands for a start refused by {@link spawnTarget}: it did not happen, and its
 * `error.code` is {@link NOT_QUOTABLE_CODE}, which {@link whyItDidNotAnswer} says in words.
 *
 * @returns {import('node:child_process').SpawnSyncReturns<string>}
 */
export function notStarted() {
  const error = Object.assign(
    new Error('a word of the command line cannot be quoted for cmd.exe'),
    { code: NOT_QUOTABLE_CODE },
  );
  return {
    status: null,
    signal: null,
    output: [null, '', ''],
    pid: 0,
    stdout: '',
    stderr: '',
    error,
  };
}

/**
 * The sentence a refusal carries when `mnema` was there and did not answer, with what to do.
 *
 * @param {string} because Why it did not answer, in words.
 * @returns {string}
 */
export function couldNotAnswer(because) {
  return (
    `mnema could not answer for this write: ${because}. A rule of this project's record addresses this path, ` +
    'and a gate that cannot read the record does not let a write through. Run `mnema doctor` in a terminal ' +
    'to see what stops it; once mnema answers again, the record decides this write.'
  );
}

/** How much of what `mnema` said on its second stream is quoted back in a reason. */
const QUOTED = 120;

/**
 * Whether `text` is a reply a host reads: `{}`, or an object that carries `hookSpecificOutput`
 * (the shape of every host the plugin's hooks serve) or a `decision` (Gemini CLI's own).
 *
 * @param {string} text
 * @returns {boolean}
 */
export function isAReply(text) {
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return false;
    return (
      Object.keys(parsed).length === 0 ||
      (typeof parsed.hookSpecificOutput === 'object' && parsed.hookSpecificOutput !== null) ||
      typeof parsed.decision === 'string'
    );
  } catch {
    return false;
  }
}

/**
 * Why one run of the gate's verb is not an answer, in words: `undefined` where it answered, `null`
 * where there is no program to run (a machine with the plugin and without the product is not made
 * worse by the plugin), and a reason where the program was there and did not answer: it could not
 * start, it did not finish in `timeout` milliseconds, it exited non-zero, or what it printed is not
 * a reply a host reads.
 *
 * @param {import('node:child_process').SpawnSyncReturns<string>} ran
 * @param {number} timeout
 * @returns {string | null | undefined}
 */
export function whyItDidNotAnswer(ran, timeout) {
  const code = /** @type {NodeJS.ErrnoException | undefined} */ (ran.error)?.code;
  if (code === 'ENOENT') return null;
  if (code === NOT_QUOTABLE_CODE)
    return 'the path of mnema, or an argument, holds a ", a % or a ^, which cmd.exe cannot be given safely; set mnema_path to a path without them';
  if (code === 'ETIMEDOUT') return `it did not answer in ${timeout / 1000} seconds`;
  // A closed input is not a failure: a `mnema` that refuses an option at its arguments exits before it
  // reads the payload, and what it said is read as it would be had the write gone through.
  if (code !== undefined && code !== 'EPIPE') return `it could not be started (${code})`;
  if (ran.status !== 0) {
    const said = (ran.stderr ?? '').trim().split('\n')[0] ?? '';
    return `it exited ${ran.status ?? ran.signal}${said === '' ? '' : `: ${said.slice(0, QUOTED)}`}`;
  }
  return isAReply(ran.stdout ?? '') ? undefined : 'what it printed is not a reply a host reads';
}
