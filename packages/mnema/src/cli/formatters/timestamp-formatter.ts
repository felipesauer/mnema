/**
 * Output mode for timestamps rendered by the CLI.
 *
 * - `relative`: human-friendly "5h ago" / "just now". Default for daily-driver views.
 * - `iso`: full ISO8601 string as stored in the database. Selected via `--iso` flag.
 */
export type TimestampMode = 'relative' | 'iso';

/**
 * Renders a stored ISO8601 timestamp in the requested mode.
 *
 * @param iso - ISO8601 timestamp as stored in the audit log / domain entities
 * @param mode - Output mode
 * @returns Display string ready to be printed
 */
export function formatTimestamp(iso: string, mode: TimestampMode): string {
  return mode === 'iso' ? iso : formatRelative(iso);
}

/**
 * Renders an ISO8601 timestamp as a relative duration ("5h ago", "3d ago").
 *
 * Falls back to the original string if the value cannot be parsed or is in
 * the future (clock skew). Buckets are intentionally coarse — the precise
 * value is one `--iso` flag away.
 *
 * @param iso - ISO8601 timestamp
 * @returns Short human-readable age
 */
export function formatRelative(iso: string): string {
  const ageMs = Date.now() - Date.parse(iso);
  if (Number.isNaN(ageMs) || ageMs < 0) return iso;
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
