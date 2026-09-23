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
 * THE WALK USED TO TAKE THE FIRST `.mnema/` IT MET, and the two halves of the paragraph
 * above are what made that wrong: the fallback data directory is `~/.mnema`, named
 * exactly what the walk looks for. Measured on the built binary before this changed:
 * after the first `mnema init` anywhere on a machine with no `$XDG_DATA_HOME`, a note
 * taken in `~/Downloads` was answered "Landed in the public tree — committed with the
 * repository" and written into the machine's data directory, and every folder under the
 * home that was no project of its own was served as the project `~`. So the walk now
 * passes over two kinds of `.mnema/`, and there is ONE function that says which
 * ({@link whyNoProjectRootAt}) — asked by the walk here, by `mnema init` before it founds
 * anything, and by whatever offers to found a project.
 *
 * This is pure resolution: it computes paths, it does NOT create directories or
 * read chains. `env` and `home` are injected so the rule is testable without
 * touching the real environment.
 */

import { realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

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
 * Why a directory can be no project's root — see {@link whyNoProjectRootAt}, which is
 * the one place that decides it.
 *
 * A closed set, so a reason added here does not compile anywhere that has to say
 * something about each one until it has been given its words.
 */
export type NoProjectRoot = 'home' | 'data-directory';

/** A `.mnema/` the walk-up reached and would not take for a project's tree. */
export interface PassedOverTree {
  /** The `.mnema/` directory itself, spelled as the walk reached it. */
  readonly tree: string;
  /** Why the directory holding it can be no project's root. */
  readonly why: NoProjectRoot;
}

/**
 * What discovery answers from a working directory: the trees, and every `.mnema/` the
 * walk passed over on its way to them.
 *
 * The second half exists because passing over a tree is not the same as its not being
 * there. A `.mnema/` in a home can hold events written there before the walk learned to
 * pass it by — a machine this was built on had one, with a task in it — and a walk that
 * went past it in silence would make those events vanish from every answer without a word.
 * Nothing here reads them; the list says where they are, so a surface can tell the person.
 */
export interface Discovery {
  /** The trees the working directory resolves to — {@link resolveTrees}'s whole answer. */
  readonly trees: ResolvedTrees;
  /** Every `.mnema/` passed over, nearest first; empty when the walk met none. */
  readonly passedOver: readonly PassedOverTree[];
}

/**
 * Resolves the trees reachable from `cwd`.
 *
 * The project trees come from the nearest ancestor directory that contains a
 * `.mnema/` DIRECTORY and can be a project's root ({@link whyNoProjectRootAt}); if
 * none exists up to the filesystem root — or up to the home directory, where the walk
 * stops — there is no project and only the global tree and key root are returned.
 * The global tree and key root come from the app data directory:
 * `$XDG_DATA_HOME/mnema` when the variable is a non-empty ABSOLUTE path, otherwise
 * `~/.mnema`.
 */
export function resolveTrees(cwd: string, env: DiscoveryEnv): ResolvedTrees {
  return discover(cwd, env).trees;
}

/**
 * {@link resolveTrees}, with what the walk passed over — the SAME walk, not a second one.
 *
 * A surface that wants to say a tree was passed over asks this instead of walking again,
 * so what it says is about the walk that decided the trees and cannot come to describe a
 * different one.
 */
export function discover(cwd: string, env: DiscoveryEnv): Discovery {
  const appDir = appDataDir(env);
  const base: ResolvedTrees = {
    global: join(appDir, GLOBAL_DIR),
    keyRoot: join(appDir, IDENTITY_DIR),
  };

  const walked = walkUp(cwd, homeSpellings(env));
  if (walked.project === undefined) return { trees: base, passedOver: walked.passedOver };

  return {
    trees: {
      projectPublic: walked.project,
      projectPrivate: join(walked.project, PRIVATE_DIR),
      ...base,
    },
    passedOver: walked.passedOver,
  };
}

/**
 * Why `dir` can be no project's root, or undefined when it can be one. THE RULE, in the
 * one place it lives: the walk-up asks it of every directory it climbs through,
 * `mnema init` asks it before founding anything, and the surface that offers to found a
 * project asks it before offering.
 *
 * ## `home` — the home directory is never a project's root, and nothing above it is
 *
 * It is a statement about the DIRECTORY, whatever its `.mnema/` holds, and the walk
 * stops there. Three things were measured on the built binary before this rule existed,
 * each in a sandbox home:
 *
 *   - With `$XDG_DATA_HOME` unset, `~/.mnema` IS this machine's data directory. A
 *     project founded in the home shares that one directory with the private key and
 *     the global tree, and a project tree's `.gitignore` covers its own `keys/` — not
 *     `identity/`. In a home kept under git, as dotfiles often are, `git add .mnema`
 *     staged the machine's private key and the backup key.
 *   - With it set, the home tree still took every folder under the home that is no
 *     project of its own: a note about unrelated work, taken in `~/work/unrelated`, was
 *     answered "committed with the repository", and `git add .mnema` staged it.
 *   - And whether `~/.mnema` is the data directory depends on WHICH PROCESS ASKS: a
 *     terminal inside a snap-packaged editor carries a `$XDG_DATA_HOME` of its own, and
 *     a process started with no environment carries none. A rule keyed on what the
 *     directory HOLDS would give two answers about one directory; one keyed on where it
 *     IS gives one.
 *
 * Nothing above the home is taken either, because anything above it contains it — a
 * project found there would take the home and everything in it, which is the same fault
 * larger. A working directory OUTSIDE the home never meets it, and walks to the
 * filesystem root as it always did.
 *
 * The home is `env.home` — the environment's, which is what every other tool the person
 * runs takes for their home — spelled as written and as the filesystem resolves it, so a
 * home reached through a symlink is still the home. A relative or empty one is no home
 * at all, and names nothing: the rule reads the XDG variable the same way.
 *
 * ## `data-directory` — a `.mnema/` that holds a key root is a machine's data directory
 *
 * A project tree never contains an `identity/`; a data directory always does (every path
 * the product has that makes one makes the key root in it, a session that only reads
 * included — pinned in `a-client-that-names-no-workspace.test.ts`). This is what reaches
 * the data directory of ANOTHER environment, which the home rule cannot: `~/.mnema` keeps
 * its key root after `$XDG_DATA_HOME` is set, a run with a sandboxed `HOME` whose working
 * directory sits under a real one finds the real one, and `sudo` finds its user's. It is
 * passed over and the walk goes on, because it holds no project and whatever lies above it
 * is still the nearest one.
 *
 * It is ONE reading, and it was two when it lived in the server's working-directory rung:
 * the second — "it is the parent of the key root this environment resolves" — was a second
 * statement of the same fact, and removing it left every case green, so it was dropped
 * rather than kept as a guard nothing can light. That rung's own guard is gone now; this is
 * where the reading lives, for every rung and every verb.
 *
 * WHAT NEITHER READING REACHES, declared rather than guessed at: a project-shaped
 * `.mnema/` in the home of someone OTHER than the environment asking — a sandboxed run
 * under a real home whose `~/.mnema` a stray `init` made — looks like any project from
 * where that run stands. Nothing in it says otherwise, and the only reading that could is
 * the real home, which this pure function does not consult.
 */
export function whyNoProjectRootAt(dir: string, env: DiscoveryEnv): NoProjectRoot | undefined {
  return noProjectRootAt(dir, homeSpellings(env));
}

/**
 * The application data directory: `$XDG_DATA_HOME/mnema` when the variable is a
 * non-empty absolute path, else `~/.mnema`. A relative or empty `XDG_DATA_HOME`
 * is treated as unset — the XDG spec requires an absolute path, and honoring a
 * relative one would anchor a machine-global tree to a working directory.
 *
 * It is the ONE place that rule lives, and it has exactly one caller:
 * {@link discover}, which derives the global tree and the key root from it.
 * That is why it is module-private. It USED TO be exported, on the premise that
 * *"anything else that must live in the same app data directory — the project
 * index (a discovery cache) among them"* would resolve by the same rule instead of
 * a second copy. The project index was the only such thing, it was removed for
 * having no reader, and no second consumer ever appeared — so the export was a
 * public name with nothing outside this file behind it.
 *
 * The rule stays a named function rather than being inlined into
 * {@link discover}: the two paths that must agree (`global` and `keyRoot`) are
 * derived from one call, so there is still only one place to change.
 */
function appDataDir(env: DiscoveryEnv): string {
  const xdg = env.xdgDataHome;
  if (xdg !== undefined && xdg.length > 0 && isAbsolute(xdg)) {
    return join(xdg, APP_DIR);
  }
  return join(env.home, `.${APP_DIR}`);
}

/**
 * The spellings of the environment's home a walked directory is compared against: the
 * path as the environment wrote it, and the path the filesystem resolves it to. Empty
 * for a relative or empty home — see {@link whyNoProjectRootAt}.
 *
 * Both, because the walk climbs from a working directory the OS hands over already
 * resolved, while `HOME` is whatever was written into it: a home that is a symlink to
 * another disk would otherwise never be recognised on the way up.
 */
function homeSpellings(env: DiscoveryEnv): ReadonlySet<string> {
  if (!isAbsolute(env.home)) return new Set();
  const spellings = new Set([resolve(env.home)]);
  try {
    spellings.add(realpathSync.native(env.home));
  } catch {
    // A home that is not on disk is still the home the environment names; it is
    // compared as written.
  }
  return spellings;
}

/** {@link whyNoProjectRootAt}, over home spellings already read. */
function noProjectRootAt(dir: string, homes: ReadonlySet<string>): NoProjectRoot | undefined {
  if (isAbsolute(dir) && homes.has(resolve(dir))) return 'home';
  if (isDirectory(join(dir, PROJECT_DIR, IDENTITY_DIR))) return 'data-directory';
  return undefined;
}

/**
 * Walks up from `cwd` looking for a directory that contains a `.mnema/` directory
 * and can be a project's root, returning that `.mnema/` path (the public project tree)
 * — or undefined, at the home directory or at the filesystem root — together with every
 * `.mnema/` it passed over on the way. A `.mnema` that is a FILE, not a directory,
 * does not count — it is not a tree.
 */
function walkUp(
  cwd: string,
  homes: ReadonlySet<string>,
): { readonly project?: string; readonly passedOver: PassedOverTree[] } {
  const passedOver: PassedOverTree[] = [];
  let dir = cwd;
  for (;;) {
    const why = noProjectRootAt(dir, homes);
    const candidate = join(dir, PROJECT_DIR);
    if (isDirectory(candidate)) {
      if (why === undefined) return { project: candidate, passedOver };
      passedOver.push({ tree: candidate, why });
    }
    // The home directory ends the walk whatever it holds: nothing above it is a place a
    // folder under it belongs to.
    if (why === 'home') return { passedOver };
    const parent = dirname(dir);
    // `dirname` of a filesystem root returns the root itself: the fixed point
    // ends the walk without a special-cased root string (works on POSIX and the
    // drive roots on Windows).
    if (parent === dir) return { passedOver };
    dir = parent;
  }
}

/**
 * Whether `path` is a directory, answering a missing one WITHOUT an exception.
 *
 * The walk asks this twice for every directory it climbs — once for the `.mnema/` and once
 * for a key root inside it — and nearly every answer is "not there". A `statSync` that throws
 * on a missing path pays for an error object and its stack each time, and that was nearly
 * the whole of what the second question cost. Measured in alternating blocks against the
 * walk as it was before the second question existed (two copies of which agreed within
 * 2%): inside a project three levels down, 33 µs became 92 µs with the throwing check and
 * 41 µs with this one — the rest is resolving the home once per call; seven levels under a
 * home with no project, 112 µs became 143 µs, and 61 µs with this one, because the walk now
 * stops at the home instead of climbing to the root. Anything other than "not there" (a
 * path through a file, a directory it may not read) still throws, and is still `false`.
 */
function isDirectory(path: string): boolean {
  try {
    return statSync(path, { throwIfNoEntry: false })?.isDirectory() === true;
  } catch {
    return false;
  }
}
