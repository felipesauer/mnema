/**
 * `mnema record pull`: `git pull` over a record whose tails grew here and are not committed yet.
 *
 * WHY IT EXISTS. A tail is appended to locally and left uncommitted; a pull request carries those
 * events to the branch this one follows; that branch then holds the start of the local file, and
 * `git pull` refuses ("Your local changes ... would be overwritten by merge") before any merge
 * driver runs, although nothing would be lost (measured on git 2.55; ADR-163). This is the by-hand
 * procedure, made one command:
 *
 *   1. It refuses where it would touch more than the record: a tracked change outside the record's
 *      folder is the person's work, and is theirs to commit or stash (`CHANGES_OUTSIDE_THE_RECORD`).
 *   2. It fetches, and for every tail file that differs between this checkout and the upstream
 *      branch it asks the one rule the merge driver asks ({@link joinGrownTail}): one side must be
 *      the start of the other. A fork, or any other file of a tail that differs, is refused before
 *      anything is written, naming each file (`NOT_A_PREFIX`).
 *   3. A file of the record git does not track yet (a tail opened here, the key that writes it)
 *      that the upstream branch also holds would stop the pull ("untracked working tree files would
 *      be overwritten"), and the autostash does not carry untracked files: it is kept aside in the
 *      repository's git directory, and put back after the pull when it is the longer side.
 *   4. It runs `git pull --autostash` with the merge driver handed on that one command line
 *      (`git -c merge.mnema-tail.driver=...`): the stash of the local events is put back through the
 *      driver, which keeps the longer side. NO GIT CONFIGURATION IS WRITTEN
 *      (`a-tail-merges-and-pulls.test.ts`, "writes no configuration").
 *   5. It verifies the record, and says the verdict.
 *
 * The pull is git's own: its remote, its branch, `pull.rebase` as the person set it. Only automatic
 * maintenance is turned off for these calls, as every git this product starts to write a
 * repository runs.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { LevelRequirement } from '@mnema/chain';
import { type DiscoveryEnv, resolveTrees } from '@mnema/core';
import { oneLine } from '../one-line.js';
import { forkSentence, joinGrownTail, MERGE_DRIVER } from './record-merge-tail.js';
import { runVerify, type VerifyDone } from './verify.js';

/** What `record pull` needs: injected so it is testable against a sandbox. */
export interface RecordPullContext {
  readonly cwd: string;
  readonly env: DiscoveryEnv;
  /** The environment git runs with. */
  readonly processEnv: NodeJS.ProcessEnv;
  /** The command git runs as the driver, `%O %A %B %P` included ({@link driverCommand}). */
  readonly driver: string;
  /** The minimum the verdict after the pull is held to: a bare `verify`'s. */
  readonly requirement: LevelRequirement;
}

/** One file of a tail this checkout and the upstream branch hold differently, and why it stops the pull. */
export interface Unjoinable {
  /** The path from the repository's top. */
  readonly path: string;
  readonly said: string;
}

export type RecordPullRefused =
  | { readonly ok: false; readonly reason: 'NO_PROJECT' }
  | { readonly ok: false; readonly reason: 'NOT_A_REPOSITORY' }
  | { readonly ok: false; readonly reason: 'NO_UPSTREAM' }
  | {
      readonly ok: false;
      readonly reason: 'CHANGES_OUTSIDE_THE_RECORD';
      readonly paths: readonly string[];
    }
  | { readonly ok: false; readonly reason: 'FETCH_FAILED'; readonly said: string }
  | {
      readonly ok: false;
      readonly reason: 'NOT_A_PREFIX';
      readonly found: readonly Unjoinable[];
    };

/** What the pull did: git's answer, the tail files put back, and the verdict after it. */
export interface RecordPullDone {
  readonly ok: true;
  /** The branch pulled, as git names it (`origin/main`). */
  readonly upstream: string;
  /** Whether git's pull succeeded, and what it said. */
  readonly pulled: { readonly status: number; readonly said: string };
  /** The untracked tail files kept aside and put back because this checkout's side was longer. */
  readonly restored: readonly string[];
  /** Where the files are that could not be put back, when there are any. */
  readonly keptAside?: { readonly dir: string; readonly paths: readonly string[] };
  /** The verdict over the record after the pull, or undefined when git's pull failed. */
  readonly verdict?: VerifyDone;
}

/** Quotes one word for the `sh -c` git runs a driver through. */
function shellWord(word: string): string {
  return `'${word.replaceAll("'", `'\\''`)}'`;
}

/** The driver command for this installation: its node, its script, and git's four placeholders. */
export function driverCommand(node: string, script: string): string {
  return `${shellWord(node)} ${shellWord(script)} record merge-tail %O %A %B %P`;
}

/** A git in `cwd`, with automatic maintenance off; bytes out, so a tail is read as it is. */
function git(
  ctx: RecordPullContext,
  cwd: string,
  args: readonly string[],
): { readonly status: number; readonly out: Buffer; readonly err: string } {
  const ran = spawnSync('git', ['-c', 'gc.auto=0', '-c', 'maintenance.auto=false', ...args], {
    cwd,
    env: ctx.processEnv,
    maxBuffer: 1 << 30,
  });
  return {
    status: ran.status ?? -1,
    out: ran.stdout ?? Buffer.alloc(0),
    err: ran.stderr?.toString('utf-8') ?? String(ran.error ?? ''),
  };
}

/** The text of a git answer, trimmed, or undefined where git did not answer 0. */
function said(ran: { status: number; out: Buffer }): string | undefined {
  return ran.status === 0 ? ran.out.toString('utf-8').trim() : undefined;
}

/** Whether `path` (from the repository's top) is a segment or the checkpoints of a tail. */
function isTailFile(path: string, tails: string): boolean {
  if (!path.startsWith(tails)) return false;
  const rest = path.slice(tails.length).split('/');
  return rest.length === 2 && (rest[1] as string).endsWith('.jsonl');
}

/** Pulls the branch this one follows over the record's uncommitted events. */
export function runRecordPull(ctx: RecordPullContext): RecordPullDone | RecordPullRefused {
  const trees = resolveTrees(ctx.cwd, ctx.env);
  if (trees.projectPublic === undefined) return { ok: false, reason: 'NO_PROJECT' };
  const record = trees.projectPublic;
  const top = said(git(ctx, record, ['rev-parse', '--show-toplevel']));
  const prefix = said(git(ctx, record, ['rev-parse', '--show-prefix']));
  if (top === undefined || prefix === undefined || prefix === '') {
    return { ok: false, reason: 'NOT_A_REPOSITORY' };
  }
  const recordDir = prefix.endsWith('/') ? prefix : `${prefix}/`;
  const tails = `${recordDir}tails/`;
  const upstream = said(
    git(ctx, top, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']),
  );
  if (upstream === undefined || upstream === '') return { ok: false, reason: 'NO_UPSTREAM' };

  // 1. What this checkout holds that is not committed.
  const status = git(ctx, top, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  const entries = status.out.toString('utf-8').split('\0');
  const outside: string[] = [];
  const untracked: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i] as string;
    if (entry.length < 4) continue;
    const code = entry.slice(0, 2);
    const path = entry.slice(3);
    // A rename or a copy carries its old path as the next entry.
    if (code.includes('R') || code.includes('C')) i++;
    if (code === '??') {
      if (path.startsWith(recordDir)) untracked.push(path);
      continue;
    }
    if (!path.startsWith(recordDir)) outside.push(path);
  }
  if (outside.length > 0) return { ok: false, reason: 'CHANGES_OUTSIDE_THE_RECORD', paths: outside };

  // 2. The upstream branch as it is now, and every tail file that differs from it here.
  const fetched = git(ctx, top, ['fetch', '--quiet']);
  if (fetched.status !== 0) return { ok: false, reason: 'FETCH_FAILED', said: fetched.err.trim() };
  const there = said(git(ctx, top, ['rev-parse', '@{upstream}']));
  if (there === undefined) return { ok: false, reason: 'NO_UPSTREAM' };
  const differing = git(ctx, top, ['diff', '--name-only', '-z', there, '--', tails])
    .out.toString('utf-8')
    .split('\0')
    .filter((path) => path.length > 0);
  const theirsOf = (path: string): Buffer | undefined => {
    const blob = git(ctx, top, ['cat-file', 'blob', `${there}:${path}`]);
    return blob.status === 0 ? blob.out : undefined;
  };
  const found: Unjoinable[] = [];
  const aside: string[] = [];
  for (const path of [...new Set([...differing, ...untracked])]) {
    const local = join(top, path);
    if (!existsSync(local)) continue;
    const theirs = theirsOf(path);
    if (theirs === undefined) continue;
    const ours = readFileSync(local);
    if (isTailFile(path, tails)) {
      const joined = joinGrownTail(ours, theirs);
      if (joined.kind === 'fork') found.push({ path, said: forkSentence(path, joined.line) });
    } else if (!ours.equals(theirs)) {
      found.push({
        path,
        said: `${oneLine(path)}: holds other bytes than on ${oneLine(upstream)}, and only a tail's segments and checkpoints grow, so it is not joined.`,
      });
    }
    if (untracked.includes(path)) aside.push(path);
  }
  if (found.length > 0) return { ok: false, reason: 'NOT_A_PREFIX', found };

  // 3. The untracked tail files the upstream branch also holds, kept aside for the pull.
  const asideDir = join(
    said(git(ctx, top, ['rev-parse', '--path-format=absolute', '--git-dir'])) ?? join(top, '.git'),
    'mnema-record-pull',
    // One folder to a run, so a run never removes what an earlier one had to keep.
    `${Date.now()}-${process.pid}`,
  );
  for (const path of aside) {
    mkdirSync(dirname(join(asideDir, path)), { recursive: true });
    renameSync(join(top, path), join(asideDir, path));
  }

  // 4. The pull, with the driver on this one command line.
  const pull = git(ctx, top, [
    '-c',
    `merge.${MERGE_DRIVER}.name=mnema: keep the longer side of a tail that only grows`,
    '-c',
    `merge.${MERGE_DRIVER}.driver=${ctx.driver}`,
    'pull',
    '--autostash',
  ]);
  const pulled = {
    status: pull.status,
    said: `${pull.out.toString('utf-8')}${pull.err}`.trim(),
  };

  // Each file kept aside goes back where this checkout's side is the longer one, or where the
  // pull left nothing at its path; where the upstream side is as long or longer, it stays.
  const restored: string[] = [];
  const kept: string[] = [];
  for (const path of aside) {
    const local = join(top, path);
    const ours = readFileSync(join(asideDir, path));
    const now = existsSync(local) ? readFileSync(local) : undefined;
    const joined = now === undefined ? undefined : joinGrownTail(ours, now);
    if (joined?.kind === 'fork') {
      kept.push(path);
      continue;
    }
    if (joined === undefined || (joined.kind === 'longer' && joined.side === 'ours')) {
      mkdirSync(dirname(local), { recursive: true });
      writeFileSync(local, ours);
      restored.push(path);
    }
  }
  if (kept.length === 0) rmSync(asideDir, { recursive: true, force: true });

  const done = {
    ok: true as const,
    upstream,
    pulled,
    restored,
    ...(kept.length > 0 ? { keptAside: { dir: asideDir, paths: kept } } : {}),
  };
  if (pull.status !== 0) return done;

  // 5. The verdict over the record the pull left.
  const verdict = runVerify({
    cwd: ctx.cwd,
    env: ctx.env,
    requirement: ctx.requirement,
    global: false,
  });
  return verdict.ok ? { ...done, verdict } : done;
}
