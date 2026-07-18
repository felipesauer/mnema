import { Err, Ok, type Result } from '../../common/result.js';
import type { Task } from '../../domain/entities/task.js';
import { ErrorCode } from '../../errors/error-codes.js';
import type { MnemaError } from '../../errors/mnema-error.js';
import type { EpicRepository } from '../../storage/sqlite/repositories/epic-repository.js';
import type { SprintRepository } from '../../storage/sqlite/repositories/sprint-repository.js';
import type { TaskRepository } from '../../storage/sqlite/repositories/task-repository.js';
import type { CoverageReport, CoverageService } from '../backlog/coverage-service.js';
import type { InboxService, SlaBreach } from '../backlog/inbox-service.js';
import { resolveEntity } from '../backlog/resolve-entity.js';
import type { DependencyGraph, DependencyGraphService } from './dependency-graph-service.js';

/** What the snapshot is scoped to. */
export type SnapshotScope =
  | { readonly kind: 'epic'; readonly key: string }
  | { readonly kind: 'sprint'; readonly key: string };

/**
 * A composed, read-only executive snapshot of an epic or sprint: the
 * headline coverage, the dependency picture (cycles + critical path),
 * and the SLA breaches scoped to it. Pure composition of services that
 * already exist — it computes nothing new.
 */
export interface Snapshot {
  readonly scope: SnapshotScope;
  /** Display title (the epic/sprint title), or the key when untitled. */
  readonly title: string;
  readonly coverage: CoverageReport;
  /** Cycles + critical path for the scope's blocks-graph. */
  readonly graph: {
    readonly cycles: readonly (readonly string[])[];
    readonly criticalPath: readonly string[];
    readonly ready: readonly string[];
    readonly blockedCount: number;
  };
  /** SLA breaches among this scope's tasks, most-overdue first. */
  readonly slaBreaches: readonly SlaBreach[];
}

/**
 * Generates an executive snapshot for an epic or sprint by composing the
 * coverage, dependency-graph and inbox services. The feedback report
 * that prompted this had to be assembled by hand; this hands the same
 * cut back as data (and, via the renderers, as markdown/HTML).
 *
 * Read-only: no audit events.
 */
export class SnapshotService {
  constructor(
    private readonly coverage: CoverageService,
    private readonly graph: DependencyGraphService,
    private readonly inbox: InboxService,
    private readonly epics: EpicRepository,
    private readonly sprints: SprintRepository,
    private readonly tasks: TaskRepository,
  ) {}

  /**
   * Builds the snapshot for a scope.
   *
   * @param scope - epic or sprint
   * @param now - reference time for SLA ages (injectable for tests)
   * @returns The composed snapshot or `EpicNotFound` / `SprintNotFound`
   */
  forScope(scope: SnapshotScope, now: number = Date.now()): Result<Snapshot, MnemaError> {
    // Resolve scope tasks + a display title up front; an unknown scope is
    // a structured error, consistent with the services we compose.
    const resolved = this.resolveScope(scope);
    if (!resolved.ok) return resolved;
    const { title, scopeKeys } = resolved.value;

    const coverageResult =
      scope.kind === 'epic' ? this.coverage.forEpic(scope.key) : this.coverage.forSprint(scope.key);
    if (!coverageResult.ok) return coverageResult;

    const graphResult = this.graph.forScope(scope);
    if (!graphResult.ok) return graphResult;
    const g: DependencyGraph = graphResult.value;

    // slaBreaches() is global; narrow it to the scope's own tasks so the
    // snapshot reflects only what belongs to this epic/sprint.
    const breaches = this.inbox.slaBreaches(now).filter((b) => scopeKeys.has(b.key));

    return Ok({
      scope,
      title,
      coverage: coverageResult.value,
      graph: {
        cycles: g.cycles,
        criticalPath: g.criticalPath,
        ready: g.frontier.ready,
        blockedCount: g.frontier.blocked.length,
      },
      slaBreaches: breaches,
    });
  }

  /** Resolves the scope to its title and the set of its task keys. */
  private resolveScope(
    scope: SnapshotScope,
  ): Result<{ title: string; scopeKeys: Set<string> }, MnemaError> {
    if (scope.kind === 'epic') {
      const epicResult = resolveEntity(this.epics, scope.key, (handle) => ({
        kind: ErrorCode.EpicNotFound,
        epicKey: handle,
      }));
      if (!epicResult.ok) return Err(epicResult.error);
      const epic = epicResult.value;
      const keys = new Set(this.tasks.findByEpic(epic.id).map((t: Task) => t.key));
      return Ok({ title: epic.title, scopeKeys: keys });
    }
    const sprintResult = resolveEntity(this.sprints, scope.key, (handle) => ({
      kind: ErrorCode.SprintNotFound,
      sprintKey: handle,
    }));
    if (!sprintResult.ok) return Err(sprintResult.error);
    const sprint = sprintResult.value;
    const keys = new Set(this.sprints.listTasks(sprint.id).map((t: Task) => t.key));
    return Ok({ title: sprint.name, scopeKeys: keys });
  }
}
