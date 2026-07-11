import type { TaskRepository } from '../storage/sqlite/repositories/task-repository.js';
import type { AuditQuery } from './audit-query.js';

/**
 * Closes the loop on skill usefulness: which recorded skills were applied
 * in a run that then produced rework.
 *
 * `skill_use` alone only says a skill was used, not whether using it went
 * well. This correlates each `skill_used` audit event with the outcome of
 * the tasks touched in the SAME run: if any of those tasks has since been
 * reopened (`reopenCount > 0`), the skill was applied right before rework
 * and is flagged for review — its guidance may be wrong or incomplete.
 * A skill used only in runs whose tasks stayed clean is not flagged.
 *
 * Read-only over the audit log and task rows; computes on demand so it
 * always reflects current reopen counts. This is a signal for a human or
 * agent to re-examine a skill, never an automatic edit.
 */
export class SkillQualityService {
  constructor(
    private readonly audit: AuditQuery,
    private readonly tasks: TaskRepository,
  ) {}

  /**
   * The set of skill slugs that were used in a run which touched a task
   * that has since been reopened. Empty when no such correlation exists.
   *
   * @returns Slugs flagged for review
   */
  flaggedForReview(): ReadonlySet<string> {
    // Pass 1: map each run id → whether any task it touched later reopened.
    // A run "touched" a task if it recorded a task_created/task_transitioned
    // for it; the reopen is read from the task's CURRENT row so a reopen that
    // happened in a later run still counts against the skill used here.
    const reopenedByRun = new Map<string, boolean>();
    const taskKeyReopened = new Map<string, boolean>();
    for (const event of this.audit.run()) {
      if (event.kind !== 'task_created' && event.kind !== 'task_transitioned') continue;
      const runId = event.run;
      if (typeof runId !== 'string') continue;
      const data = event.data as { key?: string; action?: string };
      const key = data.key;
      if (typeof key !== 'string') continue;
      // The `reopen` action IS the rework trigger, not work that preceded it.
      // A run that only reopened a task must not be blamed as "preceded
      // rework" — skip that touch so only the run that did the original work
      // (and left it needing a reopen) is flagged.
      if (data.action === 'reopen') continue;

      let reopened = taskKeyReopened.get(key);
      if (reopened === undefined) {
        const task = this.tasks.findByKey(key);
        reopened = task !== null && task.reopenCount > 0;
        taskKeyReopened.set(key, reopened);
      }
      if (reopened) reopenedByRun.set(runId, true);
      else if (!reopenedByRun.has(runId)) reopenedByRun.set(runId, false);
    }

    // Pass 2: a skill_used in a run flagged as reopened → flag the skill.
    const flagged = new Set<string>();
    for (const event of this.audit.run({ kind: 'skill_used' })) {
      const runId = event.run;
      if (typeof runId !== 'string') continue;
      const slug = (event.data as { slug?: string }).slug;
      if (typeof slug !== 'string') continue;
      if (reopenedByRun.get(runId) === true) flagged.add(slug);
    }
    return flagged;
  }
}
