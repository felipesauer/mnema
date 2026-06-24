import { InvalidArgumentError } from 'commander';

/**
 * Commander `.argParser` helpers for numeric flags.
 *
 * Bare `Number(value)` lets `'abc'` become `NaN` and `'3.7'` slip through as a
 * float — which then reaches SQLite as `NULL`/`REAL`/a constraint crash. These
 * parsers reject bad input at parse time with an `InvalidArgumentError`, which
 * the CLI's top-level handler turns into a clean usage exit (no stack trace),
 * mirroring the validation the MCP layer gets from Zod. The services still
 * re-validate, so direct/MCP callers are covered too — this is the friendly
 * front door.
 */

/** Parses a flag whose value must be a non-negative integer (e.g. estimate, context_budget). */
export function parseNonNegativeInt(raw: string): number {
  const n = toIntOrThrow(raw);
  if (n < 0) {
    throw new InvalidArgumentError(`must be >= 0 (got ${raw})`);
  }
  return n;
}

/** Parses a flag whose value must be an integer within an inclusive range (e.g. priority 1..5). */
export function parseIntInRange(min: number, max: number): (raw: string) => number {
  return (raw: string): number => {
    const n = toIntOrThrow(raw);
    if (n < min || n > max) {
      throw new InvalidArgumentError(`must be between ${min} and ${max} (got ${raw})`);
    }
    return n;
  };
}

/** Parses a flag whose value must be a positive integer (e.g. --limit). */
export function parsePositiveInt(raw: string): number {
  const n = toIntOrThrow(raw);
  if (n <= 0) {
    throw new InvalidArgumentError(`must be a positive integer (got ${raw})`);
  }
  return n;
}

/** Parses a flag whose value must be a finite number, integer or not (e.g. metric target/baseline). */
export function parseFiniteNumber(raw: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new InvalidArgumentError(`must be a number (got ${raw})`);
  }
  return n;
}

function toIntOrThrow(raw: string): number {
  const trimmed = raw.trim();
  // Reject anything that is not a plain base-10 integer literal: this excludes
  // '', 'abc', '3.7', '0x10', '1e3', '80_000', ' 10 ' edge cases that Number()
  // would otherwise silently accept or coerce.
  if (!/^[+-]?\d+$/.test(trimmed)) {
    throw new InvalidArgumentError(`must be an integer (got ${raw})`);
  }
  const n = Number(trimmed);
  // The regex matches arbitrarily long digit strings, but Number() silently
  // loses precision beyond 2^53 (e.g. '999…9' → 1e23). Reject those so the
  // stored value always equals what the user typed.
  if (!Number.isSafeInteger(n)) {
    throw new InvalidArgumentError(`is too large (got ${raw})`);
  }
  return n;
}
