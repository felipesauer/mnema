import type { Task } from '../domain/entities/task.js';
import { TaskState } from '../domain/enums/task-state.js';
import type { TaskRepository } from '../storage/sqlite/repositories/task-repository.js';

/**
 * Aggregated view of work that needs human attention.
 *
 * Decisions pending review will join the inbox once `DecisionService`
 * lands in Phase 7. For now the inbox is task-only and consists of two
 * queues: tasks waiting on review and tasks blocked.
 */
export interface InboxView {
  readonly awaitingReview: readonly Task[];
  readonly blocked: readonly Task[];
}

/**
 * Builds the human-attention queue.
 *
 * Pure read service: never writes to SQLite. Multiple callers can
 * obtain the inbox simultaneously without coordination.
 */
export class InboxService {
  constructor(private readonly tasks: TaskRepository) {}

  /**
   * Returns the current inbox snapshot.
   *
   * @returns Aggregated view of tasks needing human action
   */
  view(): InboxView {
    return {
      awaitingReview: this.tasks.findByState(TaskState.InReview),
      blocked: this.tasks.findByState(TaskState.Blocked),
    };
  }
}
