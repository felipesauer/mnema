/**
 * Named domain events that user-configured hooks can subscribe to.
 *
 * These are a curated, stable surface — deliberately decoupled from the
 * raw audit `kind` strings (which include internal meta-events like
 * `transition_blocked` or `run_resumed`). A hook config names these
 * events; the {@link DomainEventDispatcher} maps audit kinds onto them.
 */
export enum DomainEvent {
  /** A task moved into a terminal (done) state. */
  TaskDone = 'on_task_done',
  /** A task changed state (any transition). */
  TaskTransitioned = 'on_task_transitioned',
  /** A decision moved to `accepted`. */
  DecisionAccepted = 'on_decision_accepted',
  /** A sprint was closed. */
  SprintClosed = 'on_sprint_closed',
  /** An epic was closed. */
  EpicClosed = 'on_epic_closed',
}

/** Every domain event name, for schema/iteration use. */
export const DOMAIN_EVENT_NAMES = Object.values(DomainEvent);
