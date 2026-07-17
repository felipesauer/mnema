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
      message: `Project requires mnema ${required}, you have ${VERSION}. Update with: npm i -g @felipesauer/mnema`,
    };
  }
  return { ok: true };
}

/** Minimal fetch signature, injectable so tests never hit the network. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** The published package whose latest version the update check queries. */
const PACKAGE_NAME = '@felipesauer/mnema';
const REGISTRY_URL = `https://registry.npmjs.org/${encodeURIComponent(PACKAGE_NAME)}/latest`;

/** Result of an update check against the npm registry. */
export interface UpdateCheckResult {
  /** True when the registry's latest is strictly newer than the installed build. */
  readonly updateAvailable: boolean;
  /** The installed version. */
  readonly current: string;
  /** The latest published version, or `null` when the check could not run. */
  readonly latest: string | null;
  /** A human-readable line (an update hint, "up to date", or why it was skipped). */
  readonly message: string;
}

/**
 * Fetches the latest published version from the npm registry. FAIL-OPEN:
 * any network/parse/timeout error resolves to `null` (never throws), so a
 * caller can degrade to "could not check" rather than fail. A short timeout
 * keeps an offline machine from hanging. Injectable `fetcher` + `now` so
 * tests never touch the network.
 *
 * @param fetcher - Fetch implementation (defaults to global `fetch`)
 * @param timeoutMs - Abort the request after this long
 * @returns The latest version string, or `null` on any failure
 */
export async function fetchLatestVersion(
  fetcher: FetchLike = fetch,
  timeoutMs = 3000,
): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetcher(REGISTRY_URL, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { version?: unknown };
    return typeof body.version === 'string' ? body.version : null;
  } catch {
    return null; // fail-open: offline, timeout, DNS, parse — all silent
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Compares the installed {@link VERSION} against `latest` (a version already
 * fetched from the registry, or `null` when the fetch failed). Pure — does
 * no I/O, so it is trivially testable and the network stays in
 * {@link fetchLatestVersion}. Uses `includePrerelease` so an alpha build is
 * never told to "downgrade" to a lower stable that it already leads.
 *
 * @param latest - The latest published version, or `null` (check unavailable)
 * @returns The structured update-check result
 */
export function checkForUpdate(latest: string | null): UpdateCheckResult {
  if (latest === null) {
    return {
      updateAvailable: false,
      current: VERSION,
      latest: null,
      message: 'could not check for updates (offline or registry unreachable)',
    };
  }
  // semver.gt compares prereleases natively (0.10.1-alpha.0 < 0.10.1 < 0.10.2),
  // so an alpha build is never told to "downgrade" to a lower stable it leads.
  const newer = semver.valid(latest) !== null && semver.gt(latest, VERSION);
  return {
    updateAvailable: newer,
    current: VERSION,
    latest,
    message: newer
      ? `a newer mnema is available: ${latest} (you have ${VERSION}). Update with: npm i -g ${PACKAGE_NAME}, then run \`mnema upgrade\` to bring this project in line`
      : `mnema is up to date (${VERSION})`,
  };
}
