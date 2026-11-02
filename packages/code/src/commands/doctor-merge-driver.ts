/**
 * What `mnema doctor` says of the tails' merge driver, and `mnema doctor --fix merge-driver`, the
 * one act of this product that writes git's configuration.
 *
 * THE ATTRIBUTE TRAVELS, THE DRIVER DOES NOT. The record's `.gitattributes` names the driver for a
 * tail's files (`merge=mnema-tail`, `ensureTree` in `@mnema/chain`), and git runs it only where its
 * own configuration says what `mnema-tail` is; a committed file cannot say it. A clone without the
 * setting merges a tail file as text, as git merges any file: a branch that grew the same tail then
 * stops on a conflict. The doctor names that, here, where the attribute is in force and the setting
 * is absent (`a-tail-merges-and-pulls.test.ts`, "the doctor").
 *
 * WRITTEN ONLY WHEN A PERSON ASKS (ADR-163). A driver is a command git runs inside every merge, the
 * same class of thing as a hook, and `init` installs no hook either (`commit-hook.ts`). So `init`
 * writes the attribute only; `--fix merge-driver` writes the two settings into this repository's
 * own configuration (`git config --local`), with `--dry-run` saying them first, and leaves a
 * setting of the same name with another value where it is. The setting names `mnema` as git finds it
 * on its PATH: where git runs without it there, the driver cannot start and git treats the file as
 * conflicted, which is where a merge without the setting ends too. `mnema record pull` needs none
 * of this: it hands the driver to its one pull.
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

/** The two settings the fix writes, in the order it writes them. */
export const DRIVER_SETTINGS = [
  [`merge.${MERGE_DRIVER}.name`, 'mnema: keep the longer side of a tail that only grows'],
  [`merge.${MERGE_DRIVER}.driver`, 'mnema record merge-tail %O %A %B %P'],
] as const;

const FIX = '`mnema doctor --fix merge-driver`';

/** One git in `cwd`, or undefined where git is absent or does not answer. */
function gitIn(
  ctx: MergeDriverContext,
  cwd: string,
  args: readonly string[],
): { readonly status: number; readonly out: string } | undefined {
  const asked = spawnSync('git', [...args], {
    cwd,
    encoding: 'utf-8',
    timeout: 5_000,
    env: { ...ctx.processEnv, GIT_OPTIONAL_LOCKS: '0' },
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

/** The value git holds for `key`, or undefined where it holds none. */
function setting(ctx: MergeDriverContext, top: string, key: string): string | undefined {
  const got = gitIn(ctx, top, ['config', '--get', key]);
  return got?.status === 0 ? got.out : undefined;
}

/** The doctor's line, where the record names the driver and git does not know it. */
export function mergeDriverLines(ctx: MergeDriverContext): string[] {
  const here = governed(ctx);
  if (here === undefined) return [];
  if (setting(ctx, here.top, `merge.${MERGE_DRIVER}.driver`) !== undefined) return [];
  return [
    `git merges this record's tails as text in ${oneLine(here.top)}, since its configuration does not say what the ${MERGE_DRIVER} driver the record names is: a merge of a branch that grew the same tail stops on a conflict. \`mnema record pull\` pulls over events not yet committed without it; ${FIX} writes it into this repository's git configuration, for every merge.`,
  ];
}

/** What the fix did, or would do. */
export interface MergeDriverFixed {
  readonly refused: boolean;
  readonly lines: readonly string[];
}

/** `mnema doctor --fix merge-driver`: writes the two settings, and only those, into `.git/config`. */
export function fixMergeDriver(
  ctx: MergeDriverContext,
  options: { readonly dryRun: boolean },
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
  for (const [key, value] of DRIVER_SETTINGS) {
    const now = setting(ctx, here.top, key);
    if (now === value) continue;
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
    return { refused: false, lines: ['nothing to change: git already knows the driver here.'] };
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
        lines: [...lines, `git did not write ${key}; nothing else was written.`],
      };
    }
    lines.push(`set ${key} = ${value} in this repository's git configuration.`);
  }
  if (options.dryRun) lines.push('nothing was written.');
  return { refused: false, lines };
}
