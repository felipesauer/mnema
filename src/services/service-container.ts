import path from 'node:path';

import type { Config } from '../config/config-schema.js';
import { ActorKind } from '../domain/enums/actor-kind.js';
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
import { AttachmentRepository } from '../storage/sqlite/repositories/attachment-repository.js';
import { DecisionRepository } from '../storage/sqlite/repositories/decision-repository.js';
import { EpicRepository } from '../storage/sqlite/repositories/epic-repository.js';
import { MemoryRepository } from '../storage/sqlite/repositories/memory-repository.js';
import { NoteRepository } from '../storage/sqlite/repositories/note-repository.js';
import { ObservationRepository } from '../storage/sqlite/repositories/observation-repository.js';
import { ProjectRepository } from '../storage/sqlite/repositories/project-repository.js';
import { SkillRepository } from '../storage/sqlite/repositories/skill-repository.js';
import { SprintRepository } from '../storage/sqlite/repositories/sprint-repository.js';
import { TaskRepository } from '../storage/sqlite/repositories/task-repository.js';
import { TransitionRepository } from '../storage/sqlite/repositories/transition-repository.js';
import { SqliteAdapter } from '../storage/sqlite/sqlite-adapter.js';
import { perfTrace } from '../utils/perf-trace.js';
import { AgentPlanService } from './agent-plan-service.js';
import { AgentRunService } from './agent-run-service.js';
import { AttachmentService } from './attachment-service.js';
import { AuditQuery } from './audit-query.js';
import { AuditService } from './audit-service.js';
import { DecisionService } from './decision-service.js';
import { EpicService } from './epic-service.js';
import { IdentityService } from './identity-service.js';
import { InboxService } from './inbox-service.js';
import { MemoryService } from './memory-service.js';
import { NoteService } from './note-service.js';
import { ObservationService } from './observation-service.js';
import { SearchService } from './search-service.js';
import { SkillService } from './skill-service.js';
import { SprintService } from './sprint-service.js';
import { SyncRebuild } from './sync-rebuild.js';
import { SyncMode, SyncService } from './sync-service.js';
import { TaskService } from './task-service.js';

/**
 * Where the migration files live in the source tree (relative to repo
 * root). Build output bundles them next to the source under `dist/`.
 */
const MIGRATIONS_DIRNAME = 'src/storage/sqlite/migrations';

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
  readonly agentPlan: AgentPlanService;
  readonly inbox: InboxService;
  readonly sprint: SprintService;
  readonly decision: DecisionService;
  readonly note: NoteService;
  readonly epic: EpicService;
  readonly attachment: AttachmentService;
  readonly search: SearchService;
  readonly skill: SkillService;
  readonly memory: MemoryService;
  readonly observation: ObservationService;
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

  const migrationsDir = options.migrationsDir ?? path.resolve(MIGRATIONS_DIRNAME);
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
    runner.run(adapter, migrationsDir);
  }
  const pendingMigrations = runner.detectDrift(adapter, migrationsDir);
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
  const attachmentRepository = new AttachmentRepository(adapter);
  const decisionRepository = new DecisionRepository(adapter);
  const noteRepository = new NoteRepository(adapter);
  const epicRepository = new EpicRepository(adapter);
  const skillRepository = new SkillRepository(adapter);
  const memoryRepository = new MemoryRepository(adapter);
  const observationRepository = new ObservationRepository(adapter);
  trace.mark('repositories instantiated');

  const identity = new IdentityService(actors);

  const auditDir = path.join(projectRoot, config.paths.audit);
  const auditWriter = new AuditWriter(auditDir);
  const audit = new AuditService(auditWriter);
  const auditQuery = new AuditQuery(auditDir);

  const stateDir = path.join(projectRoot, config.paths.state);
  const syncBuffer = new SyncBuffer(stateDir);
  const sync = new SyncService(
    tasks,
    new MarkdownIo(),
    { projectRoot, backlogDir: config.paths.backlog },
    syncBuffer,
  );
  sync.setFlushPolicy({
    volume: config.sync.agent_buffer_flush_count,
    intervalMs: config.sync.agent_buffer_flush_seconds * 1000,
  });
  sync.setMode(options.syncMode ?? SyncMode.Push);

  const syncRebuild = new SyncRebuild(tasks, actors, projects, {
    projectRoot,
    backlogDir: config.paths.backlog,
  });

  const taskService = new TaskService(tasks, transitions, projects, stateMachine, audit, sync, {
    ensureActor: (handle, kind) =>
      identity.ensureActor(handle, kind === 'human' ? ActorKind.Human : ActorKind.Agent),
  });
  trace.mark('services instantiated');

  const agentRunService = new AgentRunService(agentRuns, actors, identity, audit, () => {
    sync.flushAll();
  });
  const agentPlanService = new AgentPlanService(agentPlans, agentRuns, tasks);

  const fileStore = new FileStore(path.join(stateDir, 'attachments'));
  const sprintService = new SprintService(sprintRepository, tasks, projects, audit, stateMachine);
  const decisionService = new DecisionService(decisionRepository, projects, identity, audit);
  const noteService = new NoteService(noteRepository, tasks, identity, audit);
  const epicService = new EpicService(epicRepository, tasks, projects, audit, stateMachine);
  const inboxService = new InboxService(tasks, decisionService, config.project.key, stateMachine);
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
  const knownTools = listAvailableToolNames(workflow);
  const skillService = new SkillService(skillsDir, knownTools, skillRepository, identity, audit);
  const memoryService = new MemoryService(memoryDir, memoryRepository, identity, audit);
  const observationService = new ObservationService(observationRepository, tasks, identity, audit);
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
    agentPlan: agentPlanService,
    inbox: inboxService,
    sprint: sprintService,
    decision: decisionService,
    note: noteService,
    epic: epicService,
    attachment: attachmentService,
    search: searchService,
    skill: skillService,
    memory: memoryService,
    observation: observationService,
    transitions,
    pendingMigrations,
    close: () => adapter.close(),
  };
}
