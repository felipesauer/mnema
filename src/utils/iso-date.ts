/**
 * Returns `true` when `value` parses as a strict ISO 8601 instant or
 * date-only string (YYYY-MM-DD). Rejects strings that JavaScript's
 * `Date` would silently coerce — e.g. `"2026-13-01"` (which becomes
 * 2027-01-01) is rejected, as is the empty string.
 *
 * Accepts:
 * - `"2026-05-07"` (date only)
 * - `"2026-05-07T13:45:00"` and `"2026-05-07T13:45:00.123"` (local)
 * - `"2026-05-07T13:45:00Z"` (UTC)
 * - `"2026-05-07T13:45:00+02:00"` / `"...-03:30"` (offsets)
 *
 * @param value - Candidate string
 * @returns `true` when the string round-trips to a valid Date
 */
export function isIso8601(value: string): boolean {
  if (typeof value !== 'string' || value.length === 0) return false;
  // Reject anything that does not at least look like ISO 8601 — Date
  // is far too lenient on its own ("Mon, 7 May 2026" parses).
  if (
    !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(
      value,
    )
  ) {
    return false;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  // Round-trip the date portion so values like "2026-13-01" (which Date
  // happily folds to 2027-01-01) are caught here.
  const expectedPrefix = value.slice(0, 10);
  return date.toISOString().slice(0, 10) === expectedPrefix;
}
