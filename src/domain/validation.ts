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
  if (!Number.isInteger(value)) {
    issues.push({ path: [field], message: `must be an integer (got ${describe(value)})` });
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
  if (!Number.isInteger(value)) {
    issues.push({ path: [field], message: `must be an integer (got ${describe(value)})` });
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

function describe(value: number): string {
  return Number.isNaN(value) ? 'NaN' : String(value);
}
