import path from 'node:path';

import type { Config } from '../config/config-schema.js';
import { StateMachine, type Workflow } from '../domain/state-machine/state-machine.js';
import { IdentityService } from '../services/integrity/identity-service.js';
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
import { loadWorkflowFile } from '../storage/workflow-file.js';
import { migrationsDir as assetPathsMigrationsDir } from '../utils/asset-paths.js';

/**
 * The eager substrate every container session needs: the open database
 * (with boot-time migration semantics), the active workflow, the
 * repositories and the identity service. Everything else is built
 * lazily on top of this.
 */
export interface Infra {
  readonly adapter: SqliteAdapter;
  readonly workflow: Workflow;
  readonly stateMachine: StateMachine;
  readonly identity: IdentityService;
  readonly pendingMigrations: readonly AppliedMigration[];
  readonly detectPendingMigrations: () => readonly AppliedMigration[];
  readonly repos: {
    readonly actors: ActorRepository;
    readonly projects: ProjectRepository;
    readonly tasks: TaskRepository;
    readonly transitions: TransitionRepository;
    readonly agentRuns: AgentRunRepository;
    readonly agentPlans: AgentPlanRepository;
    readonly sprints: SprintRepository;
    readonly sprintMetrics: SprintMetricRepository;
    readonly attachments: AttachmentRepository;
    readonly decisions: DecisionRepository;
    readonly dependencies: DependencyRepository;
    readonly labels: LabelRepository;
    readonly taskEvidence: TaskEvidenceRepository;
    readonly notes: NoteRepository;
    readonly epics: EpicRepository;
    readonly skills: SkillRepository;
    readonly memories: MemoryRepository;
    readonly observations: ObservationRepository;
    readonly provenanceLinks: ProvenanceLinkRepository;
    readonly auditState: AuditStateRepository;
    readonly headSignatures: AuditHeadSignatureRepository;
    readonly anchors: AnchorRepository;
  };
}

/**
 * Opens the database, applies boot-time migration semantics (auto-apply
 * only on a virgin DB; otherwise surface drift), loads the workflow and
 * instantiates the repository layer.
 *
 * @param config - Validated project configuration
 * @param projectRoot - Absolute path to the project root
 * @param migrationsDirOverride - Test override for the bundled migrations dir
 * @returns The eager {@link Infra} substrate
 */
export function createInfra(
  config: Config,
  projectRoot: string,
  migrationsDirOverride?: string,
): Infra {
  const dbPath = path.join(projectRoot, config.paths.state, 'state.db');
  const adapter = new SqliteAdapter(dbPath);

  // Migration sources: the bundled directory plus the project's own
  // `.mnema/migrations/`. Auto-apply only on a virgin database (first
  // boot); afterwards pending migrations are surfaced and applying is an
  // explicit `mnema migrate` — the cooperative guard for shared-team
  // scenarios where one machine pulls a schema bump before others notice.
  const bundledMigrationsDir = migrationsDirOverride ?? assetPathsMigrationsDir();
  const projectMigrationsDirAbs = path.join(projectRoot, '.mnema/migrations');
  const migrationSources: readonly string[] = [bundledMigrationsDir, projectMigrationsDirAbs];
  const runner = new MigrationRunner();
  const isVirgin = runner.loadApplied(adapter).length === 0;
  if (isVirgin) {
    runner.run(adapter, migrationSources);
  }
  const pendingMigrations = runner.detectDrift(adapter, migrationSources);
  // Fresh re-check (not the boot snapshot) so a long-lived MCP server picks
  // up a `mnema migrate` from another process without a restart.
  const detectPendingMigrations = (): readonly AppliedMigration[] =>
    runner.detectDrift(adapter, migrationSources);

  const workflowPath = path.join(projectRoot, config.paths.workflows, `${config.workflow}.json`);
  const workflow = loadWorkflowFile(workflowPath);
  const stateMachine = new StateMachine(workflow);

  const actors = new ActorRepository(adapter);
  const projects = new ProjectRepository(adapter);

  // Seed the project row from the version-controlled config when the
  // git-ignored database has none (fresh clone). Idempotent; skipped while
  // migrations are pending (mutations refuse under a stale schema anyway).
  if (pendingMigrations.length === 0) {
    ensureProject(projects, config);
  }

  return {
    adapter,
    workflow,
    stateMachine,
    identity: new IdentityService(actors),
    pendingMigrations,
    detectPendingMigrations,
    repos: {
      actors,
      projects,
      tasks: new TaskRepository(adapter),
      transitions: new TransitionRepository(adapter),
      agentRuns: new AgentRunRepository(adapter),
      agentPlans: new AgentPlanRepository(adapter),
      sprints: new SprintRepository(adapter),
      sprintMetrics: new SprintMetricRepository(adapter),
      attachments: new AttachmentRepository(adapter),
      decisions: new DecisionRepository(adapter),
      dependencies: new DependencyRepository(adapter),
      labels: new LabelRepository(adapter),
      taskEvidence: new TaskEvidenceRepository(adapter),
      notes: new NoteRepository(adapter),
      epics: new EpicRepository(adapter),
      skills: new SkillRepository(adapter),
      memories: new MemoryRepository(adapter),
      observations: new ObservationRepository(adapter),
      provenanceLinks: new ProvenanceLinkRepository(adapter),
      auditState: new AuditStateRepository(adapter),
      headSignatures: new AuditHeadSignatureRepository(adapter),
      anchors: new AnchorRepository(adapter),
    },
  };
}

/**
 * Inserts the configured project into an empty database. No-op when a
 * row for the key already exists, so it is safe to call on every boot.
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
