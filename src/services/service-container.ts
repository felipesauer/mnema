import path from 'node:path';

import type { Config } from '../config/config-schema.js';
import { ActorKind } from '../domain/enums/actor-kind.js';
import { StateMachine } from '../domain/state-machine/state-machine.js';
import { WorkflowLoader } from '../domain/state-machine/workflow-loader.js';
import { AuditWriter } from '../storage/audit/audit-writer.js';
import { SyncBuffer } from '../storage/buffer/sync-buffer.js';
import { MarkdownIo } from '../storage/markdown/markdown-io.js';
import { MigrationRunner } from '../storage/sqlite/migration-runner.js';
import { ActorRepository } from '../storage/sqlite/repositories/actor-repository.js';
import { AgentPlanRepository } from '../storage/sqlite/repositories/agent-plan-repository.js';
import { AgentRunRepository } from '../storage/sqlite/repositories/agent-run-repository.js';
import { ProjectRepository } from '../storage/sqlite/repositories/project-repository.js';
import { TaskRepository } from '../storage/sqlite/repositories/task-repository.js';
import { TransitionRepository } from '../storage/sqlite/repositories/transition-repository.js';
import { SqliteAdapter } from '../storage/sqlite/sqlite-adapter.js';
import { AgentPlanService } from './agent-plan-service.js';
import { AgentRunService } from './agent-run-service.js';
import { AuditQuery } from './audit-query.js';
import { AuditService } from './audit-service.js';
import { IdentityService } from './identity-service.js';
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
  const dbPath = path.join(projectRoot, config.paths.state, 'state.db');
  const adapter = new SqliteAdapter(dbPath);
  const migrationsDir = options.migrationsDir ?? path.resolve(MIGRATIONS_DIRNAME);
  new MigrationRunner().run(adapter, migrationsDir);

  const workflowPath = path.join(projectRoot, config.paths.workflows, `${config.workflow}.json`);
  const workflow = new WorkflowLoader().load(workflowPath);
  const stateMachine = new StateMachine(workflow);

  const actors = new ActorRepository(adapter);
  const projects = new ProjectRepository(adapter);
  const tasks = new TaskRepository(adapter);
  const transitions = new TransitionRepository(adapter);
  const agentRuns = new AgentRunRepository(adapter);
  const agentPlans = new AgentPlanRepository(adapter);

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

  const agentRunService = new AgentRunService(agentRuns, actors, identity, audit, () => {
    sync.flushAll();
  });
  const agentPlanService = new AgentPlanService(agentPlans, agentRuns);

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
    close: () => adapter.close(),
  };
}
