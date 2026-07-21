import { Err, Ok, type Result } from '../../common/result.js';
import type { Note, NoteKind } from '../../domain/entities/note.js';
import { ActorKind } from '../../domain/enums/actor-kind.js';
import { ErrorCode } from '../../errors/error-codes.js';
import type { MnemaError } from '../../errors/mnema-error.js';
import type { NoteRepository } from '../../storage/sqlite/repositories/note-repository.js';
import type { TaskRepository } from '../../storage/sqlite/repositories/task-repository.js';
import { tryMutation } from '../../storage/sqlite/sqlite-error-map.js';
import type { AuditService } from '../integrity/audit-service.js';
import type { IdentityService } from '../integrity/identity-service.js';
import { resolveEntity } from './resolve-entity.js';

/**
 * Input for {@link NoteService.add}.
 */
export interface AddNoteInput {
  readonly taskKey: string;
  readonly kind: NoteKind;
  readonly content: string;
  readonly actor: string;
  readonly via?: string;
  readonly runId?: string;
}

/**
 * Persists typed annotations attached to a task.
 *
 * Notes are append-only and keyed by their automatically generated id.
 * Workflow services (TaskService, in particular) write specific kinds
 * (`block_reason`, `review_feedback`, etc.) directly through their own
 * paths; this service is the explicit-comment surface used by the MCP
 * `note_add` tool and the eventual `mnema note add` CLI.
 */
export class NoteService {
  constructor(
    private readonly notes: NoteRepository,
    private readonly tasks: TaskRepository,
    private readonly identity: IdentityService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Records a note against a task.
   *
   * @param input - Note fields + identity tuple
   * @returns The created note or a structured error
   */
  add(input: AddNoteInput): Result<Note, MnemaError> {
    const resolved = resolveEntity(this.tasks, input.taskKey, (handle) => ({
      kind: ErrorCode.TaskNotFound,
      taskKey: handle,
    }));
    if (!resolved.ok) return Err(resolved.error);
    const task = resolved.value;

    const actorId = this.identity.ensureActor(input.actor, ActorKind.Human);
    const noteResult = tryMutation(() =>
      this.notes.insert({
        taskId: task.id,
        actorId,
        kind: input.kind,
        content: input.content,
      }),
    );
    if (!noteResult.ok) return noteResult;
    const note = noteResult.value;

    this.audit.write({
      kind: 'note_added',
      actor: input.actor,
      via: input.via,
      run: input.runId,
      data: { task_id: task.id, note_kind: note.kind, content_size: note.content.length },
    });

    return Ok(note);
  }

  /**
   * Lists every active note attached to a task.
   *
   * @param taskKey - Task key
   * @param kind - Optional kind filter
   * @returns Notes ordered by `at`, or a structured error
   */
  listForTask(taskKey: string, kind?: NoteKind): Result<readonly Note[], MnemaError> {
    const resolved = resolveEntity(this.tasks, taskKey, (handle) => ({
      kind: ErrorCode.TaskNotFound,
      taskKey: handle,
    }));
    if (!resolved.ok) return Err(resolved.error);
    const task = resolved.value;
    return Ok(this.notes.findByTask(task.id, kind));
  }
}
