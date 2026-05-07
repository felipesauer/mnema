import path from 'node:path';

import { CONFIG_FILE_RELATIVE } from '../config/config-loader.js';

/**
 * Resolves the project root from the absolute path of the
 * configuration file.
 *
 * The config lives at `<projectRoot>/.mnema/mnema.config.json`, so
 * the project root is the parent of the parent — `path.dirname`
 * twice. This helper centralises that knowledge so callers do not
 * hard-code `dirname(dirname(...))`.
 *
 * @param configFile - Absolute path to `.mnema/mnema.config.json`
 * @returns Absolute path to the project root
 */
export function resolveProjectRoot(configFile: string): string {
  // Climb out of CONFIG_FILE_RELATIVE one segment at a time. We could
  // call dirname twice and hope CONFIG_FILE_RELATIVE never grows
  // deeper, but doing it generically keeps the two pieces in sync.
  const segments = CONFIG_FILE_RELATIVE.split('/').filter((s) => s.length > 0);
  let dir = configFile;
  for (let i = 0; i < segments.length; i += 1) {
    dir = path.dirname(dir);
  }
  return dir;
}
