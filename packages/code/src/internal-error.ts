/**
 * An error that is a FAULT in the product, as opposed to a refusal of what was asked.
 *
 * The program's last-resort catch used to word everything it caught as one more no, so a
 * stored line no parser can open and a `TypeError` out of the product's own code read the
 * same and exited the same. They are not the same news: the first is a thing the person
 * can act on, the second is the product's to fix.
 *
 * WHAT COUNTS AS INTERNAL is decided by the discriminant the language already gives, not by
 * a list of the product's classes. An `Error` whose message was written for a reader — a
 * `CodedError`, the chain's parse errors, `new Error('--timeout takes …')` — is a refusal;
 * the engine's own classes (`TypeError`, `RangeError`, `ReferenceError`, …) and anything
 * thrown that is not an `Error` at all were not written for anybody, which is what makes
 * them a bug. A failed network call is the one `TypeError` that is the machine's: it carries
 * a system `code` on its `cause`.
 */

/** BSD `sysexits` EX_SOFTWARE: an internal software error, distinct from the exit 1 of a no. */
export const INTERNAL_ERROR_EXIT = 70;

/** Thrown by code that knows it has reached a state the product should never be in. */
export class InternalError extends Error {
  override readonly name = 'InternalError';
}

const ENGINE_CLASSES: readonly (abstract new (...args: never[]) => Error)[] = [
  TypeError,
  RangeError,
  ReferenceError,
  EvalError,
  URIError,
  InternalError,
];

/** Whether `error` is a fault in the product rather than a refusal. */
export function isInternalError(error: unknown): boolean {
  if (!(error instanceof Error)) return true;
  if (error instanceof TypeError && hasSystemCause(error)) return false;
  return ENGINE_CLASSES.some((engine) => error instanceof engine);
}

function hasSystemCause(error: Error): boolean {
  const { cause } = error;
  return (
    typeof cause === 'object' &&
    cause !== null &&
    typeof (cause as { code?: unknown }).code === 'string'
  );
}

/** What the person reads of an internal error: the class and the message, or the thrown value. */
export function describeInternal(error: unknown): string {
  if (error instanceof InternalError) return error.message;
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return `${String(error)} (thrown, not an Error)`;
}
