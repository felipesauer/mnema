import type { ErrorIssue } from '../errors/mnema-error.js';

/**
 * Shared field-level invariants enforced at the service boundary.
 *
 * The CLI coerces flag strings with `Number(...)`, which turns garbage into
 * `NaN` and lets floats/negatives through. The MCP layer is already guarded by
 * Zod (`z.number().int().min(0)` etc.), so without an equivalent service-side
 * check the two producers disagree: a value the MCP tool rejects gets silently
 * persisted via the CLI (as `NULL`, a `REAL`, or a constraint crash). These
 * helpers give every producer the same contract by collecting {@link ErrorIssue}s
 * the caller turns into a `VALIDATION_FAILED` result.
 */

/**
 * Pushes an issue when `value` is a provided-but-invalid non-negative integer.
 * `null`/`undefined` are treated as "unset" and pass (the field is optional).
 */
export function checkOptionalNonNegativeInt(
  value: number | null | undefined,
  field: string,
  issues: ErrorIssue[],
): void {
  if (value === null || value === undefined) return;
  if (!Number.isSafeInteger(value)) {
    const reason = Number.isInteger(value)
      ? 'is too large (exceeds the safe-integer range)'
      : 'must be an integer';
    issues.push({ path: [field], message: `${reason} (got ${describe(value)})` });
    return;
  }
  if (value < 0) {
    issues.push({ path: [field], message: `must be >= 0 (got ${value})` });
  }
}

/**
 * Pushes an issue when `value` is a provided-but-invalid integer outside
 * `[min, max]`. `null`/`undefined` pass.
 */
export function checkOptionalIntInRange(
  value: number | null | undefined,
  field: string,
  min: number,
  max: number,
  issues: ErrorIssue[],
): void {
  if (value === null || value === undefined) return;
  if (!Number.isSafeInteger(value)) {
    const reason = Number.isInteger(value)
      ? 'is too large (exceeds the safe-integer range)'
      : 'must be an integer';
    issues.push({ path: [field], message: `${reason} (got ${describe(value)})` });
    return;
  }
  if (value < min || value > max) {
    issues.push({ path: [field], message: `must be between ${min} and ${max} (got ${value})` });
  }
}

/**
 * Pushes an issue when `value` is provided but not a finite number.
 * `null`/`undefined` pass. Use for REAL columns (metric target/baseline).
 */
export function checkOptionalFiniteNumber(
  value: number | null | undefined,
  field: string,
  issues: ErrorIssue[],
): void {
  if (value === null || value === undefined) return;
  if (!Number.isFinite(value)) {
    issues.push({ path: [field], message: `must be a finite number (got ${describe(value)})` });
  }
}

/** Same as {@link checkOptionalFiniteNumber} but the field is required. */
export function checkRequiredFiniteNumber(
  value: number,
  field: string,
  issues: ErrorIssue[],
): void {
  if (!Number.isFinite(value)) {
    issues.push({ path: [field], message: `must be a finite number (got ${describe(value)})` });
  }
}

/**
 * The kebab-case ASCII shape a slug must take before it can become a file
 * path (`<dir>/<slug>.md`). Anchored, so `../../etc/x`, `a/b`, `a.b`, an
 * empty string, and a leading dash are all rejected — the same regex the
 * MCP schemas enforce, lifted here so the service (and thus the CLI and
 * any non-MCP caller) rejects a traversal attempt identically.
 */
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Pushes an issue when `slug` is not kebab-case ASCII. Guards every
 * slug/key that becomes a file path (memory, skill) so a `../` traversal
 * cannot write a mirror outside the project directory. The message
 * mirrors the MCP schema's so the two producers reject identically.
 */
export function checkSlug(slug: string, issues: ErrorIssue[], field = 'slug'): void {
  if (!SLUG_PATTERN.test(slug)) {
    issues.push({ path: [field], message: 'slug must be kebab-case ASCII' });
  }
}

/**
 * Pushes an issue when a string field is outside `[min, max]` characters.
 * `max` is optional (a lower bound only). Gives a service the same length
 * contract the MCP schema enforces, so a non-MCP caller (the CLI) rejects
 * identically.
 */
export function checkStringLength(
  value: string,
  field: string,
  min: number,
  max: number | undefined,
  issues: ErrorIssue[],
): void {
  if (value.length < min) {
    issues.push({ path: [field], message: `must be at least ${min} character(s)` });
  } else if (max !== undefined && value.length > max) {
    issues.push({ path: [field], message: `must be at most ${max} characters` });
  }
}

function describe(value: number): string {
  return Number.isNaN(value) ? 'NaN' : String(value);
}
