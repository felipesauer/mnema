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
 * An alpha build (`0.1.0-alpha.N`) must still satisfy a project pinned to a
 * stable range like `^0.1.0` — that is precisely the moment users are most
 * likely to be on a prerelease. A prerelease sorts *below* its base version,
 * so we also test the coerced base (`0.1.0`) against the range; if either the
 * full version or its base matches, the build is considered compatible.
 * `includePrerelease` keeps prerelease ranges (`^1.0.0-rc.1`) working too.
 *
 * @param required - Semver range from `mnema.config.json` (e.g., `"^1.2.0"`)
 * @returns Check result with `ok` flag and optional human-readable message
 */
export function checkVersion(required: string): VersionCheckResult {
  const base = semver.coerce(VERSION)?.version ?? VERSION;
  const compatible =
    semver.satisfies(VERSION, required, { includePrerelease: true }) ||
    semver.satisfies(base, required, { includePrerelease: true });
  if (!compatible) {
    return {
      ok: false,
      message: `Project requires mnema ${required}, you have ${VERSION}. Update with: npm i -g mnema`,
    };
  }
  return { ok: true };
}
