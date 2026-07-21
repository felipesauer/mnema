import { deriveAlias } from '../../domain/entity-alias.js';
import type { Workflow } from '../../domain/state-machine/state-machine.js';
import type { AuditEvent } from '../../storage/audit/audit-writer.js';
import type { SprintService } from '../backlog/sprint-service.js';
import type { TaskService } from '../backlog/task-service.js';
import type { AuditQuery } from '../integrity/audit-query.js';

/** Summary statistics for a set of durations, all in whole hours. */
export interface DurationSummary {
  /** Number of samples that contributed. */
  readonly count: number;
  /** Arithmetic mean, in hours (null when no samples). */
  readonly avg_hours: number | null;
  /** Median (p50), in hours (null when no samples). */
  readonly median_hours: number | null;
  /** Largest sample, in hours (null when no samples). */
  readonly max_hours: number | null;
}

/**
 * One task's estimate paired with its realised effort. `actual_hours`
 * is summed agent-run duration when run data exists for the task;
 * otherwise it falls back to lead time, flagged by `actual_source`.
 */
export interface EstimateVsActual {
  readonly task_key: string;
  readonly estimate: number;
  readonly actual_hours: number;
  /** `run_duration` (summed run intervals) or `lead_time` (fallback). */
  readonly actual_source: 'run_duration' | 'lead_time';
}

/** Points completed in a single sprint. */
export interface SprintVelocity {
  readonly sprint_key: string;
  readonly sprint_name: string;
  /** Sum of estimates of the sprint's tasks that reached a terminal state. */
  readonly completed_points: number;
  /** Count of the sprint's tasks that reached a terminal state. */
  readonly completed_tasks: number;
}

/** The full flow-metrics report derived from the audit log. */
export interface FlowMetrics {
  /** Tasks that reached a terminal state in the window. */
  readonly throughput: number;
  /** created → first terminal transition. */
  readonly lead_time: DurationSummary;
  /** first move off the initial state → first terminal transition. */
  readonly cycle_time: DurationSummary;
  /** Reopen rate over tasks that reached terminal at least once. */
  readonly reopen: {
    readonly reopened_tasks: number;
    readonly completed_tasks: number;
    readonly rate: number;
  };
  /** Completed points per sprint, newest sprint first. */
  readonly velocity: SprintVelocity[];
  /** Estimate vs realised effort, for done tasks that carry an estimate. */
  readonly estimate_vs_actual: {
    readonly samples: EstimateVsActual[];
    /** Mean realised hours per estimate point (null when no samples). */
    readonly hours_per_point: number | null;
    /** How many samples used run duration vs the lead-time fallback. */
    readonly run_duration_samples: number;
    readonly lead_time_fallback_samples: number;
  };
  /**
   * Skill adoption: whether recorded skills are actually being reused.
   * The dogfooding report flagged 9 recorded / 1 used; this makes the
   * ratio observable so the effect of the run-end skill draft can be
   * judged from data rather than guessed.
   */
  readonly skill_adoption: {
    /** `skill_recorded` events in the window. */
    readonly recorded: number;
    /** `skill_used` events in the window. */
    readonly used: number;
    /** `skill_used` per agent run (null when no runs in the window). */
    readonly uses_per_run: number | null;
    /** used ÷ recorded (null when nothing recorded); >= 1 means each skill is reused. */
    readonly used_vs_recorded: number | null;
  };
}

const MS_PER_HOUR = 3_600_000;

interface TaskTimeline {
  createdAt: number | null;
  firstMoveAt: number | null;
  firstTerminalAt: number | null;
  reopened: boolean;
  /** Run ids whose events touched this task (for run-duration join). */
  readonly runIds: Set<string>;
}

/**
 * Derives flow metrics — throughput, lead time, cycle time, reopen rate
 * and estimate-vs-actual — from the audit log, collecting nothing new.
 *
 * Every duration metric is reconstructed by replaying `task_created` and
 * `task_transitioned` events per committed task id; estimate-vs-actual joins
 * each completed task's current `estimate` (read from the task row) with the
 * lead time the log implies. Read-only and side-effect free.
 */
export class FlowMetricsService {
  constructor(
    private readonly audit: AuditQuery,
    private readonly tasks: TaskService,
    private readonly workflow: Workflow,
    private readonly sprints: SprintService,
    private readonly projectKey: string,
  ) {}

  /**
   * Computes the report.
   *
   * @param options.since - Optional lower time bound (ISO8601 or a
   *   relative duration like `7d`); only events at or after it count.
   * @param options.events - Pre-read audit events to compute from,
   *   letting a caller that already walked the log (e.g. `mnema metrics`,
   *   which also renders adoption metrics from the same read) avoid a
   *   second full read+parse. When supplied, the caller is responsible
   *   for any `since` filtering — this method does not re-filter a passed
   *   array. When omitted, the log is read here (optionally with `since`).
   * @returns The derived {@link FlowMetrics}.
   */
  compute(
    options: { readonly since?: string; readonly events?: readonly AuditEvent[] } = {},
  ): FlowMetrics {
    const events =
      options.events ?? this.audit.run(options.since === undefined ? {} : { since: options.since });
    const terminal = new Set(this.workflow.terminal);
    const initial = this.workflow.initial;

    // Timelines are keyed by the committed task id, which the audit events
    // carry in `data.id`.
    const timelines = new Map<string, TaskTimeline>();
    const timelineFor = (id: string): TaskTimeline => {
      let t = timelines.get(id);
      if (t === undefined) {
        t = {
          createdAt: null,
          firstMoveAt: null,
          firstTerminalAt: null,
          reopened: false,
          runIds: new Set<string>(),
        };
        timelines.set(id, t);
      }
      return t;
    };

    // run id → { started, ended } epoch ms, to price each run's duration.
    const runStart = new Map<string, number>();
    const runEnd = new Map<string, number>();
    // Skill-adoption tallies (events carry no task key, so count them
    // before the key guard below).
    let runCount = 0;
    let skillsRecorded = 0;
    let skillsUsed = 0;

    for (const event of events) {
      const atMs = Date.parse(event.at);
      if (Number.isNaN(atMs)) continue;

      if (event.kind === 'run_started') {
        runCount += 1;
        if (typeof event.run === 'string') runStart.set(event.run, atMs);
        continue;
      }
      if (event.kind === 'run_ended') {
        if (typeof event.run === 'string') runEnd.set(event.run, atMs);
        continue;
      }
      if (event.kind === 'skill_recorded') {
        skillsRecorded += 1;
        continue;
      }
      if (event.kind === 'skill_used') {
        skillsUsed += 1;
        continue;
      }

      const data = event.data as { id?: string; from?: string; to?: string; action?: string };
      const id = typeof data.id === 'string' ? data.id : undefined;
      if (id === undefined) continue;

      if (event.kind === 'task_created') {
        const t = timelineFor(id);
        if (t.createdAt === null) t.createdAt = atMs;
        if (typeof event.run === 'string') t.runIds.add(event.run);
        continue;
      }
      if (event.kind === 'task_transitioned') {
        const t = timelineFor(id);
        if (typeof event.run === 'string') t.runIds.add(event.run);
        // First move off the initial state starts the cycle clock.
        if (t.firstMoveAt === null && data.from === initial) {
          t.firstMoveAt = atMs;
        }
        if (data.to !== undefined && terminal.has(data.to) && t.firstTerminalAt === null) {
          t.firstTerminalAt = atMs;
        }
        if (data.action === 'reopen') {
          t.reopened = true;
        }
      }
    }

    // Summed run duration per task: for each run that touched the task,
    // add (ended − started) when both endpoints are known in-window.
    const runHoursForTask = (t: TaskTimeline): number | null => {
      let ms = 0;
      let any = false;
      for (const runId of t.runIds) {
        const s = runStart.get(runId);
        const e = runEnd.get(runId);
        if (s !== undefined && e !== undefined && e >= s) {
          ms += e - s;
          any = true;
        }
      }
      return any ? ms / MS_PER_HOUR : null;
    };

    const leadTimes: number[] = [];
    const cycleTimes: number[] = [];
    let completed = 0;
    let reopened = 0;
    const completedIds: string[] = [];

    for (const [id, t] of timelines) {
      if (t.firstTerminalAt === null) continue;
      completed += 1;
      completedIds.push(id);
      if (t.reopened) reopened += 1;
      if (t.createdAt !== null) {
        leadTimes.push((t.firstTerminalAt - t.createdAt) / MS_PER_HOUR);
      }
      const cycleStart = t.firstMoveAt ?? t.createdAt;
      if (cycleStart !== null) {
        cycleTimes.push((t.firstTerminalAt - cycleStart) / MS_PER_HOUR);
      }
    }

    // One listing builds id→{estimate, sprintId}; the audit log carries
    // neither, so they come from the current task rows.
    const estimateById = new Map<string, number | null>();
    const sprintIdById = new Map<string, string | null>();
    for (const task of this.tasks.list()) {
      estimateById.set(task.id, task.estimate);
      sprintIdById.set(task.id, task.sprintId);
    }

    // Estimate vs actual: prefer summed run duration (the effort the AC
    // asks for); fall back to lead time, flagged, when no run data exists.
    const estimateSamples: EstimateVsActual[] = [];
    for (const id of completedIds) {
      const t = timelines.get(id);
      if (t === undefined || t.firstTerminalAt === null) continue;
      const estimate = estimateById.get(id) ?? null;
      if (estimate === null || estimate <= 0) continue;

      const runHours = runHoursForTask(t);
      if (runHours !== null) {
        estimateSamples.push({
          task_key: deriveAlias('task', id),
          estimate,
          actual_hours: round1(runHours),
          actual_source: 'run_duration',
        });
      } else if (t.createdAt !== null) {
        estimateSamples.push({
          task_key: deriveAlias('task', id),
          estimate,
          actual_hours: round1((t.firstTerminalAt - t.createdAt) / MS_PER_HOUR),
          actual_source: 'lead_time',
        });
      }
    }
    const totalPoints = estimateSamples.reduce((sum, s) => sum + s.estimate, 0);
    const totalHours = estimateSamples.reduce((sum, s) => sum + s.actual_hours, 0);

    return {
      throughput: completed,
      lead_time: summarise(leadTimes),
      cycle_time: summarise(cycleTimes),
      reopen: {
        reopened_tasks: reopened,
        completed_tasks: completed,
        rate: completed === 0 ? 0 : round2(reopened / completed),
      },
      velocity: this.velocityBySprint(completedIds, sprintIdById, estimateById),
      estimate_vs_actual: {
        samples: estimateSamples,
        hours_per_point: totalPoints === 0 ? null : round1(totalHours / totalPoints),
        run_duration_samples: estimateSamples.filter((s) => s.actual_source === 'run_duration')
          .length,
        lead_time_fallback_samples: estimateSamples.filter((s) => s.actual_source === 'lead_time')
          .length,
      },
      skill_adoption: {
        recorded: skillsRecorded,
        used: skillsUsed,
        uses_per_run: runCount === 0 ? null : round2(skillsUsed / runCount),
        used_vs_recorded: skillsRecorded === 0 ? null : round2(skillsUsed / skillsRecorded),
      },
    };
  }

  /**
   * Completed points per sprint: sum the estimate of each sprint's tasks
   * that reached a terminal state. Sprint membership comes from the task
   * rows; sprints with no completed tasks are omitted. Newest first.
   */
  private velocityBySprint(
    completedIds: readonly string[],
    sprintIdByTaskId: ReadonlyMap<string, string | null>,
    estimateById: ReadonlyMap<string, number | null>,
  ): SprintVelocity[] {
    const sprints = this.sprints.list(this.projectKey);
    if (sprints.length === 0) return [];
    const completedSet = new Set(completedIds);

    const acc = new Map<string, { points: number; tasks: number }>();
    for (const [taskId, sprintId] of sprintIdByTaskId) {
      if (sprintId === null || !completedSet.has(taskId)) continue;
      const estimate = estimateById.get(taskId) ?? 0;
      const cur = acc.get(sprintId) ?? { points: 0, tasks: 0 };
      cur.points += estimate ?? 0;
      cur.tasks += 1;
      acc.set(sprintId, cur);
    }

    const out: SprintVelocity[] = [];
    for (const sprint of sprints) {
      const a = acc.get(sprint.id);
      if (a === undefined) continue;
      out.push({
        sprint_key: deriveAlias('sprint', sprint.id),
        sprint_name: sprint.name,
        completed_points: a.points,
        completed_tasks: a.tasks,
      });
    }
    // `sprints.list` returns creation order; reverse for newest-first.
    return out.reverse();
  }
}

/** Summarise a list of hour-valued durations. */
function summarise(values: readonly number[]): DurationSummary {
  if (values.length === 0) {
    return { count: 0, avg_hours: null, median_hours: null, max_hours: null };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
      : (sorted[mid] ?? 0);
  return {
    count: sorted.length,
    avg_hours: round1(sum / sorted.length),
    median_hours: round1(median),
    max_hours: round1(sorted[sorted.length - 1] ?? 0),
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
