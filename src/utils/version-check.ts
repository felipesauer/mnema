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
 * `includePrerelease` is enabled so an alpha build (`0.1.0-alpha.N`)
 * still satisfies a project pinned to `^0.1.0`. Without it, semver's
 * default policy would fail the check the moment we publish an alpha
 * — which is precisely the moment users are most likely to be on one.
 *
 * @param required - Semver range from `mnema.config.json` (e.g., `"^1.2.0"`)
 * @returns Check result with `ok` flag and optional human-readable message
 */
export function checkVersion(required: string): VersionCheckResult {
  if (!semver.satisfies(VERSION, required, { includePrerelease: true })) {
    return {
      ok: false,
      message: `Project requires mnema ${required}, you have ${VERSION}. Update with: npm i -g @saurim/mnema`,
    };
  }
  return { ok: true };
}
