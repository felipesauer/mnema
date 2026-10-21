/**
 * Where Claude Code keeps its own memory, and whether a file it just wrote is a note of it.
 *
 * THE DIRECTORY IS THE HOST'S TO SAY, and it says it in two places: the configuration directory
 * (`$CLAUDE_CONFIG_DIR`, else `~/.claude`), under which a project's notes are
 * `projects/<project>/memory/*.md`, and the `autoMemoryDirectory` setting, which moves them
 * elsewhere. The host reads that setting from a person's own settings and from the project's
 * `.claude/settings.local.json`, and ignores it in the checked-in `.claude/settings.json`, so a clone
 * cannot point it somewhere; this reads the same two files and leaves the third alone. A setting
 * that is neither absolute nor `~/…` is not followed: the default directory is assumed, and a note
 * the host writes elsewhere is not copied.
 *
 * AND THE PROJECT IS THIS ONE. Under `projects/` the host keeps one directory per project, named
 * after the project's root as 2.1.281 computes it (`defaultPath` and `uC` in its bundle): the top
 * of the git working tree the session is in, and for a LINKED WORKTREE the main working tree, the
 * one that holds the `.git` directory every worktree shares (so all worktrees of a repository share
 * one memory; on this machine no directory under `projects/` is named after a worktree, though
 * sessions ran in many); outside git, the session's own directory. The name is that path with every
 * character that is not an ASCII letter or digit turned into `-`; past 200 characters the host cuts
 * it and adds a hash of its own, which this does not compute, so there only the first 200 are
 * compared. A note in another project's directory is not this project's, and is not copied: a
 * session that writes there, or a payload that names such a path, copies nothing.
 * `autoMemoryDirectory` is already this project's: it is read from this project's local settings
 * and from the person's own, the files the host reads for this session.
 *
 * A NOTE IS A DIRECT CHILD of that directory, ending in `.md`, and is not `MEMORY.md`, the index the
 * host keeps of the others. Nothing here reads a note's words: that is `readHostMemory`'s, in the
 * core, the reading `mnema decision import --format claude-memory` uses too.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { gitPlaceOf } from '@mnema/core';

/** Where the host's memory is, as the host's own files say it. */
export interface HostMemoryPlace {
  /** `$CLAUDE_CONFIG_DIR`, else `~/.claude`. */
  readonly configDir: string;
  /** The `autoMemoryDirectory` setting, expanded, where a file the host reads it from sets one. */
  readonly directory: string | undefined;
  /** The name of this project's directory under `projects/`, as the host makes it. */
  readonly project: string;
}

/** The longest name the host gives a project's directory before it cuts it and adds a hash. */
const LONGEST_NAME = 200;

/**
 * The directory the host names a project's memory after: the main working tree of the repository
 * `projectDir` is in (a linked worktree's own path is not used), else `projectDir` itself.
 */
function hostProjectRoot(projectDir: string): string {
  const place = gitPlaceOf(projectDir);
  if (place === undefined) return resolve(projectDir);
  return basename(place.commonDir) === '.git' ? dirname(place.commonDir) : place.top;
}

/** The name the host gives `root`'s directory under `projects/`, before any cut. */
function hostProjectName(root: string): string {
  return root.replace(/[^a-zA-Z0-9]/g, '-');
}

/** Whether a directory under `projects/` is named after this project. */
function namedAfter(segment: string, project: string): boolean {
  if (project.length <= LONGEST_NAME) return segment === project;
  return segment.startsWith(`${project.slice(0, LONGEST_NAME)}-`);
}

/** The characters of the content's hash a copied note's marker carries. */
const DIGEST_LENGTH = 12;

/** The `autoMemoryDirectory` of a settings file, or `undefined` where it sets none it can be. */
function settingIn(file: string, home: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const value = (parsed as Record<string, unknown>)['autoMemoryDirectory'];
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  if (value.startsWith('~/')) return resolve(home, value.slice(2));
  return isAbsolute(value) ? resolve(value) : undefined;
}

/**
 * Where the host keeps its memory for the project at `projectDir`.
 *
 * @param env `CLAUDE_CONFIG_DIR` as the host exported it, and the home `~` stands for.
 */
export function hostMemoryPlace(
  env: { readonly CLAUDE_CONFIG_DIR?: string | undefined; readonly home: string },
  projectDir: string,
): HostMemoryPlace {
  const named = env.CLAUDE_CONFIG_DIR ?? '';
  const configDir = named !== '' ? resolve(named) : join(env.home, '.claude');
  // The project's own local file first, then the person's: the order the host reads them in.
  const directory =
    settingIn(join(projectDir, '.claude', 'settings.local.json'), env.home) ??
    settingIn(join(configDir, 'settings.json'), env.home);
  return { configDir, directory, project: hostProjectName(hostProjectRoot(projectDir)) };
}

/** Whether `path` is a note of this project's memory: not the index, inside the directory itself. */
export function isHostMemoryNote(path: string, place: HostMemoryPlace): boolean {
  if (!isAbsolute(path)) return false;
  const file = resolve(path);
  const name = basename(file);
  if (!/\.md$/i.test(name) || name.toLowerCase() === 'memory.md') return false;
  const directory = dirname(file);
  if (place.directory !== undefined) return directory === place.directory;
  return (
    basename(directory) === 'memory' &&
    dirname(dirname(directory)) === join(place.configDir, 'projects') &&
    namedAfter(basename(dirname(directory)), place.project)
  );
}

/**
 * The marker a copied note carries: the file's name and a hash of its whole content. A note copied
 * twice with the same content carries the same marker, which is how it is copied once; a note the
 * host rewrote carries a new one, and is copied again.
 */
export function hostMemoryMarker(file: string, content: string): string {
  const digest = createHash('sha256').update(content).digest('hex').slice(0, DIGEST_LENGTH);
  return `[host memory ${basename(file)} sha256:${digest}]`;
}

/** What every marker opens with: how a copied note is told from any other. */
export const HOST_MEMORY_MARK = '[host memory ';
