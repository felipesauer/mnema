import { ErrorCode } from '../../errors/error-codes.js';
import type { MnemaError } from '../../errors/mnema-error.js';
import { Err, Ok, type Result } from '../../services/result.js';

/**
 * Translates an unknown thrown value into a structured {@link MnemaError}
 * when the cause matches a SQLite operational condition we want to
 * surface cleanly (e.g. `SQLITE_BUSY` while another mutation holds the
 * write lock). Returns `null` for any other shape so callers can
 * rethrow / propagate naturally.
 *
 * Currently maps:
 * - `database is locked` / `SQLITE_BUSY` → {@link ErrorCode.StorageBusy}
 *
 * FTS5 syntax errors are intentionally NOT handled here — those are
 * specific to the search path and live in `SearchService.search`.
 *
 * @param error - Whatever was thrown by `better-sqlite3` (or wrapper)
 * @returns Structured error variant or `null`
 */
export function mapSqliteError(error: unknown): MnemaError | null {
  const message = error instanceof Error ? error.message : String(error);
  if (/database is locked|SQLITE_BUSY/i.test(message)) {
    return { kind: ErrorCode.StorageBusy, detail: message };
  }
  return null;
}

/**
 * Wraps a mutation closure so that SQLite operational errors surface as
 * structured `Result.Err` instead of throwing. Anything we don't
 * recognise re-throws so genuine programmer errors stay visible.
 *
 * Use this around the SQLite-touching tail of every service mutation
 * — after gate / business validation has already returned its own
 * `Result`, when only the database write remains.
 *
 * @param fn - Closure that performs the mutation and returns success value
 * @returns Wrapped Result
 */
export function tryMutation<T>(fn: () => T): Result<T, MnemaError> {
  try {
    return Ok(fn());
  } catch (error) {
    const mapped = mapSqliteError(error);
    if (mapped !== null) return Err(mapped);
    throw error;
  }
}
