import type { Observation } from '../domain/entities/observation.js';
import { ActorKind } from '../domain/enums/actor-kind.js';
import { ErrorCode } from '../errors/error-codes.js';
import type { MnemaError } from '../errors/mnema-error.js';
import type { ObservationRepository } from '../storage/sqlite/repositories/observation-repository.js';
import type { TaskRepository } from '../storage/sqlite/repositories/task-repository.js';
import type { AuditService } from './audit-service.js';
import type { IdentityService } from './identity-service.js';
import { Err, Ok, type Result } from './result.js';

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
 * Append-only contextual notes recorded by agents. Lighter than memories
 * (no slug, no mirror file). Useful for ephemeral signals — they may
 * later inform a durable memory or skill, but on their own they're not
 * the truth of the project.
 */
export class ObservationService {
  constructor(
    private readonly repo: ObservationRepository,
    private readonly tasks: TaskRepository,
    private readonly identity: IdentityService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Records an observation.
   *
   * @param input - Observation fields + identity tuple
   * @returns The newly created observation or an error if a related task
   *   key is supplied but unknown
   */
  record(input: ObservationRecordInput): Result<Observation, MnemaError> {
    let relatedTaskId: string | null = null;
    if (input.relatedTaskKey !== undefined && input.relatedTaskKey.length > 0) {
      const task = this.tasks.findByKey(input.relatedTaskKey);
      if (task === null) {
        return Err({ kind: ErrorCode.TaskNotFound, taskKey: input.relatedTaskKey });
      }
      relatedTaskId = task.id;
    }

    const createdBy = this.identity.ensureActor(input.actor, ActorKind.Human);
    const observation = this.repo.insert({
      content: input.content,
      topics: input.topics ?? [],
      relatedTaskId,
      createdBy,
    });

    this.audit.write({
      kind: 'observation_recorded',
      actor: input.actor,
      via: input.via,
      run: input.runId,
      data: {
        topics: observation.topics,
        related_task_key: input.relatedTaskKey ?? null,
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
      const task = this.tasks.findByKey(input.relatedTaskKey);
      if (task === null) return [];
      relatedTaskId = task.id;
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
   * @returns `true` if archived, `false` if id was unknown or already archived
   */
  archive(id: string, actor: string, via?: string, runId?: string): boolean {
    const archived = this.repo.archive(id);
    if (archived) {
      this.audit.write({
        kind: 'observation_archived',
        actor,
        via,
        run: runId,
        data: { id },
      });
    }
    return archived;
  }
}
