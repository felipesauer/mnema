import type { AuditEvent } from '../storage/audit/audit-writer.js';
import type { AuditQuery } from './audit-query.js';
import type { FlowMetrics, FlowMetricsService } from './flow-metrics-service.js';
import type { SkillQualityService } from './skill-quality-service.js';

/**
 * One cohort's slice of the eval report.
 */
export interface EvalCohort {
  /** How many agent runs fell in this cohort. */
  readonly runs: number;
  /** Flow metrics computed over ONLY this cohort's events. */
  readonly metrics: FlowMetrics;
}

/**
 * The eval report: a guided-vs-unguided metrics diff derived entirely from
 * the audit log. See {@link EvalReportService} for the honesty boundary.
 */
export interface EvalReport {
  /** The guidance proxy used to split runs (stated so the reader can judge it). */
  readonly proxy: string;
  /** Correlational-not-causal disclaimer, always present in the output. */
  readonly caveat: string;
  /** Runs that leaned on a recorded skill (`skill_used`). */
  readonly guided: EvalCohort;
  /** Runs that did not. */
  readonly unguided: EvalCohort;
  /** Skills currently flagged for review (a quality signal, not per-cohort). */
  readonly skills_flagged_for_review: number;
}

const PROXY =
  'A run is "guided" when it used a recorded skill (a `skill_used` event). ' +
  'context_bootstrap and focus are read-only and leave no audit trace, so ' +
  'they cannot be part of the proxy — skill use is the observable signal.';

const CAVEAT =
  'CORRELATIONAL, NOT CAUSAL. This compares runs within one real project, ' +
  'where tasks differ in difficulty and the agent learns over time — it is ' +
  'not a controlled A/B. A lower reopen rate in the guided cohort is a ' +
  'signal to investigate, not proof that guidance caused it. Proving cause ' +
  'needs a task corpus and an agent-runner run with vs without Mnema — ' +
  'neither of which Mnema owns (it records; it does not run agents).';

/**
 * Derives a guided-vs-unguided metrics diff from the audit log, collecting
 * nothing new (MNEMA-ADR-36: local, zero-telemetry, read-only). It partitions
 * agent runs into two cohorts by an OBSERVABLE guidance proxy — did the run
 * use a recorded skill — and reuses {@link FlowMetricsService} to compute
 * reopen rate, lead/cycle time and throughput over each cohort's events.
 *
 * This is the honest, self-contained first slice of an eval harness. It does
 * NOT run agents and does NOT own a task corpus; the report is a correlation
 * over work that already happened, and it says so (see {@link EvalReport.caveat}).
 */
export class EvalReportService {
  constructor(
    private readonly audit: AuditQuery,
    private readonly flowMetrics: FlowMetricsService,
    private readonly skillQuality: SkillQualityService,
  ) {}

  /**
   * Computes the report over the audit window.
   *
   * @param options.since - Lower bound (`7d`, `30d`, or ISO8601)
   * @returns The two-cohort diff plus the proxy and caveat
   */
  compute(options: { readonly since?: string } = {}): EvalReport {
    const events = this.audit.run(options.since === undefined ? {} : { since: options.since });

    // A run is "guided" iff it emitted a skill_used event. Collect those run
    // ids in one pass.
    const guidedRuns = new Set<string>();
    for (const event of events) {
      if (event.kind === 'skill_used' && typeof event.run === 'string') {
        guidedRuns.add(event.run);
      }
    }

    // Split the event stream by cohort. An event belongs to the guided cohort
    // when its run is guided; events with no run (rare meta-events) go to
    // neither cohort's run-scoped metrics but are harmless — FlowMetricsService
    // keys durations by task and tallies runs by run_started, so an event with
    // no run simply is not counted as a run.
    const guidedEvents: AuditEvent[] = [];
    const unguidedEvents: AuditEvent[] = [];
    for (const event of events) {
      const run = typeof event.run === 'string' ? event.run : null;
      if (run !== null && guidedRuns.has(run)) guidedEvents.push(event);
      else unguidedEvents.push(event);
    }

    const runsWithId = (evts: readonly AuditEvent[]): number => {
      const runs = new Set<string>();
      for (const e of evts) {
        if (e.kind === 'run_started' && typeof e.run === 'string') runs.add(e.run);
      }
      return runs.size;
    };

    return {
      proxy: PROXY,
      caveat: CAVEAT,
      guided: {
        runs: runsWithId(guidedEvents),
        metrics: this.flowMetrics.compute({ events: guidedEvents }),
      },
      unguided: {
        runs: runsWithId(unguidedEvents),
        metrics: this.flowMetrics.compute({ events: unguidedEvents }),
      },
      skills_flagged_for_review: this.skillQuality.flaggedForReview().size,
    };
  }
}
