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
 * answer to `init`'s question, or `--fix merge-driver`, writes THREE settings into this repository's
 * own configuration (`git config --local`), with `--dry-run` saying them first: the driver,
 * `merge.autoStash` and `rebase.autoStash`, always together and all or none. A plain `git pull` over
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
 * version, a reinstalled folder) leaves a driver that cannot start, and git then treats the file as
 * conflicted. The fix does not rewrite a driver mnema wrote, so after a move `git config --unset
 * merge.mnema-tail.driver` and the fix again write the new paths. `mnema record pull` needs none of
 * this: it hands the driver to its one pull.
 */

import { spawnSync } from 'node:child_process';
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
  return value.endsWith(DRIVER_TAIL);
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

/** The doctor's line, where the record names the driver and git does not hold all a plain pull takes. */
export function mergeDriverLines(ctx: MergeDriverContext): string[] {
  const here = governed(ctx);
  if (here === undefined) return [];
  const driver = setting(ctx, here.top, DRIVER_KEY);
  const stash = AUTOSTASH_KEYS.map((key) => [key, setting(ctx, here.top, key)] as const);
  if (driver === undefined) {
    const on = stash.filter(([, now]) => now === 'true').map(([key]) => key);
    const without =
      on.length === 0
        ? ''
        : ` ${on.join(' and ')} ${on.length === 1 ? 'is' : 'are'} on without the driver: a pull over events not yet committed then leaves conflict markers inside signed tails.`;
    return [
      `git merges this record's tails as text in ${oneLine(here.top)}, since its configuration does not say what the ${MERGE_DRIVER} driver the record names is: a merge of a branch that grew the same tail stops on a conflict, and a plain \`git pull\` over events not yet committed refuses.${without} \`mnema record pull\` pulls over them without it; ${FIX} writes the driver, merge.autoStash and rebase.autoStash into this repository's git configuration, together, so that a plain \`git pull\` carries them. ${AUTOSTASH_APPLIES_TO_EVERY_FILE}`,
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
    `${missing.join(' and ')} ${missing.length === 1 ? 'is' : 'are'} not set in ${oneLine(here.top)}, so a plain \`git pull\` over events not yet committed refuses before the merge driver runs (a rebase pull needs rebase.autoStash, a merge pull merge.autoStash). ${FIX} writes them with the driver. ${AUTOSTASH_APPLIES_TO_EVERY_FILE}`,
  ];
}

/** What the fix did, or would do. */
export interface MergeDriverFixed {
  readonly refused: boolean;
  readonly lines: readonly string[];
}

/**
 * `mnema doctor --fix merge-driver`: writes the three settings, and only those, into `.git/config`,
 * all or none. `driver` is the command the driver setting gets (`driverCommand`).
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
  const lines: string[] = [];
  let refused = false;
  const toWrite: (readonly [string, string])[] = [];
  for (const [key, value] of mergeSettings(options.driver)) {
    const now = setting(ctx, here.top, key);
    if (now === value || (key === DRIVER_KEY && now !== undefined && isOurDriver(now))) continue;
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
        'nothing to change: git already holds the driver, merge.autoStash and rebase.autoStash here.',
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
          `git did not write ${key}; the settings after it were not written, and none of them is an autoStash without the driver.`,
        ],
      };
    }
    lines.push(`set ${key} = ${value} in this repository's git configuration.`);
  }
  if (options.dryRun) lines.push('nothing was written.');
  lines.push(AUTOSTASH_APPLIES_TO_EVERY_FILE);
  return { refused: false, lines };
}
