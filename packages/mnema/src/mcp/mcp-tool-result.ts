import { deriveAlias } from '@mnema/core/domain/entity-alias.js';
import { ErrorCode } from '@mnema/core/errors/error-codes.js';
import { recoveryHint, toStructured } from '@mnema/core/errors/error-printer.js';
import type { MnemaError } from '@mnema/core/errors/mnema-error.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

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
 * Verbosity for a mutation's echoed task. `full` returns the whole task
 * entity (the historical default); `compact` returns only the fields an
 * agent needs to confirm the write — `{ key, state, updatedAt }` — so a
 * batch of mutations doesn't inflate the agent's context with repeated
 * long descriptions and acceptance-criteria arrays.
 */
export type Verbosity = 'full' | 'compact';

/** The minimal shape a task is reduced to under `compact` verbosity. */
export interface CompactTask {
  /** The short alias derived from the committed id — the human handle. */
  readonly key: string;
  readonly state: string;
  readonly updatedAt: string;
}

/**
 * Reduces a task entity to its confirmation-sized form. Shared by the
 * single-task `okTask` and batch tools that echo many tasks at once, so
 * a large batch can opt out of repeating long descriptions and
 * acceptance-criteria arrays. The `key` it echoes is the alias derived from
 * the committed id (there is no stored key).
 *
 * @param task - The full task entity (carries the committed `id`)
 * @returns Just `{ key, state, updatedAt }`
 */
export function toCompactTask(task: { id: string; state: string; updatedAt: string }): CompactTask {
  return { key: deriveAlias('task', task.id), state: task.state, updatedAt: task.updatedAt };
}

/**
 * Wraps a mutated or read task as a success response, honouring `verbosity`.
 * `full` (default) echoes the whole entity under `task`, with a derived `key`
 * alias added alongside the committed id so the agent has a handle to show and
 * to feed back into later tools; `compact` echoes only `{ key, state,
 * updatedAt }`.
 *
 * @param task - The full task entity returned by the service (carries `id`)
 * @param verbosity - Echo mode; defaults to `full`
 * @returns A success-shaped CallToolResult
 */
export function okTask(
  task: { id: string; state: string; updatedAt: string },
  verbosity: Verbosity = 'full',
): CallToolResult {
  return ok({
    task:
      verbosity === 'compact'
        ? toCompactTask(task)
        : { ...task, key: deriveAlias('task', task.id) },
  });
}

/**
 * Wraps a structured {@link MnemaError} as an MCP tool error.
 *
 * Sets the SDK's `isError` flag and includes the canonical structured
 * representation (`{ error, ...fields, hint? }`) so LLMs can branch on the
 * discriminator — and, for the variants with a known recovery action, act
 * on the `hint` without already knowing the fix.
 *
 * @param error - Structured error
 * @returns An error-shaped CallToolResult
 */
export function err(error: MnemaError): CallToolResult {
  const structured = toStructured(error);
  const hint = recoveryHint(error);
  if (hint !== null) structured.hint = hint;
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

/**
 * Convenience: short-circuits when the database is behind the bundled
 * migration files on disk, returning a `SCHEMA_OUT_OF_DATE` error with
 * the list of pending files. Read-only tools should NOT use this — the
 * cooperative guard only blocks mutations.
 *
 * Accepts either a fixed list or a thunk. A thunk lets a long-lived server
 * re-detect drift at call time, so a `mnema migrate` from another process
 * unblocks mutations without a restart (the CLI passes a fixed list — it
 * opens a fresh container per invocation, so it is never stale).
 *
 * @param pending - Pending migration file names, or a thunk returning them
 * @returns `null` when schema is current, or an error result otherwise
 */
export type PendingMigrationsSource = readonly string[] | (() => readonly string[]);

export function requireFreshSchema(pending: PendingMigrationsSource): CallToolResult | null {
  const files = typeof pending === 'function' ? pending() : pending;
  if (files.length === 0) return null;
  return err({ kind: ErrorCode.SchemaOutOfDate, pending: files });
}
