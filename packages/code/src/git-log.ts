/**
 * What the git log says about a decision — read when asked, never written down.
 *
 * A commit and a decision are two halves of one fact: the commit carries the change, the
 * record carries the reasoning. The bridge between them is a trailer the commit message
 * carries, `Mnema-Decision: <ADR-n | id>`, and it is READ HERE, from git, at the moment of
 * the question. Nothing of it is appended to the record: a commit can vanish in a rebase, and
 * a signed fact pointing at a commit that no longer exists is a fact that cannot be checked
 * (the same reason `usage` does not record the host's transcripts).
 *
 * EVERY GIT IS `execFile` WITH AN ARGUMENT LIST, never a shell: a decision id, a path and a
 * commit name all come from a person or a record, and none of them is ever parsed by a shell.
 * Each read is bounded in time and in bytes, and each is read-only (no lock, no program of
 * the repository's run). A git that cannot answer — absent, not a repository, timed out — is
 * `null`, and {@link inAWorkTree} is the one question that tells "there is no git here" from
 * "there is git and it has nothing to say".
 */

import { execFileSync } from 'node:child_process';

/** The trailer key a commit message carries. */
export const TRAILER = 'Mnema-Decision';

/** How long one git read may take. */
const TIMEOUT_MS = 5000;

/** The most output one git read may produce. */
const MAX_BYTES = 4 * 1024 * 1024;

/** How many commits one list shows before it says there are more. */
export const LISTED = 30;

/** The most changed files of one commit that are asked about. */
export const MOST_FILES = 200;

/** What every git here runs with: no lock taken, no program of the repository's run. */
const READ_ONLY = ['-c', 'core.fsmonitor=false', '--no-optional-locks'];

/** One commit as the log shows it. */
export interface Commit {
  readonly sha: string;
  /** Committer date, ISO-8601. */
  readonly at: string;
  readonly subject: string;
  /** The values of its `Mnema-Decision` trailers, in order, as written. */
  readonly cites: readonly string[];
}

/** One read-only git in `root`, or `null` for every outcome that is not an answer. */
export function git(root: string, args: readonly string[]): string | null {
  try {
    return execFileSync('git', [...READ_ONLY, ...args], {
      cwd: root,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: TIMEOUT_MS,
      maxBuffer: MAX_BYTES,
    });
  } catch {
    return null;
  }
}

/** Whether `root` is inside a git work tree — false for no git at all and for no repository. */
export function inAWorkTree(root: string): boolean {
  return git(root, ['rev-parse', '--is-inside-work-tree'])?.trim() === 'true';
}

/** Whether the history in `root` was cut short (a `--depth` clone) — what is counted is then only what it holds. */
export function isShallow(root: string): boolean {
  return git(root, ['rev-parse', '--is-shallow-repository'])?.trim() === 'true';
}

/** Whether the work tree has a commit to read — a fresh repository has none. */
function hasCommits(root: string): boolean {
  return git(root, ['rev-parse', '--verify', '--quiet', 'HEAD']) !== null;
}

const FIELD = '\x1f';
const RECORD = '\x1e';

/** The log format: sha, date, subject and the trailer values, fields apart by US, commits by RS. */
const FORMAT = `--format=%H${FIELD}%cI${FIELD}%s${FIELD}%(trailers:key=${TRAILER},valueonly,unfold)${RECORD}`;

/** A pathspec that is the path itself — never a glob, never magic. */
function literal(path: string): string {
  return `:(literal)${path === '' ? '.' : path}`;
}

/** Parses what {@link FORMAT} printed. */
export function parseCommits(text: string): Commit[] {
  const commits: Commit[] = [];
  for (const chunk of text.split(RECORD)) {
    const record = chunk.replace(/^\n+/, '');
    if (record === '') continue;
    const [sha = '', at = '', subject = '', trailers = ''] = record.split(FIELD);
    if (sha === '') continue;
    const cites = trailers
      .split('\n')
      .map((value) => value.trim())
      .filter((value) => value !== '');
    commits.push({ sha, at, subject, cites });
  }
  return commits;
}

/** The commits that carry the trailer, newest first — `null` when git cannot answer. */
export function commitsWithTrailer(root: string, paths?: readonly string[]): Commit[] | null {
  if (!inAWorkTree(root)) return null;
  if (!hasCommits(root)) return [];
  // The grep narrows the walk; the trailer parse below is what decides who cites. A body
  // line that merely starts with the key is found here and read as no trailer there.
  const out = git(root, [
    'log',
    `-n${LISTED * 40}`,
    '--regexp-ignore-case',
    `--grep=^${TRAILER}:`,
    FORMAT,
    ...(paths !== undefined ? ['--', ...paths.map(literal)] : []),
  ]);
  return out === null ? null : parseCommits(out).filter((commit) => commit.cites.length > 0);
}

/** The newest commits that touched any of `paths`, `LISTED + 1` at most — `null` when git cannot answer. */
export function commitsTouching(root: string, paths: readonly string[]): Commit[] | null {
  if (!inAWorkTree(root)) return null;
  if (!hasCommits(root) || paths.length === 0) return [];
  const out = git(root, ['log', `-n${LISTED + 1}`, FORMAT, '--', ...paths.map(literal)]);
  return out === null ? null : parseCommits(out);
}

/**
 * How many commits since `since` touched any of `paths`, and how many were made at all —
 * `null` when git cannot answer.
 */
export function commitsSince(
  root: string,
  since: string,
  paths: readonly string[],
): { readonly touching: number; readonly all: number } | null {
  if (!inAWorkTree(root)) return null;
  if (!hasCommits(root)) return { touching: 0, all: 0 };
  const count = (rest: readonly string[]): number | null => {
    const out = git(root, ['rev-list', '--count', `--since=${since}`, 'HEAD', ...rest]);
    const n = Number.parseInt(out ?? '', 10);
    return Number.isNaN(n) ? null : n;
  };
  const all = count([]);
  const touching = paths.length === 0 ? 0 : count(['--', ...paths.map(literal)]);
  return all === null || touching === null ? null : { touching, all };
}

/** The commit `named` names, or `undefined` when it names none (or git cannot answer). */
export function resolveCommit(root: string, named: string): Commit | undefined {
  // A name that opens with a dash would be read by git as an option.
  if (named === '' || named.startsWith('-') || !inAWorkTree(root)) return undefined;
  const out = git(root, ['log', '-n1', FORMAT, `${named}^{commit}`, '--']);
  return out === null ? undefined : parseCommits(out)[0];
}

/** The files a commit changed, relative to `root`, at most {@link MOST_FILES} — and whether more were left. */
export function filesOf(
  root: string,
  sha: string,
): { readonly files: readonly string[]; readonly more: boolean } {
  const out = git(root, [
    'diff-tree',
    '--no-commit-id',
    '--name-only',
    '-r',
    '-z',
    '--root',
    '--relative',
    sha,
  ]);
  const all = (out ?? '').split('\0').filter((file) => file !== '');
  return { files: all.slice(0, MOST_FILES), more: all.length > MOST_FILES };
}
