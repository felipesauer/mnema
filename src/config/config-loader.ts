import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { type Config, ConfigSchema } from './config-schema.js';

/**
 * Thrown when `mnema.config.json` is not found in the current directory
 * or any of its ancestors up to the filesystem root.
 */
export class ConfigNotFoundError extends Error {
  constructor() {
    super('mnema.config.json not found in current directory or any ancestor');
    this.name = 'ConfigNotFoundError';
  }
}

/**
 * Thrown when `mnema.config.json` exists but violates the schema.
 * The `issues` field carries the raw Zod issues for diagnostics.
 */
export class ConfigInvalidError extends Error {
  constructor(public readonly issues: unknown) {
    super('mnema.config.json is invalid');
    this.name = 'ConfigInvalidError';
  }
}

/**
 * Loads and validates `mnema.config.json` by walking the directory tree
 * upward (mirroring how `git` discovers its repository root).
 */
export class ConfigLoader {
  /**
   * Searches for `mnema.config.json` starting from the given directory,
   * walking up the parent chain until the filesystem root.
   *
   * @param startDir - Starting directory; defaults to `process.cwd()`
   * @returns Absolute path to the config file, or `null` if not found
   */
  findConfigFile(startDir: string = process.cwd()): string | null {
    let dir = path.resolve(startDir);
    const root = path.parse(dir).root;

    while (true) {
      const candidate = path.join(dir, 'mnema.config.json');
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

    const raw: unknown = JSON.parse(readFileSync(file, 'utf-8'));
    const parsed = ConfigSchema.safeParse(raw);
    if (!parsed.success) throw new ConfigInvalidError(parsed.error.issues);
    return parsed.data;
  }
}
