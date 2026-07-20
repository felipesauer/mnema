import { existsSync, mkdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { Err, Ok, type Result } from '../../common/result.js';
import type { Observation } from '../../domain/entities/observation.js';
import { ActorKind } from '../../domain/enums/actor-kind.js';
import { hasInvocationMarkup } from '../../domain/invocation-markup.js';
import { ErrorCode } from '../../errors/error-codes.js';
import type { MnemaError } from '../../errors/mnema-error.js';
import { MarkdownIo } from '../../storage/markdown/markdown-io.js';
import type { ObservationRepository } from '../../storage/sqlite/repositories/observation-repository.js';
import type { TaskRepository } from '../../storage/sqlite/repositories/task-repository.js';
import { resolveEntity } from '../backlog/resolve-entity.js';
import type { AuditService } from '../integrity/audit-service.js';
import type { IdentityService } from '../integrity/identity-service.js';

/**
 * Maximum length of an observation's content, in characters. Enforced here
 * in the service so EVERY entry point (the CLI `mnema observation record`,
 * which calls the service directly, and the MCP handler) rejects
 * over-length content identically — a human and an agent recording the same
 * long note get the same outcome. The MCP handler imports this constant so
 * there is a single source of truth.
 */
export const OBSERVATION_CONTENT_MAX = 2000;

/**
 * Input for {@link ObservationService.record}.
 */
export interface ObservationRecordInput {
  readonly content: string;
  readonly topics?: readonly string[];
  readonly relatedTaskKey?: string;
  readonly actor: string;
  readonly via?: string;
  readonly runId?: string;
}

/**
 * Filter set for {@link ObservationService.list}.
 */
export interface ObservationListInput {
  readonly topic?: string;
  readonly relatedTaskKey?: string;
  readonly since?: string;
  readonly limit?: number;
  /** Include archived observations (default false). */
  readonly includeArchived?: boolean;
}

/**
 * Outcome of {@link ObservationService.archive}. `already_archived` is kept
 * distinct from `not_found` so callers can report end-state idempotency (the
 * row exists and is already retired) instead of a false "not found".
 */
export type ObservationArchiveOutcome = 'archived' | 'already_archived' | 'not_found';

/**
 * Append-only contextual notes recorded by agents. Lighter than memories
 * (a UUID, no slug), but — like memories — each note is mirrored to
 * `<observationsDir>/<id>.md` when recorded, so the signal survives a clone
 * and {@link SyncRebuild} can re-import it after a state wipe. The `.md`
 * carries the full content in a `mnema:` frontmatter block, the same shape
 * the rebuild reads for tasks and decisions.
 */
export class ObservationService {
  private readonly markdownIo = new MarkdownIo();

  constructor(
    private readonly repo: ObservationRepository,
    private readonly tasks: TaskRepository,
    private readonly identity: IdentityService,
    private readonly audit: AuditService,
    private readonly observationsDir: string,
  ) {}

  /**
   * Records an observation.
   *
   * @param input - Observation fields + identity tuple
   * @returns The newly created observation or an error if a related task
   *   key is supplied but unknown
   */
  record(input: ObservationRecordInput): Result<Observation, MnemaError> {
    // Reject tool-invocation markup leaking into the note — a malformed MCP
    // call can spill `</content>\n<topics>[…]` / `<parameter name=...>` into the
    // value, which would persist a garbage trailer. Same screen and message as
    // decision_record / memory_record.
    if (hasInvocationMarkup(input.content)) {
      return Err({
        kind: ErrorCode.ValidationFailed,
        issues: [
          {
            path: ['content'],
            message: 'contains tool-invocation markup; pass each field as its own argument',
          },
        ],
      });
    }

    // Enforce the content cap here (not only in the MCP handler) so the CLI
    // path — which calls the service directly — rejects over-length content
    // identically. Same actionable message naming the exact overflow.
    if (input.content.length > OBSERVATION_CONTENT_MAX) {
      const over = input.content.length - OBSERVATION_CONTENT_MAX;
      return Err({
        kind: ErrorCode.ValidationFailed,
        issues: [
          {
            path: ['content'],
            message: `content is ${input.content.length} characters — ${over} over the ${OBSERVATION_CONTENT_MAX} limit. Split it into two observations.`,
          },
        ],
      });
    }

    let relatedTaskId: string | null = null;
    if (input.relatedTaskKey !== undefined && input.relatedTaskKey.length > 0) {
      const resolved = resolveEntity(this.tasks, input.relatedTaskKey, (handle) => ({
        kind: ErrorCode.TaskNotFound,
        taskKey: handle,
      }));
      if (!resolved.ok) return Err(resolved.error);
      relatedTaskId = resolved.value.id;
    }

    const createdBy = this.identity.ensureActor(input.actor, ActorKind.Human);
    const observation = this.repo.insert({
      content: input.content,
      topics: input.topics ?? [],
      relatedTaskId,
      createdBy,
    });

    this.writeMirror(observation, relatedTaskId);

    this.audit.write({
      kind: 'observation_recorded',
      actor: input.actor,
      via: input.via,
      run: input.runId,
      data: {
        topics: observation.topics,
        related_task_id: relatedTaskId ?? null,
      },
    });

    return Ok(observation);
  }

  /**
   * Lists observations with optional filters.
   *
   * @param input - Filter set
   * @returns Observation rows, newest first
   */
  list(input: ObservationListInput = {}): readonly Observation[] {
    let relatedTaskId: string | undefined;
    if (input.relatedTaskKey !== undefined && input.relatedTaskKey.length > 0) {
      const resolved = resolveEntity(this.tasks, input.relatedTaskKey, (handle) => ({
        kind: ErrorCode.TaskNotFound,
        taskKey: handle,
      }));
      // A filter that resolves nowhere (or ambiguously) narrows to nothing.
      if (!resolved.ok) return [];
      relatedTaskId = resolved.value.id;
    }

    return this.repo.list({
      topic: input.topic,
      relatedTaskId,
      since: input.since,
      limit: input.limit,
      includeArchived: input.includeArchived,
    });
  }

  /**
   * Archives an observation (soft, one-way retirement) — the row and its
   * audit trail survive, but it drops out of the default listing and of
   * search. Used to retire a stale or superseded signal without losing the
   * record. Unlike a memory, an observation has no slug to re-record, so
   * archival is not reversed by a later write.
   *
   * @param id - Observation id
   * @param actor - Identity tuple for audit
   * @param via - Optional client annotation
   * @param runId - Optional run id
   * @returns The {@link ObservationArchiveOutcome}
   */
  archive(id: string, actor: string, via?: string, runId?: string): ObservationArchiveOutcome {
    // Look the id up first (findById returns archived rows too): the repo's
    // conditional UPDATE alone cannot tell "unknown id" from "already
    // archived", and a caller must not report "not found" for a row that
    // exists in exactly the requested end state.
    const existing = this.repo.findById(id);
    if (existing === null) return 'not_found';
    if (existing.archivedAt !== null) return 'already_archived';
    // A false here means another writer archived between the lookup and the
    // UPDATE — the end state holds either way.
    if (!this.repo.archive(id)) return 'already_archived';
    // Unlink the mirror on archive (rather than tombstoning it in place):
    // an archived observation is retired from circulation, so its `.md`
    // must not linger on disk looking like a live entry — the same
    // treatment an archived memory's mirror gets. `rebuildMirrors` skips
    // archived rows, so it will not recreate the file.
    const mirrorPath = this.mirrorPath(id);
    if (existsSync(mirrorPath)) unlinkSync(mirrorPath);
    this.audit.write({
      kind: 'observation_archived',
      actor,
      via,
      run: runId,
      data: { id },
    });
    return 'archived';
  }

  /**
   * Regenerates missing `.md` mirror files from every active SQLite row —
   * the recovery path when a project gained observations before the mirror
   * existed, or after a manual deletion. Archived rows are skipped (their
   * mirror is intentionally absent) and present files are left untouched, so
   * this only heals drift. Returns the ids whose mirror was just written.
   *
   * @returns Ids whose mirror file was created during this call
   */
  rebuildMirrors(): string[] {
    const rebuilt: string[] = [];
    for (const observation of this.repo.list({ includeArchived: false })) {
      if (!existsSync(this.mirrorPath(observation.id))) {
        this.writeMirror(observation, observation.relatedTaskId);
        rebuilt.push(observation.id);
      }
    }
    return rebuilt;
  }

  /** Absolute path an observation's mirror lives at. */
  private mirrorPath(id: string): string {
    return path.join(this.observationsDir, `${id}.md`);
  }

  /**
   * Writes (or rewrites) the markdown mirror for an observation. The
   * canonical content lives in the `mnema:` frontmatter — the shape
   * {@link SyncRebuild} reads back, so the two must agree — since the
   * serialiser normalises a trailing newline into the body and would not
   * round-trip content byte-for-byte from there. The body carries the same
   * text so the file is readable in a pull request. The related task is
   * referenced by its committed id, which survives a clone.
   */
  private writeMirror(observation: Observation, relatedTaskId: string | null): void {
    mkdirSync(this.observationsDir, { recursive: true });
    this.markdownIo.write(this.mirrorPath(observation.id), {
      mnemaData: {
        id: observation.id,
        kind: 'observation',
        content: observation.content,
        topics: [...observation.topics],
        related_task_id: relatedTaskId,
        created_by: observation.createdBy,
        at: observation.at,
        archived_at: observation.archivedAt,
      },
      otherFrontmatter: {},
      content: observation.content,
    });
  }
}
