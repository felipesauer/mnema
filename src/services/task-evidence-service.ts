import {
  EVIDENCE_KINDS,
  type EvidenceKind,
  isEvidenceKind,
  type TaskEvidence,
} from '../domain/entities/task-evidence.js';
import { ErrorCode } from '../errors/error-codes.js';
import type { MnemaError } from '../errors/mnema-error.js';
import type { TaskEvidenceRepository } from '../storage/sqlite/repositories/task-evidence-repository.js';
import type { TaskRepository } from '../storage/sqlite/repositories/task-repository.js';
import type { AuditService } from './audit-service.js';
import { Err, Ok, type Result } from './result.js';

/**
 * Input for {@link TaskEvidenceService.attach}.
 */
export interface AttachEvidenceInput {
  readonly taskKey: string;
  readonly criterionIndex: number;
  readonly kind?: EvidenceKind;
  readonly ref: string;
  readonly note?: string | null;
  readonly actor: string;
  readonly via?: string;
  readonly runId?: string;
}

/**
 * One acceptance criterion paired with the evidence attached to it.
 */
export interface CriterionEvidence {
  readonly index: number;
  readonly criterion: string;
  readonly evidence: readonly TaskEvidence[];
}

/**
 * A task's criteria paired with their evidence, plus any rows whose
 * `criterionIndex` no longer points at a live criterion (the criteria array
 * was shrunk/reordered after the evidence was attached). Surfacing orphans
 * instead of silently dropping them keeps the dangling rows visible.
 */
export interface TaskEvidenceView {
  readonly criteria: readonly CriterionEvidence[];
  readonly orphaned: readonly TaskEvidence[];
}

/**
 * Manages evidence linking a task's acceptance criteria to concrete
 * artefacts. Additive over the existing `acceptanceCriteria` string[] —
 * never touches the criteria themselves or the workflow gate. See
 * MNEMA-ADR-23.
 */
export class TaskEvidenceService {
  constructor(
    private readonly evidence: TaskEvidenceRepository,
    private readonly tasks: TaskRepository,
    private readonly audit: AuditService,
  ) {}

  /**
   * Attaches evidence to one of a task's acceptance criteria.
   *
   * @param input - Task key, criterion index, evidence fields + identity
   * @returns The created evidence or a structured error
   */
  attach(input: AttachEvidenceInput): Result<TaskEvidence, MnemaError> {
    const rawKind: string = input.kind ?? 'other';
    if (!isEvidenceKind(rawKind)) {
      return Err({
        kind: ErrorCode.ValidationFailed,
        issues: [
          {
            path: ['kind'],
            message: `must be one of ${EVIDENCE_KINDS.join(', ')} (got "${rawKind}")`,
          },
        ],
      });
    }
    const kind: EvidenceKind = rawKind;
    const task = this.tasks.findByKey(input.taskKey);
    if (task === null) {
      return Err({ kind: ErrorCode.TaskNotFound, taskKey: input.taskKey });
    }

    // `Number.isInteger` rejects NaN (from a CLI `Number('abc')`) and floats
    // (0.5), both of which would otherwise pass the `< 0 || >= length` range
    // test and reach an INTEGER column as NULL/REAL — an invisible orphan row.
    if (
      !Number.isInteger(input.criterionIndex) ||
      input.criterionIndex < 0 ||
      input.criterionIndex >= task.acceptanceCriteria.length
    ) {
      return Err({
        kind: ErrorCode.EvidenceCriterionOutOfRange,
        taskKey: input.taskKey,
        index: input.criterionIndex,
        criteriaCount: task.acceptanceCriteria.length,
      });
    }

    if (this.evidence.exists(task.id, input.criterionIndex, kind, input.ref)) {
      return Err({
        kind: ErrorCode.EvidenceDuplicate,
        taskKey: input.taskKey,
        index: input.criterionIndex,
        ref: input.ref,
      });
    }

    const created = this.evidence.insert({
      taskId: task.id,
      criterionIndex: input.criterionIndex,
      kind,
      ref: input.ref,
      note: input.note ?? null,
    });

    this.audit.write({
      kind: 'evidence_attached',
      actor: input.actor,
      via: input.via,
      run: input.runId,
      data: {
        task_key: task.key,
        criterion_index: input.criterionIndex,
        evidence_kind: kind,
        ref: input.ref,
      },
    });

    return Ok(created);
  }

  /**
   * Pairs every acceptance criterion of a task with its evidence rows.
   * Criteria with no evidence come back with an empty array — the
   * "which criteria are still unbacked" view.
   *
   * @param taskKey - Task identifier
   * @returns Criterion/evidence pairs or a structured error
   */
  forTask(taskKey: string): Result<TaskEvidenceView, MnemaError> {
    const task = this.tasks.findByKey(taskKey);
    if (task === null) {
      return Err({ kind: ErrorCode.TaskNotFound, taskKey });
    }
    const rows = this.evidence.findByTask(task.id);
    const criteria = task.acceptanceCriteria.map((criterion, index) => ({
      index,
      criterion,
      evidence: rows.filter((r) => r.criterionIndex === index),
    }));
    // Rows whose index falls outside the current criteria array — the criteria
    // were rewritten after the evidence was attached. Surface them rather than
    // dropping them silently, so the dangling state is observable.
    const max = task.acceptanceCriteria.length;
    const orphaned = rows.filter((r) => r.criterionIndex < 0 || r.criterionIndex >= max);
    return Ok({ criteria, orphaned });
  }
}
