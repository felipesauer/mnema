import type { z } from 'zod';

import { Err, Ok, type Result } from '../../services/result.js';
import type { FieldSpec } from './workflow-meta-schema.js';

/**
 * A transition in a workflow, with its associated gate schema.
 *
 * `requires` is the compiled Zod schema used at validation time;
 * `requiresSpec` retains the original JSON specs so downstream code
 * (notably `task-service.transition` deciding which payload fields
 * are mutating vs validating) can introspect per-field metadata like
 * `field_kind`.
 */
export interface Transition {
  readonly to: string;
  readonly description: string;
  readonly useWhen: string;
  readonly requires: z.ZodObject;
  readonly requiresSpec: Readonly<Record<string, FieldSpec>>;
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
  /**
   * Original field specs from the workflow JSON, keyed by field name.
   * Lets the caller inspect per-field metadata (e.g. `field_kind`)
   * without having to re-resolve the workflow path.
   */
  readonly requiresSpec: Readonly<Record<string, FieldSpec>>;
}

/**
 * Outcome of {@link StateMachine.resolveTransition}: like
 * {@link ValidatedTransition} but tolerant of a failed gate. The action
 * must exist (an unknown action is still an error), so `to` and the
 * best-effort `data` are always present; `gate` says whether the
 * required-field check passed and, when not, carries the offending
 * issues. The enforcement policy lives in the caller — the state machine
 * only reports.
 */
export interface ResolvedTransition {
  readonly to: string;
  readonly data: unknown;
  readonly requiresSpec: Readonly<Record<string, FieldSpec>>;
  readonly gate:
    | { readonly ok: true }
    | { readonly ok: false; readonly issues: readonly z.core.$ZodIssue[] };
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
   * When `defaults` is supplied, any key absent from `payload` falls back
   * to the default before validation. This lets a gate validate the
   * task's *resulting* state rather than the delta: a field already
   * persisted (title, description, …) satisfies the gate without being
   * resent, and omitting it never overwrites what is stored. The caller
   * decides which fields are safe to default — the state machine just
   * merges. Keys present in `payload` (even with a shorter value) win.
   *
   * @param from - Source state
   * @param action - Action name
   * @param payload - Data to validate against the gate's requires schema
   * @param defaults - Fallback values for keys missing from `payload`
   * @returns Result with target state and parsed data, or typed gate error
   */
  validateTransition(
    from: string,
    action: string,
    payload: unknown,
    defaults: Readonly<Record<string, unknown>> = {},
  ): Result<ValidatedTransition, GateError> {
    const transition = this.workflow.transitions[from]?.[action];
    if (transition === undefined) {
      return Err({ kind: 'INVALID_TRANSITION', from, action });
    }

    const merged = mergeDefaults(payload, defaults);
    const parsed = transition.requires.safeParse(merged);
    if (!parsed.success) {
      return Err({ kind: 'GATE_FAILED', issues: parsed.error.issues });
    }

    return Ok({
      to: transition.to,
      data: parsed.data,
      requiresSpec: transition.requiresSpec,
    });
  }

  /**
   * Resolves a transition without letting a failed gate abort it. Use
   * this when the *caller* decides what a gate failure means (see
   * `enforcement_mode`): an agent may be blocked while a human overrides.
   *
   * An unknown action is still an error — there is nothing to resolve.
   * When the action exists, returns the target state, the best-effort
   * parsed `data` (the fields that did parse, plus defaults), and a
   * `gate` flag that is `{ ok: false, issues }` when required fields are
   * missing. On a clean gate the `data` is the fully-validated payload,
   * identical to {@link validateTransition}.
   *
   * @param from - Source state
   * @param action - Action name
   * @param payload - Data to validate against the gate
   * @param defaults - Fallback values for keys missing from `payload`
   * @returns Resolved transition, or `INVALID_TRANSITION` when the action
   *   does not exist
   */
  resolveTransition(
    from: string,
    action: string,
    payload: unknown,
    defaults: Readonly<Record<string, unknown>> = {},
  ): Result<ResolvedTransition, GateError> {
    const transition = this.workflow.transitions[from]?.[action];
    if (transition === undefined) {
      return Err({ kind: 'INVALID_TRANSITION', from, action });
    }

    const merged = mergeDefaults(payload, defaults);
    const parsed = transition.requires.safeParse(merged);
    return Ok({
      to: transition.to,
      // On success Zod has already stripped keys not declared by the gate.
      // On failure (a permitted override), hand back only the DECLARED
      // fields the user did supply — never the raw payload, so an
      // undeclared key cannot ride the override path into the append-only
      // audit log. The override intent (valid fields) is preserved.
      data: parsed.success ? parsed.data : pickDeclared(merged, transition.requiresSpec),
      requiresSpec: transition.requiresSpec,
      gate: parsed.success ? { ok: true } : { ok: false, issues: parsed.error.issues },
    });
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

  /**
   * The workflow's terminal state names.
   *
   * @returns The terminal states (a task in one of these is "done")
   */
  terminalStates(): readonly string[] {
    return this.workflow.terminal;
  }
}

/**
 * Returns `payload` with each default applied only where the payload
 * omits that key (missing or `undefined`). An explicit value in the
 * payload — including `null` or an empty string — is left untouched, so
 * a caller can still clear a field on purpose. Non-object payloads pass
 * through unchanged so the gate schema reports the real type error.
 */
function mergeDefaults(payload: unknown, defaults: Readonly<Record<string, unknown>>): unknown {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return payload;
  }
  const result: Record<string, unknown> = { ...(payload as Record<string, unknown>) };
  for (const [key, value] of Object.entries(defaults)) {
    if (result[key] === undefined && value !== undefined && value !== null) {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Restricts a payload to the keys declared by the gate spec, mirroring
 * the strip Zod applies on the success path. Used on the failed-gate
 * (override) path so an undeclared key cannot reach the audit log. A
 * non-object payload passes through unchanged, so the gate still reports
 * the real type error rather than this masking it as an empty object.
 */
function pickDeclared(payload: unknown, spec: Readonly<Record<string, unknown>>): unknown {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return payload;
  }
  const source = payload as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(spec)) {
    if (key in source) result[key] = source[key];
  }
  return result;
}
