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
 * A NOTE IS A DIRECT CHILD of that directory, ending in `.md`, and is not `MEMORY.md`, the index the
 * host keeps of the others. Nothing here reads a note's words: that is `readHostMemory`'s, in the
 * core, the reading `mnema decision import --format claude-memory` uses too.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

/** Where the host's memory is, as the host's own files say it. */
export interface HostMemoryPlace {
  /** `$CLAUDE_CONFIG_DIR`, else `~/.claude`. */
  readonly configDir: string;
  /** The `autoMemoryDirectory` setting, expanded, where a file the host reads it from sets one. */
  readonly directory: string | undefined;
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
  return { configDir, directory };
}

/** Whether `path` is a note of the host's memory: not the index, and inside the directory itself. */
export function isHostMemoryNote(path: string, place: HostMemoryPlace): boolean {
  if (!isAbsolute(path)) return false;
  const file = resolve(path);
  const name = basename(file);
  if (!/\.md$/i.test(name) || name.toLowerCase() === 'memory.md') return false;
  const directory = dirname(file);
  if (place.directory !== undefined) return directory === place.directory;
  return (
    basename(directory) === 'memory' &&
    dirname(dirname(directory)) === join(place.configDir, 'projects')
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
