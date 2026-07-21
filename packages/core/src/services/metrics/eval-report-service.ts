import type { Workflow } from '../../domain/state-machine/state-machine.js';
import type { AuditEvent } from '../../storage/audit/audit-writer.js';
import type { AuditQuery } from '../integrity/audit-query.js';
import type { SkillQualityService } from '../knowledge/skill-quality-service.js';
import type { FlowMetrics, FlowMetricsService } from './flow-metrics-service.js';

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

/** How a run is judged "guided". Configurable via `eval.guided_proxy`. */
export type GuidedProxy = 'skill_used' | 'bootstrap' | 'either';

/** The proxy description shown in the report, per configured mode. */
function proxyText(proxy: GuidedProxy): string {
  const skill = 'used a recorded skill (a `skill_used` event)';
  const boot =
    'was opened after `context_bootstrap` ran (a `run_started` event flagged ' +
    '`bootstrapped` — the observable signal for a bootstrap-guided run that ' +
    'uses no recorded skill; context_bootstrap stays read-only and only sets ' +
    'a per-session flag the run start stamps)';
  const body =
    proxy === 'skill_used'
      ? `it ${skill}`
      : proxy === 'bootstrap'
        ? `it ${boot}`
        : `it EITHER ${skill} OR ${boot}`;
  return `A run is "guided" when ${body}. Configurable via \`eval.guided_proxy\` (skill_used | bootstrap | either).`;
}

const CAVEAT =
  'CORRELATIONAL, NOT CAUSAL. This compares runs within one real project, ' +
  'where tasks differ in difficulty and the agent learns over time — it is ' +
  'not a controlled A/B. A lower reopen rate in the guided cohort is a ' +
  'signal to investigate, not proof that guidance caused it. Proving cause ' +
  'needs a task corpus and an agent-runner run with vs without Mnema — ' +
  'neither of which Mnema owns (it records; it does not run agents).';

/**
 * Derives a guided-vs-unguided metrics diff from the audit log, collecting
 * nothing new (local, zero-telemetry, read-only). It partitions
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
    private readonly workflow: Workflow,
  ) {}

  /**
   * Computes the report over the audit window.
   *
   * @param options.since - Lower bound (`7d`, `30d`, or ISO8601)
   * @returns The two-cohort diff plus the proxy and caveat
   */
  compute(options: { readonly since?: string; readonly proxy?: GuidedProxy } = {}): EvalReport {
    const events = this.audit.run(options.since === undefined ? {} : { since: options.since });
    const proxy: GuidedProxy = options.proxy ?? 'either';

    // A run is "guided" per the configured proxy. skill_used: the run emitted
    // a skill_used event. bootstrap: its run_started carries data.bootstrapped
    // (context_bootstrap ran before the run opened — a guided solo run with no
    // skill trace). either: whichever holds. Collect the run ids in one pass.
    const wantSkill = proxy === 'skill_used' || proxy === 'either';
    const wantBootstrap = proxy === 'bootstrap' || proxy === 'either';
    const guidedRuns = new Set<string>();
    for (const event of events) {
      if (typeof event.run !== 'string') continue;
      if (wantSkill && event.kind === 'skill_used') {
        guidedRuns.add(event.run);
      } else if (
        wantBootstrap &&
        event.kind === 'run_started' &&
        (event.data as { bootstrapped?: unknown }).bootstrapped === true
      ) {
        guidedRuns.add(event.run);
      }
    }

    // Assign each TASK (not each event) to a cohort by the run that owns it.
    // A task's lifecycle can span runs in opposite cohorts; if we split by
    // each event's own run, FlowMetricsService — which keys its timelines by
    // task key — reconstructs that task twice from partial slices, counting it
    // as completed in BOTH cohorts and blaming the reopen on whichever run
    // happened to run the reopen transition. Owning the whole task by ONE run
    // keeps every task in exactly one cohort.
    //
    // The owner is the run that DID the work whose outcome we measure: the
    // run of the task's first terminal transition (its completion). Owning by
    // the CREATING run would invert the split for the normal backlog-first
    // flow — tasks created up-front in a planning run and executed later in
    // guided runs would route every completion (and reopen) to the planning
    // run's cohort, showing guided `done=0`. Fallbacks, for tasks that never
    // reached terminal in the window: the creating run, then the first run
    // that touched it (ownership barely matters there — an uncompleted task
    // contributes no completion/reopen).
    const terminal = new Set(this.workflow.terminal);
    const firstTerminalRun = new Map<string, string>();
    const createdRun = new Map<string, string>();
    const firstTouchRun = new Map<string, string>();
    for (const event of events) {
      if (event.kind !== 'task_created' && event.kind !== 'task_transitioned') continue;
      const run = typeof event.run === 'string' ? event.run : null;
      if (run === null) continue;
      const key = taskKeyOf(event);
      if (key === null) continue;
      if (!firstTouchRun.has(key)) firstTouchRun.set(key, run);
      if (event.kind === 'task_created') {
        if (!createdRun.has(key)) createdRun.set(key, run);
        continue;
      }
      const to = (event.data as { to?: string }).to;
      if (typeof to === 'string' && terminal.has(to) && !firstTerminalRun.has(key)) {
        firstTerminalRun.set(key, run);
      }
    }
    const ownerOf = (key: string): string | undefined =>
      firstTerminalRun.get(key) ?? createdRun.get(key) ?? firstTouchRun.get(key);

    // Route every event to a cohort. Task events follow their task's owner run;
    // all other events (run_started, skill_*, run-less meta-events) follow their
    // own run's guidedness. A task event whose owner run is unknown (no run ever
    // touched it — e.g. a manual CLI transition outside any run) falls back to
    // its own run, then to unguided.
    const guidedEvents: AuditEvent[] = [];
    const unguidedEvents: AuditEvent[] = [];
    const isGuided = (run: string | null): boolean => run !== null && guidedRuns.has(run);
    for (const event of events) {
      const ownRun = typeof event.run === 'string' ? event.run : null;
      let guided: boolean;
      if (event.kind === 'task_created' || event.kind === 'task_transitioned') {
        const key = taskKeyOf(event);
        const owner = key === null ? null : (ownerOf(key) ?? ownRun);
        guided = isGuided(owner);
      } else {
        guided = isGuided(ownRun);
      }
      if (guided) guidedEvents.push(event);
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
      proxy: proxyText(proxy),
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

/** The committed task id carried by a task_created/task_transitioned event. */
function taskKeyOf(event: AuditEvent): string | null {
  const id = (event.data as { id?: unknown }).id;
  return typeof id === 'string' ? id : null;
}
