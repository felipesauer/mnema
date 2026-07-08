import type { AuditEvent } from '../storage/audit/audit-writer.js';
import type { FlowMetrics } from './flow-metrics-service.js';
import type { CounterEntry } from './metrics-counter.js';

/**
 * The local adoption report for the alpha. Every field is derived from
 * already-recorded local data — the audit log, the local counter log, and
 * flow metrics — with ZERO remote telemetry (MNEMA-ADR-36). Pure data.
 */
export interface AdoptionMetrics {
  /**
   * Time from the first recorded task to the first task reaching a
   * terminal state — the "first successful use" latency. Null when the
   * project has not yet completed a first task.
   */
  readonly timeToFirstDone: {
    readonly firstTaskAt: string | null;
    readonly firstDoneAt: string | null;
    readonly hours: number | null;
  };
  /**
   * Which advanced features have been activated at least once, by the
   * presence of their audit event kind. `graph` is intentionally absent —
   * viewing the graph is a pure read that records nothing (ADR-20); the
   * measurable proxy is `dependencies` (a link was created).
   */
  readonly featureActivation: {
    readonly epics: boolean;
    readonly decisions: boolean;
    readonly sprints: boolean;
    readonly dependencies: boolean;
    readonly skills: boolean;
    /** How many of the tracked features have been activated. */
    readonly activatedCount: number;
    readonly trackedCount: number;
  };
  /** Read-only command adoption, from the local counter log. */
  readonly doctorRuns: number;
  /** Skill adoption, lifted from flow metrics (already local). */
  readonly skillAdoption: FlowMetrics['skill_adoption'];
}

const TERMINAL_DONE_ACTIONS = new Set(['done', 'approve', 'complete']);

/** The first event of a given kind, by `at` (events may be unsorted). */
function earliest(
  events: readonly AuditEvent[],
  predicate: (e: AuditEvent) => boolean,
): string | null {
  let best: string | null = null;
  for (const e of events) {
    if (!predicate(e)) continue;
    if (best === null || e.at < best) best = e.at;
  }
  return best;
}

/** True when a transition event lands the task in a terminal state. */
function isTerminalTransition(e: AuditEvent, terminal: ReadonlySet<string>): boolean {
  if (e.kind !== 'task_transitioned') return false;
  const to = (e.data as Record<string, unknown>).to;
  if (typeof to === 'string') return terminal.has(to);
  // Fallback ONLY when `to` is absent (older/hand-written events): honour
  // the common done/approve actions. When `to` is present it is the
  // authority — an action named 'approve'/'done' that lands in a
  // NON-terminal state (possible in a custom workflow) must not count.
  const action = (e.data as Record<string, unknown>).action;
  return typeof action === 'string' && TERMINAL_DONE_ACTIONS.has(action);
}

/** Whole hours between two ISO timestamps, or null if unparseable/negative. */
function hoursBetween(fromIso: string, toIso: string): number | null {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (Number.isNaN(from) || Number.isNaN(to) || to < from) return null;
  return Math.round((to - from) / 3_600_000);
}

/**
 * Composes the adoption report from local sources. Pure: no IO, no service
 * access — the caller supplies the audit events, local counters, terminal
 * states, and flow metrics.
 *
 * @param events - Audit events (any order)
 * @param counters - Entries from the local counter log
 * @param terminal - The workflow's terminal state names
 * @param flow - Flow metrics (for skill adoption)
 * @returns The composed adoption metrics
 */
export function computeAdoptionMetrics(
  events: readonly AuditEvent[],
  counters: readonly CounterEntry[],
  terminal: ReadonlySet<string>,
  flow: FlowMetrics,
): AdoptionMetrics {
  const firstTaskAt = earliest(events, (e) => e.kind === 'task_created');
  const firstDoneAt = earliest(events, (e) => isTerminalTransition(e, terminal));
  const hours =
    firstTaskAt !== null && firstDoneAt !== null ? hoursBetween(firstTaskAt, firstDoneAt) : null;

  const has = (kind: string): boolean => events.some((e) => e.kind === kind);
  const epics = has('epic_created');
  const decisions = has('decision_recorded');
  const sprints = has('sprint_planned');
  const dependencies = has('dependency_linked');
  const skills = has('skill_recorded');
  const flags = [epics, decisions, sprints, dependencies, skills];

  const doctorRuns = counters.filter((c) => c.kind === 'doctor_ran').length;

  return {
    timeToFirstDone: { firstTaskAt, firstDoneAt, hours },
    featureActivation: {
      epics,
      decisions,
      sprints,
      dependencies,
      skills,
      activatedCount: flags.filter(Boolean).length,
      trackedCount: flags.length,
    },
    doctorRuns,
    skillAdoption: flow.skill_adoption,
  };
}
