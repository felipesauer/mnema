import { existsSync } from 'node:fs';
import path from 'node:path';

import { ActorKind } from '../domain/enums/actor-kind.js';
import { ErrorCode } from '../errors/error-codes.js';
import type { MnemaError } from '../errors/mnema-error.js';
import type { FileStore } from '../storage/files/file-store.js';
import type {
  Attachment,
  AttachmentParentKind,
  AttachmentRepository,
} from '../storage/sqlite/repositories/attachment-repository.js';
import type { DecisionRepository } from '../storage/sqlite/repositories/decision-repository.js';
import type { TaskRepository } from '../storage/sqlite/repositories/task-repository.js';
import type { AuditService } from './audit-service.js';
import type { IdentityService } from './identity-service.js';
import { Err, Ok, type Result } from './result.js';

/**
 * Input for {@link AttachmentService.attachToTask}.
 */
export interface AttachToTaskInput {
  readonly taskKey: string;
  readonly sourcePath: string;
  readonly mime?: string;
  readonly actor: string;
  readonly via?: string;
  readonly runId?: string;
}

/**
 * Input for {@link AttachmentService.attachToDecision}.
 */
export interface AttachToDecisionInput {
  readonly decisionKey: string;
  readonly sourcePath: string;
  readonly mime?: string;
  readonly actor: string;
  readonly via?: string;
  readonly runId?: string;
}

/**
 * Maps file extensions to a default mime type when the caller doesn't
 * provide one. Intentionally tiny — anything unrecognised falls back
 * to `application/octet-stream`.
 */
const DEFAULT_MIMES: Record<string, string> = {
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.pdf': 'application/pdf',
  '.log': 'text/plain',
  '.csv': 'text/csv',
};

/**
 * Orchestrates attachment ingestion: dedup binary content via the
 * {@link FileStore}, persist metadata via {@link AttachmentRepository},
 * audit the operation.
 *
 * Tasks and decisions may carry attachments through this service. Notes
 * will join when {@link import('./note-service.js').NoteService} lands.
 */
export class AttachmentService {
  constructor(
    private readonly attachments: AttachmentRepository,
    private readonly tasks: TaskRepository,
    private readonly decisions: DecisionRepository,
    private readonly fileStore: FileStore,
    private readonly identity: IdentityService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Stores a file on disk and attaches its metadata to a task.
   *
   * Idempotent at the binary level: identical content is written to
   * disk only once, regardless of how many times it is attached.
   *
   * @param input - Attachment parameters + identity tuple
   * @returns The persisted attachment row or a structured error
   */
  attachToTask(input: AttachToTaskInput): Result<Attachment, MnemaError> {
    if (!existsSync(input.sourcePath)) {
      return Err({ kind: ErrorCode.AttachmentSourceNotFound, path: input.sourcePath });
    }

    const task = this.tasks.findByKey(input.taskKey);
    if (task === null) {
      return Err({ kind: ErrorCode.TaskNotFound, taskKey: input.taskKey });
    }

    const stored = this.fileStore.store(input.sourcePath);
    const filename = path.basename(input.sourcePath);
    const mime = input.mime ?? mimeForExtension(stored.extension);
    const uploadedBy = this.identity.ensureActor(input.actor, ActorKind.Human);

    const record = this.attachments.insert({
      parentKind: 'task',
      parentId: task.id,
      filename,
      path: stored.relativePath,
      mime,
      size: stored.size,
      hash: stored.hash,
      uploadedBy,
    });

    this.audit.write({
      kind: 'attachment_added',
      actor: input.actor,
      via: input.via,
      run: input.runId,
      data: {
        task_key: task.key,
        filename,
        size: stored.size,
        hash: stored.hash,
        deduplicated: stored.deduplicated,
      },
    });

    return Ok(record);
  }

  /**
   * Stores a file on disk and attaches its metadata to a decision (ADR).
   *
   * @param input - Attachment parameters + identity tuple
   * @returns The persisted attachment row or a structured error
   */
  attachToDecision(input: AttachToDecisionInput): Result<Attachment, MnemaError> {
    if (!existsSync(input.sourcePath)) {
      return Err({ kind: ErrorCode.AttachmentSourceNotFound, path: input.sourcePath });
    }

    const decision = this.decisions.findByKey(input.decisionKey);
    if (decision === null) {
      return Err({ kind: ErrorCode.DecisionNotFound, decisionKey: input.decisionKey });
    }

    const stored = this.fileStore.store(input.sourcePath);
    const filename = path.basename(input.sourcePath);
    const mime = input.mime ?? mimeForExtension(stored.extension);
    const uploadedBy = this.identity.ensureActor(input.actor, ActorKind.Human);

    const record = this.attachments.insert({
      parentKind: 'decision',
      parentId: decision.id,
      filename,
      path: stored.relativePath,
      mime,
      size: stored.size,
      hash: stored.hash,
      uploadedBy,
    });

    this.audit.write({
      kind: 'attachment_added',
      actor: input.actor,
      via: input.via,
      run: input.runId,
      data: {
        decision_key: decision.key,
        filename,
        size: stored.size,
        hash: stored.hash,
        deduplicated: stored.deduplicated,
      },
    });

    return Ok(record);
  }

  /**
   * Lists attachments for a parent entity.
   *
   * @param kind - Parent kind (`task`, `note`, `decision`)
   * @param parentId - Internal parent identifier
   * @returns Active attachments
   */
  list(kind: AttachmentParentKind, parentId: string): readonly Attachment[] {
    return this.attachments.findByParent(kind, parentId);
  }

  /**
   * Convenience: list attachments for a task by its human key.
   *
   * @param taskKey - Task key (e.g. `WEBAPP-42`)
   * @returns Active attachments, or an error if the task is unknown
   */
  listForTask(taskKey: string): Result<readonly Attachment[], MnemaError> {
    const task = this.tasks.findByKey(taskKey);
    if (task === null) {
      return Err({ kind: ErrorCode.TaskNotFound, taskKey });
    }
    return Ok(this.attachments.findByParent('task', task.id));
  }

  /**
   * Convenience: list attachments for a decision by its human key.
   *
   * @param decisionKey - Decision key (e.g. `WEBAPP-ADR-7`)
   * @returns Active attachments, or an error if the decision is unknown
   */
  listForDecision(decisionKey: string): Result<readonly Attachment[], MnemaError> {
    const decision = this.decisions.findByKey(decisionKey);
    if (decision === null) {
      return Err({ kind: ErrorCode.DecisionNotFound, decisionKey });
    }
    return Ok(this.attachments.findByParent('decision', decision.id));
  }
}

function mimeForExtension(extension: string): string {
  const lower = extension.toLowerCase();
  return DEFAULT_MIMES[lower] ?? 'application/octet-stream';
}
