import { Err, Ok, type Result } from '../../common/result.js';
import type { Task } from '../../domain/entities/task.js';
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

/** One node in the blocks-graph. */
export interface GraphNode {
  readonly key: string;
  readonly state: string;
  readonly terminal: boolean;
  /** Keys this task is blocked by (in-scope `blocks` edges). */
  readonly blockedBy: readonly string[];
  /** Keys this task blocks (in-scope `blocks` edges). */
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

    // Restrict the graph to in-scope tasks: map id→key and keep only
    // edges whose both ends are in scope.
    const idToKey = new Map<string, string>();
    for (const t of tasks) idToKey.set(t.id, t.key);

    const blockedBy = new Map<string, string[]>(); // key → keys it depends on
    const blocks = new Map<string, string[]>(); // key → keys it blocks
    for (const t of tasks) {
      blockedBy.set(t.key, []);
      blocks.set(t.key, []);
    }
    // One query for every in-scope task's edges, not one per task.
    const depsByTask = this.dependencies.findByTasks(tasks.map((t) => t.id));
    for (const t of tasks) {
      for (const dep of depsByTask.get(t.id) ?? []) {
        if (dep.kind !== BLOCKS) continue;
        const blockerKey = idToKey.get(dep.blocksTaskId);
        if (blockerKey === undefined) continue; // out-of-scope blocker
        blockedBy.get(t.key)?.push(blockerKey);
        blocks.get(blockerKey)?.push(t.key);
      }
    }

    const terminalByKey = new Map<string, boolean>();
    for (const t of tasks) terminalByKey.set(t.key, this.stateMachine.isTerminal(t.state));

    const cycles = findCycles(tasks, blockedBy);
    const frontier = this.computeFrontier(tasks, blockedBy, terminalByKey);
    const criticalPath = cycles.length > 0 ? [] : longestChain(tasks, blockedBy);

    const nodes: GraphNode[] = tasks
      .map((t) => ({
        key: t.key,
        state: t.state,
        terminal: terminalByKey.get(t.key) ?? false,
        blockedBy: [...(blockedBy.get(t.key) ?? [])].sort(),
        blocks: [...(blocks.get(t.key) ?? [])].sort(),
      }))
      .sort((a, b) => a.key.localeCompare(b.key));

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
    terminalByKey: ReadonlyMap<string, boolean>,
  ): { ready: string[]; blocked: BlockedNode[] } {
    const ready: string[] = [];
    const blocked: BlockedNode[] = [];
    for (const t of tasks) {
      if (terminalByKey.get(t.key) === true) continue;
      const blockers = blockedBy.get(t.key) ?? [];
      const liveBlockers = blockers.filter((k) => terminalByKey.get(k) !== true).sort();
      if (liveBlockers.length === 0) {
        ready.push(t.key);
      } else {
        blocked.push({ key: t.key, blockedBy: liveBlockers });
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
  for (const t of tasks) colour.set(t.key, WHITE);
  const cycles: string[][] = [];
  const stack: string[] = [];
  const seenCycle = new Set<string>();

  const visit = (key: string): void => {
    colour.set(key, GRAY);
    stack.push(key);
    for (const next of blockedBy.get(key) ?? []) {
      const c = colour.get(next);
      if (c === GRAY) {
        // Back-edge: the cycle is from `next` down the stack to `key`.
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
    colour.set(key, BLACK);
  };

  for (const t of tasks) {
    if (colour.get(t.key) === WHITE) visit(t.key);
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
  // best[key] = the longest chain ENDING at `key` (deepest blocker first).
  const best = new Map<string, string[]>();

  const chainEndingAt = (key: string): string[] => {
    const cached = best.get(key);
    if (cached !== undefined) return cached;
    let longest: string[] = [];
    for (const blocker of blockedBy.get(key) ?? []) {
      const candidate = chainEndingAt(blocker);
      if (candidate.length > longest.length) longest = candidate;
    }
    const result = [...longest, key];
    best.set(key, result);
    return result;
  };

  let overall: string[] = [];
  for (const t of tasks) {
    const chain = chainEndingAt(t.key);
    if (
      chain.length > overall.length ||
      // Tie-break deterministically on the joined keys so the readout is stable.
      (chain.length === overall.length && chain.join('>') < overall.join('>'))
    ) {
      overall = chain;
    }
  }
  // A single task with no blocks edges is a trivial chain of length 1;
  // only report a path that actually traverses an edge (length >= 2).
  return overall.length >= 2 ? overall : [];
}
