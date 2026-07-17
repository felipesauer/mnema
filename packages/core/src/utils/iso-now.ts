/**
 * Returns the current instant as an ISO8601 string with millisecond precision
 * (e.g. `2026-05-08T15:30:00.123Z`).
 *
 * Used everywhere the codebase persists a timestamp into SQLite or audit logs,
 * so the storage format is uniform across both surfaces. Avoids the SQLite
 * `datetime('now')` default which produces a non-ISO `YYYY-MM-DD HH:MM:SS`
 * string that downstream parsers (notably JavaScript `Date.parse` cross-engine)
 * cannot reliably consume.
 *
 * @returns ISO8601 string with `Z` suffix
 */
export function isoNow(): string {
  return new Date().toISOString();
}
