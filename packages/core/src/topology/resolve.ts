/**
 * Tree discovery: from a working directory, resolve WHICH trees a person writes
 * to and reads from. There are three, plus the one key they all reference.
 *
 * A person has one identity (one key) used across every tree, and up to three
 * places their events live:
 *
 *   - PROJECT-PUBLIC  `<repo>/.mnema/`          committed; the team sees it.
 *   - PROJECT-PRIVATE `<repo>/.mnema/private/`  gitignored; only this machine,
 *                                               only this project.
 *   - GLOBAL-PRIVATE  `<data>/mnema/global/`    only this machine, ACROSS all
 *                                               projects (personal knowledge).
 *
 * and the KEY ROOT `<data>/mnema/identity/` — where the private key lives once,
 * referenced by all three trees (never copied into any chain).
 *
 * Discovery mirrors two consecrated tools, not the alpha: the PROJECT root is
 * found by walking up directories until a `.mnema/` appears (as git finds
 * `.git`), so it works from any subdirectory; the GLOBAL/identity root follows
 * XDG (`$XDG_DATA_HOME/mnema`, falling back to `~/.mnema`). The project trees are
 * OPTIONAL — run outside a repo and only the global tree resolves.
 *
 * This is pure resolution: it computes paths, it does NOT create directories or
 * read chains. `env` and `home` are injected so the rule is testable without
 * touching the real environment.
 */

import { statSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';

/** The directory name a project tree lives in, at a repo's root. */
export const PROJECT_DIR = '.mnema';
/** The subdirectory of the public project tree that holds the private tree. */
export const PRIVATE_DIR = 'private';
/** The application directory under the XDG data home (or `~`). */
export const APP_DIR = 'mnema';
/** The global chain's directory under the app directory. */
export const GLOBAL_DIR = 'global';
/** The key root's directory under the app directory. */
export const IDENTITY_DIR = 'identity';

/** The environment inputs discovery reads — injected so the rule is testable. */
export interface DiscoveryEnv {
  /** `$XDG_DATA_HOME`, if set. When absent, the home fallback is used. */
  readonly xdgDataHome?: string | undefined;
  /** The user's home directory, for the `~/.mnema` fallback. */
  readonly home: string;
}

/**
 * The trees resolved from a working directory. The project trees are present
 * only inside a project (a `.mnema/` was found by walking up); the global tree
 * and key root always resolve.
 */
export interface ResolvedTrees {
  /** `<repo>/.mnema` — committed, team-visible. Absent outside a project. */
  readonly projectPublic?: string;
  /** `<repo>/.mnema/private` — gitignored, this machine. Absent outside a project. */
  readonly projectPrivate?: string;
  /** `<data>/mnema/global` — this machine, across all projects. Always present. */
  readonly global: string;
  /** `<data>/mnema/identity` — the key root the three trees reference. Always present. */
  readonly keyRoot: string;
}

/**
 * Resolves the trees reachable from `cwd`.
 *
 * The project trees come from the nearest ancestor directory that contains a
 * `.mnema/` DIRECTORY; if none exists up to the filesystem root, there is no
 * project and only the global tree and key root are returned. The global tree
 * and key root come from the app data directory: `$XDG_DATA_HOME/mnema` when the
 * variable is a non-empty ABSOLUTE path, otherwise `~/.mnema`.
 */
export function resolveTrees(cwd: string, env: DiscoveryEnv): ResolvedTrees {
  const appDir = appDataDir(env);
  const base: ResolvedTrees = {
    global: join(appDir, GLOBAL_DIR),
    keyRoot: join(appDir, IDENTITY_DIR),
  };

  const projectPublic = findProjectRoot(cwd);
  if (projectPublic === undefined) return base;

  return {
    projectPublic,
    projectPrivate: join(projectPublic, PRIVATE_DIR),
    ...base,
  };
}

/**
 * The application data directory: `$XDG_DATA_HOME/mnema` when the variable is a
 * non-empty absolute path, else `~/.mnema`. A relative or empty `XDG_DATA_HOME`
 * is treated as unset — the XDG spec requires an absolute path, and honoring a
 * relative one would anchor a machine-global tree to a working directory.
 *
 * Exported so anything else that must live in the same app data directory — the
 * project index (a discovery cache) among them — resolves it by the ONE rule,
 * never a second copy that could drift from where the global tree and key root
 * actually land.
 */
export function appDataDir(env: DiscoveryEnv): string {
  const xdg = env.xdgDataHome;
  if (xdg !== undefined && xdg.length > 0 && isAbsolute(xdg)) {
    return join(xdg, APP_DIR);
  }
  return join(env.home, `.${APP_DIR}`);
}

/**
 * Walks up from `cwd` looking for a directory that contains a `.mnema/`
 * directory, returning that `.mnema/` path (the public project tree) or
 * undefined at the filesystem root. A `.mnema` that is a FILE, not a directory,
 * does not count — it is not a tree.
 */
function findProjectRoot(cwd: string): string | undefined {
  let dir = cwd;
  for (;;) {
    const candidate = join(dir, PROJECT_DIR);
    if (isDirectory(candidate)) return candidate;
    const parent = dirname(dir);
    // `dirname` of a filesystem root returns the root itself: the fixed point
    // ends the walk without a special-cased root string (works on POSIX and the
    // drive roots on Windows).
    if (parent === dir) return undefined;
    dir = parent;
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
