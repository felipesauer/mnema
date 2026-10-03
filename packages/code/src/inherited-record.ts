/**
 * A record read from another repository, at one commit — what a project INHERITS.
 *
 * A project points at a repository of decisions (any git repository whose tree holds a mnema
 * record) by two facts in a committed file, `.mnema/inherit.json`: where it is, and the commit.
 * The commit is the whole of what makes this provable. A branch name moves under a reader; a
 * commit does not, so "what this project inherited" is the same bytes for everyone who clones it
 * and a verdict over them is a verdict about those bytes.
 *
 * WHAT THIS DOES NOT DO IS AS DELIBERATE AS WHAT IT DOES.
 *  - It never writes to the where and never into the project's own chain: an inherited decision
 *    is read, so it is not signed by the project, is not in any tree the project's `verify`
 *    covers, and cannot be confused with a decision the project made.
 *  - It never reaches the network on a read. Only `fetchOrigin` does, and only the two verbs that
 *    point or move the pointer call it — plus the one read that finds the pinned commit missing
 *    from this machine, once, which is what lets a fresh clone have what it points at.
 *  - It reads what VERIFIES. The record at the commit is checked with the same `verify` the
 *    project's own is; a record that does not verify there contributes nothing, and the reading
 *    says so ({@link InheritedReading}).
 *
 * The copy lives under the mnema data directory (`<data>/inherited/<where digest>/`), never in
 * the project's tree: a bare repository fetched into, and one extracted copy of `.mnema/` per
 * commit read. Git is run with an argument array, never through a shell.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { catalogUpcasters, verify } from '@mnema/chain';
import { brief } from '@mnema/context';
import type { ResolvedTrees } from '@mnema/core';
import {
  ASKS_A_PERSON_CHANNEL,
  EDIT_PUSH_CHANNEL,
  REFUSES_A_WRITE_CHANNEL,
} from './record-framing.js';
import { withCache } from './tree-sources.js';

/** The committed file, inside the project's tree, that names what is inherited. */
export const POINTER_FILE = 'inherit.json';

/** A full object name: 40 hex digits, or 64 for a SHA-256 repository. */
const COMMIT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/** What a project inherits from: a repository, and the one commit of it that is read. */
export interface Pointer {
  readonly where: string;
  readonly commit: string;
}

/** One inherited decision in force, as the where's record names it. */
export interface InheritedRule {
  readonly id: string;
  readonly adr: string;
  readonly title: string;
}

/** What the pointer file holds, or why it cannot be used. */
export type PointerRead =
  | { readonly state: 'absent' }
  | { readonly state: 'found'; readonly pointer: Pointer }
  | { readonly state: 'invalid'; readonly why: string };

/**
 * What reading the inherited record at its pinned commit came to.
 *
 * Four outcomes and only the first carries decisions: the others each say, in a sentence, why
 * there are none, because an absence nobody explains is read as "the where has no rules".
 */
export type InheritedReading =
  | {
      readonly state: 'read';
      readonly pointer: Pointer;
      readonly decisions: readonly InheritedRule[];
    }
  | { readonly state: 'unverified'; readonly pointer: Pointer; readonly why: string }
  | { readonly state: 'unavailable'; readonly pointer: Pointer; readonly why: string }
  | { readonly state: 'invalid'; readonly why: string };

/** Reads `<tree>/inherit.json`. */
export function readPointer(projectPublic: string): PointerRead {
  const file = join(projectPublic, POINTER_FILE);
  if (!existsSync(file)) return { state: 'absent' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return { state: 'invalid', why: `${POINTER_FILE} is not valid JSON` };
  }
  const { origin: where, commit } = (parsed ?? {}) as { origin?: unknown; commit?: unknown };
  if (typeof where !== 'string' || where.length === 0 || where.startsWith('-')) {
    return { state: 'invalid', why: `${POINTER_FILE} has no usable "origin"` };
  }
  if (typeof commit !== 'string' || !COMMIT.test(commit)) {
    return { state: 'invalid', why: `${POINTER_FILE} has no full "commit" hash` };
  }
  return { state: 'found', pointer: { where, commit } };
}

/** Writes the pointer file — the only file this feature writes into a project. */
export function writePointer(projectPublic: string, pointer: Pointer): void {
  writeFileSync(
    join(projectPublic, POINTER_FILE),
    `${JSON.stringify({ origin: pointer.where, commit: pointer.commit }, null, 2)}\n`,
  );
}

/** Where a project's copies of one where live: under the data directory, outside the project. */
function homeOf(trees: ResolvedTrees, where: string): string {
  const digest = createHash('sha256').update(where).digest('hex').slice(0, 16);
  return join(dirname(trees.global), 'inherited', digest);
}

/**
 * What `git` is asked to fetch from. A path written relative is relative to the project's root,
 * the way a file in the repository would read it; a URL is left as it is.
 */
function sourceOf(where: string, projectRoot: string): string {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(where) || /^[\w.-]+@[\w.-]+:/.test(where)) return where;
  return resolve(projectRoot, where);
}

/** A git failure, with the last line git said — the part a person can act on. */
export class GitFailed extends Error {
  override readonly name = 'GitFailed';
}

function git(args: readonly string[], binary = false): Buffer | string {
  try {
    return execFileSync('git', ['-c', 'gc.auto=0', '-c', 'maintenance.auto=false', ...args], {
      encoding: binary ? 'buffer' : 'utf8',
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120_000,
      maxBuffer: 1024 * 1024 * 1024,
    });
  } catch (error) {
    const stderr = String((error as { stderr?: unknown }).stderr ?? '').trim();
    throw new GitFailed(stderr.split('\n').pop() || (error as Error).message);
  }
}

/** The bare repository the where is fetched into, created on first use. */
function repoOf(home: string): string {
  const repo = join(home, 'repo.git');
  if (!existsSync(repo)) {
    mkdirSync(home, { recursive: true });
    git(['init', '--bare', '--quiet', repo]);
  }
  return repo;
}

/** Whether this machine's copy of the where holds the commit. */
function holds(repo: string, commit: string): boolean {
  try {
    git(['-C', repo, 'cat-file', '-e', `${commit}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

/** Brings the where's heads into the local copy. The only call here that may use the network. */
function fetchOrigin(repo: string, source: string): void {
  git([
    '-C',
    repo,
    'fetch',
    '--quiet',
    '--no-tags',
    '--',
    source,
    '+HEAD:refs/mnema/head',
    '+refs/heads/*:refs/mnema/heads/*',
  ]);
}

/** The `.mnema/` of one commit, extracted once and never changed (a commit does not change). */
function materialize(home: string, repo: string, commit: string): string {
  const dest = join(home, 'at', commit);
  if (existsSync(join(dest, '.mnema'))) return join(dest, '.mnema');
  const archive = git(
    ['-C', repo, 'archive', '--format=tar', commit, '--', '.mnema/tails', '.mnema/keys'],
    true,
  ) as Buffer;
  const partial = `${dest}.partial-${process.pid}`;
  rmSync(partial, { recursive: true, force: true });
  mkdirSync(partial, { recursive: true });
  try {
    execFileSync('tar', ['-x', '-C', partial], {
      input: archive,
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    mkdirSync(dirname(dest), { recursive: true });
    try {
      renameSync(partial, dest);
    } catch {
      // Another reader extracted the same commit first; theirs is the same bytes.
    }
  } finally {
    rmSync(partial, { recursive: true, force: true });
  }
  return join(dest, '.mnema');
}

/** The decisions in force of one extracted record, once it verifies — or why it does not. */
function readRecord(
  root: string,
):
  | { readonly ok: true; readonly decisions: readonly InheritedRule[] }
  | { ok: false; why: string } {
  try {
    const upcasters = catalogUpcasters();
    const verdict = verify(root, upcasters);
    if (!verdict.ok) return { ok: false, why: verdict.summary };
    const decisions = withCache(
      root,
      upcasters,
      (cache) =>
        brief([{ scope: 'public', chainRoot: root, cache }], {
          editPush: EDIT_PUSH_CHANNEL,
          asksAPerson: ASKS_A_PERSON_CHANNEL,
          refusesAWrite: REFUSES_A_WRITE_CHANNEL,
        }).decisions,
    );
    return {
      ok: true,
      decisions: decisions.map((d) => ({ id: d.id, adr: d.adr, title: d.title })),
    };
  } catch (error) {
    return { ok: false, why: (error as Error).message };
  }
}

/**
 * Reads the record a pointer names, at that commit.
 *
 * `mayFetch` is whether a commit missing from this machine may be asked of the where: a read
 * of the brief says yes once (a fresh clone has nothing yet), and the update's look at the
 * PREVIOUS commit says no (it asks only what it already has).
 */
export function readInherited(
  trees: ResolvedTrees,
  pointer: Pointer,
  mayFetch: boolean,
): InheritedReading {
  const projectRoot = dirname(trees.projectPublic as string);
  const home = homeOf(trees, pointer.where);
  let root: string;
  try {
    const repo = repoOf(home);
    if (!holds(repo, pointer.commit) && mayFetch) {
      try {
        fetchOrigin(repo, sourceOf(pointer.where, projectRoot));
      } catch (error) {
        return {
          state: 'unavailable',
          pointer,
          why: `this machine has no copy of that commit and ${pointer.where} could not be reached (${(error as Error).message})`,
        };
      }
    }
    if (!holds(repo, pointer.commit)) {
      return { state: 'unavailable', pointer, why: 'this machine has no copy of that commit' };
    }
    try {
      root = materialize(home, repo, pointer.commit);
    } catch {
      return { state: 'unverified', pointer, why: 'that commit holds no mnema record' };
    }
  } catch (error) {
    return { state: 'unavailable', pointer, why: (error as Error).message };
  }
  const read = readRecord(root);
  return read.ok
    ? { state: 'read', pointer, decisions: read.decisions }
    : { state: 'unverified', pointer, why: read.why };
}

/** What the project's own pointer reads as, or `undefined` when it inherits nothing. */
export function readProjectInherited(trees: ResolvedTrees): InheritedReading | undefined {
  if (trees.projectPublic === undefined) return undefined;
  const found = readPointer(trees.projectPublic);
  if (found.state === 'absent') return undefined;
  if (found.state === 'invalid') return found;
  return readInherited(trees, found.pointer, true);
}

/** The commit a revision of the where names, after fetching — or why none. */
export function resolveAtOrigin(
  trees: ResolvedTrees,
  where: string,
  rev: string | undefined,
):
  | { readonly ok: true; readonly commit: string }
  | {
      readonly ok: false;
      readonly reason: 'UNREACHABLE' | 'NO_SUCH_REVISION';
      readonly detail: string;
    } {
  const projectRoot = dirname(trees.projectPublic as string);
  if (rev?.startsWith('-') === true) {
    return { ok: false, reason: 'NO_SUCH_REVISION', detail: `${rev} is not a revision` };
  }
  let repo: string;
  try {
    repo = repoOf(homeOf(trees, where));
    fetchOrigin(repo, sourceOf(where, projectRoot));
  } catch (error) {
    return { ok: false, reason: 'UNREACHABLE', detail: (error as Error).message };
  }
  const candidates = rev === undefined ? ['refs/mnema/head'] : [rev, `refs/mnema/heads/${rev}`];
  for (const candidate of candidates) {
    try {
      const commit = String(
        git(['-C', repo, 'rev-parse', '--verify', '--quiet', `${candidate}^{commit}`]),
      ).trim();
      if (COMMIT.test(commit)) return { ok: true, commit };
    } catch {
      // try the next spelling
    }
  }
  return {
    ok: false,
    reason: 'NO_SUCH_REVISION',
    detail: rev === undefined ? `${where} has no HEAD commit` : `${where} has no revision ${rev}`,
  };
}

/** How many commits lie between two, when this machine holds both. */
export function commitsBetween(
  trees: ResolvedTrees,
  where: string,
  from: string,
  to: string,
): number | undefined {
  try {
    const repo = repoOf(homeOf(trees, where));
    return Number(String(git(['-C', repo, 'rev-list', '--count', `${from}..${to}`])).trim());
  } catch {
    return undefined;
  }
}
