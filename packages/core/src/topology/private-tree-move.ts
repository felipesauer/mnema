/**
 * The private trees left in working trees from before the private tree moved into the
 * repository's git directory (`git-place.ts`) — found, and moved there when a person asks.
 *
 * A project's private notes written before the move sit at `<worktree>/<project>/.mnema/private/`
 * in every worktree that wrote them. Nothing reads them there any more, and removing that
 * worktree still deletes them. `mnema doctor` says where they are; `mnema doctor --fix
 * private-tree` moves them.
 *
 * WHAT A MOVE DOES, entry by entry, and nothing else:
 *   - each tail (`tails/<id>/`) goes to the shared tree's `tails/`. Its id names a key and an
 *     installation, so tails of different worktrees never share a name; one that is already
 *     there with the same bytes is the same tail, and the old copy goes. One there with other
 *     bytes is left where it was, and said.
 *   - the installation id (`keys/<fingerprint>.inst`) goes to THIS worktree's own place for it,
 *     so the worktree goes on writing the tail it wrote before. Where that place already holds
 *     an id — the worktree wrote after the move — the old id is dropped, and the tail it named
 *     is moved all the same, as a closed tail nobody appends to.
 *   - the other key files (`.pub`, `.anchor`) go to the shared tree's `keys/`. The same key has
 *     the same public half and serves the same anchor in every worktree of one machine, so one
 *     already there is the same bytes, and the old copy goes. One with other bytes is left, and
 *     said.
 *   - `locks/` — the writers' locks, the projection a reader built, the heads a tail cited — is
 *     machinery and not record: it is discarded, and the next read rebuilds what it needs.
 *
 * Nothing in a tail is rewritten: a tail's files are moved as they are, under the name they had.
 * A file is never written over — a name already taken is compared, not replaced.
 */

import {
  constants,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { gitPlaceOf, privateTreePlace, privateTreeUnder } from './git-place.js';
import { PRIVATE_DIR, PROJECT_DIR } from './resolve.js';

/** A private tree a worktree holds where the private tree used to live. */
export interface LeftBehind {
  /** The top of the worktree that holds it. */
  readonly worktree: string;
  /** The tree itself: `<worktree>/<project>/.mnema/private`. */
  readonly tree: string;
  /** How many tails it holds. */
  readonly tails: number;
  /** Where this worktree keeps its installation id for the shared tree. */
  readonly installation: string;
}

/** Where a project's private tree lives now, and what its worktrees left in the old place. */
export interface PrivateTreesLeftBehind {
  /** The shared tree, in the repository's git directory. */
  readonly to: string;
  /** Every worktree's old tree that is still on disk; empty when none is. */
  readonly left: readonly LeftBehind[];
}

/**
 * The old private trees of the project at `projectDir`, in every worktree of its repository that
 * this machine can find — or undefined when the project is in no repository, where the private
 * tree has not moved.
 *
 * The worktrees are the one `projectDir` is in, the main one when the git directory is a
 * `.git` directory, and each linked one git lists under `<common git dir>/worktrees/`.
 */
export function privateTreesLeftBehind(projectDir: string): PrivateTreesLeftBehind | undefined {
  const place = gitPlaceOf(projectDir);
  const here = privateTreePlace(projectDir);
  if (place === undefined || here === undefined) return undefined;
  const within = relative(place.top, resolve(projectDir));

  const worktrees = new Map<string, string>([[place.top, place.gitDir]]);
  if (basename(place.commonDir) === '.git') {
    worktrees.set(dirname(place.commonDir), place.commonDir);
  }
  for (const name of listed(join(place.commonDir, 'worktrees'))) {
    const gitDir = join(place.commonDir, 'worktrees', name);
    let dotGit: string;
    try {
      dotGit = readFileSync(join(gitDir, 'gitdir'), 'utf-8').trim();
    } catch {
      continue;
    }
    if (dotGit.length > 0) worktrees.set(dirname(resolve(gitDir, dotGit)), gitDir);
  }

  const left: LeftBehind[] = [];
  for (const [worktree, gitDir] of worktrees) {
    const tree = join(worktree, within, PROJECT_DIR, PRIVATE_DIR);
    if (!isDirectory(tree)) continue;
    left.push({
      worktree,
      tree,
      tails: listed(join(tree, 'tails')).length,
      installation: privateTreeUnder(gitDir, within),
    });
  }
  return { to: here.tree, left };
}

/** What a move did. */
export interface MovedTree {
  /** The tails moved into the shared tree, by id. */
  readonly tails: readonly string[];
  /** The tails moved as closed tails, because the worktree already had an installation id. */
  readonly closed: readonly string[];
  /** Paths left where they were, because the same name holds other bytes in the shared tree. */
  readonly kept: readonly string[];
  /** Whether the old tree is gone. */
  readonly emptied: boolean;
}

/** Moves one old tree into the shared one at `to` — see the module's comment for each entry. */
export function movePrivateTree(left: LeftBehind, to: string): MovedTree {
  const tails: string[] = [];
  const closed: string[] = [];
  const kept: string[] = [];
  const from = left.tree;

  for (const tail of listed(join(from, 'tails'))) {
    const moved = moveEntry(join(from, 'tails', tail), join(to, 'tails', tail));
    if (moved === 'kept') kept.push(join(from, 'tails', tail));
    else tails.push(tail);
  }
  for (const file of listed(join(from, 'keys'))) {
    const source = join(from, 'keys', file);
    if (file.endsWith('.inst')) {
      const moved = moveEntry(source, join(left.installation, 'keys', file));
      if (moved === 'kept') {
        const id = readFileSync(source, 'utf-8').trim();
        closed.push(`${file.slice(0, -'.inst'.length)}-${id}`);
        rmSync(source);
      }
      continue;
    }
    if (moveEntry(source, join(to, 'keys', file)) === 'kept') kept.push(source);
  }
  rmSync(join(from, 'locks'), { recursive: true, force: true });
  for (const entry of listed(from)) {
    if (entry === 'tails' || entry === 'keys') continue;
    if (moveEntry(join(from, entry), join(to, entry)) === 'kept') kept.push(join(from, entry));
  }

  for (const dir of [join(from, 'tails'), join(from, 'keys'), from]) removeIfEmpty(dir);
  return { tails, closed, kept, emptied: !existsSync(from) };
}

/**
 * Moves `source` to `dest` when the name is free; drops `source` when `dest` holds the same
 * bytes; and keeps it, touching nothing, when `dest` holds other bytes.
 */
function moveEntry(source: string, dest: string): 'moved' | 'same' | 'kept' {
  if (existsSync(dest)) {
    if (!sameBytes(source, dest)) return 'kept';
    rmSync(source, { recursive: true, force: true });
    return 'same';
  }
  mkdirFor(dest);
  if (isDirectory(source)) {
    try {
      renameSync(source, dest);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
      // Another file system: copy whole under a name nobody reads, then take the name.
      const staging = `${dest}.moving-${process.pid}`;
      cpSync(source, staging, { recursive: true, errorOnExist: true, force: false });
      renameSync(staging, dest);
      rmSync(source, { recursive: true, force: true });
    }
    return 'moved';
  }
  // A file is copied with EXCL, so a name a writer took in the meantime is never written over.
  try {
    copyFileSync(source, dest, constants.COPYFILE_EXCL);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    if (!sameBytes(source, dest)) return 'kept';
  }
  rmSync(source);
  return 'moved';
}

/** Whether two paths hold the same bytes: a file's contents, or a directory's whole tree. */
function sameBytes(a: string, b: string): boolean {
  const aDir = isDirectory(a);
  if (aDir !== isDirectory(b)) return false;
  if (!aDir) return readFileSync(a).equals(readFileSync(b));
  const names = listed(a).sort();
  const others = listed(b).sort();
  if (names.length !== others.length || names.some((name, i) => name !== others[i])) return false;
  return names.every((name) => sameBytes(join(a, name), join(b, name)));
}

function mkdirFor(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}

function removeIfEmpty(dir: string): void {
  try {
    rmdirSync(dir);
  } catch {
    // Not empty, or not there: either way it stays as it is.
  }
}

function listed(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path, { throwIfNoEntry: false })?.isDirectory() === true;
  } catch {
    return false;
  }
}
