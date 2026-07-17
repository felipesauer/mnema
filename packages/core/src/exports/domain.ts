/** Curated domain surface of @mnema/core. */
export { ActorKind } from '../domain/enums/actor-kind.js';
export type { Workflow, WorkflowFeatures } from '../domain/state-machine/state-machine.js';
export { StateMachine } from '../domain/state-machine/state-machine.js';
export {
  formatWorkflowIssues,
  WorkflowInvalidError,
  WorkflowLoader,
  WorkflowNotFoundError,
} from '../domain/state-machine/workflow-loader.js';
