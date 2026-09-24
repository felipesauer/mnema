/**
 * A HOME OF ITS OWN — no process of this suite resolves the home of the machine it runs on.
 *
 * WHY IT EXISTS. A test process that sees the machine's own home reaches the machine's own data:
 * the key root and the global tree live in `~/.mnema` unless `MNEMA_HOME` puts them elsewhere, so
 * such a process signs with the machine's key and appends to the machine's global tree. On a
 * runner that is a stray directory nobody reads; on a workstation it is somebody's real record.
 * Nothing in a test's own lines shows it — a case that isolates the directory it cares about and
 * forgets `HOME` stays green while it writes.
 *
 * WHAT IT DOES, per test process (every test file runs in a process of its own):
 *
 *   1. `HOME` becomes a directory made here, under the machine's temp, and removed after the file.
 *      `MNEMA_HOME` is REMOVED rather than pointed there: the variable wins over `HOME` — that is
 *      what it is for — so a value set here would outrank the `HOME` of every child a case starts
 *      in a sandbox of its own, and the two machines a case starts as two homes would share one
 *      key. Removed, the value of whoever runs the suite reaches no case, and a case that wants the
 *      variable writes it.
 *   2. Every process this one starts is asked, before it starts, what home it will resolve: its
 *      `HOME` when that is an absolute path, and otherwise the account's home from the password
 *      database — what `os.homedir()` answers in a process whose `HOME` is missing or empty, and
 *      what the product falls back to for a relative one. A child that would resolve the machine's
 *      home, or whose `MNEMA_HOME` points into it or is the value this suite was started with, is
 *      started with this process's `HOME` instead and without the variable — so it cannot write
 *      where it was about to — and the case is failed with the line that started it.
 *   3. After each case, this process's own environment is asked the same question.
 *
 * WHY IT DOES NOT LOOK AT `~/.mnema`. A guard that compared the machine's data directory before and
 * after would be a guard about the disk, and the disk is not the suite's: on a workstation that
 * directory is written by the person's own sessions while the suite runs, and one such write would
 * be an accusation against a case that did nothing. What each process WILL resolve depends on its
 * environment alone, so the same answer holds on a runner with no `~/.mnema` and on a machine where
 * one exists.
 *
 * WHAT IT DOES NOT REACH, so nobody has to find it: a case that hands the core a `home` spelled as
 * the machine's by hand — in process, there is no boundary to stand at — and a grandchild that a
 * child starts with an environment built from nothing. `a-home-of-its-own.test.ts` counts both, and
 * both are zero.
 *
 * It is `.mjs` under `.github/` for the reason the reporter beside it is: `tsconfig.rulers.json`
 * type-checks it with the product's own options, which no test file ever is.
 */

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { tmpdir, userInfo } from 'node:os';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, afterEach, expect } from 'vitest';

/** The variable that relocates the key root — the product's own, read by `code/src/env.ts`. */
export const THE_VARIABLE = 'MNEMA_HOME';

/** The seven ways `node:child_process` starts a process. */
const STARTERS = ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'exec', 'execSync', 'fork'];

/** The machine's home, from the password database — the one a process with no `HOME` resolves. */
export const THE_MACHINES_HOME = userInfo().homedir;

const spellings = new Set([resolve(THE_MACHINES_HOME)]);
try {
  spellings.add(realpathSync.native(THE_MACHINES_HOME));
} catch {
  // A machine whose home is not on disk still has that home; it is compared as written.
}

/** The value of the variable this suite was started with — somebody's real key root, if set. */
const STARTED_WITH = process.env[THE_VARIABLE];

/** This process's home, for the one file it runs. */
export const HOME_OF_ITS_OWN = mkdtempSync(join(tmpdir(), 'mnema-home-'));
process.env.HOME = HOME_OF_ITS_OWN;
delete process.env[THE_VARIABLE];

/**
 * Whether `path` is the machine's home — or, with `inside`, a directory under it.
 *
 * @param {string | undefined} path
 * @param {boolean} inside
 * @returns {boolean}
 */
function inTheMachinesHome(path, inside) {
  if (typeof path !== 'string' || path.length === 0 || !isAbsolute(path)) return false;
  const candidates = [resolve(path)];
  try {
    candidates.push(realpathSync.native(path));
  } catch {
    // Not on disk: compared as written.
  }
  return candidates.some((candidate) =>
    [...spellings].some(
      (home) => candidate === home || (inside && candidate.startsWith(home + sep)),
    ),
  );
}

/**
 * What in `env` would reach the machine's own data, in words for the failure — empty when nothing.
 *
 * `startedWith` is a parameter so the case beside this file can ask the question for a value no
 * runner of this suite has set; everything else calls it with the one this suite started with.
 *
 * @param {NodeJS.ProcessEnv} env
 * @param {string | undefined} [startedWith]
 * @returns {string[]}
 */
export function reachesTheMachine(env, startedWith = STARTED_WITH) {
  /** @type {string[]} */
  const reasons = [];
  const home = env.HOME;
  const resolved =
    typeof home === 'string' && home.length > 0 && isAbsolute(home) ? home : THE_MACHINES_HOME;
  if (inTheMachinesHome(resolved, false)) {
    reasons.push(`HOME=${JSON.stringify(home ?? null)} resolves to ${THE_MACHINES_HOME}`);
  }
  const relocated = env[THE_VARIABLE];
  if (inTheMachinesHome(relocated, true)) {
    reasons.push(`${THE_VARIABLE}=${JSON.stringify(relocated)} is inside ${THE_MACHINES_HOME}`);
  } else if (
    relocated !== undefined &&
    relocated.length > 0 &&
    startedWith !== undefined &&
    resolve(relocated) === resolve(startedWith)
  ) {
    reasons.push(
      `${THE_VARIABLE}=${JSON.stringify(relocated)} is the key root this suite was started with`,
    );
  }
  return reasons;
}

/** @type {string[]} */
const caught = [];

/**
 * Every process start this file stood in front of since the last case ended, emptied as it is
 * read. The case that proves this guard catches what it says reads it; the `afterEach` below reads
 * whatever no case took.
 *
 * @returns {string[]}
 */
export function takeCaught() {
  return caught.splice(0);
}

/**
 * The arguments a starter is called with, made safe, and the call recorded when they were not.
 *
 * @param {string} starter
 * @param {unknown[]} args
 * @returns {unknown[]}
 */
function guarded(starter, args) {
  let at = -1;
  for (let i = args.length - 1; i >= 1; i--) {
    const arg = args[i];
    if (arg !== null && typeof arg === 'object' && !Array.isArray(arg)) {
      at = i;
      break;
    }
  }
  const options = at >= 0 ? /** @type {{ env?: NodeJS.ProcessEnv }} */ (args[at]) : undefined;
  const env = options?.env ?? process.env;
  const reasons = reachesTheMachine(env);
  if (reasons.length === 0) return args;

  const line =
    (new Error().stack ?? '')
      .split('\n')
      .find((frame) => /\.test\.ts:\d+/.test(frame))
      ?.trim() ?? 'a line outside any test file';
  caught.push(`${starter}(${String(args[0])}) — ${reasons.join('; ')} — ${line}`);

  /** @type {NodeJS.ProcessEnv} */
  const safe = { ...env, HOME: HOME_OF_ITS_OWN };
  delete safe[THE_VARIABLE];
  const copy = [...args];
  if (at >= 0) copy[at] = { ...options, env: safe };
  else {
    // Where each signature takes its options: after an argument list when there is one, and
    // before any callback.
    const slot = starter !== 'exec' && starter !== 'execSync' && Array.isArray(copy[1]) ? 2 : 1;
    copy.splice(slot, 0, { env: safe });
  }
  return copy;
}

/** @type {Record<string, unknown>} */
const childProcess = createRequire(import.meta.url)('node:child_process');
const WRAPPED = Symbol.for('mnema.a-home-of-its-own');
if (Reflect.get(childProcess, WRAPPED) !== true) {
  Reflect.set(childProcess, WRAPPED, true);
  for (const starter of STARTERS) {
    const original = /** @type {(...args: unknown[]) => unknown} */ (childProcess[starter]);
    /** @param {unknown[]} args */
    const wrapped = (...args) => original.apply(childProcess, guarded(starter, args));
    const custom = Reflect.get(original, promisify.custom);
    if (typeof custom === 'function') {
      Object.defineProperty(wrapped, promisify.custom, {
        /** @param {unknown[]} args */
        value: (...args) => custom.apply(childProcess, guarded(`${starter} (promisified)`, args)),
      });
    }
    childProcess[starter] = wrapped;
  }
  // The named imports a test file holds are bound to the builtin's exports, and this is what makes
  // them read the wrappers; without it only `require` would.
  syncBuiltinESMExports();
}

afterEach(() => {
  const found = takeCaught();
  for (const reason of reachesTheMachine(process.env)) found.push(`this process: ${reason}`);
  if (found.length > 0) {
    expect.fail(
      `A process of this case would reach the machine's own data:\n  ${found.join('\n  ')}`,
    );
  }
});

afterAll(() => {
  rmSync(HOME_OF_ITS_OWN, { recursive: true, force: true });
});
