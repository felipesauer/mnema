/**
 * What `mnema doctor` says of the tails' merge driver and of the settings a plain `git pull` needs,
 * and `mnema doctor --fix merge-driver`, the one act of this product that writes git's configuration.
 *
 * THE ATTRIBUTE TRAVELS, THE DRIVER DOES NOT. The record's `.gitattributes` names the driver for a
 * tail's files (`merge=mnema-tail`, `ensureTree` in `@mnema/chain`), and git runs it only where its
 * own configuration says what `mnema-tail` is; a committed file cannot say it. A clone without the
 * setting merges a tail file as text, as git merges any file: a branch that grew the same tail then
 * stops on a conflict. The doctor names that, here, where the attribute is in force and the setting
 * is absent (`a-tail-merges-and-pulls.test.ts`, "the doctor").
 *
 * WRITTEN ONLY WHEN A PERSON ASKS (ADR-163, amended by ADR-181). A driver is a command git runs
 * inside every merge, the same class of thing as a hook, and `init` installs no hook either
 * (`commit-hook.ts`). So the record's `.gitattributes` is all `init` writes by itself; the person's
 * answer to `init`'s question, or `--fix merge-driver`, writes FOUR settings into this repository's
 * own configuration (`git config --local`), with `--dry-run` saying them first: the driver's name
 * and the driver, then `merge.autoStash` and `rebase.autoStash`, in that order, and the autoStash
 * ones only while the driver can run here (`whyTheDriverCannotRun`). A plain `git pull` over
 * events not yet committed refuses before any driver runs, and `merge.autoStash` (a merge pull) or
 * `rebase.autoStash` (a rebase pull) is what makes git stash and restore them; the restore goes
 * through the driver, which is the reason neither autoStash is ever written without it: an autoStash
 * alone exits 0 and leaves conflict markers inside signed tails (measured on git 2.55, ADR-181;
 * `a-plain-git-pull-carries-the-record.test.ts`). The autoStash settings apply to EVERY file of the
 * clone, not the record's alone, and the fix says so. A setting of the same name with another value
 * (`merge.autoStash=false` is a person's choice) is left where it is, and then nothing is written.
 * The driver is written first and the autoStash settings after it, so a write that stops half way
 * never leaves an autoStash without the driver.
 *
 * THE DRIVER IS NAMED BY THE PATHS OF THE RUNNING INSTALLATION (`driverCommand`: its node and its
 * script, absolute), written at fix time: a git started by a host that has no `mnema` on its PATH
 * (a GUI-launched editor) still finds it. The cost: an installation that moves (another node
 * version, a reinstalled folder) leaves a driver that cannot start, and with an autoStash on a plain
 * pull then exits 0 with the local events only in the stash. So ONE FUNCTION says whether the
 * configured driver can run here ({@link whyTheDriverCannotRun}: for the absolute form, the node an
 * executable file and the script a file; for the earlier `mnema ...` form, a `mnema` on the PATH git
 * runs with), and the doctor, `mnema status` (through `fork-kept-aside.ts`), `init` and the fix all
 * ask it: the fix rewrites a driver mnema wrote that cannot run, and writes no autoStash while the
 * driver cannot. It does not rewrite one that can. `mnema record pull` needs none of this: it hands
 * the driver to its one pull.
 */

import { spawnSync } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { type DiscoveryEnv, resolveTrees } from '@mnema/core';
import { oneLine } from '../one-line.js';
import { MERGE_DRIVER } from './record-merge-tail.js';

/** What the reading and the fix need. */
export interface MergeDriverContext {
  readonly cwd: string;
  readonly env: DiscoveryEnv;
  readonly processEnv: NodeJS.ProcessEnv;
}

/** The key of the driver's command. */
const DRIVER_KEY = `merge.${MERGE_DRIVER}.driver`;

/** What every driver mnema writes ends in, whichever way it names the program. */
const DRIVER_TAIL = ' record merge-tail %O %A %B %P';

/** The form an earlier mnema wrote: the program found by the PATH. */
const PATH_FORM = `mnema${DRIVER_TAIL}`;

/** The form `driverCommand` writes: two single-quoted absolute paths. */
const QUOTED_FORM = /^'((?:[^']|'\\'')*)' '((?:[^']|'\\'')*)' record merge-tail %O %A %B %P$/;

const unquoted = (word: string): string => word.replaceAll("'\\''", "'");

function isAFile(path: string, executable: boolean): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    if (executable) accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Windows finds a program by the extensions PATHEXT lists, so `mnema.cmd` is the mnema on the PATH. */
const DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD';

function mnemaIsOnThePath(processEnv: NodeJS.ProcessEnv, platform: NodeJS.Platform): boolean {
  const windows = platform === 'win32';
  // A copied environment keeps the case it had: Windows spells the variables `Path` and `PathExt`.
  const read = (name: string): string | undefined =>
    windows
      ? Object.entries(processEnv).find(([key]) => key.toUpperCase() === name)?.[1]
      : processEnv[name];
  const names = windows
    ? (read('PATHEXT') ?? DEFAULT_PATHEXT)
        .split(';')
        .filter((ext) => ext !== '')
        .map((ext) => `mnema${ext.toLowerCase()}`)
    : ['mnema'];
  return (read('PATH') ?? '')
    .split(windows ? ';' : delimiter)
    .some((dir) => dir !== '' && names.some((name) => isAFile(join(dir, name), !windows)));
}

/**
 * Why a driver command mnema wrote cannot run here, or undefined where it can (and where it is not
 * one mnema wrote: a driver of somebody else's is not judged). THE ONE FUNCTION that answers it
 * (`a-plain-git-pull-carries-the-record.test.ts`).
 */
export function whyTheDriverCannotRun(
  processEnv: NodeJS.ProcessEnv,
  value: string,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  const quoted = QUOTED_FORM.exec(value);
  if (quoted !== null) {
    const node = unquoted(quoted[1] as string);
    const script = unquoted(quoted[2] as string);
    if (!isAFile(node, true)) return `${oneLine(node)} is not an executable file`;
    if (!isAFile(script, false)) return `${oneLine(script)} is not a file`;
    return undefined;
  }
  if (value === PATH_FORM) {
    return mnemaIsOnThePath(processEnv, platform)
      ? undefined
      : 'there is no mnema on the PATH git runs with';
  }
  return undefined;
}

/** The two settings that make a pull stash and restore what is not committed. */
const AUTOSTASH_KEYS = ['merge.autoStash', 'rebase.autoStash'] as const;

/** The three settings the fix writes, in the order it writes them. `driver` is the command ({@link driverCommand}). */
export function mergeSettings(driver: string): readonly (readonly [string, string])[] {
  return [
    [`merge.${MERGE_DRIVER}.name`, 'mnema: keep the longer side of a tail that only grows'],
    [DRIVER_KEY, driver],
    ...AUTOSTASH_KEYS.map((key) => [key, 'true'] as const),
  ];
}

/** Whether a driver git holds is one mnema wrote, wherever it finds the program. */
function isOurDriver(value: string): boolean {
  return value === PATH_FORM || QUOTED_FORM.test(value);
}

/** The sentence about the autoStash, said wherever the settings are offered or written. */
export const AUTOSTASH_APPLIES_TO_EVERY_FILE =
  'merge.autoStash and rebase.autoStash apply to every file of this clone, not only the record: a pull stashes and restores any file with changes that is not committed.';

const FIX = '`mnema doctor --fix merge-driver`';

/** One git in `cwd`, or undefined where git is absent or does not answer. */
function gitIn(
  ctx: MergeDriverContext,
  cwd: string,
  args: readonly string[],
): { readonly status: number; readonly out: string } | undefined {
  // Automatic maintenance off, as every git this product starts where a repository may be written.
  const asked = spawnSync('git', ['-c', 'gc.auto=0', '-c', 'maintenance.auto=false', ...args], {
    cwd,
    encoding: 'utf-8',
    timeout: 5_000,
    // The process's own HOME where it has one (git reads the user's configuration from it), and
    // the one this run was handed where it has none, as the doctor's other reads of git do.
    env: {
      ...ctx.processEnv,
      ...(ctx.processEnv.HOME === undefined && ctx.env.home !== undefined
        ? { HOME: ctx.env.home }
        : {}),
      GIT_OPTIONAL_LOCKS: '0',
    },
  });
  if (asked.error !== undefined || asked.status === null) return undefined;
  return { status: asked.status, out: asked.stdout.trim() };
}

/** Where this project's record is in a git repository whose attributes name the driver for its tails. */
function governed(ctx: MergeDriverContext): { readonly top: string } | undefined {
  const record = resolveTrees(ctx.cwd, ctx.env).projectPublic;
  if (record === undefined) return undefined;
  const top = gitIn(ctx, record, ['rev-parse', '--show-toplevel']);
  if (top === undefined || top.status !== 0) return undefined;
  const named = gitIn(ctx, record, ['check-attr', 'merge', '--', 'tails/any/000001.jsonl']);
  if (named === undefined || !named.out.endsWith(`: merge: ${MERGE_DRIVER}`)) return undefined;
  return { top: top.out };
}

/** The value git holds for `key` (an autoStash as `true` or `false`, however it was written), or undefined where it holds none. */
function setting(ctx: MergeDriverContext, top: string, key: string): string | undefined {
  const bool = (AUTOSTASH_KEYS as readonly string[]).includes(key);
  const got = gitIn(ctx, top, ['config', ...(bool ? ['--type=bool'] : []), '--get', key]);
  return got?.status === 0 ? got.out : undefined;
}

/**
 * Why the driver git holds for the tails cannot run here, while an autoStash is on: the state in which
 * a plain pull exits 0 and leaves the local events only in the stash. Undefined in every other state.
 * `mnema status` says it (`fork-kept-aside.ts`) beside the doctor's line, from this one function.
 */
export function theDriverThatCannotRunUnderAnAutoStash(
  ctx: MergeDriverContext,
): string | undefined {
  const here = governed(ctx);
  if (here === undefined) return undefined;
  const driver = setting(ctx, here.top, DRIVER_KEY);
  if (driver === undefined || !isOurDriver(driver)) return undefined;
  if (!AUTOSTASH_KEYS.some((key) => setting(ctx, here.top, key) === 'true')) return undefined;
  return whyTheDriverCannotRun(ctx.processEnv, driver);
}

/** The doctor's line, where the record names the driver and git does not hold all a plain pull takes. */
export function mergeDriverLines(ctx: MergeDriverContext): string[] {
  const here = governed(ctx);
  if (here === undefined) return [];
  const driver = setting(ctx, here.top, DRIVER_KEY);
  const stash = AUTOSTASH_KEYS.map((key) => [key, setting(ctx, here.top, key)] as const);
  const on = stash.filter(([, now]) => now === 'true').map(([key]) => key);
  if (driver === undefined) {
    const without =
      on.length === 0
        ? ''
        : ` ${on.join(' and ')} ${on.length === 1 ? 'is' : 'are'} on without the driver: a pull over events not yet committed then leaves conflict markers inside signed tails.`;
    return [
      `git merges this record's tails as text in ${oneLine(here.top)}, since its configuration does not say what the ${MERGE_DRIVER} driver the record names is: a merge of a branch that grew the same tail stops on a conflict, and a plain \`git pull\` over events not yet committed refuses.${without} \`mnema record pull\` pulls over them without it; ${FIX} writes the driver and its name, merge.autoStash and rebase.autoStash into this repository's git configuration, so that a plain \`git pull\` carries them. ${AUTOSTASH_APPLIES_TO_EVERY_FILE}`,
    ];
  }
  const dead = isOurDriver(driver) ? whyTheDriverCannotRun(ctx.processEnv, driver) : undefined;
  if (dead !== undefined) {
    return [
      `the ${MERGE_DRIVER} driver git holds in ${oneLine(here.top)} cannot run here (${dead}), so a merge of a tail stops on a conflict${on.length > 0 ? `, and with ${on.join(' and ')} on a plain \`git pull\` over events not yet committed puts them aside in git's stash and exits 0` : ''}. ${FIX} writes a driver that runs.`,
    ];
  }
  const chosen = stash.filter(([, now]) => now !== undefined && now !== 'true').map(([key]) => key);
  if (chosen.length > 0) {
    return [
      `${chosen.join(' and ')} ${chosen.length === 1 ? 'is' : 'are'} not on in ${oneLine(here.top)}, so a plain \`git pull\` over events not yet committed refuses; mnema leaves a setting you chose where it is, and \`mnema record pull\` pulls over them.`,
    ];
  }
  const missing = stash.filter(([, now]) => now === undefined).map(([key]) => key);
  if (missing.length === 0) return [];
  return [
    `${missing.join(' and ')} ${missing.length === 1 ? 'is' : 'are'} not set in ${oneLine(here.top)}, so a plain \`git pull\` over events not yet committed refuses before the merge driver runs (a rebase pull needs rebase.autoStash, a merge pull merge.autoStash). ${FIX} writes them after the driver. ${AUTOSTASH_APPLIES_TO_EVERY_FILE}`,
  ];
}

/** What the fix did, or would do. */
export interface MergeDriverFixed {
  readonly refused: boolean;
  readonly lines: readonly string[];
}

/**
 * `mnema doctor --fix merge-driver`: writes the four settings, and only those, into `.git/config`:
 * the driver's name and the driver, then the two autoStash ones. It is not a rollback: a write that
 * fails stops there, and the ones after it are not written, which is why the driver comes first. A
 * driver mnema wrote that cannot run here (its paths gone, or `mnema` not on the PATH) is replaced by
 * `driver`; one that can run is kept; one of somebody else's is left, and then nothing is written.
 * No autoStash is written while the driver cannot run, and `driver` is refused when it cannot.
 * `driver` is the command the driver setting gets (`driverCommand`).
 */
export function fixMergeDriver(
  ctx: MergeDriverContext,
  options: { readonly dryRun: boolean; readonly driver: string },
): MergeDriverFixed {
  const here = governed(ctx);
  if (here === undefined) {
    return {
      refused: true,
      lines: [
        `nothing changed: there is no record here inside a git repository whose .gitattributes names the ${MERGE_DRIVER} driver; \`mnema init\` writes that line.`,
      ],
    };
  }
  const mine = whyTheDriverCannotRun(ctx.processEnv, options.driver);
  if (mine !== undefined) {
    return {
      refused: true,
      lines: [
        `the driver this installation would write cannot run here (${mine}): nothing was written, and no autoStash is written while the driver cannot run.`,
      ],
    };
  }
  const lines: string[] = [];
  let refused = false;
  const toWrite: (readonly [string, string])[] = [];
  for (const [key, value] of mergeSettings(options.driver)) {
    const now = setting(ctx, here.top, key);
    if (now === value) continue;
    if (key === DRIVER_KEY && now !== undefined && isOurDriver(now)) {
      const dead = whyTheDriverCannotRun(ctx.processEnv, now);
      if (dead === undefined) continue;
      lines.push(`the driver git holds cannot run here (${dead}): it is replaced.`);
      toWrite.push([key, value]);
      continue;
    }
    if (now !== undefined) {
      refused = true;
      lines.push(
        `${key} is already set to ${oneLine(now)}, which mnema did not write; it is left as it is.`,
      );
      continue;
    }
    toWrite.push([key, value]);
  }
  if (refused) return { refused, lines: [...lines, 'nothing was written.'] };
  if (toWrite.length === 0) {
    return {
      refused: false,
      lines: [
        'nothing to change: git already holds a driver that runs, merge.autoStash and rebase.autoStash here.',
      ],
    };
  }
  for (const [key, value] of toWrite) {
    if (options.dryRun) {
      lines.push(`would set ${key} = ${value} in this repository's git configuration.`);
      continue;
    }
    const wrote = gitIn(ctx, here.top, ['config', '--local', key, value]);
    if (wrote?.status !== 0) {
      return {
        refused: true,
        lines: [
          ...lines,
          `git did not write ${key}; the settings after it were not written, and the ones before it stay (the driver goes first, so an autoStash is never left without it).`,
        ],
      };
    }
    lines.push(`set ${key} = ${value} in this repository's git configuration.`);
  }
  if (options.dryRun) lines.push('nothing was written.');
  lines.push(AUTOSTASH_APPLIES_TO_EVERY_FILE);
  return { refused: false, lines };
}
