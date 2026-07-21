import { Err, Ok, type Result } from '../../common/result.js';
import { ErrorCode } from '../../errors/error-codes.js';
import type { MnemaError } from '../../errors/mnema-error.js';

/**
 * Translates an unknown thrown value into a structured {@link MnemaError}
 * when the cause matches a SQLite operational condition we want to
 * surface cleanly. Returns `null` for any other shape so callers can
 * rethrow / propagate naturally.
 *
 * Currently maps:
 * - `database is locked` / `SQLITE_BUSY` → {@link ErrorCode.StorageBusy}
 * - `UNIQUE constraint failed: <table>.<column>` → entity-specific
 *   variant (see {@link mapUniqueConstraint})
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
  const unique = mapUniqueConstraint(message);
  if (unique !== null) return unique;
  // A foreign-key violation almost always means a caller passed an id that
  // doesn't exist (an unresolved assignee/epic/sprint handle, say).
  // Services resolve those references up front, so reaching here is a
  // last-resort guard: turn the raw `FOREIGN KEY constraint failed` into a
  // structured validation error rather than leaking a SQLite stack trace.
  if (/FOREIGN KEY constraint failed/i.test(message)) {
    return {
      kind: ErrorCode.ValidationFailed,
      issues: [
        {
          path: [],
          message: 'references an entity that does not exist (unresolved id or handle)',
        },
      ],
    };
  }
  return null;
}

/**
 * Recognises the `UNIQUE constraint failed: <table>.<column>` shape
 * `better-sqlite3` throws and translates it into the entity-specific
 * variant when we have one. Today the partial unique index on
 * `sprints(project_id) WHERE state = 'ACTIVE'` fires when two
 * concurrent `sprint start` calls race past the service-level
 * `findActive` check — we surface that as the same
 * `ACTIVE_SPRINT_EXISTS` variant the single-actor retry path uses.
 *
 * The active sprint's key is not in the error message; callers that
 * need it can re-query. The `activeSprintKey` field is left empty so
 * the error remains usable without forcing a synchronous lookup at
 * mapping time.
 */
function mapUniqueConstraint(message: string): MnemaError | null {
  if (!/UNIQUE constraint failed/i.test(message)) return null;
  if (/idx_sprints_active|sprints\.project_id/i.test(message)) {
    return {
      kind: ErrorCode.ActiveSprintExists,
      projectKey: '',
      activeSprintKey: '',
    };
  }
  // UNIQUE(key) on decisions — the only entity that still mints a sequential
  // key, so two writers sharing one state.db can each derive the same one
  // (the COUNT(*)-based nextSequence is check-then-act). Surface a retryable
  // KeyCollision instead of leaking the raw SqliteError, so a wrapper's retry
  // loop (keyed off the Conflict exit code) gets a fresh key on the next attempt.
  const keyCollision = /UNIQUE constraint failed: (\w+)\.key\b/i.exec(message);
  if (keyCollision !== null) {
    return { kind: ErrorCode.KeyCollision, table: keyCollision[1] ?? '' };
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
