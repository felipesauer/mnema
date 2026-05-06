import semver from 'semver';

import { VERSION } from './version.js';

/**
 * Result of a Mnema version compatibility check.
 */
export interface VersionCheckResult {
  readonly ok: boolean;
  readonly message?: string;
}

/**
 * Checks if the current Mnema version satisfies the project's required range.
 *
 * @param required - Semver range from `mnema.config.json` (e.g., `"^1.2.0"`)
 * @returns Check result with `ok` flag and optional human-readable message
 */
export function checkVersion(required: string): VersionCheckResult {
  if (!semver.satisfies(VERSION, required)) {
    return {
      ok: false,
      message: `Project requires mnema ${required}, you have ${VERSION}. Update with: npm i -g @saurim/mnema`,
    };
  }
  return { ok: true };
}
