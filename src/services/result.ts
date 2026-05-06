/**
 * Discriminated union representing success or failure of an operation.
 * Use the Ok and Err factories to construct values.
 */
export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

/**
 * Constructs a successful Result containing the given value.
 *
 * @param value - The success value to wrap
 * @returns A Result indicating success
 */
export function Ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

/**
 * Constructs a failed Result containing the given error.
 *
 * @param error - The error value to wrap
 * @returns A Result indicating failure
 */
export function Err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}
