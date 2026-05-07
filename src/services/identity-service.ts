import { existsSync, readFileSync } from 'node:fs';
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
    const envActor = process.env.MNEMA_ACTOR;
    if (envActor !== undefined && envActor.length > 0) {
      return envActor;
    }

    const configPath = path.join(this.home(), '.config', 'mnema', 'identity.json');
    if (!existsSync(configPath)) {
      throw new IdentityNotConfiguredError();
    }

    const config = JSON.parse(readFileSync(configPath, 'utf-8')) as {
      default_actor?: string;
    };
    if (config.default_actor === undefined || config.default_actor.length === 0) {
      throw new IdentityNotConfiguredError();
    }

    return config.default_actor;
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
