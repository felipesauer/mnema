import { Err, Ok, type Result } from '../../common/result.js';
import type { Task } from '../../domain/entities/task.js';
import { deriveAlias } from '../../domain/entity-alias.js';
import type { StateMachine } from '../../domain/state-machine/state-machine.js';
import { ErrorCode } from '../../errors/error-codes.js';
import type { MnemaError } from '../../errors/mnema-error.js';
import type { DependencyRepository } from '../../storage/sqlite/repositories/dependency-repository.js';
import type { EpicRepository } from '../../storage/sqlite/repositories/epic-repository.js';
import type { SprintRepository } from '../../storage/sqlite/repositories/sprint-repository.js';
import type { TaskRepository } from '../../storage/sqlite/repositories/task-repository.js';
import { resolveEntity } from '../backlog/resolve-entity.js';

/** What the graph is scoped to. */
export type GraphScope =
  | { readonly kind: 'epic'; readonly key: string }
  | { readonly kind: 'sprint'; readonly key: string }
  | { readonly kind: 'project' };

/** One node in the blocks-graph. Handles are display aliases. */
export interface GraphNode {
  readonly key: string;
  readonly state: string;
  readonly terminal: boolean;
  /** Aliases this task is blocked by (in-scope `blocks` edges). */
  readonly blockedBy: readonly string[];
  /** Aliases this task blocks (in-scope `blocks` edges). */
  readonly blocks: readonly string[];
}

/** A task that is not ready, with the specific blockers still holding it. */
export interface BlockedNode {
  readonly key: string;
  /** Non-terminal blockers keeping this task from being ready. */
  readonly blockedBy: readonly string[];
}

/** The result of a dependency-graph query. */
export interface DependencyGraph {
  readonly scope: GraphScope;
  /** Every in-scope task and its in-scope blocks edges, ordered by key. */
  readonly nodes: readonly GraphNode[];
  /**
   * Cycles in the `blocks` graph, each as the ordered keys forming the
   * loop (e.g. `[A, B, A]`). Empty for a healthy DAG. When non-empty the
   * critical path is not well-defined and is returned empty.
   */
  readonly cycles: readonly (readonly string[])[];
  /** The blocking frontier: which non-terminal tasks are ready vs blocked. */
  readonly frontier: {
    /** Non-terminal tasks whose every blocker is terminal — actionable now. */
    readonly ready: readonly string[];
    /** Non-terminal tasks still held by a non-terminal blocker. */
    readonly blocked: readonly BlockedNode[];
  };
  /**
   * The longest chain of `blocks` edges (the critical path), as ordered
   * keys from the deepest blocker to the most-blocked task. Empty when
   * the graph has a cycle.
   */
  readonly criticalPath: readonly string[];
}

const BLOCKS = 'blocks';

/** The display alias for a task id — the handle the graph DTOs carry. */
function taskAlias(id: string): string {
  return deriveAlias('task', id);
}

/**
 * Read-only navigation of the task dependency graph, scoped to an epic,
 * a sprint, or the whole project.
 *
 * Only `blocks` edges form the graph — `relates_to` / `duplicates` /
 * `parent_of` are informational and never gate readiness, mirroring
 * {@link DependencyService}. Edges that point outside the scope are
 * dropped: an epic is read as a self-contained unit, so a blocker in
 * another epic does not enter its frontier or critical path.
 *
 * Three readings the tracker could not give before:
 *  - **cycles**: a back-edge in the `blocks` graph (the link tool rejects
 *    these at write time, but legacy/imported data or a reopen could
 *    still produce one, so the query verifies rather than assumes);
 *  - **frontier**: which open tasks are ready vs blocked-by-what;
 *  - **critical path**: the longest blocking chain — the sequence that
 *    bounds how fast the scope can finish.
 *
 * Read-only: no audit events.
 */
export class DependencyGraphService {
  constructor(
    private readonly dependencies: DependencyRepository,
    private readonly tasks: TaskRepository,
    private readonly epics: EpicRepository,
    private readonly sprints: SprintRepository,
    private readonly stateMachine: StateMachine,
  ) {}

  /**
   * Builds the dependency graph for a scope.
   *
   * @param scope - epic / sprint / project
   * @returns The graph or `EpicNotFound` / `SprintNotFound`
   */
  forScope(scope: GraphScope): Result<DependencyGraph, MnemaError> {
    const tasksResult = this.resolveScopeTasks(scope);
    if (!tasksResult.ok) return tasksResult;
    const tasks = tasksResult.value;

    // The graph walks by committed id — a stable, in-scope identifier — and
    // only derives the display alias when building the returned DTOs. Keep
    // only edges whose both ends are in scope.
    const inScope = new Set<string>(tasks.map((t) => t.id));

    const blockedBy = new Map<string, string[]>(); // id → ids it depends on
    const blocks = new Map<string, string[]>(); // id → ids it blocks
    for (const t of tasks) {
      blockedBy.set(t.id, []);
      blocks.set(t.id, []);
    }
    // One query for every in-scope task's edges, not one per task.
    const depsByTask = this.dependencies.findByTasks(tasks.map((t) => t.id));
    for (const t of tasks) {
      for (const dep of depsByTask.get(t.id) ?? []) {
        if (dep.kind !== BLOCKS) continue;
        if (!inScope.has(dep.blocksTaskId)) continue; // out-of-scope blocker
        blockedBy.get(t.id)?.push(dep.blocksTaskId);
        blocks.get(dep.blocksTaskId)?.push(t.id);
      }
    }

    const terminalById = new Map<string, boolean>();
    for (const t of tasks) terminalById.set(t.id, this.stateMachine.isTerminal(t.state));

    const cycleIds = findCycles(tasks, blockedBy);
    const frontier = this.computeFrontier(tasks, blockedBy, terminalById);
    const criticalPathIds = cycleIds.length > 0 ? [] : longestChain(tasks, blockedBy);

    const nodes: GraphNode[] = tasks
      .map((t) => ({
        key: deriveAlias('task', t.id),
        state: t.state,
        terminal: terminalById.get(t.id) ?? false,
        blockedBy: [...(blockedBy.get(t.id) ?? [])].map(taskAlias).sort(),
        blocks: [...(blocks.get(t.id) ?? [])].map(taskAlias).sort(),
      }))
      .sort((a, b) => a.key.localeCompare(b.key));

    const cycles = cycleIds.map((loop) => loop.map(taskAlias));
    const criticalPath = criticalPathIds.map(taskAlias);

    return Ok({ scope, nodes, cycles, frontier, criticalPath });
  }

  /** Resolves the scope to its active tasks. */
  private resolveScopeTasks(scope: GraphScope): Result<Task[], MnemaError> {
    if (scope.kind === 'epic') {
      const epicResult = resolveEntity(this.epics, scope.key, (handle) => ({
        kind: ErrorCode.EpicNotFound,
        epicKey: handle,
      }));
      if (!epicResult.ok) return Err(epicResult.error);
      const epic = epicResult.value;
      return Ok(this.tasks.findByEpic(epic.id));
    }
    if (scope.kind === 'sprint') {
      const sprintResult = resolveEntity(this.sprints, scope.key, (handle) => ({
        kind: ErrorCode.SprintNotFound,
        sprintKey: handle,
      }));
      if (!sprintResult.ok) return Err(sprintResult.error);
      const sprint = sprintResult.value;
      return Ok(this.sprints.listTasks(sprint.id));
    }
    return Ok(this.tasks.findAllActive());
  }

  /**
   * The blocking frontier. A non-terminal task is *ready* when every
   * `blocks` dependency points at a terminal task, and *blocked*
   * otherwise — carrying the specific non-terminal blockers. Terminal
   * tasks are not part of the frontier (there is nothing to act on).
   */
  private computeFrontier(
    tasks: readonly Task[],
    blockedBy: ReadonlyMap<string, string[]>,
    terminalById: ReadonlyMap<string, boolean>,
  ): { ready: string[]; blocked: BlockedNode[] } {
    const ready: string[] = [];
    const blocked: BlockedNode[] = [];
    for (const t of tasks) {
      if (terminalById.get(t.id) === true) continue;
      const blockers = blockedBy.get(t.id) ?? [];
      const liveBlockers = blockers.filter((id) => terminalById.get(id) !== true).map(taskAlias);
      if (liveBlockers.length === 0) {
        ready.push(deriveAlias('task', t.id));
      } else {
        blocked.push({ key: deriveAlias('task', t.id), blockedBy: liveBlockers.sort() });
      }
    }
    ready.sort();
    blocked.sort((a, b) => a.key.localeCompare(b.key));
    return { ready, blocked };
  }
}

/**
 * Finds cycles in the `blocks` graph via a three-colour DFS. Each cycle
 * is returned as the ordered keys closing the loop (start repeated at the
 * end, e.g. `[A, B, A]`). Walks `blockedBy` edges (task → its blockers).
 */
function findCycles(tasks: readonly Task[], blockedBy: ReadonlyMap<string, string[]>): string[][] {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const colour = new Map<string, number>();
  for (const t of tasks) colour.set(t.id, WHITE);
  const cycles: string[][] = [];
  const stack: string[] = [];
  const seenCycle = new Set<string>();

  const visit = (id: string): void => {
    colour.set(id, GRAY);
    stack.push(id);
    for (const next of blockedBy.get(id) ?? []) {
      const c = colour.get(next);
      if (c === GRAY) {
        // Back-edge: the cycle is from `next` down the stack to `id`.
        const start = stack.indexOf(next);
        if (start !== -1) {
          const loop = [...stack.slice(start), next];
          const canonical = canonicalCycle(loop);
          if (!seenCycle.has(canonical)) {
            seenCycle.add(canonical);
            cycles.push(loop);
          }
        }
      } else if (c === WHITE) {
        visit(next);
      }
    }
    stack.pop();
    colour.set(id, BLACK);
  };

  for (const t of tasks) {
    if (colour.get(t.id) === WHITE) visit(t.id);
  }
  return cycles;
}

/**
 * A rotation-independent signature for a cycle so the same loop reached
 * from different entry points is reported once. Drops the repeated tail
 * node, rotates to the lexicographically smallest member first.
 */
function canonicalCycle(loop: readonly string[]): string {
  const core = loop.slice(0, -1); // drop repeated tail
  if (core.length === 0) return '';
  let minIdx = 0;
  for (let i = 1; i < core.length; i += 1) {
    if ((core[i] ?? '') < (core[minIdx] ?? '')) minIdx = i;
  }
  return [...core.slice(minIdx), ...core.slice(0, minIdx)].join('>');
}

/**
 * Longest chain of `blocks` edges across the (acyclic) graph — the
 * critical path. Memoised DFS over `blockedBy`: the depth of a node is
 * 1 + the max depth of its blockers. Returns the keys of the deepest
 * chain ordered blocker→blocked. Caller guarantees acyclicity.
 */
function longestChain(tasks: readonly Task[], blockedBy: ReadonlyMap<string, string[]>): string[] {
  // best[id] = the longest chain ENDING at `id` (deepest blocker first).
  const best = new Map<string, string[]>();

  const chainEndingAt = (id: string): string[] => {
    const cached = best.get(id);
    if (cached !== undefined) return cached;
    let longest: string[] = [];
    for (const blocker of blockedBy.get(id) ?? []) {
      const candidate = chainEndingAt(blocker);
      if (candidate.length > longest.length) longest = candidate;
    }
    const result = [...longest, id];
    best.set(id, result);
    return result;
  };

  let overall: string[] = [];
  for (const t of tasks) {
    const chain = chainEndingAt(t.id);
    if (
      chain.length > overall.length ||
      // Tie-break deterministically on the joined ids so the readout is stable.
      (chain.length === overall.length && chain.join('>') < overall.join('>'))
    ) {
      overall = chain;
    }
  }
  // A single task with no blocks edges is a trivial chain of length 1;
  // only report a path that actually traverses an edge (length >= 2).
  return overall.length >= 2 ? overall : [];
}
