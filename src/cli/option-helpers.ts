import { InvalidArgumentError } from 'commander';

import { isValidTimeBound } from '../mcp/time-bound-schema.js';

/**
 * Commander option coercer for a flag that may be passed more than once,
 * accumulating each value into an array. Use as the third argument to
 * `.option()` with an initial `[]`:
 *
 * ```ts
 * .option('--topic <topic>', 'Topic (repeatable)', collectRepeatable, [])
 * ```
 *
 * so `--topic a --topic b` yields `['a', 'b']`.
 *
 * @param value - The value parsed for this occurrence
 * @param previous - Values accumulated from earlier occurrences
 * @returns `previous` with `value` appended
 */
export function collectRepeatable(value: string, previous: string[]): string[] {
  return [...previous, value];
}

/**
 * Commander option coercer for a `--since`/`--until` time bound. The audit
 * query layer treats an unparseable bound as "no bound" (fail-open), which
 * turns a typo like `--since 30days` into a silent full-history scan while
 * the command's header still echoes the filter as applied. Rejecting the
 * value up front — the same grammar the MCP `timeBoundSchema` enforces —
 * makes the typo a loud argument error instead of a wrong number.
 *
 * @param value - Raw flag value
 * @returns The value, when it is a resolvable time bound
 */
export function parseTimeBoundOption(value: string): string {
  if (!isValidTimeBound(value)) {
    throw new InvalidArgumentError(
      'expected a relative duration (`30s`, `2h`, `7d`) or an ISO-8601 timestamp.',
    );
  }
  return value;
}

/**
 * Like {@link parseTimeBoundOption} but also accepting the friendly
 * `today` / `yesterday` tokens `mnema history` normalises itself.
 *
 * @param value - Raw flag value
 * @returns The value, when it is a resolvable bound or a friendly token
 */
export function parseFriendlyTimeBoundOption(value: string): string {
  if (value === 'today' || value === 'yesterday') return value;
  return parseTimeBoundOption(value);
}
