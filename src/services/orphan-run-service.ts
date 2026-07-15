import type { AgentRun } from '../domain/entities/agent-run.js';
import { AgentRunStatus } from '../domain/enums/agent-run-status.js';
import type { MnemaError } from '../errors/mnema-error.js';
import type { AgentRunRepository } from '../storage/sqlite/repositories/agent-run-repository.js';
import type { AgentRunService } from './agent-run-service.js';
import { Ok, type Result } from '../common/result.js';

const MS_PER_HOUR = 3_600_000;

/**
 * Pure detection: of the given running runs, those whose `startedAt` is
 * at least `thresholdHours` old, oldest first. Shared by
 * {@link OrphanRunService.detect} and the `mnema doctor` sweep so both
 * use identical age logic without the doctor needing the full service.
 *
 * @param running - Runs currently in `running` status
 * @param thresholdHours - Age past which a run is an orphan
 * @param now - Reference time in epoch ms
 */
export function findOrphanRuns(
  running: readonly AgentRun[],
  thresholdHours: number,
  now: number,
): OrphanRun[] {
  const orphans: OrphanRun[] = [];
  for (const run of running) {
    const startedMs = Date.parse(run.startedAt);
    if (Number.isNaN(startedMs)) continue;
    const ageHours = Math.floor((now - startedMs) / MS_PER_HOUR);
    if (ageHours >= thresholdHours) {
      orphans.push({ id: run.id, goal: run.goal, startedAt: run.startedAt, ageHours });
    }
  }
  return orphans;
}

/** A running run judged stale (started, never ended, past the threshold). */
export interface OrphanRun {
  readonly id: string;
  readonly goal: string;
  readonly startedAt: string;
  /** Whole hours since it started. */
  readonly ageHours: number;
}

/** Outcome of an auto-close sweep. */
export interface ClosedOrphan {
  readonly id: string;
  readonly ageHours: number;
  /** Whether the abort succeeded (false if the run changed underneath us). */
  readonly closed: boolean;
}

/**
 * Detects and closes orphaned agent runs — sessions that called
 * `agent_run_start`, dropped, and left the run `running` forever. They
 * never reach a terminal status on their own, so they linger in the
 * audit trail and skew "what's still in progress".
 *
 * Detection is age-based: a run still `running` whose `started_at` is
 * older than the configured threshold is an orphan. Closing aborts it
 * (a terminal status) with an explanatory note rather than deleting it,
 * so provenance is preserved — the run, its mutations and its plans stay
 * in the record, now correctly marked as abandoned.
 *
 * Read for detection; the close sweep is the only mutation, and it goes
 * through {@link AgentRunService.end} so the same audit event and
 * run-end hook fire as for a normal end.
 */
export class OrphanRunService {
  constructor(
    private readonly runs: AgentRunRepository,
    private readonly agentRun: AgentRunService,
  ) {}

  /**
   * Lists running runs older than `thresholdHours`, oldest first.
   *
   * @param thresholdHours - Age past which a running run is an orphan
   * @param now - Reference time in epoch ms (injectable for tests)
   * @returns The stale runs
   */
  detect(thresholdHours: number, now: number = Date.now()): OrphanRun[] {
    return findOrphanRuns(this.runs.findRunning(), thresholdHours, now);
  }

  /**
   * Aborts every orphaned run with an explanatory note. Each close goes
   * through {@link AgentRunService.end}; a run that already ended (e.g. a
   * concurrent session closed it) is reported as `closed: false` rather
   * than failing the sweep.
   *
   * @param thresholdHours - Age past which a running run is an orphan
   * @param now - Reference time in epoch ms (injectable for tests)
   * @returns One result row per orphan that was found
   */
  closeStale(thresholdHours: number, now: number = Date.now()): Result<ClosedOrphan[], MnemaError> {
    const closed: ClosedOrphan[] = [];
    for (const orphan of this.detect(thresholdHours, now)) {
      const note = `Auto-closed as orphaned: no agent_run_end after ${orphan.ageHours}h (threshold ${thresholdHours}h).`;
      // end() credits provenance from the run's own invokedBy/agentActor,
      // so no actor needs to be supplied here.
      const result = this.agentRun.end({
        runId: orphan.id,
        status: AgentRunStatus.Aborted,
        result: note,
      });
      closed.push({ id: orphan.id, ageHours: orphan.ageHours, closed: result.ok });
    }
    return Ok(closed);
  }
}
