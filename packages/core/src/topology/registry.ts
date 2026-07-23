/**
 * The project index: a machine-local record of where a person's projects live —
 * "there is a `.mnema/` at /path/X" for each one.
 *
 * It exists so a surface can answer "where are my projects on this machine?"
 * without walking the whole filesystem, and so a server with an arbitrary
 * working directory has a list of REAL project roots instead of guessing. It is
 * the piece {@link registerProject} writes when a project is established and
 * {@link listProjects} reads back.
 *
 * It is a DISCOVERY CACHE, not truth and never proof:
 *   - it is machine-local and unversioned — a clone of a project never has it,
 *     so it can NEVER be required to verify or read a chain (that always works
 *     from the chain alone);
 *   - it is reconstructible — if the file is lost, the next `init` re-registers
 *     and a filesystem scan could rebuild it, so nothing depends on it surviving;
 *   - it attests nothing — it only points at where to look; the truth of a
 *     project is always its chain (verify), never an entry here.
 *
 * Like {@link resolveTrees}, resolution is pure: `env` is injected, so the rule
 * is testable without touching the real environment, and the file it reads and
 * writes is derived from that same {@link appDataDir}.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { appDataDir, type DiscoveryEnv } from './resolve.js';

/** The index file's name under the app data directory. */
export const PROJECTS_FILE = 'projects.json';

/** One registered project: the absolute path to its public `.mnema/` tree. */
export interface RegisteredProject {
  /** The absolute path of the project's public tree (`<repo>/.mnema`). */
  readonly root: string;
}

/** The on-disk shape of the index. Versioned so a future reader can adapt. */
interface IndexFile {
  readonly version: 1;
  readonly projects: readonly RegisteredProject[];
}

/** The index file's path within the resolved app data directory. */
export function projectsIndexPath(env: DiscoveryEnv): string {
  return join(appDataDir(env), PROJECTS_FILE);
}

/**
 * Reads the index, or an empty list when it is absent or unreadable. A missing
 * index is not an error — it is a cache that has not been written yet, or was
 * lost; either way the honest answer is "no projects recorded here", never a
 * throw. A malformed file is treated the same: the cache is reconstructible, so
 * a corrupt one is discarded, not fatal.
 */
export function listProjects(env: DiscoveryEnv): readonly RegisteredProject[] {
  return readIndex(env).projects;
}

/**
 * Records a project's public tree in the index, idempotently: registering the
 * same root again does not duplicate it. Returns the full list after the write,
 * so a caller sees the resulting state without a second read.
 *
 * This writes a CACHE, not a chain — there is no gate and no event. It is safe
 * to call on every `init`; a re-init of an existing project simply re-asserts
 * the same entry.
 */
export function registerProject(root: string, env: DiscoveryEnv): readonly RegisteredProject[] {
  const current = readIndex(env);
  if (current.projects.some((p) => p.root === root)) return current.projects;

  const next: IndexFile = {
    version: 1,
    projects: [...current.projects, { root }],
  };
  writeIndex(env, next);
  return next.projects;
}

/** Reads and validates the index file, falling back to empty on any problem. */
function readIndex(env: DiscoveryEnv): IndexFile {
  let raw: string;
  try {
    raw = readFileSync(projectsIndexPath(env), 'utf8');
  } catch {
    return { version: 1, projects: [] };
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return normalize(parsed);
  } catch {
    return { version: 1, projects: [] };
  }
}

/**
 * Coerces parsed JSON into a valid {@link IndexFile}, keeping only well-formed
 * entries. A cache read is defensive: an entry that is not `{ root: string }` is
 * dropped rather than trusted, because a garbled cache must never surface a
 * bogus path as a real project.
 */
function normalize(parsed: unknown): IndexFile {
  if (typeof parsed !== 'object' || parsed === null) return { version: 1, projects: [] };
  const projects = (parsed as { projects?: unknown }).projects;
  if (!Array.isArray(projects)) return { version: 1, projects: [] };
  const clean: RegisteredProject[] = [];
  for (const entry of projects) {
    if (typeof entry === 'object' && entry !== null) {
      const root = (entry as { root?: unknown }).root;
      if (typeof root === 'string' && root.length > 0) clean.push({ root });
    }
  }
  return { version: 1, projects: clean };
}

/** Writes the index, creating the app data directory if it does not exist. */
function writeIndex(env: DiscoveryEnv, index: IndexFile): void {
  const path = projectsIndexPath(env);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
}
