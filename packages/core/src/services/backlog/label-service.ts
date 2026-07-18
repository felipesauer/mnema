import { z } from 'zod';
import { Err, Ok, type Result } from '../../common/result.js';
import type { Label, LabelCount } from '../../domain/entities/label.js';
import { ErrorCode } from '../../errors/error-codes.js';
import { fromZodIssues, type MnemaError } from '../../errors/mnema-error.js';
import type { LabelRepository } from '../../storage/sqlite/repositories/label-repository.js';
import type { TaskRepository } from '../../storage/sqlite/repositories/task-repository.js';
import type { AuditService } from '../integrity/audit-service.js';
import type { SyncService } from '../sync/sync-service.js';
import { resolveEntity } from './resolve-entity.js';

/**
 * A single label name: trimmed, non-empty, bounded, and free of commas
 * and newlines. Commas would be ambiguous on the CLI (`--label a,b`) and
 * newlines would corrupt the YAML frontmatter list, so they are rejected
 * at the door rather than silently mangled.
 */
const LABEL_NAME = z
  .string()
  .trim()
  .min(1, 'label must not be empty')
  .max(50, 'label must be at most 50 characters')
  .refine((v) => !v.includes(','), 'label must not contain a comma')
  .refine((v) => !/[\r\n]/.test(v), 'label must not contain a line break');

const LABELS_INPUT = z.array(LABEL_NAME);

/**
 * Validates a set of label names against the same rules {@link LabelService.setLabels}
 * enforces, WITHOUT touching a task or writing anything. Callers that apply
 * labels only after another insert (e.g. `task_create` folding inline labels
 * onto a freshly-inserted task) use this to reject a bad name up front, so the
 * insert never lands only to have the label application fail afterwards.
 *
 * @param labels - The candidate label names
 * @returns Ok with the normalized names, or a structured ValidationFailed error
 */
export function validateLabelNames(labels: readonly string[]): Result<string[], MnemaError> {
  const parsed = LABELS_INPUT.safeParse(labels);
  if (!parsed.success) {
    return Err({ kind: ErrorCode.ValidationFailed, issues: fromZodIssues(parsed.error.issues) });
  }
  return Ok(parsed.data);
}

/** Input for {@link LabelService.setLabels}. */
export interface SetLabelsInput {
  readonly taskKey: string;
  /** The complete desired set; `[]` clears every label on the task. */
  readonly labels: readonly string[];
  readonly actor: string;
  readonly via?: string;
  readonly runId?: string;
}

/**
 * Manages transversal labels on tasks over the `labels` + `task_labels`
 * tables (migration 017).
 *
 * The single mutation is set-semantics: {@link setLabels} replaces a
 * task's whole label set. Add and clear are just special cases of "set
 * to this list", which keeps the model — and the audit trail — simple:
 * one event records the resulting set rather than a stream of
 * add/remove deltas. Names are normalized (trimmed, de-duplicated) and
 * validated before any write; the catalogue row is created on demand.
 */
export class LabelService {
  constructor(
    private readonly labels: LabelRepository,
    private readonly tasks: TaskRepository,
    private readonly audit: AuditService,
    private readonly sync: SyncService,
  ) {}

  /**
   * Replaces the labels on a task with the given set.
   *
   * @param input - Task key, the complete desired label set, identity
   * @returns The labels now on the task (sorted) or a structured error
   */
  setLabels(input: SetLabelsInput): Result<string[], MnemaError> {
    const resolved = resolveEntity(this.tasks, input.taskKey, (handle) => ({
      kind: ErrorCode.TaskNotFound,
      taskKey: handle,
    }));
    if (!resolved.ok) return Err(resolved.error);
    const task = resolved.value;

    const parsed = LABELS_INPUT.safeParse(input.labels);
    if (!parsed.success) {
      return Err({ kind: ErrorCode.ValidationFailed, issues: fromZodIssues(parsed.error.issues) });
    }

    const applied = this.labels.setForTask(task.id, parsed.data);

    this.audit.write({
      kind: 'task_labels_set',
      actor: input.actor,
      via: input.via,
      run: input.runId,
      data: { task_key: task.key, labels: applied },
    });

    // Mirror the new label set to the task's markdown frontmatter, the
    // same way TaskService syncs after its own mutations.
    this.sync.syncTask(task.key, { action: 'task_labels_set', runId: input.runId });

    return Ok(applied);
  }

  /**
   * The labels currently on a task (sorted by name).
   *
   * @param taskKey - Task identifier
   * @returns The label names or a structured error if the task is unknown
   */
  listForTask(taskKey: string): Result<string[], MnemaError> {
    const resolved = resolveEntity(this.tasks, taskKey, (handle) => ({
      kind: ErrorCode.TaskNotFound,
      taskKey: handle,
    }));
    if (!resolved.ok) return Err(resolved.error);
    const task = resolved.value;
    return Ok(this.labels.findNamesByTask(task.id));
  }

  /**
   * The label catalogue with per-label active-task counts, most-used
   * first. Labels with no active task are omitted.
   */
  counts(): LabelCount[] {
    return this.labels.countsByLabel();
  }

  /** The full label catalogue, ordered by name. */
  catalogue(): Label[] {
    return this.labels.listAll();
  }
}
