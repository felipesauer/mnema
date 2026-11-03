/**
 * What git does not hold of the record yet, and the one sentence that says it (ADR-104).
 *
 * WHY IT EXISTS. A writer appends to a tail and commits nothing; the events reach git when a person
 * cuts them into a pull request (`mnema record commit`). Measured in this repository, an event
 * waited 10.8 h on average for that and 78 were waiting at once, and nothing said so. This reads
 * the gap and `mnema status`, `mnema doctor` and the session's closing line say it, each from
 * {@link readEventsNotInGit} and {@link saysEventsNotInGit}, so the three cannot come to count or
 * word it differently (`events-not-in-git-are-said.test.ts` holds the three to this module).
 *
 * WHAT IT COUNTS. Per tail of the project's public tree: the complete lines of each segment file
 * here above the lines of the same file in HEAD (a segment HEAD does not hold, and so a tail git
 * does not track at all, counts whole). It reads no network, writes nothing, and asks git only
 * what the committed tree holds: HEAD's file sizes in one `ls-tree`, and the content of a segment
 * only where its size differs from the one here, which is the last segment of a tail that grew.
 * What git holds in its index is not looked at: the question is what a commit already carries.
 *
 * ALSO READ, FOR THE SENTENCE. The age of the oldest event waiting (its own `at`); how many
 * commits reached the default branch (the one `record commit` takes as its base, `theDefaultBranch`)
 * since the last one that changed the record's folder, first parents only, so a pull request merged
 * is one; and whether the branch this one follows holds commits that changed the record and this
 * one lacks, which is when `mnema record pull` is what brings them over without a conflict.
 *
 * SILENT BY CONSTRUCTION. Where nothing waits, outside a git repository, with no public tree, or
 * with the tails ignored by git (a person who ignores the record is not told to commit it), the
 * answer is `undefined` and no line is said.
 *
 * IT NEVER TELLS ANYONE TO COMMIT. The sentence says what waits and what the command does (it
 * prepares a branch and prints what to run next; the person, or the agent the person asked, runs
 * those), and states how to read it: marked old past {@link OLD_AFTER_HOURS} hours.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type DiscoveryEnv, resolveTrees } from '@mnema/core';
import { oneLine } from './one-line.js';

/** What the reading needs: injected so it is testable against a sandbox. */
export interface EventsNotInGitContext {
  readonly cwd: string;
  readonly env: DiscoveryEnv;
  /** The environment git runs with; this process's by default. */
  readonly processEnv?: NodeJS.ProcessEnv;
  /** Now, in milliseconds; the wall clock by default. */
  readonly now?: number;
}

/** What is not in git, as the sentence and `status --json` carry it. */
export interface EventsNotInGit {
  /** Events above what HEAD holds, every tail of the public tree counted. */
  readonly events: number;
  /** Tails with at least one of them. */
  readonly tails: number;
  /** The `at` of the oldest of them, where it could be read. */
  readonly oldestAt?: string;
  /** Whole hours since then. */
  readonly oldestHours?: number;
  /** True past {@link OLD_AFTER_HOURS}. */
  readonly old: boolean;
  /** The default branch as this clone knows it (`origin/main`), where there is one. */
  readonly defaultBranch?: string;
  /** Commits that reached it since the last one that changed the record's folder. */
  readonly commitsSinceRecordCommit?: number;
  /** Commits that changed the record on the branch this one follows, that this one lacks. */
  readonly pullDue: number;
}

/** The rule the sentence marks an event old by: written in `docs/cli-reference.md`. */
export const OLD_AFTER_HOURS = 24;

/** What a git run answered. */
type Ran = { readonly status: number; readonly out: Buffer };

/** Names that point git at another repository than the one a directory names. */
const REPOSITORY_VARIABLES = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_COMMON_DIR',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
] as const;

type Ask = (args: readonly string[]) => string | undefined;

/** What the record's default branch is, as this clone last read it: no network. */
export type DefaultBranch =
  | {
      readonly ok: true;
      readonly remote: string;
      /** The remote-tracking ref `refs/remotes/<remote>/HEAD` names, in full. */
      readonly headRef: string;
      /** The default branch's name on the remote (`main`). */
      readonly branch: string;
      readonly commit: string;
    }
  | { readonly ok: false; readonly reason: 'NO_REMOTE'; readonly remotes: readonly string[] }
  | { readonly ok: false; readonly reason: 'NO_DEFAULT_BRANCH'; readonly remote: string };

/**
 * The default branch of the remote the current branch follows (else the only remote, else
 * `origin`), as `refs/remotes/<remote>/HEAD` names it, with no network. `ask` runs one git in the
 * repository and answers its trimmed output, or `undefined` where it failed. The one reading
 * `mnema record commit` takes its base from (ADR-171) and this module takes its count from.
 */
export function theDefaultBranch(ask: Ask): DefaultBranch {
  const remotes = (ask(['remote']) ?? '').split('\n').filter(Boolean);
  const current = ask(['symbolic-ref', '--quiet', '--short', 'HEAD']);
  const followed = current === undefined ? undefined : ask(['config', `branch.${current}.remote`]);
  const remote =
    followed !== undefined && remotes.includes(followed)
      ? followed
      : remotes.length === 1
        ? remotes[0]
        : remotes.includes('origin')
          ? 'origin'
          : undefined;
  if (remote === undefined) return { ok: false, reason: 'NO_REMOTE', remotes };
  const headRef = ask(['symbolic-ref', '--quiet', `refs/remotes/${remote}/HEAD`]);
  const commit =
    headRef === undefined
      ? undefined
      : ask(['rev-parse', '--verify', '--quiet', `${headRef}^{commit}`]);
  if (headRef === undefined || commit === undefined) {
    return { ok: false, reason: 'NO_DEFAULT_BRANCH', remote };
  }
  return {
    ok: true,
    remote,
    headRef,
    branch: headRef.slice(`refs/remotes/${remote}/`.length),
    commit,
  };
}

const SEGMENT = /^\d{6}\.jsonl$/;

/** The complete lines of a file: a last piece without its newline is not a line. */
function linesOf(bytes: Buffer): number {
  let n = 0;
  for (let at = bytes.indexOf(0x0a); at !== -1; at = bytes.indexOf(0x0a, at + 1)) n++;
  return n;
}

/** The `at` of line `index` (from 0) of a segment, where it can be read. */
function atOfLine(bytes: Buffer, index: number): string | undefined {
  let start = 0;
  for (let line = 0; line < index; line++) {
    const end = bytes.indexOf(0x0a, start);
    if (end === -1) return undefined;
    start = end + 1;
  }
  const end = bytes.indexOf(0x0a, start);
  if (end === -1) return undefined;
  try {
    const at = (
      JSON.parse(bytes.subarray(start, end).toString('utf-8')) as { event?: { at?: unknown } }
    ).event?.at;
    return typeof at === 'string' && !Number.isNaN(Date.parse(at)) ? at : undefined;
  } catch {
    return undefined;
  }
}

/**
 * What the public tree holds that HEAD does not, and what the sentence needs beside it; or
 * `undefined` where nothing waits or the question does not apply (outside git, no public tree, the
 * tails ignored by git).
 */
export function readEventsNotInGit(ctx: EventsNotInGitContext): EventsNotInGit | undefined {
  const record = resolveTrees(ctx.cwd, ctx.env).projectPublic;
  if (record === undefined) return undefined;
  const tailsDir = join(record, 'tails');
  if (!existsSync(tailsDir)) return undefined;

  const env: NodeJS.ProcessEnv = { ...(ctx.processEnv ?? process.env), GIT_OPTIONAL_LOCKS: '0' };
  for (const name of REPOSITORY_VARIABLES) Reflect.deleteProperty(env, name);
  const run = (args: readonly string[]): Ran => {
    const ran = spawnSync('git', ['-c', 'gc.auto=0', '-c', 'maintenance.auto=false', ...args], {
      cwd: record,
      env,
      maxBuffer: 1 << 30,
      timeout: 10_000,
    });
    return { status: ran.status ?? -1, out: ran.stdout ?? Buffer.alloc(0) };
  };
  const ask: Ask = (args) => {
    const ran = run(args);
    return ran.status === 0 ? ran.out.toString('utf-8').trim() : undefined;
  };
  if (ask(['rev-parse', '--is-inside-work-tree']) !== 'true') return undefined;

  // What HEAD holds of the tails: path (from the record's folder) to blob and size. A repository
  // with no commit yet holds nothing, so everything here waits.
  const held = new Map<string, { readonly oid: string; readonly size: number }>();
  const listed = run(['ls-tree', '-r', '-l', '-z', 'HEAD', '--', 'tails']);
  if (listed.status === 0) {
    for (const entry of listed.out.toString('utf-8').split('\0')) {
      const parsed = /^\d+ blob ([0-9a-f]+) +(\d+)\t(.+)$/.exec(entry);
      if (parsed !== null) {
        held.set(parsed[3] as string, { oid: parsed[1] as string, size: Number(parsed[2]) });
      }
    }
  }

  let events = 0;
  let tails = 0;
  let oldest: string | undefined;
  let untrackedFile: string | undefined;
  for (const id of readdirSync(tailsDir).sort()) {
    const dir = join(tailsDir, id);
    if (!lstatSync(dir).isDirectory()) continue;
    let waiting = 0;
    for (const name of readdirSync(dir).sort()) {
      if (!SEGMENT.test(name)) continue;
      const file = join(dir, name);
      const stat = lstatSync(file);
      if (!stat.isFile()) continue;
      const path = `tails/${id}/${name}`;
      const inHead = held.get(path);
      if (inHead?.size === stat.size) continue;
      const here = readFileSync(file);
      let before = 0;
      if (inHead !== undefined) {
        const blob = run(['cat-file', 'blob', inHead.oid]);
        if (blob.status !== 0) continue;
        before = linesOf(blob.out);
      } else {
        untrackedFile ??= path;
      }
      const above = linesOf(here) - before;
      if (above <= 0) continue;
      waiting += above;
      const at = atOfLine(here, before);
      if (at !== undefined && (oldest === undefined || Date.parse(at) < Date.parse(oldest))) {
        oldest = at;
      }
    }
    if (waiting > 0) tails++;
    events += waiting;
  }
  if (events === 0) return undefined;
  // A person who has git ignore the record is not told to commit it.
  if (
    untrackedFile !== undefined &&
    run(['check-ignore', '-q', '--', untrackedFile]).status === 0
  ) {
    return undefined;
  }

  const now = ctx.now ?? Date.now();
  const oldestHours =
    oldest === undefined
      ? undefined
      : Math.max(0, Math.floor((now - Date.parse(oldest)) / 3_600_000));
  const base = theDefaultBranch(ask);
  let defaultBranch: string | undefined;
  let commitsSinceRecordCommit: number | undefined;
  if (base.ok) {
    defaultBranch = `${base.remote}/${base.branch}`;
    const last = ask(['log', '-1', '--format=%H', base.commit, '--', '.']);
    if (last !== undefined && last !== '') {
      const counted = Number(
        ask(['rev-list', '--count', '--first-parent', `${last}..${base.commit}`]),
      );
      if (Number.isInteger(counted)) commitsSinceRecordCommit = counted;
    }
  }
  // The branch this one follows, as this clone last read it: what `mnema record pull` pulls.
  const pullDue = Number(ask(['rev-list', '--count', 'HEAD..@{upstream}', '--', '.']) ?? 0);

  return {
    events,
    tails,
    ...(oldest !== undefined ? { oldestAt: oldest } : {}),
    ...(oldestHours !== undefined ? { oldestHours } : {}),
    old: oldestHours !== undefined && oldestHours > OLD_AFTER_HOURS,
    ...(defaultBranch !== undefined ? { defaultBranch } : {}),
    ...(commitsSinceRecordCommit !== undefined ? { commitsSinceRecordCommit } : {}),
    pullDue: Number.isInteger(pullDue) ? pullDue : 0,
  };
}

function counted(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** How long ago, in the unit a person reads it in. */
function agePhrase(hours: number): string {
  if (hours < 1) return 'less than an hour';
  if (hours < 48) return counted(hours, 'hour', 'hours');
  return counted(Math.floor(hours / 24), 'day', 'days');
}

/**
 * The sentence the three surfaces say: what waits, how old, and the commands that bear on it.
 * One line, a statement of fact with the commands named: `mnema record commit` prepares a branch
 * and prints what to run next, and the sentence does not ask anyone to run it.
 */
export function saysEventsNotInGit(found: EventsNotInGit): string {
  const oldest =
    found.oldestHours === undefined
      ? ''
      : found.old
        ? ` (the oldest was written ${agePhrase(found.oldestHours)} ago, which is old: past ${OLD_AFTER_HOURS} hours)`
        : ` (the oldest was written ${agePhrase(found.oldestHours)} ago)`;
  const since =
    found.commitsSinceRecordCommit === undefined || found.commitsSinceRecordCommit === 0
      ? ''
      : ` ${found.defaultBranch === undefined ? 'The default branch' : oneLine(found.defaultBranch)} has had ${counted(found.commitsSinceRecordCommit, 'commit', 'commits')} since the last one that changed the record.`;
  const pull =
    found.pullDue === 0
      ? ''
      : ` The branch this one follows holds ${counted(found.pullDue, 'commit', 'commits')} that changed the record and this clone lacks: \`mnema record pull\` brings them over the events waiting here.`;
  return (
    `${counted(found.events, 'event', 'events')} of this record ${found.events === 1 ? 'is' : 'are'} not in a git commit yet${oldest}: ` +
    '`mnema record commit` prepares them as a branch for a pull request and prints the commands to run next; it pushes nothing.' +
    since +
    pull
  );
}
