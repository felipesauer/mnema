import { Err, Ok, type Result } from '../../common/result.js';
import type { Task } from '../../domain/entities/task.js';
import type { StateMachine } from '../../domain/state-machine/state-machine.js';
import { ErrorCode } from '../../errors/error-codes.js';
import type { MnemaError } from '../../errors/mnema-error.js';
import type { EpicRepository } from '../../storage/sqlite/repositories/epic-repository.js';
import type { SprintRepository } from '../../storage/sqlite/repositories/sprint-repository.js';
import type { TaskRepository } from '../../storage/sqlite/repositories/task-repository.js';
import { resolveEntity } from './resolve-entity.js';

/**
 * A computed coverage snapshot for an epic or sprint.
 *
 * Coverage is derived on demand from the current state of the tasks —
 * it is never stored, because it changes on every task transition
 * (mirrors how `statistics.by_state` is computed globally).
 */
export interface CoverageReport {
  /** Active (non-deleted) tasks in the epic/sprint. */
  readonly total: number;
  /** Tasks in a terminal state (per the active workflow). */
  readonly terminal: number;
  /** Count per state, scoped to this epic/sprint. */
  readonly byState: Readonly<Record<string, number>>;
  /** Tasks in a BLOCKED state, when the workflow has one (0 otherwise). */
  readonly blocked: number;
  /** `round(terminal / total * 100)`, or 0 when there are no tasks. */
  readonly percent: number;
  /** Keys of the non-terminal tasks — the actionable "what's left". */
  readonly open: readonly string[];
}

const BLOCKED_STATE = 'BLOCKED';

/**
 * Computes epic/sprint coverage on demand. Read-only: queries are not
 * mutations, so no audit events are emitted.
 */
export class CoverageService {
  constructor(
    private readonly epics: EpicRepository,
    private readonly sprints: SprintRepository,
    private readonly tasks: TaskRepository,
    private readonly stateMachine: StateMachine,
  ) {}

  /**
   * Coverage of an epic.
   *
   * @param epicKey - Epic identifier
   * @returns The report or `EpicNotFound`
   */
  forEpic(epicKey: string): Result<CoverageReport, MnemaError> {
    const resolved = resolveEntity(this.epics, epicKey, (handle) => ({
      kind: ErrorCode.EpicNotFound,
      epicKey: handle,
    }));
    if (!resolved.ok) return Err(resolved.error);
    const epic = resolved.value;
    return Ok(this.compute(this.tasks.findByEpic(epic.id)));
  }

  /**
   * Coverage of a sprint.
   *
   * @param sprintKey - Sprint identifier
   * @returns The report or `SprintNotFound`
   */
  forSprint(sprintKey: string): Result<CoverageReport, MnemaError> {
    const resolved = resolveEntity(this.sprints, sprintKey, (handle) => ({
      kind: ErrorCode.SprintNotFound,
      sprintKey: handle,
    }));
    if (!resolved.ok) return Err(resolved.error);
    const sprint = resolved.value;
    return Ok(this.compute(this.sprints.listTasks(sprint.id)));
  }

  /**
   * Reduces a task list into a {@link CoverageReport}. Terminal is
   * workflow-driven, so this works for any preset.
   */
  private compute(tasks: readonly Task[]): CoverageReport {
    const byState: Record<string, number> = {};
    const open: string[] = [];
    let terminal = 0;
    let blocked = 0;

    for (const task of tasks) {
      byState[task.state] = (byState[task.state] ?? 0) + 1;
      if (task.state === BLOCKED_STATE) blocked += 1;
      if (this.stateMachine.isTerminal(task.state)) {
        terminal += 1;
      } else {
        open.push(task.key);
      }
    }

    const total = tasks.length;
    // Reserve 100% for the genuinely-complete case. Plain rounding reports
    // 100% at 199/200 (Math.round(99.5)), contradicting the non-empty `open`
    // list it ships alongside. Clamp intermediate values to 99 so the headline
    // can never claim done while work remains.
    const percent =
      total === 0
        ? 0
        : terminal === total
          ? 100
          : Math.min(99, Math.round((terminal / total) * 100));

    return { total, terminal, byState, blocked, percent, open };
  }
}
