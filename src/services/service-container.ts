import path from 'node:path';

import type { Config } from '../config/config-schema.js';
import { ActorKind } from '../domain/enums/actor-kind.js';
import type { EnforcementMode } from '../domain/enums/enforcement-mode.js';
import { StateMachine } from '../domain/state-machine/state-machine.js';
import { WorkflowLoader } from '../domain/state-machine/workflow-loader.js';
import { listAvailableToolNames } from '../mcp/tool-registry.js';
import { AuditWriter } from '../storage/audit/audit-writer.js';
import { SyncBuffer } from '../storage/buffer/sync-buffer.js';
import { FileStore } from '../storage/files/file-store.js';
import { MarkdownIo } from '../storage/markdown/markdown-io.js';
import { type AppliedMigration, MigrationRunner } from '../storage/sqlite/migration-runner.js';
import { ActorRepository } from '../storage/sqlite/repositories/actor-repository.js';
import { AgentPlanRepository } from '../storage/sqlite/repositories/agent-plan-repository.js';
import { AgentRunRepository } from '../storage/sqlite/repositories/agent-run-repository.js';
import { AnchorRepository } from '../storage/sqlite/repositories/anchor-repository.js';
import { AttachmentRepository } from '../storage/sqlite/repositories/attachment-repository.js';
import { AuditHeadSignatureRepository } from '../storage/sqlite/repositories/audit-head-signature-repository.js';
import { AuditStateRepository } from '../storage/sqlite/repositories/audit-state-repository.js';
import { DecisionRepository } from '../storage/sqlite/repositories/decision-repository.js';
import { DependencyRepository } from '../storage/sqlite/repositories/dependency-repository.js';
import { EpicRepository } from '../storage/sqlite/repositories/epic-repository.js';
import { LabelRepository } from '../storage/sqlite/repositories/label-repository.js';
import { MemoryRepository } from '../storage/sqlite/repositories/memory-repository.js';
import { NoteRepository } from '../storage/sqlite/repositories/note-repository.js';
import { ObservationRepository } from '../storage/sqlite/repositories/observation-repository.js';
import { ProjectRepository } from '../storage/sqlite/repositories/project-repository.js';
import { ProvenanceLinkRepository } from '../storage/sqlite/repositories/provenance-link-repository.js';
import { SkillRepository } from '../storage/sqlite/repositories/skill-repository.js';
import { SprintMetricRepository } from '../storage/sqlite/repositories/sprint-metric-repository.js';
import { SprintRepository } from '../storage/sqlite/repositories/sprint-repository.js';
import { TaskEvidenceRepository } from '../storage/sqlite/repositories/task-evidence-repository.js';
import { TaskRepository } from '../storage/sqlite/repositories/task-repository.js';
import { TransitionRepository } from '../storage/sqlite/repositories/transition-repository.js';
import { SqliteAdapter } from '../storage/sqlite/sqlite-adapter.js';
import { migrationsDir as assetPathsMigrationsDir } from '../utils/asset-paths.js';
import { perfTrace } from '../utils/perf-trace.js';
import { AgentPlanService } from './agent-plan-service.js';
import { AgentRunService } from './agent-run-service.js';
import { buildAnchorScheduler } from './anchor/anchor-factory.js';
import { AttachmentService } from './attachment-service.js';
import { AuditQuery } from './audit-query.js';
import { AuditService } from './audit-service.js';
import { CommandDefinitionService } from './command-definition-service.js';
import { CommitVerifier } from './commit-verifier.js';
import { CoverageService } from './coverage-service.js';
import { DecisionService } from './decision-service.js';
import { DependencyGraphService } from './dependency-graph-service.js';
import { DependencyService } from './dependency-service.js';
import { DomainEventDispatcher } from './domain-event-dispatcher.js';
import { EpicService } from './epic-service.js';
import { FileCollisionService } from './file-collision-service.js';
import { FlowMetricsService } from './flow-metrics-service.js';
import { type CommandRunner, GitHubPrService } from './github-pr-service.js';
import { HeadCheckpointService } from './head-checkpoint.js';
import { HookTrustService, hasAnyHook } from './hook-trust.js';
import { IdentityService } from './identity-service.js';
import { InboxService } from './inbox-service.js';
import { LabelService } from './label-service.js';
import { MachineKeyService } from './machine-key.js';
import { MemoryService } from './memory-service.js';
import { MemoryStalenessService } from './memory-staleness.js';
import { NoteService } from './note-service.js';
import { ObservationService } from './observation-service.js';
import { OrphanRunService } from './orphan-run-service.js';
import { PortfolioService } from './portfolio-service.js';
import { ProjectSecretService } from './project-secret.js';
import { ProvenanceService } from './provenance-service.js';
import { RoadmapMirror } from './roadmap-mirror.js';
import { RunDiffService } from './run-diff-service.js';
import { SearchService } from './search-service.js';
import { SkillService } from './skill-service.js';
import { SnapshotService } from './snapshot-service.js';
import { SprintService } from './sprint-service.js';
import { SyncRebuild } from './sync-rebuild.js';
import { SyncMode, SyncService } from './sync-service.js';
import { TaskEvidenceService } from './task-evidence-service.js';
import { TaskService } from './task-service.js';
import { userKnowledgeDir } from './user-knowledge.js';
import { WikilinkLintService } from './wikilink-lint-service.js';
import { WorkGraphLintService } from './work-graph-lint-service.js';

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
}

/**
 * Bag of services and repositories wired together for a CLI session.
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
  readonly portfolio: PortfolioService;
  readonly flowMetrics: FlowMetricsService;
  readonly hookTrust: HookTrustService;
  readonly githubPr: GitHubPrService;
  readonly commitVerifier: CommitVerifier;
  readonly workGraphLint: WorkGraphLintService;
  readonly attachment: AttachmentService;
  readonly search: SearchService;
  readonly skill: SkillService;
  readonly commandDefinition: CommandDefinitionService;
  readonly wikilinkLint: WikilinkLintService;
  readonly memory: MemoryService;
  readonly memoryStaleness: MemoryStalenessService;
  readonly observation: ObservationService;
  readonly provenance: ProvenanceService;
  readonly transitions: TransitionRepository;
  readonly pendingMigrations: readonly AppliedMigration[];
  readonly close: () => void;
}

/**
 * Builds a fully-wired service container for a CLI session.
 *
 * Responsibilities:
 * 1. Open the SQLite database (running migrations on first boot).
 * 2. Load the active workflow JSON declared in the config.
 * 3. Instantiate every repository, service, and the audit writer.
 *
 * The returned container exposes a `close()` callback that releases
 * the SQLite handle.
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
  const dbPath = path.join(projectRoot, config.paths.state, 'state.db');
  const adapter = new SqliteAdapter(dbPath);
  trace.mark('SqliteAdapter opened');

  // Migration sources: the bundled directory (where Mnema's shipped
  // migrations live) plus the project's own `.mnema/migrations/` so
  // any locally-generated migration rides alongside without
  // contaminating the global install. The bundled path is resolved
  // via `assetPathsMigrationsDir()` so it works under both the
  // source tree (dev) and the installed package (production); a
  // cwd-relative resolve would point at a non-existent directory
  // when run from a project tmpdir and silently make `detectDrift`
  // believe there are no migrations on disk.
  const bundledMigrationsDir = options.migrationsDir ?? assetPathsMigrationsDir();
  const projectMigrationsDirAbs = path.join(projectRoot, '.mnema/migrations');
  const migrationSources: readonly string[] = [bundledMigrationsDir, projectMigrationsDirAbs];
  // Auto-apply migrations only on a virgin database (first boot, no
  // `schema_migrations` table yet). Once the database has been
  // initialised, pending migrations are surfaced through
  // `pendingMigrations` and applying them becomes an explicit step
  // (`mnema migrate`). This keeps the cooperative guard meaningful for
  // shared-team scenarios where one machine pulls a schema bump
  // before others have noticed.
  const runner = new MigrationRunner();
  const isVirgin = runner.loadApplied(adapter).length === 0;
  if (isVirgin) {
    runner.run(adapter, migrationSources);
  }
  const pendingMigrations = runner.detectDrift(adapter, migrationSources);
  trace.mark('migrations checked');

  const workflowPath = path.join(projectRoot, config.paths.workflows, `${config.workflow}.json`);
  const workflow = new WorkflowLoader().load(workflowPath);
  const stateMachine = new StateMachine(workflow);
  trace.mark('workflow + state machine');

  const actors = new ActorRepository(adapter);
  const projects = new ProjectRepository(adapter);
  const tasks = new TaskRepository(adapter);
  const transitions = new TransitionRepository(adapter);
  const agentRuns = new AgentRunRepository(adapter);
  const agentPlans = new AgentPlanRepository(adapter);
  const sprintRepository = new SprintRepository(adapter);
  const sprintMetricRepository = new SprintMetricRepository(adapter);
  const attachmentRepository = new AttachmentRepository(adapter);
  const decisionRepository = new DecisionRepository(adapter);
  const dependencyRepository = new DependencyRepository(adapter);
  const labelRepository = new LabelRepository(adapter);
  const taskEvidenceRepository = new TaskEvidenceRepository(adapter);
  const noteRepository = new NoteRepository(adapter);
  const epicRepository = new EpicRepository(adapter);
  const skillRepository = new SkillRepository(adapter);
  const memoryRepository = new MemoryRepository(adapter);
  const observationRepository = new ObservationRepository(adapter);
  const provenanceLinkRepository = new ProvenanceLinkRepository(adapter);
  const auditStateRepository = new AuditStateRepository(adapter);
  trace.mark('repositories instantiated');

  // Seed the project row from the (version-controlled) config when the
  // database has none. `mnema.config.json` travels with the repository
  // but `state.db` is git-ignored, so on a fresh clone the database is
  // recreated empty by the migrations above and the `projects` table is
  // bare. Without this, `mnema sync` would find no project and rebuild
  // nothing from the committed backlog. Idempotent: existing rows are
  // left untouched, so it is a no-op once initialised. Skipped while
  // migrations are pending — mutating commands refuse to run under a
  // stale schema anyway, and read-only commands never need the write.
  if (pendingMigrations.length === 0) {
    ensureProject(projects, config);
  }

  const identity = new IdentityService(actors);

  const auditDir = path.join(projectRoot, config.paths.audit);
  // Per-project HMAC secret keys the v3 chain (ADR-37 layer 2). Passed to
  // the writer as a LAZY provider: the secret is generated only on the
  // first actual write (a read-only command never mints it or the
  // committed fingerprint). Resolved under the same user dir as the other
  // user-level services so tests (and the isolation below) stay in one
  // place; `null` (knowledge layer disabled) still gets a real home for
  // the secret, which is not part of that optional layer.
  const secretUserDir = options.userDir ?? userKnowledgeDir();
  const projectSecretService = new ProjectSecretService(
    projectRoot,
    config.project.key,
    secretUserDir,
  );
  // Machine attestation (ADR-37 layer 2): sign the chain head with the
  // per-machine Ed25519 key at a checkpoint interval. Bound to the resolved
  // actor; when no identity is configured there is nobody to attest, so head
  // signing is simply skipped (the keyed chain still protects the log). The
  // signer no-ops between checkpoints, so it never sits on the per-event cost.
  const resolvedActor = identity.resolveDefaultActor().actor;
  const headCheckpoint =
    resolvedActor === null
      ? null
      : new HeadCheckpointService(
          new AuditHeadSignatureRepository(adapter),
          new MachineKeyService(projectRoot, resolvedActor, secretUserDir),
          resolvedActor,
          config.audit.checkpoint,
        );
  // Temporal anchoring (ADR-37 layer 3): resolve the configured provider
  // and wire a fire-and-forget scheduler. Inert for the default `none`
  // provider, so a local-first project pays nothing; a real provider stamps
  // the signed head off the write path, fail-open. Retries any anchor left
  // pending by a prior process on boot.
  const anchorRepository = new AnchorRepository(adapter);
  const anchorScheduler = buildAnchorScheduler(config, projectRoot, anchorRepository);
  if (pendingMigrations.length === 0) anchorScheduler.retryPending();
  const auditWriter = new AuditWriter(
    auditDir,
    auditStateRepository,
    undefined,
    () => projectSecretService.getOrCreate(),
    headCheckpoint,
    anchorScheduler,
  );
  const audit = new AuditService(auditWriter);
  const auditQuery = new AuditQuery(auditDir);

  // Domain-event hooks: only attach the dispatcher when at least one
  // hook is configured, so the common (no-hooks) path carries zero
  // overhead. The dispatcher runs post-commit and records each firing,
  // so a hook is part of the audit trail rather than a phantom effect.
  // Execution is gated by HookTrustService: an in-repo hooks block runs
  // only if a human approved these exact hooks; an un-approved block is
  // recorded as skipped and never executed. Trust is resolved ONCE here
  // (config and approval are immutable within a process) rather than on
  // every dispatch, so the approval-file read + fingerprint hash do not
  // run on the audit hot path. `userDir` resolves to the same location
  // the user-knowledge layer uses; `options.userDir === null` (tests
  // disabling that layer) falls back to the real dir so the trust check
  // is still exercised.
  // Built unconditionally so `mnema hooks show/approve` can reuse the same
  // wiring (and userDir isolation) as the dispatcher.
  const hookTrust = new HookTrustService(config.project.key, options.userDir ?? userKnowledgeDir());
  if (hasAnyHook(config.hooks)) {
    const hooksTrusted = hookTrust.isTrusted(config.hooks);
    const dispatcher = new DomainEventDispatcher(
      config.hooks,
      workflow.terminal,
      (input) => audit.write(input),
      undefined,
      () => hooksTrusted,
    );
    audit.setWriteObserver((event) => dispatcher.dispatch(event));
  }

  const stateDir = path.join(projectRoot, config.paths.state);
  const syncBuffer = new SyncBuffer(stateDir);
  const roadmapMirror = new RoadmapMirror({
    projectRoot,
    roadmapDir: config.paths.roadmap,
    sprintsDir: config.paths.sprints,
  });
  const sync = new SyncService(
    tasks,
    new MarkdownIo(),
    { projectRoot, backlogDir: config.paths.backlog },
    syncBuffer,
    // Resolve a task's epic/sprint UUIDs to their stable human keys for
    // the markdown frontmatter; those keys survive a clone, the ids do not.
    (task) => ({
      epicKey: task.epicId !== null ? (epicRepository.findById(task.epicId)?.key ?? null) : null,
      sprintKey:
        task.sprintId !== null ? (sprintRepository.findById(task.sprintId)?.key ?? null) : null,
    }),
    // Resolve a task's labels for the frontmatter `labels:` list.
    (task) => labelRepository.findNamesByTask(task.id),
  );
  sync.setFlushPolicy({
    volume: config.sync.agent_buffer_flush_count,
    intervalMs: config.sync.agent_buffer_flush_seconds * 1000,
  });
  sync.setMode(options.syncMode ?? SyncMode.Push);

  const syncRebuild = new SyncRebuild(
    tasks,
    actors,
    projects,
    epicRepository,
    sprintRepository,
    decisionRepository,
    labelRepository,
    {
      projectRoot,
      backlogDir: config.paths.backlog,
      roadmapDir: config.paths.roadmap,
      sprintsDir: config.paths.sprints,
    },
    new Set(stateMachine.getWorkflow().states),
  );

  const taskService = new TaskService(
    tasks,
    transitions,
    projects,
    stateMachine,
    audit,
    sync,
    {
      ensureActor: (handle, kind) =>
        identity.ensureActor(handle, kind === 'human' ? ActorKind.Human : ActorKind.Agent),
      findActorIdByHandle: (handle) => identity.findActorIdByHandle(handle),
    },
    config.enforcement_mode as EnforcementMode,
  );
  trace.mark('services instantiated');

  const agentRunService = new AgentRunService(
    agentRuns,
    actors,
    identity,
    audit,
    agentPlans,
    transitions,
    () => {
      sync.flushAll();
    },
  );
  const agentPlanService = new AgentPlanService(agentPlans, agentRuns, tasks);
  const orphanRunService = new OrphanRunService(agentRuns, agentRunService);

  const fileStore = new FileStore(path.join(stateDir, 'attachments'));
  const sprintService = new SprintService(
    sprintRepository,
    tasks,
    projects,
    audit,
    stateMachine,
    sprintMetricRepository,
    roadmapMirror,
    sync,
  );
  const provenanceService = new ProvenanceService(provenanceLinkRepository);
  const decisionService = new DecisionService(
    decisionRepository,
    projects,
    identity,
    audit,
    noteRepository,
    tasks,
    roadmapMirror,
    provenanceLinkRepository,
    observationRepository,
  );
  const dependencyService = new DependencyService(
    dependencyRepository,
    tasks,
    sprintRepository,
    stateMachine,
    audit,
  );
  const noteService = new NoteService(noteRepository, tasks, identity, audit);
  const taskEvidenceService = new TaskEvidenceService(taskEvidenceRepository, tasks, audit);
  const epicService = new EpicService(
    epicRepository,
    tasks,
    projects,
    audit,
    stateMachine,
    roadmapMirror,
    sync,
  );
  const coverageService = new CoverageService(
    epicRepository,
    sprintRepository,
    tasks,
    stateMachine,
  );
  const dependencyGraphService = new DependencyGraphService(
    dependencyRepository,
    tasks,
    epicRepository,
    sprintRepository,
    stateMachine,
  );
  const runDiffService = new RunDiffService(agentRuns, auditQuery);
  const fileCollisionService = new FileCollisionService(
    tasks,
    taskEvidenceRepository,
    epicRepository,
    sprintRepository,
    projectRoot,
    options.commitRunner,
  );
  const labelService = new LabelService(labelRepository, tasks, audit, sync);
  const portfolioService = new PortfolioService(
    tasks,
    epicRepository,
    sprintRepository,
    labelRepository,
  );
  const flowMetricsService = new FlowMetricsService(
    auditQuery,
    taskService,
    workflow,
    sprintService,
    config.project.key,
  );
  const githubPrService = new GitHubPrService();
  const commitVerifier = new CommitVerifier(options.commitRunner);
  const workGraphLintService = new WorkGraphLintService(
    sprintRepository,
    epicRepository,
    tasks,
    stateMachine,
    auditQuery,
    adapter,
  );
  const inboxService = new InboxService(tasks, decisionService, config.project.key, stateMachine, {
    staleAfterDays: config.aging.stale_after_days,
    slaDays: config.aging.sla_days,
    wipLimits: config.aging.wip_limits,
  });
  const snapshotService = new SnapshotService(
    coverageService,
    dependencyGraphService,
    inboxService,
    epicRepository,
    sprintRepository,
    tasks,
  );
  const attachmentService = new AttachmentService(
    attachmentRepository,
    tasks,
    decisionRepository,
    fileStore,
    identity,
    audit,
  );
  const searchService = new SearchService(adapter);
  const skillsDir = path.join(projectRoot, config.paths.skills);
  const memoryDir = path.join(projectRoot, config.paths.memory);
  // Skill lint checks that a referenced tool *exists*, not that it is
  // advertised under the current profile, so validate against the full
  // catalogue (all groups enabled) plus this workflow's transition tools.
  const knownTools = listAvailableToolNames(workflow, {
    epics: true,
    sprints: true,
    knowledge: true,
  });
  // User-level knowledge (`~/.config/mnema`) merges under the project's
  // own skills/memories — read-only, project always shadows. Tests
  // override this (or pass null) so they never read the real home dir.
  const userDir = options.userDir !== undefined ? options.userDir : userKnowledgeDir();
  const skillService = new SkillService(
    skillsDir,
    knownTools,
    skillRepository,
    identity,
    audit,
    userDir,
    options.commitRunner,
  );
  const commandDefinitionService = new CommandDefinitionService(
    path.join(projectRoot, config.paths.commands),
  );
  const memoryService = new MemoryService(
    memoryDir,
    memoryRepository,
    identity,
    audit,
    userDir,
    provenanceLinkRepository,
  );
  const wikilinkLintService = new WikilinkLintService(
    skillsDir,
    memoryDir,
    config.project.key,
    skillRepository,
    memoryRepository,
    decisionRepository,
    tasks,
    projects,
  );
  const observationService = new ObservationService(observationRepository, tasks, identity, audit);
  const memoryStalenessService = new MemoryStalenessService(projectRoot);
  trace.mark('all services wired');
  trace.end();

  return {
    adapter,
    stateMachine,
    identity,
    task: taskService,
    audit,
    auditQuery,
    sync,
    syncRebuild,
    agentRun: agentRunService,
    orphanRun: orphanRunService,
    agentPlan: agentPlanService,
    inbox: inboxService,
    sprint: sprintService,
    decision: decisionService,
    dependency: dependencyService,
    label: labelService,
    note: noteService,
    taskEvidence: taskEvidenceService,
    epic: epicService,
    coverage: coverageService,
    dependencyGraph: dependencyGraphService,
    fileCollision: fileCollisionService,
    snapshot: snapshotService,
    runDiff: runDiffService,
    portfolio: portfolioService,
    flowMetrics: flowMetricsService,
    hookTrust,
    githubPr: githubPrService,
    commitVerifier,
    workGraphLint: workGraphLintService,
    attachment: attachmentService,
    search: searchService,
    skill: skillService,
    commandDefinition: commandDefinitionService,
    wikilinkLint: wikilinkLintService,
    memory: memoryService,
    memoryStaleness: memoryStalenessService,
    observation: observationService,
    provenance: provenanceService,
    transitions,
    pendingMigrations,
    close: () => adapter.close(),
  };
}

/**
 * Inserts the configured project into an empty database. No-op when a
 * row for the key already exists, so it is safe to call on every boot.
 * Mirrors the seed `mnema init` performs, keeping the config the single
 * source of truth for project identity on a fresh clone.
 *
 * @param projects - Project repository bound to the open database
 * @param config - Validated project configuration
 */
function ensureProject(projects: ProjectRepository, config: Config): void {
  if (projects.findByKey(config.project.key) !== null) return;
  projects.insert({
    key: config.project.key,
    name: config.project.name,
    description: config.project.description ?? null,
  });
}
