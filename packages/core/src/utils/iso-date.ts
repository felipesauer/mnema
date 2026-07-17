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
  // Reject a value whose date components Date silently folded — "2026-13-01"
  // → 2027-01-01, "2026-02-30" → Mar 2. Compare the literal Y-M-D against the
  // parsed date in the SAME reference frame the string was parsed in:
  //   - date-only ("2026-07-13") is parsed as UTC midnight → use UTC getters;
  //   - a timezone-less datetime ("2026-07-13T23:00:00") is parsed as LOCAL
  //     time → use local getters (using the UTC prefix here would wrongly
  //     reject an evening value behind UTC, which rolls to the next UTC day);
  //   - a zoned datetime ("…Z" / "…+02:00") pins an absolute instant whose
  //     local Y-M-D may legitimately differ, so the regex + non-NaN check
  //     already prove it — no component comparison.
  // The regex above guarantees a `YYYY-MM-DD` prefix, so all three parse.
  const [y = 0, m = 0, d = 0] = value.slice(0, 10).split('-').map(Number);
  const zoned = value.length > 10 && /(?:Z|[+-]\d{2}:?\d{2})$/.test(value);
  if (zoned) {
    // A zoned instant's LOCAL/UTC Y-M-D may legitimately differ from the
    // literal (the offset can roll it across midnight), so a getter compare
    // is wrong. But the literal calendar date must still be REAL: reject a
    // folded value like `2026-02-30T00:00:00Z` (→ Mar 2) or `2026-04-31T…`.
    // Validate the literal Y-M-D directly against the month's real length.
    return isRealCalendarDate(y, m, d);
  }
  const dateOnly = value.length === 10;
  const gotY = dateOnly ? date.getUTCFullYear() : date.getFullYear();
  const gotM = (dateOnly ? date.getUTCMonth() : date.getMonth()) + 1;
  const gotD = dateOnly ? date.getUTCDate() : date.getDate();
  return gotY === y && gotM === m && gotD === d;
}

/** True when Y-M-D is a real calendar date (month 1-12, day within the month, leap-aware). */
function isRealCalendarDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return d <= (days[m - 1] ?? 0);
}
