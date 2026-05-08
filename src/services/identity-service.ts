import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import type { ActorKind } from '../domain/enums/actor-kind.js';
import type { ActorRepository } from '../storage/sqlite/repositories/actor-repository.js';

/**
 * Metadata supplied by the MCP client at connection time.
 */
export interface McpClientMetadata {
  readonly agent_handle?: string;
}

/**
 * Where the resolved actor came from. Surfaced by `mnema identity whoami`
 * so users can see whether their env override is active.
 */
export type IdentitySource = 'env' | 'config' | 'none';

/**
 * Result of resolving the default actor with attribution. Used by the
 * CLI `whoami` subcommand and by error messages that explain why an
 * action is rejected.
 */
export interface ResolvedIdentity {
  readonly actor: string | null;
  readonly source: IdentitySource;
  readonly configPath: string;
}

/**
 * Persisted shape of `~/.config/mnema/identity.json`.
 */
interface IdentityConfigFile {
  readonly version?: string;
  readonly default_actor?: string;
  readonly display?: string;
}

/**
 * Thrown when no default human identity could be resolved.
 */
export class IdentityNotConfiguredError extends Error {
  constructor() {
    super(
      'No identity configured. Set MNEMA_ACTOR or create ~/.config/mnema/identity.json with a default_actor field.',
    );
    this.name = 'IdentityNotConfiguredError';
  }
}

/**
 * Resolves human and agent identity for the current process.
 *
 * Resolution order for the human actor:
 * 1. `MNEMA_ACTOR` environment variable (when set and non-empty)
 * 2. `default_actor` from `~/.config/mnema/identity.json`
 *
 * Agent actors are resolved from MCP client metadata and namespaced with
 * the `agent:` prefix to avoid handle collisions with humans.
 */
export class IdentityService {
  /**
   * Optional override for `homedir()`, used by tests.
   */
  private readonly home: () => string;

  constructor(
    private readonly actorRepository: ActorRepository,
    home: () => string = homedir,
  ) {
    this.home = home;
  }

  /**
   * Loads the default human actor's handle from local config or environment.
   *
   * @returns Handle of the default human actor
   * @throws IdentityNotConfiguredError when no source provides one
   */
  getDefaultActor(): string {
    const resolved = this.resolveDefaultActor();
    if (resolved.actor === null) {
      throw new IdentityNotConfiguredError();
    }
    return resolved.actor;
  }

  /**
   * Resolves the default actor with attribution about where it came from.
   * Never throws — returns `{ actor: null, source: 'none' }` when nothing
   * is configured. Useful for `mnema identity whoami` and structured
   * diagnostics.
   *
   * @returns The resolved actor and its source
   */
  resolveDefaultActor(): ResolvedIdentity {
    const configPath = this.configPath();

    const envActor = process.env.MNEMA_ACTOR;
    if (envActor !== undefined && envActor.length > 0) {
      return { actor: envActor, source: 'env', configPath };
    }

    if (!existsSync(configPath)) {
      return { actor: null, source: 'none', configPath };
    }

    const config = readConfig(configPath);
    if (config.default_actor === undefined || config.default_actor.length === 0) {
      return { actor: null, source: 'none', configPath };
    }
    return { actor: config.default_actor, source: 'config', configPath };
  }

  /**
   * Persists `handle` as the default actor in the user's config file.
   * Creates the directory and file if missing; writes atomically through a
   * temporary file so a crash mid-write cannot corrupt the config. The
   * file is chmod'd to 0600 — handles are not secrets, but the file is
   * personal config and should not be world-readable.
   *
   * @param handle - Actor handle to persist
   * @param display - Optional human-readable display name
   */
  setDefaultActor(handle: string, display?: string): void {
    assertValidHandle(handle);
    const configPath = this.configPath();
    mkdirSync(path.dirname(configPath), { recursive: true });

    const existing = existsSync(configPath) ? readConfig(configPath) : {};
    const next: IdentityConfigFile = {
      version: '1.0',
      ...existing,
      default_actor: handle,
      ...(display === undefined ? {} : { display }),
    };

    const tmp = `${configPath}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf-8');
    chmodSync(tmp, 0o600);
    renameSync(tmp, configPath);
  }

  /**
   * Removes the default actor from the user's config. The config file is
   * deleted entirely when there are no other fields left, otherwise the
   * `default_actor` key is dropped and the rest is preserved.
   */
  unsetDefaultActor(): void {
    const configPath = this.configPath();
    if (!existsSync(configPath)) return;

    const config = readConfig(configPath);
    const { default_actor: _removed, ...rest } = config;
    if (Object.keys(rest).length === 0 || (Object.keys(rest).length === 1 && rest.version)) {
      unlinkSync(configPath);
      return;
    }

    const tmp = `${configPath}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(rest, null, 2)}\n`, 'utf-8');
    chmodSync(tmp, 0o600);
    renameSync(tmp, configPath);
  }

  private configPath(): string {
    return path.join(this.home(), '.config', 'mnema', 'identity.json');
  }

  /**
   * Extracts the agent handle from MCP client metadata.
   * Returns `null` for direct CLI use cases where no agent is in the loop.
   *
   * @param metadata - Client metadata from the MCP connection
   * @returns Prefixed agent handle (e.g., `"agent:claude-code"`) or `null`
   */
  resolveAgentActor(metadata: McpClientMetadata): string | null {
    const handle = metadata.agent_handle;
    if (handle === undefined || handle.length === 0) {
      return null;
    }
    return `agent:${handle}`;
  }

  /**
   * Ensures an actor exists in the database, creating it if absent.
   *
   * @param handle - Actor handle (e.g., `"daniel"` or `"agent:claude-code"`)
   * @param kind - Whether the actor is a human or an agent
   * @returns The actor's internal id
   */
  ensureActor(handle: string, kind: ActorKind): string {
    return this.actorRepository.upsert(handle, kind);
  }

  /**
   * Resolves an internal actor id to its handle. Returns `null` when the
   * id is unknown — callers should fall back to a sensible placeholder
   * rather than fail (the audit trail still has the raw id).
   *
   * @param id - Internal actor id
   * @returns The actor's handle, or `null` if not found
   */
  resolveHandle(id: string): string | null {
    const actor = this.actorRepository.findById(id);
    return actor === null ? null : actor.handle;
  }
}

const HANDLE_PATTERN = /^[a-zA-Z0-9._-]{1,64}$/;

/**
 * Validates that a handle is safe to persist as an actor identifier.
 * Allowed: letters, digits, `.`, `_`, `-`, length 1-64. Rejects whitespace,
 * `:` (reserved for `agent:` prefix), and anything else that could collide
 * with audit-log path conventions.
 *
 * @param handle - Candidate handle string
 * @throws Error with a user-friendly message when invalid
 */
function assertValidHandle(handle: string): void {
  if (handle.length === 0) {
    throw new Error('handle must not be empty');
  }
  if (handle.startsWith('agent:')) {
    throw new Error('handle must not start with `agent:` (reserved for agent actors)');
  }
  if (!HANDLE_PATTERN.test(handle)) {
    throw new Error(`handle must be 1-64 characters of [a-zA-Z0-9._-] (got: \`${handle}\`)`);
  }
}

function readConfig(configPath: string): IdentityConfigFile {
  const raw = readFileSync(configPath, 'utf-8');
  try {
    return JSON.parse(raw) as IdentityConfigFile;
  } catch {
    return {};
  }
}
