import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import { type Config, ConfigSchema, type UserConfig, UserConfigSchema } from './config-schema.js';

/** User-level config location, relative to the home directory. */
export const USER_CONFIG_RELATIVE = '.config/mnema/config.json';

/**
 * Canonical location of the configuration file, relative to the
 * project root.
 */
export const CONFIG_FILE_RELATIVE = '.mnema/mnema.config.json';

/**
 * Thrown when `.mnema/mnema.config.json` is not found in the current
 * directory or any of its ancestors up to the filesystem root.
 */
export class ConfigNotFoundError extends Error {
  constructor() {
    super(`${CONFIG_FILE_RELATIVE} not found in current directory or any ancestor`);
    this.name = 'ConfigNotFoundError';
  }
}

/**
 * Thrown when the configuration file exists but violates the schema.
 * The `issues` field carries the raw Zod issues for diagnostics.
 */
export class ConfigInvalidError extends Error {
  constructor(public readonly issues: unknown) {
    super(`${CONFIG_FILE_RELATIVE} is invalid`);
    this.name = 'ConfigInvalidError';
  }
}

/**
 * Thrown when the user-level config (`~/.config/mnema/config.json`)
 * exists but violates {@link UserConfigSchema} — e.g. it tries to set a
 * project-only key. Kept distinct from {@link ConfigInvalidError} so the
 * error names the user file, not the project one.
 */
export class UserConfigInvalidError extends Error {
  constructor(public readonly issues: unknown) {
    super(`${USER_CONFIG_RELATIVE} is invalid`);
    this.name = 'UserConfigInvalidError';
  }
}

/**
 * Loads and validates the project configuration by walking the
 * directory tree upward (mirroring how `git` discovers its repository
 * root).
 */
export class ConfigLoader {
  /**
   * @param home - Resolver for the home directory. Defaults to
   *   `os.homedir`; tests inject a temp dir to exercise the user-level
   *   config without touching the real `~/.config`.
   */
  constructor(private readonly home: () => string = homedir) {}

  /**
   * Searches for `.mnema/mnema.config.json` starting from the given
   * directory, walking up the parent chain until the filesystem root.
   *
   * @param startDir - Starting directory; defaults to `process.cwd()`
   * @returns Absolute path to the config file, or `null` if not found
   */
  findConfigFile(startDir: string = process.cwd()): string | null {
    let dir = path.resolve(startDir);
    const root = path.parse(dir).root;

    while (true) {
      const candidate = path.join(dir, CONFIG_FILE_RELATIVE);
      if (existsSync(candidate)) return candidate;
      if (dir === root) return null;
      dir = path.dirname(dir);
    }
  }

  /**
   * Loads, parses and validates `mnema.config.json`.
   *
   * @param startDir - Starting directory for the search
   * @returns Validated Config object with defaults applied
   * @throws ConfigNotFoundError if no config file is found
   * @throws ConfigInvalidError if the config violates the schema
   */
  load(startDir?: string): Config {
    const file = this.findConfigFile(startDir);
    if (file === null) throw new ConfigNotFoundError();

    const raw = JSON.parse(readFileSync(file, 'utf-8')) as Record<string, unknown>;

    // Layer the user-level defaults UNDER the project config: the project
    // always wins key-by-key. Only behaviour preferences are mergeable
    // (UserConfigSchema), so project identity/paths/workflow can never be
    // set globally. Validation runs on the merged object.
    const userDefaults = this.loadUserConfig();
    const merged = userDefaults === null ? raw : mergeUnderProject(userDefaults, raw);

    const parsed = ConfigSchema.safeParse(merged);
    if (!parsed.success) throw new ConfigInvalidError(parsed.error.issues);
    return parsed.data;
  }

  /**
   * Reads and validates the optional user-level config. Returns `null`
   * when the file does not exist (the common case).
   *
   * @throws UserConfigInvalidError when the file exists but is malformed
   *   or sets a disallowed key
   */
  loadUserConfig(): UserConfig | null {
    const file = path.join(this.home(), USER_CONFIG_RELATIVE);
    if (!existsSync(file)) return null;
    const raw: unknown = JSON.parse(readFileSync(file, 'utf-8'));
    const parsed = UserConfigSchema.safeParse(raw);
    if (!parsed.success) throw new UserConfigInvalidError(parsed.error.issues);
    return parsed.data;
  }
}

/**
 * Merges user-level defaults under the project config: a top-level key
 * present in the project wins; `sync`/`features` merge one level deep so
 * a project that sets one sub-field doesn't drop the user's others.
 *
 * @param user - Validated user-level defaults
 * @param project - Raw project config (wins on every conflict)
 * @returns The merged object, ready for {@link ConfigSchema} validation
 */
function mergeUnderProject(
  user: UserConfig,
  project: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...user, ...project };
  for (const key of ['sync', 'features'] as const) {
    const u = user[key];
    const p = project[key];
    if (u !== undefined && p !== undefined && typeof p === 'object' && p !== null) {
      out[key] = { ...u, ...(p as Record<string, unknown>) };
    }
  }
  return out;
}
