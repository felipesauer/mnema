import { Err, Ok, type Result } from '../../common/result.js';
import {
  EVIDENCE_KINDS,
  type EvidenceKind,
  isEvidenceKind,
  type TaskEvidence,
} from '../../domain/entities/task-evidence.js';
import { ErrorCode } from '../../errors/error-codes.js';
import type { MnemaError } from '../../errors/mnema-error.js';
import type { TaskEvidenceRepository } from '../../storage/sqlite/repositories/task-evidence-repository.js';
import type { TaskRepository } from '../../storage/sqlite/repositories/task-repository.js';
import type { AuditService } from '../integrity/audit-service.js';
import { resolveEntity } from './resolve-entity.js';

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
 * The outcome of {@link TaskEvidenceService.attach}: the evidence row, and
 * whether the call created it (`noOp: false`) or matched an edge that already
 * existed (`noOp: true`). Re-attaching an identical edge is idempotent rather
 * than an error, so a retry after a dropped response is safe.
 */
export interface AttachEvidenceResult {
  readonly evidence: TaskEvidence;
  readonly noOp: boolean;
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
 * never touches the criteria themselves or the workflow gate.
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
  attach(input: AttachEvidenceInput): Result<AttachEvidenceResult, MnemaError> {
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
    const resolved = resolveEntity(this.tasks, input.taskKey, (handle) => ({
      kind: ErrorCode.TaskNotFound,
      taskKey: handle,
    }));
    if (!resolved.ok) return Err(resolved.error);
    const task = resolved.value;

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

    // Re-attaching the exact same edge is a no-op, not an error: return the
    // row that already exists so a retry after a dropped response is safe and
    // the caller is never tempted to mangle the ref to dodge a duplicate.
    const existing = this.evidence.findEdge(task.id, input.criterionIndex, kind, input.ref);
    if (existing !== null) {
      return Ok({ evidence: existing, noOp: true });
    }

    const created = this.evidence.insert({
      taskId: task.id,
      criterionIndex: input.criterionIndex,
      // Record the criterion's text so a later reorder can be reconciled by
      // identity rather than position.
      criterionText: task.acceptanceCriteria[input.criterionIndex] ?? null,
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

    return Ok({ evidence: created, noOp: false });
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
    const resolved = resolveEntity(this.tasks, taskKey, (handle) => ({
      kind: ErrorCode.TaskNotFound,
      taskKey: handle,
    }));
    if (!resolved.ok) return Err(resolved.error);
    const task = resolved.value;
    const rows = this.evidence.findByTask(task.id);
    const criteria = task.acceptanceCriteria.map((criterion) => ({
      criterion,
      evidence: [] as TaskEvidence[],
    }));
    const orphaned: TaskEvidence[] = [];

    for (const row of rows) {
      const targetIndex = this.resolveCriterionIndex(row, task.acceptanceCriteria);
      if (targetIndex === null) {
        // The criterion this evidence was attached to no longer exists (the
        // array was shrunk, or its text was edited). A true orphan.
        orphaned.push(row);
      } else {
        criteria[targetIndex]?.evidence.push(row);
      }
    }

    return Ok({
      criteria: criteria.map((c, index) => ({
        index,
        criterion: c.criterion,
        evidence: c.evidence,
      })),
      orphaned,
    });
  }

  /**
   * Resolves the CURRENT index a piece of evidence belongs to, reconciling by
   * criterion identity so a reorder follows the criterion rather than the slot.
   *
   * - With a recorded `criterionText` (migration 016+): match by text. Prefer
   *   the original index when its text still agrees (handles duplicate texts
   *   stably); otherwise the first criterion whose text matches. No match → the
   *   criterion was removed/edited → `null` (orphan).
   * - Without `criterionText` (legacy rows): fall back to positional matching,
   *   orphaning anything out of range.
   */
  private resolveCriterionIndex(row: TaskEvidence, criteria: readonly string[]): number | null {
    if (row.criterionText !== null) {
      if (criteria[row.criterionIndex] === row.criterionText) {
        return row.criterionIndex; // unchanged or stably matched
      }
      const found = criteria.indexOf(row.criterionText);
      return found === -1 ? null : found; // followed the reorder, or orphan
    }
    // Legacy row: positional.
    return row.criterionIndex >= 0 && row.criterionIndex < criteria.length
      ? row.criterionIndex
      : null;
  }
}
