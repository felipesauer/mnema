import path from 'node:path';

import type { Config } from '../config/config-schema.js';
import { createAuditCore } from '../container/audit-core.js';
import { createInfra } from '../container/infra.js';
import { createLazyRegistry } from '../container/lazy.js';
import { createSyncCore } from '../container/sync-core.js';
import { ActorKind } from '../domain/enums/actor-kind.js';
import type { EnforcementMode } from '../domain/enums/enforcement-mode.js';
import type { StateMachine, Workflow } from '../domain/state-machine/state-machine.js';
import { FileStore } from '../storage/files/file-store.js';
import type { AppliedMigration } from '../storage/sqlite/migration-runner.js';
import type { TransitionRepository } from '../storage/sqlite/repositories/transition-repository.js';
import type { SqliteAdapter } from '../storage/sqlite/sqlite-adapter.js';
import { LAYOUT } from '../utils/layout.js';
import { perfTrace } from '../utils/perf-trace.js';
import { AgentPlanService } from './agent/agent-plan-service.js';
import { AgentRunService } from './agent/agent-run-service.js';
import { AttachmentService } from './attachment-service.js';
import { ArchiveService } from './backlog/archive-service.js';
import { CoverageService } from './backlog/coverage-service.js';
import { DecisionService } from './backlog/decision-service.js';
import { DependencyService } from './backlog/dependency-service.js';
import { EpicService } from './backlog/epic-service.js';
import { InboxService } from './backlog/inbox-service.js';
import { LabelService } from './backlog/label-service.js';
import { NoteService } from './backlog/note-service.js';
import { SprintService } from './backlog/sprint-service.js';
import { TaskEvidenceService } from './backlog/task-evidence-service.js';
import { TaskService } from './backlog/task-service.js';
import { TaskTemplateService } from './backlog/task-template-service.js';
import { CommandDefinitionService } from './command-definition-service.js';
import { DriftService } from './drift-service.js';
import { EvolutionCandidateService } from './evolution-candidate-service.js';
import { GitObserverService } from './git/git-observer-service.js';
import { type CommandRunner, GitHubPrService } from './git/github-pr-service.js';
import type { AuditQuery } from './integrity/audit-query.js';
import type { AuditService } from './integrity/audit-service.js';
import { CommitVerifier } from './integrity/commit-verifier.js';
import type { HookTrustService } from './integrity/hook-trust.js';
import type { IdentityService } from './integrity/identity-service.js';
import { ProvenanceService } from './integrity/provenance-service.js';
import { FocusService } from './knowledge/focus-service.js';
import { MemoryService } from './knowledge/memory-service.js';
import { MemoryStalenessService } from './knowledge/memory-staleness.js';
import { ObservationService } from './knowledge/observation-service.js';
import { PortfolioService } from './knowledge/portfolio-service.js';
import { SkillQualityService } from './knowledge/skill-quality-service.js';
import { SkillService } from './knowledge/skill-service.js';
import { userKnowledgeDir } from './knowledge/user-knowledge.js';
import { FileCollisionService } from './lint/file-collision-service.js';
import { WikilinkLintService } from './lint/wikilink-lint-service.js';
import { WorkGraphLintService } from './lint/work-graph-lint-service.js';
import { EvalReportService } from './metrics/eval-report-service.js';
import { FlowMetricsService } from './metrics/flow-metrics-service.js';
import { OrphanRunService } from './metrics/orphan-run-service.js';
import { RunDiffService } from './metrics/run-diff-service.js';
import { SearchService } from './search-service.js';
import { DependencyGraphService } from './snapshot/dependency-graph-service.js';
import { SnapshotService } from './snapshot/snapshot-service.js';
import type { SyncRebuild } from './sync/sync-rebuild.js';
import type { SyncMode, SyncService } from './sync/sync-service.js';

/**
 * Options accepted by {@link createServiceContainer}.
 */
export interface ServiceContainerOptions {
  /** Optional sync mode override (defaults to Push for CLI). */
  readonly syncMode?: SyncMode;
  /**
   * Override path used to resolve migrations on disk. Tests pass an
   * absolute path; production code relies on the default.
   */
  readonly migrationsDir?: string;
  /**
   * Override the user-level knowledge dir (`~/.config/mnema`). Production
   * uses the real home dir; tests pass an isolated path (or `null` to
   * disable the layer) so they never read the developer's own
   * `~/.config/mnema`.
   */
  readonly userDir?: string | null;
  /**
   * Override the command runner used to verify commit refs against git.
   * Production shells out via the default runner; tests inject a mock so
   * they exercise the found / not-found / no-repo paths deterministically
   * without a real repository.
   */
  readonly commitRunner?: CommandRunner;
  /**
   * Resolve the set of tool names skill lint validates `tools_used`
   * against. The catalogue is owned by the surface that advertises the
   * tools (MCP), not by this container — callers that have one inject it
   * here. When absent, the tool-existence check is skipped entirely.
   */
  readonly resolveKnownTools?: (workflow: Workflow) => ReadonlySet<string>;
}

/**
 * Bag of services and repositories wired together for a CLI session.
 *
 * Construction is LAZY: accessing a service builds it (and only its
 * dependency chain) on first use, so a read-only command pays for the
 * substrate plus the domain it touches — never all ~50 constructors.
 * The facade shape is unchanged for consumers.
 *
 * `pendingMigrations` is non-empty when the database was already
 * initialised but newer migrations exist on disk that have not been
 * applied yet. Read-only commands keep working; mutating commands
 * should refuse with a `SchemaOutOfDate` error and direct the user to
 * `mnema migrate`. A virgin database (no `schema_migrations` table)
 * is auto-migrated on first boot, so `pendingMigrations` is always
 * empty in that case.
 */
export interface ServiceContainer {
  readonly adapter: SqliteAdapter;
  readonly stateMachine: StateMachine;
  readonly identity: IdentityService;
  readonly task: TaskService;
  readonly audit: AuditService;
  readonly auditQuery: AuditQuery;
  readonly sync: SyncService;
  readonly syncRebuild: SyncRebuild;
  readonly archive: ArchiveService;
  readonly agentRun: AgentRunService;
  readonly orphanRun: OrphanRunService;
  readonly agentPlan: AgentPlanService;
  readonly inbox: InboxService;
  readonly sprint: SprintService;
  readonly decision: DecisionService;
  readonly dependency: DependencyService;
  readonly label: LabelService;
  readonly note: NoteService;
  readonly taskEvidence: TaskEvidenceService;
  readonly epic: EpicService;
  readonly coverage: CoverageService;
  readonly dependencyGraph: DependencyGraphService;
  readonly fileCollision: FileCollisionService;
  readonly snapshot: SnapshotService;
  readonly runDiff: RunDiffService;
  readonly focus: FocusService;
  readonly skillQuality: SkillQualityService;
  readonly portfolio: PortfolioService;
  readonly flowMetrics: FlowMetricsService;
  readonly evalReport: EvalReportService;
  readonly evolutionCandidate: EvolutionCandidateService;
  readonly hookTrust: HookTrustService;
  readonly githubPr: GitHubPrService;
  readonly commitVerifier: CommitVerifier;
  readonly drift: DriftService;
  readonly gitObserver: GitObserverService;
  readonly workGraphLint: WorkGraphLintService;
  readonly attachment: AttachmentService;
  readonly search: SearchService;
  readonly skill: SkillService;
  readonly commandDefinition: CommandDefinitionService;
  readonly taskTemplate: TaskTemplateService;
  readonly wikilinkLint: WikilinkLintService;
  readonly memory: MemoryService;
  readonly memoryStaleness: MemoryStalenessService;
  readonly observation: ObservationService;
  readonly provenance: ProvenanceService;
  readonly transitions: TransitionRepository;
  readonly pendingMigrations: readonly AppliedMigration[];
  /**
   * Re-runs migration drift detection against the live DB. Unlike
   * `pendingMigrations` (a boot-time snapshot), this reads `schema_migrations`
   * fresh, so a long-lived process (the MCP server) sees a `mnema migrate`
   * run by another process and unblocks without a restart.
   */
  readonly detectPendingMigrations: () => readonly AppliedMigration[];
  /**
   * Diagnostics for the lazy wiring: which pieces have been built so far,
   * in build order. Internal — used by tests to assert that touching one
   * domain does not construct the others.
   */
  readonly wiringDiagnostics: () => readonly string[];
  readonly close: () => void;
}

/**
 * Builds a service container for a CLI session.
 *
 * Eager responsibilities (boot semantics, unchanged):
 * 1. Open the SQLite database (running migrations on a virgin DB).
 * 2. Load the active workflow JSON declared in the config.
 * 3. Instantiate the repository layer and seed the project row.
 *
 * Everything above the substrate is wired lazily: the audit and sync
 * lattices build as units on first touch; every domain service builds
 * individually on first access.
 *
 * @param config - Validated project configuration
 * @param projectRoot - Absolute path to the directory containing `mnema.config.json`
 * @param options - Optional overrides (sync mode, migrations dir)
 * @returns A wired {@link ServiceContainer}
 */
export function createServiceContainer(
  config: Config,
  projectRoot: string,
  options: ServiceContainerOptions = {},
): ServiceContainer {
  const trace = perfTrace('createServiceContainer');
  const infra = createInfra(config, projectRoot, options.migrationsDir);
  const { repos, workflow, stateMachine, identity } = infra;
  trace.mark('infra ready (adapter, migrations, workflow, repos)');

  const registry = createLazyRegistry();
  const { lazy } = registry;

  const stateDir = path.join(projectRoot, LAYOUT.state);

  // --- the coupled lattices (build as units, lazily) -------------------
  const auditCore = lazy('audit-core', () =>
    createAuditCore(infra, config, projectRoot, options.userDir),
  );
  const syncCore = lazy('sync-core', () =>
    createSyncCore(infra, auditCore(), config, projectRoot, options.syncMode),
  );

  // --- shared user-level knowledge dir (null disables the layer) -------
  const userDir = options.userDir !== undefined ? options.userDir : userKnowledgeDir();

  // --- backlog ----------------------------------------------------------
  const task = lazy(
    'task',
    () =>
      new TaskService(
        repos.tasks,
        repos.transitions,
        repos.projects,
        stateMachine,
        auditCore().audit,
        syncCore().sync,
        {
          ensureActor: (handle, kind) =>
            identity.ensureActor(handle, kind === 'human' ? ActorKind.Human : ActorKind.Agent),
          findActorIdByHandle: (handle) => identity.findActorIdByHandle(handle),
          getDefaultActor: () => identity.getDefaultActor(),
        },
        config.enforcement_mode as EnforcementMode,
        config.claims.require_to_start,
        config.enforcement_field_severity,
      ),
  );
  const archive = lazy(
    'archive',
    () => new ArchiveService(repos.tasks, { projectRoot, backlogDir: LAYOUT.backlog }),
  );
  const sprint = lazy(
    'sprint',
    () =>
      new SprintService(
        repos.sprints,
        repos.tasks,
        repos.projects,
        auditCore().audit,
        stateMachine,
        syncCore().roadmapMirror,
        syncCore().sync,
      ),
  );
  const decision = lazy(
    'decision',
    () =>
      new DecisionService(
        repos.decisions,
        repos.projects,
        identity,
        auditCore().audit,
        repos.notes,
        repos.tasks,
        syncCore().roadmapMirror,
        repos.provenanceLinks,
        repos.observations,
      ),
  );
  const dependency = lazy(
    'dependency',
    () =>
      new DependencyService(
        repos.dependencies,
        repos.tasks,
        repos.sprints,
        stateMachine,
        auditCore().audit,
      ),
  );
  const note = lazy(
    'note',
    () => new NoteService(repos.notes, repos.tasks, identity, auditCore().audit),
  );
  const taskEvidence = lazy(
    'taskEvidence',
    () => new TaskEvidenceService(repos.taskEvidence, repos.tasks, auditCore().audit),
  );
  const epic = lazy(
    'epic',
    () =>
      new EpicService(
        repos.epics,
        repos.tasks,
        repos.projects,
        auditCore().audit,
        stateMachine,
        syncCore().roadmapMirror,
        syncCore().sync,
      ),
  );
  const coverage = lazy(
    'coverage',
    () => new CoverageService(repos.epics, repos.sprints, repos.tasks, stateMachine),
  );
  const dependencyGraph = lazy(
    'dependencyGraph',
    () =>
      new DependencyGraphService(
        repos.dependencies,
        repos.tasks,
        repos.epics,
        repos.sprints,
        stateMachine,
      ),
  );
  const label = lazy(
    'label',
    () => new LabelService(repos.labels, repos.tasks, auditCore().audit, syncCore().sync),
  );
  const inbox = lazy(
    'inbox',
    () =>
      new InboxService(repos.tasks, decision(), config.project.key, stateMachine, {
        staleAfterDays: config.aging.stale_after_days,
        slaDays: config.aging.sla_days,
        wipLimits: config.aging.wip_limits,
      }),
  );
  const snapshot = lazy(
    'snapshot',
    () =>
      new SnapshotService(
        coverage(),
        dependencyGraph(),
        inbox(),
        repos.epics,
        repos.sprints,
        repos.tasks,
      ),
  );
  const portfolio = lazy(
    'portfolio',
    () => new PortfolioService(repos.tasks, repos.epics, repos.sprints, repos.labels),
  );
  const attachment = lazy(
    'attachment',
    () =>
      new AttachmentService(
        repos.attachments,
        repos.tasks,
        repos.decisions,
        new FileStore(path.join(stateDir, 'attachments')),
        identity,
        auditCore().audit,
        path.join(stateDir, 'attachments'),
      ),
  );
  const taskTemplate = lazy(
    'taskTemplate',
    () => new TaskTemplateService(path.join(projectRoot, LAYOUT.templates)),
  );

  // --- agent -------------------------------------------------------------
  const agentRun = lazy(
    'agentRun',
    () =>
      new AgentRunService(
        repos.agentRuns,
        repos.actors,
        identity,
        auditCore().audit,
        repos.agentPlans,
        repos.transitions,
        repos.tasks,
        stateMachine,
        () => {
          syncCore().sync.flushAll();
        },
      ),
  );
  const agentPlan = lazy(
    'agentPlan',
    () => new AgentPlanService(repos.agentPlans, repos.agentRuns, repos.tasks),
  );
  const orphanRun = lazy('orphanRun', () => new OrphanRunService(repos.agentRuns, agentRun()));
  const commandDefinition = lazy(
    'commandDefinition',
    () => new CommandDefinitionService(path.join(projectRoot, LAYOUT.commands)),
  );

  // --- knowledge ----------------------------------------------------------
  const skill = lazy('skill', () => {
    // The tool catalogue belongs to the surface that advertises it; without
    // an injected resolver the skill lint tool-existence check is skipped.
    const knownTools = options.resolveKnownTools ? options.resolveKnownTools(workflow) : null;
    return new SkillService(
      path.join(projectRoot, LAYOUT.skills),
      knownTools,
      repos.skills,
      identity,
      auditCore().audit,
      userDir,
      options.commitRunner,
      repos.provenanceLinks,
    );
  });
  const memory = lazy(
    'memory',
    () =>
      new MemoryService(
        path.join(projectRoot, LAYOUT.memory),
        repos.memories,
        identity,
        auditCore().audit,
        userDir,
        repos.provenanceLinks,
        repos.observations,
      ),
  );
  const observation = lazy(
    'observation',
    () =>
      new ObservationService(
        repos.observations,
        repos.tasks,
        identity,
        auditCore().audit,
        path.join(projectRoot, LAYOUT.observations),
      ),
  );
  const memoryStaleness = lazy('memoryStaleness', () => new MemoryStalenessService(projectRoot));
  const focus = lazy('focus', () => new FocusService(task(), dependency(), identity, stateMachine));
  const skillQuality = lazy(
    'skillQuality',
    () => new SkillQualityService(auditCore().auditQuery, repos.tasks, repos.transitions),
  );
  const evolutionCandidate = lazy(
    'evolutionCandidate',
    () =>
      new EvolutionCandidateService(
        skillQuality(),
        observation(),
        repos.tasks,
        repos.transitions,
        stateMachine.getWorkflow(),
      ),
  );
  const provenance = lazy('provenance', () => new ProvenanceService(repos.provenanceLinks));

  // --- git ----------------------------------------------------------------
  const githubPr = lazy('githubPr', () => new GitHubPrService());
  // Test seam: integration tests swap the GitHub service for one backed by
  // a mock `gh` runner. The facade exposes a setter for exactly this field.
  let githubPrOverride: GitHubPrService | null = null;
  const commitVerifier = lazy('commitVerifier', () => new CommitVerifier(options.commitRunner));
  const drift = lazy(
    'drift',
    () =>
      new DriftService(
        repos.taskEvidence,
        options.commitRunner,
        config.project.key,
        (handle) => repos.tasks.resolve(handle).status === 'unique',
      ),
  );
  const gitObserver = lazy(
    'gitObserver',
    () => new GitObserverService(repos.tasks, identity, options.commitRunner),
  );
  const fileCollision = lazy(
    'fileCollision',
    () =>
      new FileCollisionService(
        repos.tasks,
        repos.taskEvidence,
        repos.epics,
        repos.sprints,
        projectRoot,
        options.commitRunner,
      ),
  );

  // --- metrics / lint / search ---------------------------------------------
  const search = lazy('search', () => new SearchService(infra.adapter));
  const runDiff = lazy(
    'runDiff',
    () => new RunDiffService(repos.agentRuns, auditCore().auditQuery),
  );
  const flowMetrics = lazy(
    'flowMetrics',
    () =>
      new FlowMetricsService(
        auditCore().auditQuery,
        task(),
        workflow,
        sprint(),
        config.project.key,
      ),
  );
  const evalReport = lazy(
    'evalReport',
    () => new EvalReportService(auditCore().auditQuery, flowMetrics(), skillQuality(), workflow),
  );
  const workGraphLint = lazy(
    'workGraphLint',
    () =>
      new WorkGraphLintService(
        repos.sprints,
        repos.epics,
        repos.tasks,
        stateMachine,
        auditCore().auditQuery,
        infra.adapter,
        repos.taskEvidence,
      ),
  );
  const wikilinkLint = lazy(
    'wikilinkLint',
    () =>
      new WikilinkLintService(
        path.join(projectRoot, LAYOUT.skills),
        path.join(projectRoot, LAYOUT.memory),
        config.project.key,
        repos.skills,
        repos.memories,
        repos.decisions,
        repos.tasks,
        repos.projects,
      ),
  );

  trace.mark('lazy wiring registered');
  trace.end();

  return {
    adapter: infra.adapter,
    stateMachine,
    identity,
    transitions: repos.transitions,
    pendingMigrations: infra.pendingMigrations,
    detectPendingMigrations: infra.detectPendingMigrations,
    wiringDiagnostics: () => registry.built(),
    close: () => infra.adapter.close(),
    get task() {
      return task();
    },
    get audit() {
      return auditCore().audit;
    },
    get auditQuery() {
      return auditCore().auditQuery;
    },
    get hookTrust() {
      return auditCore().hookTrust;
    },
    get sync() {
      return syncCore().sync;
    },
    get syncRebuild() {
      return syncCore().syncRebuild;
    },
    get archive() {
      return archive();
    },
    get agentRun() {
      return agentRun();
    },
    get orphanRun() {
      return orphanRun();
    },
    get agentPlan() {
      return agentPlan();
    },
    get inbox() {
      return inbox();
    },
    get sprint() {
      return sprint();
    },
    get decision() {
      return decision();
    },
    get dependency() {
      return dependency();
    },
    get label() {
      return label();
    },
    get note() {
      return note();
    },
    get taskEvidence() {
      return taskEvidence();
    },
    get epic() {
      return epic();
    },
    get coverage() {
      return coverage();
    },
    get dependencyGraph() {
      return dependencyGraph();
    },
    get fileCollision() {
      return fileCollision();
    },
    get snapshot() {
      return snapshot();
    },
    get runDiff() {
      return runDiff();
    },
    get focus() {
      return focus();
    },
    get skillQuality() {
      return skillQuality();
    },
    get portfolio() {
      return portfolio();
    },
    get flowMetrics() {
      return flowMetrics();
    },
    get evalReport() {
      return evalReport();
    },
    get evolutionCandidate() {
      return evolutionCandidate();
    },
    get githubPr() {
      return githubPrOverride ?? githubPr();
    },
    set githubPr(value: GitHubPrService) {
      githubPrOverride = value;
    },
    get commitVerifier() {
      return commitVerifier();
    },
    get drift() {
      return drift();
    },
    get gitObserver() {
      return gitObserver();
    },
    get workGraphLint() {
      return workGraphLint();
    },
    get attachment() {
      return attachment();
    },
    get search() {
      return search();
    },
    get skill() {
      return skill();
    },
    get commandDefinition() {
      return commandDefinition();
    },
    get taskTemplate() {
      return taskTemplate();
    },
    get wikilinkLint() {
      return wikilinkLint();
    },
    get memory() {
      return memory();
    },
    get memoryStaleness() {
      return memoryStaleness();
    },
    get observation() {
      return observation();
    },
    get provenance() {
      return provenance();
    },
  };
}
