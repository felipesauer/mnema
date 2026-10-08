/**
 * Where git keeps a working tree's repository — read from the files git writes, without
 * running git.
 *
 * THE PRIVATE TREE USED TO LIVE IN THE WORKING TREE, at `<project>/.mnema/private/`, kept out of
 * commits by a `.gitignore` line. `git worktree remove` deletes an ignored file without asking,
 * and agents' hosts make and remove worktrees on their own, so every private note written in a
 * worktree went with it. A repository has one place no working tree owns and no `git add` can
 * stage: its common git directory, shared by every worktree of it and kept when one is removed.
 * The private tree lives there now ({@link privateTreePlace}).
 *
 * PURE, like the rest of discovery: it reads `.git` (a directory, or a file that names one) and
 * the `commondir` file a linked worktree's git directory carries — the two things git itself
 * reads to answer `git rev-parse --git-common-dir`. Measured against git on a linked worktree, a
 * submodule, `--separate-git-dir`, and a worktree of a bare repository.
 *
 * WHAT IT DOES NOT READ, declared: `$GIT_DIR`, `$GIT_COMMON_DIR` and `core.worktree`. A process
 * that points git elsewhere with them is answered from the `.git` on disk.
 */

import { readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

/** The directory name, under a git directory, that holds this product's private trees. */
const IN_GIT_DIR = 'mnema';

/** Where git keeps the repository a directory belongs to. */
export interface GitPlace {
  /** The top of the working tree: the directory holding `.git`. */
  readonly top: string;
  /** This working tree's own git directory (`.git`, or `.git/worktrees/<name>` for a linked one). */
  readonly gitDir: string;
  /** The git directory every worktree of the repository shares. */
  readonly commonDir: string;
}

/**
 * The repository `dir` belongs to: the nearest ancestor (or `dir` itself) holding a `.git` that
 * names a git directory. Undefined outside a repository, or where `.git` names nothing git
 * would take for one.
 */
export function gitPlaceOf(dir: string): GitPlace | undefined {
  let at = resolve(dir);
  for (;;) {
    const dotGit = join(at, '.git');
    const stat = statOrUndefined(dotGit);
    if (stat !== undefined) {
      const gitDir = stat.isDirectory() ? dotGit : gitDirNamedBy(dotGit, at);
      if (gitDir === undefined || statOrUndefined(join(gitDir, 'HEAD')) === undefined) {
        return undefined;
      }
      return { top: at, gitDir, commonDir: commonDirOf(gitDir) };
    }
    const parent = dirname(at);
    if (parent === at) return undefined;
    at = parent;
  }
}

/**
 * Where a project's private tree lives, and where THIS working tree keeps its installation id
 * for it — or undefined when the project is in no repository, and the tree stays in
 * `.mnema/private/`.
 *
 * The tree is `<common git dir>/mnema/<project, relative to the top>/private`: one per project
 * per repository, so every worktree reads and writes the same one and a separate clone has its
 * own. The installation id is the same path under THIS worktree's git directory: each worktree
 * writes its own tail and none waits on another's lock, and when a worktree is removed git
 * removes its git directory with the id, and the tail stays in the shared tree, closed.
 */
export function privateTreePlace(
  projectDir: string,
): { readonly tree: string; readonly installation: string } | undefined {
  const place = gitPlaceOf(projectDir);
  if (place === undefined) return undefined;
  const within = relative(place.top, resolve(projectDir));
  return {
    tree: join(place.commonDir, IN_GIT_DIR, within, 'private'),
    installation: join(place.gitDir, IN_GIT_DIR, within, 'private'),
  };
}

/** Whether `path` is `dir` or lies under it, by spelling. */
export function isWithin(path: string, dir: string): boolean {
  const rel = relative(resolve(dir), resolve(path));
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

/** The git directory a `.git` FILE names (`gitdir: <path>`), resolved against its directory. */
function gitDirNamedBy(dotGit: string, at: string): string | undefined {
  let text: string;
  try {
    text = readFileSync(dotGit, 'utf-8');
  } catch {
    return undefined;
  }
  const named = /^gitdir: *(.+?)\s*$/m.exec(text)?.[1];
  return named === undefined ? undefined : resolve(at, named);
}

/** A linked worktree's git directory names the shared one in `commondir`; any other is its own. */
function commonDirOf(gitDir: string): string {
  try {
    const named = readFileSync(join(gitDir, 'commondir'), 'utf-8').trim();
    if (named.length > 0) return resolve(gitDir, named);
  } catch {
    // No `commondir`: this git directory is the common one.
  }
  return gitDir;
}

function statOrUndefined(path: string): ReturnType<typeof statSync> | undefined {
  try {
    return statSync(path, { throwIfNoEntry: false });
  } catch {
    return undefined;
  }
}
