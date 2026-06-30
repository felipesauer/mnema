import type { Workflow } from '../domain/state-machine/state-machine.js';
import type { AuditQuery } from './audit-query.js';
import type { TaskService } from './task-service.js';

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

/** One task's estimate paired with its realised lead time. */
export interface EstimateVsActual {
  readonly task_key: string;
  readonly estimate: number;
  readonly lead_time_hours: number;
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
  /** Estimate vs realised lead time, for done tasks that carry an estimate. */
  readonly estimate_vs_actual: {
    readonly samples: EstimateVsActual[];
    /** Mean realised hours per estimate point (null when no samples). */
    readonly hours_per_point: number | null;
  };
}

const MS_PER_HOUR = 3_600_000;

interface TaskTimeline {
  createdAt: number | null;
  firstMoveAt: number | null;
  firstTerminalAt: number | null;
  reopened: boolean;
}

/**
 * Derives flow metrics — throughput, lead time, cycle time, reopen rate
 * and estimate-vs-actual — from the audit log, collecting nothing new.
 *
 * Every duration metric is reconstructed by replaying `task_created` and
 * `task_transitioned` events per task key; estimate-vs-actual joins each
 * completed task's current `estimate` (read from the task row) with the
 * lead time the log implies. Read-only and side-effect free.
 */
export class FlowMetricsService {
  constructor(
    private readonly audit: AuditQuery,
    private readonly tasks: TaskService,
    private readonly workflow: Workflow,
  ) {}

  /**
   * Computes the report.
   *
   * @param options.since - Optional lower time bound (ISO8601 or a
   *   relative duration like `7d`); only events at or after it count.
   * @returns The derived {@link FlowMetrics}.
   */
  compute(options: { readonly since?: string } = {}): FlowMetrics {
    const events = this.audit.run(options.since === undefined ? {} : { since: options.since });
    const terminal = new Set(this.workflow.terminal);
    const initial = this.workflow.initial;

    const timelines = new Map<string, TaskTimeline>();
    const timelineFor = (key: string): TaskTimeline => {
      let t = timelines.get(key);
      if (t === undefined) {
        t = { createdAt: null, firstMoveAt: null, firstTerminalAt: null, reopened: false };
        timelines.set(key, t);
      }
      return t;
    };

    for (const event of events) {
      const data = event.data as { key?: string; from?: string; to?: string; action?: string };
      const key = typeof data.key === 'string' ? data.key : undefined;
      if (key === undefined) continue;
      const atMs = Date.parse(event.at);
      if (Number.isNaN(atMs)) continue;

      if (event.kind === 'task_created') {
        const t = timelineFor(key);
        if (t.createdAt === null) t.createdAt = atMs;
        continue;
      }
      if (event.kind === 'task_transitioned') {
        const t = timelineFor(key);
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

    const leadTimes: number[] = [];
    const cycleTimes: number[] = [];
    let completed = 0;
    let reopened = 0;
    const completedKeys: string[] = [];

    for (const [key, t] of timelines) {
      if (t.firstTerminalAt === null) continue;
      completed += 1;
      completedKeys.push(key);
      if (t.reopened) reopened += 1;
      if (t.createdAt !== null) {
        leadTimes.push((t.firstTerminalAt - t.createdAt) / MS_PER_HOUR);
      }
      const cycleStart = t.firstMoveAt ?? t.createdAt;
      if (cycleStart !== null) {
        cycleTimes.push((t.firstTerminalAt - cycleStart) / MS_PER_HOUR);
      }
    }

    // One listing builds a key→estimate map; the audit log carries no
    // estimate, so it is read from the current task rows.
    const estimateByKey = new Map<string, number | null>();
    for (const task of this.tasks.list()) estimateByKey.set(task.key, task.estimate);

    const estimateSamples: EstimateVsActual[] = [];
    for (const key of completedKeys) {
      const t = timelines.get(key);
      if (t === undefined || t.createdAt === null || t.firstTerminalAt === null) continue;
      const estimate = estimateByKey.get(key) ?? null;
      if (estimate === null || estimate <= 0) continue;
      estimateSamples.push({
        task_key: key,
        estimate,
        lead_time_hours: round1((t.firstTerminalAt - t.createdAt) / MS_PER_HOUR),
      });
    }
    const totalPoints = estimateSamples.reduce((sum, s) => sum + s.estimate, 0);
    const totalHours = estimateSamples.reduce((sum, s) => sum + s.lead_time_hours, 0);

    return {
      throughput: completed,
      lead_time: summarise(leadTimes),
      cycle_time: summarise(cycleTimes),
      reopen: {
        reopened_tasks: reopened,
        completed_tasks: completed,
        rate: completed === 0 ? 0 : round2(reopened / completed),
      },
      estimate_vs_actual: {
        samples: estimateSamples,
        hours_per_point: totalPoints === 0 ? null : round1(totalHours / totalPoints),
      },
    };
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
