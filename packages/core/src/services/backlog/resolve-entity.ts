import { Err, Ok, type Result } from '../../common/result.js';
import type { AliasResolution } from '../../domain/entity-alias.js';
import { ErrorCode } from '../../errors/error-codes.js';
import type { MnemaError } from '../../errors/mnema-error.js';

/**
 * The slice of a repository this resolver needs: turn a user-typed handle into
 * a resolution and load the winner by id. Every work-graph repository
 * (task/epic/sprint) satisfies it, so a service can resolve a handle without
 * depending on the concrete repository type.
 */
export interface HandleResolvable<T> {
  resolve(query: string): AliasResolution;
  findById(id: string): T | null;
}

/**
 * Resolves a user-typed handle — committed id, short alias (`t-3a9f`), hash
 * prefix, or a legacy key — to a single entity. Ambiguity becomes a structured
 * {@link ErrorCode.AmbiguousAlias} so the caller can ask for more characters
 * (git short-SHA style); absence becomes the caller's own not-found error.
 *
 * This is the single resolution path every user-facing surface funnels
 * through, so alias resolution reaches a service the moment it takes a handle
 * from the CLI or an MCP tool — internal reference lookups keep using
 * `findById` directly.
 *
 * @param repo - The repository slice that can resolve and load the entity
 * @param handle - The id, alias, or hash prefix the user supplied
 * @param notFound - Builds the entity-specific not-found error from the handle
 */
export function resolveEntity<T>(
  repo: HandleResolvable<T>,
  handle: string,
  notFound: (handle: string) => MnemaError,
): Result<T, MnemaError> {
  const resolution = repo.resolve(handle);
  if (resolution.status === 'ambiguous') {
    return Err({ kind: ErrorCode.AmbiguousAlias, query: handle, matches: resolution.ids });
  }
  if (resolution.status === 'unique') {
    const entity = repo.findById(resolution.id);
    if (entity !== null) return Ok(entity);
  }
  return Err(notFound(handle));
}
