import { Err, Ok, type Result } from '../../common/result.js';
import type { Task } from '../../domain/entities/task.js';
import type { StateMachine } from '../../domain/state-machine/state-machine.js';
import { ErrorCode } from '../../errors/error-codes.js';
import type { MnemaError } from '../../errors/mnema-error.js';
import type { AuditEvent } from '../../storage/audit/audit-writer.js';
import type { EpicRepository } from '../../storage/sqlite/repositories/epic-repository.js';
import type { SprintRepository } from '../../storage/sqlite/repositories/sprint-repository.js';
import type { TaskEvidenceRepository } from '../../storage/sqlite/repositories/task-evidence-repository.js';
import type { TaskRepository } from '../../storage/sqlite/repositories/task-repository.js';
import type { SqliteAdapter } from '../../storage/sqlite/sqlite-adapter.js';
import type { AuditQuery } from '../integrity/audit-query.js';

/**
 * Severity of a work-graph lint diagnostic. Mirrors the skill-lint
 * vocabulary so callers can treat both reports uniformly.
 *
 * - `error`: a real integrity problem (e.g. a dependency pointing at a
 *   task that no longer exists).
 * - `warning`: a convention/process issue that does not corrupt state
 *   (e.g. a sprint still holding non-terminal tasks).
 */
export type WorkGraphSeverity = 'error' | 'warning';

/** One diagnostic emitted by {@link WorkGraphLintService}. */
export interface WorkGraphDiagnostic {
  /** The scope being linted, e.g. `sprint MNEMA-SPRINT-5`. */
  readonly scope: string;
  readonly severity: WorkGraphSeverity;
  /** Short machine-stable rule id, e.g. `incomplete-tasks`. */
  readonly rule: string;
  readonly message: string;
}

/** Outcome of a lint pass over a sprint or epic. */
export interface WorkGraphLintReport {
  readonly diagnostics: readonly WorkGraphDiagnostic[];
  readonly tasksScanned: number;
  readonly errorCount: number;
  readonly warningCount: number;
}

interface BrokenDependencyRow {
  readonly task_key: string;
  readonly blocks_task_id: string;
}

/**
 * Read-only linter over the work graph (sprints, epics, tasks,
 * dependencies). It never mutates state — it reports diagnostics the
 * way `skill lint` / `memory lint` do, so a human or agent can act on
 * them.
 *
 * Checks:
 * - `incomplete-tasks` (warning): the sprint/epic still holds tasks in a
 *   non-terminal state.
 * - `empty` (warning): the sprint/epic has no tasks at all.
 * - `subagent-bypass` (warning): a DONE task whose transitions were never
 *   recorded under an agent run (`run` absent on every audit event for
 *   the task) — i.e. it was moved outside a tracked agent run.
 * - `missing-evidence` (warning): a task in a terminal state with no
 *   attached evidence of any kind — done on paper, unproven in fact. The
 *   inverse of subagent-bypass: that checks *who* moved it, this checks
 *   *whether the work was shown*.
 * - `broken-dependency` (error): a dependency edge pointing at a task
 *   that no longer exists (soft-deleted or gone).
 */
export class WorkGraphLintService {
  constructor(
    private readonly sprints: SprintRepository,
    private readonly epics: EpicRepository,
    private readonly tasks: TaskRepository,
    private readonly stateMachine: StateMachine,
    private readonly auditQuery: AuditQuery,
    private readonly adapter: SqliteAdapter,
    private readonly evidence: TaskEvidenceRepository,
  ) {}

  /**
   * Lints a sprint by key.
   *
   * @param sprintKey - Sprint identifier
   * @returns The report or `SprintNotFound`
   */
  lintSprint(sprintKey: string): Result<WorkGraphLintReport, MnemaError> {
    const sprint = this.sprints.findByKey(sprintKey);
    if (sprint === null) {
      return Err({ kind: ErrorCode.SprintNotFound, sprintKey });
    }
    return Ok(this.lintTasks(`sprint ${sprintKey}`, this.sprints.listTasks(sprint.id)));
  }

  /**
   * Lints an epic by key.
   *
   * @param epicKey - Epic identifier
   * @returns The report or `EpicNotFound`
   */
  lintEpic(epicKey: string): Result<WorkGraphLintReport, MnemaError> {
    const epic = this.epics.findByKey(epicKey);
    if (epic === null) {
      return Err({ kind: ErrorCode.EpicNotFound, epicKey });
    }
    return Ok(this.lintTasks(`epic ${epicKey}`, this.tasksOfEpic(epic.id)));
  }

  /**
   * Active tasks attached to an epic. Resolved through the task
   * repository's by-key lookup so the linter stays independent of any
   * epic-scoped repository method that other features may add.
   */
  private tasksOfEpic(epicId: string): Task[] {
    const keys = this.epics.listTaskKeys(epicId);
    const tasks: Task[] = [];
    for (const key of keys) {
      const task = this.tasks.findByKey(key);
      if (task !== null) tasks.push(task);
    }
    return tasks;
  }

  /**
   * Runs every check over a task list scoped by `scope`.
   */
  private lintTasks(scope: string, tasks: readonly Task[]): WorkGraphLintReport {
    const diagnostics: WorkGraphDiagnostic[] = [];

    if (tasks.length === 0) {
      diagnostics.push({
        scope,
        severity: 'warning',
        rule: 'empty',
        message: `${scope} has no tasks attached`,
      });
    }

    const incomplete = tasks.filter((t) => !this.stateMachine.isTerminal(t.state));
    if (incomplete.length > 0) {
      diagnostics.push({
        scope,
        severity: 'warning',
        rule: 'incomplete-tasks',
        message: `${incomplete.length} task(s) not in a terminal state: ${incomplete
          .map((t) => t.key)
          .join(', ')}`,
      });
    }

    // Read the audit log ONCE and bucket task_transitioned events by key,
    // rather than re-reading the whole log per terminal task.
    const transitionsByKey = new Map<string, AuditEvent[]>();
    for (const e of this.auditQuery.run()) {
      if (e.kind !== 'task_transitioned') continue;
      const key = (e.data as Record<string, unknown> | undefined)?.key;
      if (typeof key !== 'string') continue;
      const list = transitionsByKey.get(key);
      if (list === undefined) transitionsByKey.set(key, [e]);
      else list.push(e);
    }
    for (const task of tasks) {
      if (
        this.stateMachine.isTerminal(task.state) &&
        this.isSubagentBypass(transitionsByKey.get(task.key) ?? [], task.state)
      ) {
        diagnostics.push({
          scope,
          severity: 'warning',
          rule: 'subagent-bypass',
          message: `${task.key} reached a terminal state with no transition recorded under an agent run`,
        });
      }
    }

    // missing-evidence: a task finished "done" but showed no proof. A
    // canceled task legitimately has none, so exclude the abandon terminal
    // (CANCELED across the shipped workflows) — only completion terminals
    // are expected to carry evidence.
    for (const task of tasks) {
      if (
        this.stateMachine.isTerminal(task.state) &&
        task.state !== 'CANCELED' &&
        this.evidence.findByTask(task.id).length === 0
      ) {
        diagnostics.push({
          scope,
          severity: 'warning',
          rule: 'missing-evidence',
          message: `${task.key} reached ${task.state} with no attached evidence`,
        });
      }
    }

    for (const broken of this.findBrokenDependencies(tasks)) {
      diagnostics.push({
        scope,
        severity: 'error',
        rule: 'broken-dependency',
        message: `${broken.task_key} depends on a task that no longer exists`,
      });
    }

    return {
      diagnostics,
      tasksScanned: tasks.length,
      errorCount: diagnostics.filter((d) => d.severity === 'error').length,
      warningCount: diagnostics.filter((d) => d.severity === 'warning').length,
    };
  }

  /**
   * A task reached a terminal state via a "bypassed" transition when the
   * transition that ARRIVED at that terminal state carried no `run` id.
   *
   * Keying on the terminal arrival (not `every` transition) matters: an
   * earlier run-tracked transition (e.g. `start`) must not excuse a later
   * run-less terminal transition (e.g. `approve`). Only state transitions
   * count — a note/attachment/creation event can carry a `run` id without any
   * transition having gone through a tracked run.
   */
  private isSubagentBypass(transitions: readonly AuditEvent[], terminalState: string): boolean {
    if (transitions.length === 0) return false; // no transition trail — not our signal

    // The transitions that arrive at the current terminal state. auditQuery
    // returns events chronologically, so the last is the effective arrival.
    const arrivals = transitions.filter(
      (e) => (e.data as Record<string, unknown> | undefined)?.to === terminalState,
    );
    if (arrivals.length === 0) {
      // No explicit arrival event recorded — fall back to the conservative
      // "entire trail is run-less" signal so a fully-untracked task is caught.
      return transitions.every((e) => e.run === undefined || e.run === null);
    }
    const lastArrival = arrivals[arrivals.length - 1];
    return lastArrival === undefined || lastArrival.run === undefined || lastArrival.run === null;
  }

  /**
   * Returns dependency edges (for the given tasks) whose blocking task
   * row is missing or soft-deleted. Queried directly against the
   * `dependencies` table shipped in migration 001 so the linter stays
   * independent of the dependency feature surface.
   */
  private findBrokenDependencies(tasks: readonly Task[]): BrokenDependencyRow[] {
    if (tasks.length === 0) return [];
    const ids = tasks.map((t) => t.id);
    const placeholders = ids.map(() => '?').join(', ');
    const rows = this.adapter
      .getDatabase()
      .prepare(
        // Only `blocks` edges are integrity-bearing: a dangling
        // relates_to/duplicates/parent_of edge to a soft-deleted task is
        // informational, not a broken-graph error. (blockersAllTerminal /
        // reachesViaBlocks both filter to 'blocks' too.)
        `SELECT t.key AS task_key, d.blocks_task_id AS blocks_task_id
           FROM dependencies d
           JOIN tasks t ON t.id = d.task_id
          WHERE d.task_id IN (${placeholders})
            AND d.kind = 'blocks'
            AND NOT EXISTS (
              SELECT 1 FROM tasks b
               WHERE b.id = d.blocks_task_id AND b.deleted_at IS NULL
            )`,
      )
      .all(...ids) as BrokenDependencyRow[];
    return rows;
  }
}
