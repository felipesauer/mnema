/**
 * A HOME OF ITS OWN: no process of this suite resolves the home of the machine it runs on.
 *
 * WHY IT EXISTS. A test process that sees the machine's own home reaches the machine's own data:
 * the key root and the global tree live in `~/.mnema` unless `MNEMA_HOME` puts them elsewhere, so
 * such a process signs with the machine's key and appends to the machine's global tree. On a
 * runner that is a stray directory nobody reads; on a workstation it is somebody's real record.
 * Nothing in a test's own lines shows it: a case that isolates the directory it cares about and
 * forgets `HOME` stays green while it writes.
 *
 * WHAT IT DOES, per test process (every test file runs in a process of its own):
 *
 *   1. `HOME` becomes a path of its own under the machine's temp, removed after the file.
 *      `MNEMA_HOME` is REMOVED rather than pointed there: the variable wins over `HOME` (that is
 *      what it is for), so a value set here would outrank the `HOME` of every child a case starts
 *      in a sandbox of its own, and the two machines a case starts as two homes would share one
 *      key. Removed, the value of whoever runs the suite reaches no case, and a case that wants the
 *      variable writes it.
 *   2. Every process this one starts is asked, before it starts, what home it will resolve: its
 *      `HOME` when that is an absolute path, and otherwise the account's home from the password
 *      database: what `os.homedir()` answers in a process whose `HOME` is missing or empty, and
 *      what the product falls back to for a relative one. A child that would resolve the machine's
 *      home, or whose `MNEMA_HOME` points into it or is the value this suite was started with, is
 *      started with this process's `HOME` instead and without the variable (so it cannot write
 *      where it was about to) and the case is failed with the line that started it.
 *   3. After each case, this process's own environment is asked the same question.
 *
 * WHY IT DOES NOT LOOK AT `~/.mnema`. A guard that compared the machine's data directory before and
 * after would be a guard about the disk, and the disk is not the suite's: on a workstation that
 * directory is written by the person's own sessions while the suite runs, and one such write would
 * be an accusation against a case that did nothing. What each process WILL resolve depends on its
 * environment alone, so the same answer holds on a runner with no `~/.mnema` and on a machine where
 * one exists.
 *
 *   4. The record places OF THE CHECKOUT the suite runs in (its `.mnema/`, and the `mnema/` of its
 *      own git directory) are listed when the file starts and again when it ends, and a file after
 *      which they differ fails. A case that runs a verb with the checkout as its working directory
 *      writes a record there (the committed tree, or the installation id a linked worktree keeps
 *      in its own git directory), and nothing in its own lines shows it: the sandbox it built sits
 *      beside it, empty and removed, while the record it meant not to touch grew. THIS ONE LOOKS AT
 *      THE DISK, which the paragraph below refuses for the machine's home, and the difference is
 *      the place: the checkout belongs to the run, and the machine's home belongs to the person.
 *      The cost is said here: the window is the file, so a person recording in THIS checkout while
 *      the suite runs reddens the file that was running (the message says so), and a leak by one
 *      file is also named by the files that overlapped it. The lock and cache files under `locks/`
 *      are not a record and are not listed. THE SHARED PRIVATE TREE, in the git directory the
 *      worktrees of a clone have in common, is NOT listed, and that is a limit and not an oversight:
 *      the sessions of the person in the main clone write it while the suite runs (measured: the
 *      guard reddened seven files on a run in a worktree for writes that were theirs), so a write
 *      there would be an accusation against a case that did nothing. A case that writes it from a
 *      worktree also leaves that worktree's own installation id, which is listed.
 *
 * WHAT IT DOES NOT REACH, so nobody has to find it: a case that hands the core a `home` spelled as
 * the machine's by hand (in process, there is no boundary to stand at) and a grandchild that a
 * child starts with an environment built from nothing. `a-home-of-its-own.test.ts` counts both, and
 * both are zero.
 *
 * It is `.mjs` under `.github/` for the reason the reporter beside it is: `tsconfig.rulers.json`
 * type-checks it with the product's own options, which no test file ever is.
 */

import { randomUUID } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { tmpdir, userInfo } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, afterEach, expect } from 'vitest';

/** The variable that relocates the key root: the product's own, read by `code/src/env.ts`. */
export const THE_VARIABLE = 'MNEMA_HOME';

/** The seven ways `node:child_process` starts a process. */
const STARTERS = ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'exec', 'execSync', 'fork'];

/** The machine's home, from the password database: the one a process with no `HOME` resolves. */
export const THE_MACHINES_HOME = userInfo().homedir;

const spellings = new Set([resolve(THE_MACHINES_HOME)]);
try {
  spellings.add(realpathSync.native(THE_MACHINES_HOME));
} catch {
  // A machine whose home is not on disk still has that home; it is compared as written.
}

/** The value of the variable this suite was started with: somebody's real key root, if set. */
const STARTED_WITH = process.env[THE_VARIABLE];

/**
 * This process's home, for the one file it runs: a path no other process can have, and NOT
 * created here: it comes into being the first time something writes under it (the product makes
 * `~/.mnema` with a recursive `mkdir`), and it goes when the file is done.
 *
 * Not created, because a file in which no case runs never reaches its `afterAll` (every case
 * skipped, or a `-t` that selects nothing, as the re-run in `.github/why-it-went-red/` does on
 * purpose) and its worker is stopped without passing through `process.on('exit')` either. A home
 * made up front was left behind by exactly those files: one empty `mnema-home-*` in the machine's
 * temp per run of the suite, measured before this changed. A home nothing wrote to is nothing to
 * leave behind.
 */
export const HOME_OF_ITS_OWN = join(tmpdir(), `mnema-home-${process.pid}-${randomUUID()}`);
process.env.HOME = HOME_OF_ITS_OWN;
delete process.env[THE_VARIABLE];
// The agent a shell asked the verbs that write to sign as would change every one of them: a case
// that wants it writes it.
delete process.env.MNEMA_AGENT_KEY;

/**
 * Whether `path` is the machine's home, or, with `inside`, a directory under it.
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
 * What in `env` would reach the machine's own data, in words for the failure: empty when nothing.
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

/**
 * The directory of the checkout this process runs in: the nearest ancestor of its working directory
 * that holds a `.git`, or the working directory itself when none does.
 *
 * @param {string} from
 * @returns {string}
 */
export function checkoutOf(from) {
  for (let at = resolve(from); ; at = dirname(at)) {
    try {
      lstatSync(join(at, '.git'));
      return at;
    } catch {
      // No `.git` here: one level up.
    }
    if (dirname(at) === at) return resolve(from);
  }
}

/**
 * The places a record of the checkout lives, as paths that may not exist yet: `.mnema/` beside the
 * code, and `mnema/` in the git directory of this checkout: the private tree itself in a clone, the
 * installation id of a linked worktree. The common directory a worktree shares with its main clone
 * is left out, and the header says why.
 *
 * @param {string} checkout
 * @returns {string[]}
 */
export function recordPlacesOf(checkout) {
  const places = [join(checkout, '.mnema')];
  const dotGit = join(checkout, '.git');
  try {
    if (lstatSync(dotGit).isDirectory()) {
      places.push(join(dotGit, 'mnema'));
    } else {
      // A linked worktree: `.git` is a file naming its own git directory.
      const named = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, 'utf-8'))?.[1];
      if (named !== undefined) places.push(join(resolve(checkout, named.trim()), 'mnema'));
    }
  } catch {
    // No such directory to look in: `.mnema/` is all there is.
  }
  return places;
}

/**
 * What the places hold, one entry per path: size and modification time, so a file that appeared,
 * one that was written to and one that went all differ. Symlinks are listed, not followed.
 *
 * @param {readonly string[]} places
 * @returns {Map<string, string>}
 */
export function listRecordPlaces(places) {
  /** @type {Map<string, string>} */
  const listed = new Map();
  /** @param {string} at */
  const walk = (at) => {
    let stat;
    try {
      stat = lstatSync(at);
    } catch {
      return; // gone between the listing and the look: nothing to say about it
    }
    listed.set(at, stat.isDirectory() ? 'dir' : `${stat.size} ${stat.mtimeMs}`);
    if (!stat.isDirectory()) return;
    if (basename(at) === 'locks') return; // lock and cache files: not a record
    let names;
    try {
      names = readdirSync(at);
    } catch {
      return;
    }
    for (const name of names) walk(join(at, name));
  };
  for (const place of places) walk(place);
  return listed;
}

/**
 * What differs between two listings, in words: empty when nothing does.
 *
 * @param {Map<string, string>} before
 * @param {Map<string, string>} after
 * @returns {string[]}
 */
export function whatMovedBetween(before, after) {
  /** @type {string[]} */
  const moved = [];
  for (const [path, state] of after) {
    if (!before.has(path)) moved.push(`appeared: ${path}`);
    else if (before.get(path) !== state) moved.push(`written: ${path}`);
  }
  for (const path of before.keys()) if (!after.has(path)) moved.push(`removed: ${path}`);
  return moved;
}

const THE_CHECKOUT = checkoutOf(process.cwd());
const THE_PLACES = recordPlacesOf(THE_CHECKOUT);
const RECORD_BEFORE = listRecordPlaces(THE_PLACES);

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
  caught.push(`${starter}(${String(args[0])}): ${reasons.join('; ')}: ${line}`);

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
  const moved = whatMovedBetween(RECORD_BEFORE, listRecordPlaces(THE_PLACES));
  if (moved.length > 0) {
    expect.fail(
      `The record of the checkout (${THE_CHECKOUT}) changed while this file ran. A case ran with the checkout as its working directory, or a person recorded here meanwhile:\n  ${moved.slice(0, 20).join('\n  ')}`,
    );
  }
});
