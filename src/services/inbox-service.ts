import type { Decision } from '../domain/entities/decision.js';
import type { Task } from '../domain/entities/task.js';
import type { StateMachine } from '../domain/state-machine/state-machine.js';
import type { TaskRepository } from '../storage/sqlite/repositories/task-repository.js';
import type { DecisionService } from './decision-service.js';

/**
 * Aggregated view of work that needs human attention.
 *
 * Queues today: tasks awaiting review (when the workflow declares
 * `reviewWorkflow`), tasks blocked (when the workflow declares
 * `blockedState`), and decisions still in `proposed` status.
 * Workflows without a feature simply report an empty array — the
 * concept does not exist for them.
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
 * obtain the inbox simultaneously without coordination. The state
 * names (`IN_REVIEW`, `BLOCKED`) come from the workflow feature flags;
 * if a workflow opts out of `reviewWorkflow` / `blockedState`, the
 * corresponding queue is always empty.
 */
export class InboxService {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly decisions: DecisionService,
    private readonly projectKey: string,
    private readonly stateMachine: StateMachine,
  ) {}

  /**
   * Returns the current inbox snapshot.
   *
   * @returns Aggregated view of tasks and decisions needing human action
   */
  view(): InboxView {
    const features = this.stateMachine.getWorkflow().features;
    return {
      awaitingReview: features.reviewWorkflow ? this.tasks.findByState('IN_REVIEW') : [],
      blocked: features.blockedState ? this.tasks.findByState('BLOCKED') : [],
      pendingDecisions: this.decisions.listPending(this.projectKey),
    };
  }
}
