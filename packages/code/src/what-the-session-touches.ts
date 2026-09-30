/**
 * What a session touches as it opens — the words the notes it is handed are chosen by.
 *
 * WHY IT EXISTS. The notes a session opens with (`mnema recall`) were the NEWEST ones, and
 * the newest note is not the one about the work in front of the session: a record whose
 * last twenty notes are about billing hands a session opened on the login code twenty
 * notes about billing. The notes are chosen by what the session is near, and this is
 * where "near" is read.
 *
 * WHAT CAN BE READ, AND WHEN. The opening runs before the person has asked anything, so
 * there is no request to read, and the host hands the handler nothing about the work
 * (`plugin/hooks/hand-over.mjs` reads no stdin, and the host's input at that moment is a
 * session id, a transcript path and a reason — no text of the task). What exists at that
 * instant, and reads with no model, is the project's own directory and its own record:
 *
 *   - the files CHANGED in the working tree — the work in progress, when there is some;
 *   - the tasks IN PROGRESS in the record — the one piece of it that names the work;
 *   - the name of the BRANCH — which names the work more often than not;
 *   - the files of the last {@link COMMITS} commits — the work just done, when the tree
 *     is clean.
 *
 * They are read in that order, and the order is the priority when there are more words
 * than {@link MAX_WORDS}: what is being changed now outranks what was changed last.
 *
 * THE RECORD'S OWN FILES ARE NOT THE WORK. Every write to the record changes the committed
 * tree, so in a project whose only change is the record, the changed files are its own
 * chain — measured on a field project at the moment its session would open: its two
 * changed files were `.mnema/tails/…/000001.jsonl` and `checkpoints.jsonl`. The record's
 * directory is excluded from both git reads by a pathspec, and what is left is the project.
 *
 * THE REPOSITORY IS READ AND NEVER WRITTEN. `git status` refreshes the index when it may,
 * which is a write into somebody's repository by a verb that says it writes nothing; with
 * `--no-optional-locks` it does not. And git runs no program of the repository's while it
 * answers: the file-system monitor a repository's configuration can name is switched off
 * for these reads (`core.fsmonitor=false`), and `log` checks no signature
 * (`--no-show-signature`), which would start `gpg` once per commit.
 *
 * NO GIT IS NOT AN ERROR. Outside a repository, with no `git` on the PATH, in a repository
 * with no commit yet, or when a read takes longer than {@link GIT_TIMEOUT_MS} — every one
 * of those is a signal that is not there, and a session with no signal is handed the
 * newest notes, as before. The timeout is the one input here that is not a function of the
 * tree: a machine slow enough to cross it is handed the newest notes where a faster one is
 * handed the nearest. It is there because the opening must not wait on a repository.
 *
 * DETERMINISTIC, AND NOTHING ELSE MOVES IT: the same tree and the same record produce the
 * same words in the same order — git's own orders (paths sorted, commits newest first), the
 * record's tasks by id, and a first-seen dedupe. Nothing is sampled, and no clock is read.
 */

import { spawnSync } from 'node:child_process';
import type { ScopedCache } from '@mnema/copilot';
import { PROJECT_DIR, type TaskState, wordsOf } from '@mnema/core';

/** What the session touches, as words — and where the words came from, counted. */
export interface SessionTouch {
  /** The words the notes are ranked by, in priority order, each once. Empty is no signal. */
  readonly words: readonly string[];
  /** How many paths are changed in the working tree, outside the record. */
  readonly changed: number;
  /** How many tasks the record holds in progress. */
  readonly tasks: number;
  /** Whether the branch's name contributed a word. */
  readonly branch: boolean;
  /** How many of the last commits were read — up to {@link COMMITS}. */
  readonly commits: number;
}

/**
 * How many commits back the work just done reaches. Three: the session that opens on a
 * clean tree is most often continuing the last piece of work, and a piece of work is
 * rarely one commit; further back, the files stop being the work and start being the
 * project.
 */
export const COMMITS = 3;

/**
 * The most words the notes are ranked by. A commit that touched two hundred files is not
 * two hundred themes, and the words past this many are the least near by the order above.
 */
export const MAX_WORDS = 64;

/**
 * The shortest word that counts. Under three characters, the words of a path are its
 * extensions and its fragments (`ts`, `md`, `v2`) — they say what FORMAT a file is in, and
 * a note that says `ts` is not about the file.
 */
const MIN_WORD = 3;

/**
 * The branch names that name no work: the ones git and every forge create a repository
 * with. A session on `main` has told nothing about its work by being there, and a note
 * that happens to say "main" is not nearer for it.
 */
const NAMES_NO_WORK: ReadonlySet<string> = new Set(['main', 'master']);

/** How long one git read may take before it counts as no signal. */
export const GIT_TIMEOUT_MS = 2000;

/** The most output one git read may produce before it counts as no signal. */
const GIT_MAX_BYTES = 4 * 1024 * 1024;

/** What every git read here runs with: no lock taken, no program of the repository's run. */
const READ_ONLY = ['-c', 'core.fsmonitor=false', '--no-optional-locks'];

/** Everything under the project's directory except the record itself — both reads' pathspec. */
const THE_PROJECT_NOT_THE_RECORD = ['--', '.', `:(exclude)${PROJECT_DIR}`];

/**
 * What the session opening at `projectRoot` touches: the working tree, the tasks in
 * progress in `sources`, the branch and the last commits, as words.
 */
export function whatTheSessionTouches(
  projectRoot: string,
  sources: readonly ScopedCache[],
): SessionTouch {
  const status = workingTree(projectRoot);
  const tasks = tasksInProgress(sources);
  const branchWords = branchWordsOf(status.branch);
  const committed = lastCommits(projectRoot);

  const words = new Wordlist();
  for (const path of status.changed) words.add(path);
  for (const title of tasks) words.add(title);
  words.addWords(branchWords);
  for (const path of committed.paths) words.add(path);

  return {
    words: words.list(),
    changed: status.changed.length,
    tasks: tasks.length,
    branch: branchWords.length > 0,
    commits: committed.commits,
  };
}

/** The words, each once (case aside), in the order they were first met, up to the cap. */
class Wordlist {
  private readonly seen = new Set<string>();
  private readonly words: string[] = [];

  add(text: string): void {
    this.addWords(wordsOf(text));
  }

  addWords(words: readonly string[]): void {
    for (const word of words) {
      if (this.words.length >= MAX_WORDS) return;
      if (word.length < MIN_WORD) continue;
      const folded = word.toLowerCase();
      if (this.seen.has(folded)) continue;
      this.seen.add(folded);
      this.words.push(word);
    }
  }

  list(): readonly string[] {
    return this.words;
  }
}

/** The paths changed in the working tree, and the branch's name when HEAD is on one. */
function workingTree(root: string): { readonly changed: string[]; readonly branch?: string } {
  const out = git(root, [
    'status',
    '--porcelain=v2',
    '-z',
    '--branch',
    // Pinned rather than left to the person's configuration, so a `status.showUntrackedFiles
    // = no` somewhere does not decide what a session is near. `all` and not `normal`: a new
    // directory is listed as `src/` under `normal`, and the words of the files in it — the
    // new work itself — never reach the ranking (measured on the binary: a session that had
    // just written `src/invoice/rounding.ts` was near nothing but `src`).
    '--untracked-files=all',
    '--ignore-submodules=all',
    ...THE_PROJECT_NOT_THE_RECORD,
  ]);
  if (out === null) return { changed: [] };
  return parseStatus(out);
}

/**
 * Reads `git status --porcelain=v2 -z --branch`: the branch from its header, and one path
 * per entry — the new path of a rename, whose original is the next NUL-separated field.
 * The field counts are git's documented ones for each entry type.
 */
export function parseStatus(out: string): { readonly changed: string[]; readonly branch?: string } {
  const changed: string[] = [];
  let branch: string | undefined;
  const entries = out.split('\0');
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i] as string;
    if (entry.startsWith('# branch.head ')) {
      const head = entry.slice('# branch.head '.length);
      if (head !== '(detached)') branch = head;
    } else if (entry.startsWith('1 ')) {
      changed.push(afterFields(entry, 8));
    } else if (entry.startsWith('2 ')) {
      changed.push(afterFields(entry, 9));
      i += 1;
    } else if (entry.startsWith('u ')) {
      changed.push(afterFields(entry, 10));
    } else if (entry.startsWith('? ')) {
      changed.push(entry.slice(2));
    }
  }
  return { changed: changed.filter((path) => path !== ''), ...(branch ? { branch } : {}) };
}

/** What follows the `n`th space of an entry — the path, which may itself hold spaces. */
function afterFields(entry: string, n: number): string {
  let at = -1;
  for (let k = 0; k < n; k += 1) {
    at = entry.indexOf(' ', at + 1);
    if (at === -1) return '';
  }
  return entry.slice(at + 1);
}

/** The words of a branch's name, less the ones that name no work. */
function branchWordsOf(branch: string | undefined): string[] {
  if (branch === undefined) return [];
  return wordsOf(branch).filter(
    (word) => word.length >= MIN_WORD && !NAMES_NO_WORK.has(word.toLowerCase()),
  );
}

/** The mark each commit's entry starts with in the log below — a byte no path holds. */
const COMMIT_MARK = '\u0001';

/** The paths of the last {@link COMMITS} commits that touched the project, newest first. */
function lastCommits(root: string): { readonly paths: string[]; readonly commits: number } {
  const out = git(root, [
    'log',
    `-n${COMMITS}`,
    // A merge lists no file by default, so a history of merges would read as no work at
    // all; the commits a merge brought in are the ones that name it.
    '--no-merges',
    '--no-show-signature',
    '--format=%x01',
    '--name-only',
    '-z',
    ...THE_PROJECT_NOT_THE_RECORD,
  ]);
  if (out === null) return { paths: [], commits: 0 };
  return parseLog(out);
}

/** Reads the log above: a mark per commit, then its paths, NUL-separated. */
export function parseLog(out: string): { readonly paths: string[]; readonly commits: number } {
  const paths: string[] = [];
  let commits = 0;
  for (const raw of out.split('\0')) {
    const entry = raw.replace(/^\n+/, '');
    if (entry === COMMIT_MARK) commits += 1;
    else if (entry !== '') paths.push(entry);
  }
  return { paths, commits };
}

/** The state a task is in while somebody works on it — typed, so a renamed state does not compile. */
const IN_PROGRESS: TaskState = 'IN_PROGRESS';

/** The titles of the tasks in progress, out of every tree read, by id. */
function tasksInProgress(sources: readonly ScopedCache[]): string[] {
  return sources
    .flatMap(({ cache }) => cache.listTasksByState(IN_PROGRESS))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((task) => task.title);
}

/** One read-only git in `root`, or `null` for every outcome that is not an answer. */
function git(root: string, args: readonly string[]): string | null {
  const ran = spawnSync('git', [...READ_ONLY, ...args], {
    cwd: root,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BYTES,
  });
  if (ran.error !== undefined || ran.status !== 0) return null;
  return ran.stdout;
}
