/**
 * Possible states of a Task in the default workflow.
 * Custom workflows may use other states (free-form strings).
 */
export enum TaskState {
  Draft = 'DRAFT',
  Ready = 'READY',
  InProgress = 'IN_PROGRESS',
  Blocked = 'BLOCKED',
  InReview = 'IN_REVIEW',
  Done = 'DONE',
  Canceled = 'CANCELED',
}
