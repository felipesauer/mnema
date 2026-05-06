import type { z } from 'zod';

import { Err, Ok, type Result } from '../../services/result.js';

/**
 * A transition in a workflow, with its associated gate schema.
 */
export interface Transition {
  readonly to: string;
  readonly description: string;
  readonly useWhen: string;
  readonly requires: z.ZodObject;
}

/**
 * A loaded workflow, ready to be consumed by the state machine.
 *
 * `transitions` is keyed first by source state, then by action name.
 */
export interface Workflow {
  readonly name: string;
  readonly description: string | null;
  readonly states: readonly string[];
  readonly initial: string;
  readonly terminal: readonly string[];
  readonly features: WorkflowFeatures;
  readonly transitions: Readonly<Record<string, Readonly<Record<string, Transition>>>>;
}

/**
 * Boolean feature flags declared by a workflow.
 */
export interface WorkflowFeatures {
  readonly sprints: boolean;
  readonly epics: boolean;
  readonly reviewWorkflow: boolean;
  readonly blockedState: boolean;
}

/**
 * Errors returned by gate validation.
 */
export type GateError =
  | { readonly kind: 'INVALID_TRANSITION'; readonly from: string; readonly action: string }
  | { readonly kind: 'GATE_FAILED'; readonly issues: readonly z.core.$ZodIssue[] };

/**
 * Successful validation outcome.
 */
export interface ValidatedTransition {
  readonly to: string;
  readonly data: unknown;
}

/**
 * Generic state machine driven by a declarative workflow.
 *
 * Holds no internal state — every method reads from the injected workflow.
 */
export class StateMachine {
  constructor(private readonly workflow: Workflow) {}

  /**
   * Returns the workflow this state machine is bound to.
   *
   * @returns Reference to the underlying workflow
   */
  getWorkflow(): Workflow {
    return this.workflow;
  }

  /**
   * Checks if a transition from a state via an action is defined.
   *
   * @param from - Source state
   * @param action - Action name
   * @returns True if the transition exists, false otherwise
   */
  canTransition(from: string, action: string): boolean {
    return this.workflow.transitions[from]?.[action] !== undefined;
  }

  /**
   * Validates a transition attempt against the workflow.
   * Checks both the transition existence and the gate requirements.
   *
   * @param from - Source state
   * @param action - Action name
   * @param payload - Data to validate against the gate's requires schema
   * @returns Result with target state and parsed data, or typed gate error
   */
  validateTransition(
    from: string,
    action: string,
    payload: unknown,
  ): Result<ValidatedTransition, GateError> {
    const transition = this.workflow.transitions[from]?.[action];
    if (transition === undefined) {
      return Err({ kind: 'INVALID_TRANSITION', from, action });
    }

    const parsed = transition.requires.safeParse(payload);
    if (!parsed.success) {
      return Err({ kind: 'GATE_FAILED', issues: parsed.error.issues });
    }

    return Ok({ to: transition.to, data: parsed.data });
  }

  /**
   * Lists all actions available from a given state.
   *
   * @param state - State to query
   * @returns Array of action names with their transition definitions
   */
  listActionsFrom(state: string): ReadonlyArray<{ action: string; transition: Transition }> {
    const transitions = this.workflow.transitions[state] ?? {};
    return Object.entries(transitions).map(([action, transition]) => ({ action, transition }));
  }

  /**
   * Checks if a state is terminal (no outgoing transitions).
   *
   * @param state - State to check
   * @returns True if the state is terminal
   */
  isTerminal(state: string): boolean {
    return this.workflow.terminal.includes(state);
  }
}
