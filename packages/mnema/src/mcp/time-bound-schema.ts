import { isIso8601 } from '@mnema/core/utils/iso-date.js';
import { z } from 'zod';

/**
 * A relative time bound: a positive integer followed by a unit —
 * `s`econds, `m`inutes, `h`ours or `d`ays (e.g. `30s`, `2h`, `7d`).
 * Mirrors the grammar `parseTimeBound` accepts so validation and parsing
 * cannot drift.
 */
const RELATIVE_DURATION = /^\d+[smhd]$/;

/**
 * Whether a raw `since`/`until` value is a bound the audit query layer can
 * actually resolve: either a relative duration (`30s`, `2h`, `7d`) or a
 * strict ISO-8601 instant / date. Anything else — `last week`, `2026-13-40`,
 * or a value `Date` would silently coerce (`2026-02-30`) — is rejected so
 * the query fails with a validation error instead of failing open to an
 * unbounded all-time result.
 *
 * @param value - Raw bound from the tool input
 * @returns `true` when the value is a resolvable time bound
 */
export function isValidTimeBound(value: string): boolean {
  return RELATIVE_DURATION.test(value) || isIso8601(value);
}

/**
 * Builds the optional Zod schema for a `since`/`until` time bound shared by
 * the audit-reading tools (`audit_query`, `metrics_flow`, `history_get`). A
 * malformed value is rejected up front — via the standard MCP validation
 * path — rather than silently ignored downstream.
 *
 * @param description - The `.describe()` text for the specific tool/field
 * @returns An optional, format-checked string schema
 */
export function timeBoundSchema(description: string): z.ZodType<string | undefined> {
  return z
    .string()
    .refine(isValidTimeBound, {
      message: 'must be an ISO-8601 timestamp or a relative duration (e.g. 30s, 2h, 7d)',
    })
    .describe(description)
    .optional();
}
