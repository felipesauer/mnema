import type { Decision } from '../domain/entities/decision.js';
import type { Task } from '../domain/entities/task.js';
import { TaskState } from '../domain/enums/task-state.js';
import type { TaskRepository } from '../storage/sqlite/repositories/task-repository.js';
import type { DecisionService } from './decision-service.js';

/**
 * Aggregated view of work that needs human attention.
 *
 * Three queues today: tasks awaiting review, tasks blocked, and
 * decisions still in `proposed` status (waiting on accept/reject).
 */
export interface InboxView {
  readonly awaitingReview: readonly Task[];
  readonly blocked: readonly Task[];
  readonly pendingDecisions: readonly Decision[];
}

/**
 * Builds the human-attention queue.
 *
 * Pure read service: never writes to SQLite. Multiple callers can
 * obtain the inbox simultaneously without coordination.
 */
export class InboxService {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly decisions: DecisionService,
    private readonly projectKey: string,
  ) {}

  /**
   * Returns the current inbox snapshot.
   *
   * @returns Aggregated view of tasks and decisions needing human action
   */
  view(): InboxView {
    return {
      awaitingReview: this.tasks.findByState(TaskState.InReview),
      blocked: this.tasks.findByState(TaskState.Blocked),
      pendingDecisions: this.decisions.listPending(this.projectKey),
    };
  }
}
