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
 * Location of the optional per-repo personal override, relative to the
 * project root. Gitignored by `init`, so it carries local tweaks (a
 * looser `enforcement_mode` in dev, a personal `sync.mode`) without
 * touching the team's committed `mnema.config.json`. Constrained to
 * {@link UserConfigSchema}, so it can never change project identity,
 * paths or workflow — only behaviour preferences.
 */
export const LOCAL_CONFIG_RELATIVE = '.mnema/config.local.json';

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
 * Thrown when the per-repo override (`.mnema/config.local.json`) exists
 * but violates {@link UserConfigSchema} — e.g. it tries to set a
 * project-only key. Kept distinct from {@link ConfigInvalidError} and
 * {@link UserConfigInvalidError} so the error names the local file.
 */
export class LocalConfigInvalidError extends Error {
  constructor(public readonly issues: unknown) {
    super(`${LOCAL_CONFIG_RELATIVE} is invalid`);
    this.name = 'LocalConfigInvalidError';
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

    // Precedence, lowest to highest:
    //   user-level defaults  <  project config  <  per-repo local override
    // The project always wins over the user global; the local override
    // wins over the project. Both the global and the local layer are
    // constrained to UserConfigSchema (behaviour preferences only), so
    // neither can change project identity/paths/workflow. Validation runs
    // once, on the fully merged object.
    const userDefaults = this.loadUserConfig();
    const withUser =
      userDefaults === null ? raw : deepMergeConfig(userDefaults as Record<string, unknown>, raw);

    const localOverride = this.loadLocalConfig(file);
    const merged =
      localOverride === null
        ? withUser
        : deepMergeConfig(withUser, localOverride as Record<string, unknown>);

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

  /**
   * Reads and validates the optional per-repo override that lives next to
   * the project config (`.mnema/config.local.json`). Returns `null` when
   * the file does not exist (the common case).
   *
   * @param configFile - Absolute path to the resolved project config file;
   *   the local override is looked up in the same directory
   * @throws LocalConfigInvalidError when the file exists but is malformed
   *   or sets a disallowed (project-only) key
   */
  loadLocalConfig(configFile: string): UserConfig | null {
    const file = path.join(path.dirname(configFile), 'config.local.json');
    if (!existsSync(file)) return null;
    const raw: unknown = JSON.parse(readFileSync(file, 'utf-8'));
    const parsed = UserConfigSchema.safeParse(raw);
    if (!parsed.success) throw new LocalConfigInvalidError(parsed.error.issues);
    return parsed.data;
  }
}

/** Sub-objects merged one level deep instead of replaced wholesale. */
const DEEP_MERGE_KEYS = ['sync', 'features', 'aging', 'github'] as const;

/**
 * Layers `override` on top of `base`: a top-level key present in
 * `override` wins; the {@link DEEP_MERGE_KEYS} sub-objects merge one level
 * deep so an override that sets a single sub-field doesn't drop the
 * others. Used for both merge steps — user-under-project and
 * project-under-local — since both are "the higher layer wins key by key".
 *
 * @param base - Lower-precedence object
 * @param override - Higher-precedence object (wins on every conflict)
 * @returns The merged object, ready for {@link ConfigSchema} validation
 */
function deepMergeConfig(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base, ...override };
  for (const key of DEEP_MERGE_KEYS) {
    const b = base[key];
    const o = override[key];
    if (
      typeof b === 'object' &&
      b !== null &&
      typeof o === 'object' &&
      o !== null &&
      !Array.isArray(o)
    ) {
      out[key] = { ...(b as Record<string, unknown>), ...(o as Record<string, unknown>) };
    }
  }
  return out;
}
