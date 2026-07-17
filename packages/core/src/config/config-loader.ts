import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import {
  BEHAVIOUR_KEYS,
  type Config,
  ConfigSchema,
  DEEP_MERGE_KEYS,
  PROJECT_ONLY_KEYS,
} from './config-schema.js';

/**
 * Canonical location of the configuration file, relative to the
 * project root.
 */
export const CONFIG_FILE_RELATIVE = '.mnema/mnema.config.json';

/**
 * Location of the optional per-repo personal override, relative to the
 * project root. Gitignored by `init`, so it carries local tweaks (a
 * looser `enforcement_mode` in dev, personal flush cadence) without
 * touching the team's committed `mnema.config.json` — the coexistence
 * primitive for N humans/machines sharing one repo. Constrained to the
 * schema-derived {@link BEHAVIOUR_KEYS}, so it can never change project
 * identity or hooks — only behaviour preferences.
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
 * Thrown when the per-repo override (`.mnema/config.local.json`) exists
 * but is malformed JSON or sets a project-only key. Kept distinct from
 * {@link ConfigInvalidError} so the error names the local file.
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
 *
 * Two layers, lowest to highest precedence:
 *   project `mnema.config.json`  <  per-repo `.mnema/config.local.json`
 * The local override is structurally screened (behaviour keys only);
 * full schema validation runs ONCE, on the merged object — so a bad
 * local value fails with the same actionable message a bad project
 * value does, and the override surface can never drift from the schema.
 */
export class ConfigLoader {
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
   * Loads, parses and validates `mnema.config.json` (plus the optional
   * per-repo local override).
   *
   * @param startDir - Starting directory for the search
   * @returns Validated Config object with defaults applied
   * @throws ConfigNotFoundError if no config file is found
   * @throws ConfigInvalidError if the merged config violates the schema
   * @throws LocalConfigInvalidError if the local override is malformed
   *   or sets a project-only key
   */
  load(startDir?: string): Config {
    const file = this.findConfigFile(startDir);
    if (file === null) throw new ConfigNotFoundError();

    const raw = readJsonFile(file, (cause) => new ConfigInvalidError(cause)) as Record<
      string,
      unknown
    >;

    const localOverride = this.loadLocalConfig(file);
    const merged = localOverride === null ? raw : deepMergeConfig(raw, localOverride);

    const parsed = ConfigSchema.safeParse(merged);
    if (!parsed.success) throw new ConfigInvalidError(parsed.error.issues);
    return parsed.data;
  }

  /**
   * Reads the optional per-repo override that lives next to the project
   * config (`.mnema/config.local.json`). Returns `null` when the file
   * does not exist (the common case). The override is screened
   * structurally here — top-level keys must be schema-derived behaviour
   * keys — and its VALUES are validated by the single post-merge
   * `ConfigSchema` parse in {@link load}.
   *
   * @param configFile - Absolute path to the resolved project config file;
   *   the local override is looked up in the same directory
   * @throws LocalConfigInvalidError when the file is malformed JSON, is
   *   not an object, or sets a project-only key
   */
  loadLocalConfig(configFile: string): Record<string, unknown> | null {
    const file = path.join(path.dirname(configFile), 'config.local.json');
    if (!existsSync(file)) return null;
    const raw = readJsonFile(file, (cause) => new LocalConfigInvalidError(cause));
    if (!isPlainObject(raw)) {
      throw new LocalConfigInvalidError('config.local.json must be a JSON object');
    }
    for (const key of Object.keys(raw)) {
      if (!BEHAVIOUR_KEYS.includes(key)) {
        const reason = (PROJECT_ONLY_KEYS as readonly string[]).includes(key)
          ? `"${key}" is project-only and cannot be overridden locally`
          : `unknown key "${key}"`;
        throw new LocalConfigInvalidError(reason);
      }
    }
    return raw;
  }
}

/** True for a plain object (mergeable), false for arrays / null / scalars. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads a config file and parses it as JSON. A syntactically broken file
 * would otherwise throw Node's raw `SyntaxError` before schema validation
 * runs — a bare "Unexpected token" stack with no filename. Instead, the
 * parse failure is rethrown as the caller's typed error (carrying the
 * SyntaxError as its `issues`), so it renders as a clean, file-named line
 * exactly like a schema failure does.
 *
 * @param file - Absolute path to the config file
 * @param makeError - Builds the typed error for this config layer
 * @returns The parsed JSON value
 */
function readJsonFile(file: string, makeError: (cause: unknown) => Error): unknown {
  const raw = readFileSync(file, 'utf-8');
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw makeError(error);
  }
}

/**
 * Recursively merges two plain objects: the override wins on every leaf,
 * nested plain objects merge key-by-key, and arrays/scalars replace
 * wholesale — so a nested record like `aging.sla_days` keeps the base's
 * per-state keys when the override only sets one of them.
 */
function mergeObjectsDeep(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, o] of Object.entries(override)) {
    const b = out[key];
    out[key] = isPlainObject(b) && isPlainObject(o) ? mergeObjectsDeep(b, o) : o;
  }
  return out;
}

/**
 * Layers `override` on top of `base`: a top-level key present in
 * `override` wins; every {@link DEEP_MERGE_KEYS} sub-tree (derived from
 * the schema shape — every top-level object block) merges *recursively*
 * so an override that sets a single (possibly nested) sub-field doesn't
 * drop the others.
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
    if (isPlainObject(b) && isPlainObject(o)) {
      out[key] = mergeObjectsDeep(b, o);
    }
  }
  return out;
}
