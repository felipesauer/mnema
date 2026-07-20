import type { Decision } from '../../domain/entities/decision.js';
import type { Task } from '../../domain/entities/task.js';
import { deriveAlias } from '../../domain/entity-alias.js';
import type { StateMachine } from '../../domain/state-machine/state-machine.js';
import type {
  LeanTask,
  TaskRepository,
} from '../../storage/sqlite/repositories/task-repository.js';
import type { DecisionService } from './decision-service.js';

/**
 * Per-state review SLA configuration. `staleAfterDays` is the global
 * fallback; `slaDays` overrides it per workflow state name. `wipLimits`
 * caps how many tasks may sit in a state at once (work-in-progress
 * limit), keyed by state name; a state without an entry is uncapped.
 */
export interface SlaConfig {
  readonly staleAfterDays: number;
  readonly slaDays: Readonly<Record<string, number>>;
  readonly wipLimits: Readonly<Record<string, number>>;
}

/** A task that has sat in a non-terminal state past its SLA. */
export interface SlaBreach {
  /** Committed id — the stable identity for filtering/scoping. */
  readonly id: string;
  /** Short alias derived from the id, for display. */
  readonly key: string;
  readonly title: string;
  readonly state: string;
  readonly assignee_id: string | null;
  /** Whole days since the task last moved (from `updatedAt`). */
  readonly age_days: number;
  /** The SLA threshold that applied to this state, in days. */
  readonly sla_days: number;
}

/** A workflow state holding more active tasks than its WIP limit allows. */
export interface WipBreach {
  readonly state: string;
  /** Active (non-deleted) tasks currently in the state. */
  readonly count: number;
  /** The configured WIP limit for the state. */
  readonly limit: number;
  /** Keys of the tasks in the state, for drill-down. */
  readonly keys: readonly string[];
}

/**
 * Aggregated view of work that needs human attention.
 *
 * Queues today: tasks awaiting review (when the workflow declares
 * `reviewWorkflow`), tasks blocked (when the workflow declares
 * `blockedState`), and decisions still in `proposed` status.
 * Workflows without a feature simply report an empty array — the
 * concept does not exist for them.
 *
 * `slaBreaches` is the active layer over the passive aging view: every
 * non-terminal task whose time-in-state exceeds the SLA for that state,
 * oldest first — what a human is actually overdue to act on.
 */
export interface InboxView {
  readonly awaitingReview: readonly Task[];
  readonly blocked: readonly Task[];
  readonly pendingDecisions: readonly Decision[];
  readonly slaBreaches: readonly SlaBreach[];
  readonly wipBreaches: readonly WipBreach[];
}

const MS_PER_DAY = 86_400_000;

/**
 * Builds the human-attention queue.
 *
 * Pure read service: never writes to SQLite. Multiple callers can
 * obtain the inbox simultaneously without coordination. The state
 * names (`IN_REVIEW`, `BLOCKED`) come from the workflow feature flags;
 * if a workflow opts out of `reviewWorkflow` / `blockedState`, the
 * corresponding queue is always empty.
 */
export class InboxService {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly decisions: DecisionService,
    private readonly projectKey: string,
    private readonly stateMachine: StateMachine,
    private readonly sla: SlaConfig,
  ) {}

  /**
   * Returns the current inbox snapshot, including SLA breaches.
   *
   * @param now - Reference time in epoch ms (injectable for tests;
   *   defaults to the current time)
   * @returns Aggregated view of tasks and decisions needing human action
   */
  view(now: number = Date.now()): InboxView {
    const features = this.stateMachine.getWorkflow().features;
    // Read the active tasks ONCE (lean projection, no JSON.parse) and feed
    // both breach computations, rather than scanning the table twice.
    const active = this.tasks.findActiveLean();
    return {
      awaitingReview: features.reviewWorkflow ? this.tasks.findByState('IN_REVIEW') : [],
      blocked: features.blockedState ? this.tasks.findByState('BLOCKED') : [],
      pendingDecisions: this.decisions.listPending(this.projectKey),
      slaBreaches: this.computeSlaBreaches(active, now),
      wipBreaches: this.computeWipBreaches(active),
    };
  }

  /**
   * Computes WIP-limit breaches: workflow states holding more active,
   * non-terminal tasks than their configured limit. A state with no
   * `wipLimits` entry is uncapped and never reported. Most-over-limit
   * first (by how far over).
   *
   * @returns Breaches, the most over-limit state first
   */
  wipBreaches(): WipBreach[] {
    return this.computeWipBreaches(this.tasks.findActiveLean());
  }

  /** WIP-breach computation over an already-fetched active task list. */
  private computeWipBreaches(tasks: readonly LeanTask[]): WipBreach[] {
    // Tolerate a config that predates wip_limits (older callers/fixtures).
    const limits = this.sla.wipLimits ?? {};
    if (Object.keys(limits).length === 0) return [];
    const terminal = new Set(this.stateMachine.getWorkflow().terminal);

    const keysByState = new Map<string, string[]>();
    for (const task of tasks) {
      if (terminal.has(task.state)) continue;
      if (limits[task.state] === undefined) continue;
      const list = keysByState.get(task.state) ?? [];
      list.push(deriveAlias('task', task.id));
      keysByState.set(task.state, list);
    }

    const breaches: WipBreach[] = [];
    for (const [state, keys] of keysByState) {
      const limit = limits[state] ?? 0;
      if (keys.length > limit) {
        breaches.push({ state, count: keys.length, limit, keys: keys.sort() });
      }
    }
    return breaches.sort((a, b) => b.count - b.limit - (a.count - a.limit));
  }

  /**
   * Computes SLA breaches: non-terminal tasks whose days-in-state (since
   * `updatedAt`) meet or exceed the SLA for that state. The threshold is
   * the per-state `sla_days` override, or `stale_after_days` otherwise.
   * Oldest breach first.
   *
   * @param now - Reference time in epoch ms
   * @returns Breaches, most overdue first
   */
  slaBreaches(now: number = Date.now()): SlaBreach[] {
    return this.computeSlaBreaches(this.tasks.findActiveLean(), now);
  }

  /** SLA-breach computation over an already-fetched active task list. */
  private computeSlaBreaches(tasks: readonly LeanTask[], now: number): SlaBreach[] {
    const terminal = new Set(this.stateMachine.getWorkflow().terminal);
    const breaches: SlaBreach[] = [];
    for (const task of tasks) {
      if (terminal.has(task.state)) continue;
      const slaDays = this.sla.slaDays[task.state] ?? this.sla.staleAfterDays;
      const ageDays = Math.floor((now - new Date(task.updatedAt).getTime()) / MS_PER_DAY);
      if (ageDays >= slaDays) {
        breaches.push({
          id: task.id,
          key: deriveAlias('task', task.id),
          title: task.title,
          state: task.state,
          assignee_id: task.assigneeId,
          age_days: ageDays,
          sla_days: slaDays,
        });
      }
    }
    return breaches.sort((a, b) => b.age_days - a.age_days);
  }
}
