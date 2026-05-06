import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { ErrorCode } from '../errors/error-codes.js';
import { toStructured } from '../errors/error-printer.js';
import type { MnemaError } from '../errors/mnema-error.js';

/**
 * Wraps an arbitrary value as a successful MCP `tools/call` response.
 *
 * The MCP SDK expects every tool to return a {@link CallToolResult}.
 * Mnema tools serialize their structured payload as JSON in a single
 * text block — this is the most portable representation today (most
 * clients render the JSON for the LLM verbatim).
 *
 * @param value - Tool-specific payload (will be JSON.stringified)
 * @returns A success-shaped CallToolResult
 */
export function ok(value: Record<string, unknown>): CallToolResult {
  const payload = { ok: true, ...value };
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
  };
}

/**
 * Wraps a structured {@link MnemaError} as an MCP tool error.
 *
 * Sets the SDK's `isError` flag and includes the canonical structured
 * representation (`{ error, ...fields, message }`) so LLMs can branch
 * on the discriminator.
 *
 * @param error - Structured error
 * @returns An error-shaped CallToolResult
 */
export function err(error: MnemaError): CallToolResult {
  const structured = toStructured(error);
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify(structured) }],
  };
}

/**
 * Convenience: short-circuits when the active session has no run id,
 * returning the canonical `NO_ACTIVE_RUN` error.
 *
 * @param runId - Current run id from the session context (may be null)
 * @returns `null` when a run is active, or an error result when not
 */
export function requireActiveRun(runId: string | null): CallToolResult | null {
  if (runId !== null) return null;
  return err({ kind: ErrorCode.NoActiveRun });
}
