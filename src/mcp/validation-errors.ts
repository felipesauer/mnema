import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { ErrorCode } from '../errors/error-codes.js';
import { toStructured } from '../errors/error-printer.js';
import type { ErrorIssue } from '../errors/mnema-error.js';

/**
 * Installs a process-wide Zod error customizer so a failed parse yields
 * a human, field-named message instead of Zod's terse default
 * (`Invalid input: expected string, received undefined`).
 *
 * The MCP SDK validates a tool's input against its schema *before* the
 * handler runs, and surfaces `ZodError.message` to the client — which in
 * Zod 4 is a JSON dump of the raw issues. This customizer makes each
 * issue's message read like a sentence; {@link reformatSdkValidationError}
 * then flattens the dump itself. Call once at boot, before tools parse.
 */
export function installZodErrorMap(): void {
  z.config({
    customError: (issue) => {
      const field =
        Array.isArray(issue.path) && issue.path.length > 0 ? issue.path.join('.') : 'value';
      // A missing required field arrives as invalid_type with undefined
      // input — by far the most common agent mistake, so name it plainly.
      if (issue.code === 'invalid_type' && issue.input === undefined) {
        return `${field} is required`;
      }
      return undefined;
    },
  });
}

/**
 * The prefix the MCP SDK puts on every pre-handler validation failure.
 * Matching it lets us recognise a leaked raw-Zod result and rewrite it.
 */
const SDK_VALIDATION_PREFIX = 'Input validation error: Invalid arguments for tool ';

/** Shape of one raw Zod issue as the SDK serialises it into the message. */
interface RawZodIssue {
  readonly path?: readonly PropertyKey[];
  readonly message?: string;
}

/**
 * Rewrites a tool result that carries the SDK's raw pre-handler
 * validation error into Mnema's canonical `VALIDATION_FAILED` shape.
 *
 * The SDK returns `{ isError: true, content: [{ type: 'text', text:
 * 'MCP error -32602: Input validation error: Invalid arguments for tool
 * <name>: <json-dump>' }] }`. We detect that text, parse the JSON dump
 * back into issues, and re-serialise it with {@link toStructured} so the
 * agent sees the same friendly `{ error: 'VALIDATION_FAILED', issues,
 * message }` it gets from every in-handler validation. Anything that
 * does not match is returned untouched.
 *
 * @param result - A tool-call result from the SDK
 * @returns The result, reformatted when it was a raw validation leak
 */
export function reformatSdkValidationError(result: CallToolResult): CallToolResult {
  if (result.isError !== true) return result;
  const block = result.content?.[0];
  if (block === undefined || block.type !== 'text') return result;

  const idx = block.text.indexOf(SDK_VALIDATION_PREFIX);
  if (idx === -1) return result;

  const afterPrefix = block.text.slice(idx + SDK_VALIDATION_PREFIX.length);
  // `<toolName>: <jsonDump>` — split on the first colon-space.
  const sep = afterPrefix.indexOf(': ');
  if (sep === -1) return result;
  const toolName = afterPrefix.slice(0, sep);
  const dump = afterPrefix.slice(sep + 2);

  let issues: ErrorIssue[];
  try {
    const parsed = JSON.parse(dump) as RawZodIssue[];
    if (!Array.isArray(parsed)) return result;
    issues = parsed.map((raw) => ({
      path: Array.isArray(raw.path) ? raw.path : [],
      message: typeof raw.message === 'string' ? raw.message : 'invalid value',
    }));
  } catch {
    // Not the JSON-dump variant we know how to flatten — leave as-is.
    return result;
  }

  const structured = toStructured({ kind: ErrorCode.ValidationFailed, issues });
  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: JSON.stringify({ ...structured, tool: toolName }),
      },
    ],
  };
}
