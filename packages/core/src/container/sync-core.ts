import path from 'node:path';

import type { Config } from '../config/config-schema.js';
import { RoadmapMirror } from '../services/sync/roadmap-mirror.js';
import { SyncRebuild } from '../services/sync/sync-rebuild.js';
import { SyncMode, SyncService } from '../services/sync/sync-service.js';
import { SyncBuffer } from '../storage/buffer/sync-buffer.js';
import { MarkdownIo } from '../storage/markdown/markdown-io.js';
import type { AuditCore } from './audit-core.js';
import type { Infra } from './infra.js';

/**
 * The sync lattice: buffer, roadmap mirror, the markdown sync service and
 * the rebuild-from-disk path. Built lazily as a unit — every mutating
 * domain service depends on `sync`, and `syncRebuild` is the clone-heal
 * path that also needs the audit lattice.
 */
export interface SyncCore {
  readonly sync: SyncService;
  readonly syncRebuild: SyncRebuild;
  readonly roadmapMirror: RoadmapMirror;
}

/**
 * Builds the sync lattice.
 *
 * @param infra - Eager substrate
 * @param auditCore - The audit lattice (rebuild replays chain events)
 * @param config - Validated project configuration
 * @param projectRoot - Absolute path to the project root
 * @param syncMode - Optional sync mode override (defaults to Push)
 * @returns The wired {@link SyncCore}
 */
export function createSyncCore(
  infra: Infra,
  auditCore: AuditCore,
  config: Config,
  projectRoot: string,
  syncMode?: SyncMode,
): SyncCore {
  const { repos } = infra;
  const stateDir = path.join(projectRoot, config.paths.state);
  const syncBuffer = new SyncBuffer(stateDir);
  const roadmapMirror = new RoadmapMirror({
    projectRoot,
    roadmapDir: config.paths.roadmap,
    sprintsDir: config.paths.sprints,
  });

  const sync = new SyncService(
    repos.tasks,
    new MarkdownIo(),
    { projectRoot, backlogDir: config.paths.backlog },
    syncBuffer,
    // Resolve a task's epic/sprint UUIDs to their stable human keys for
    // the markdown frontmatter; those keys survive a clone, the ids do not.
    (task) => ({
      epicKey: task.epicId !== null ? (repos.epics.findById(task.epicId)?.key ?? null) : null,
      sprintKey:
        task.sprintId !== null ? (repos.sprints.findById(task.sprintId)?.key ?? null) : null,
    }),
    // Resolve a task's labels for the frontmatter `labels:` list.
    (task) => repos.labels.findNamesByTask(task.id),
    // Resolve the keys of the tasks this one is blocked by for the
    // frontmatter `depends_on:` list. Only `blocks`-kind edges gate
    // readiness, so only they are mirrored.
    (task) =>
      repos.dependencies
        .findByTask(task.id)
        .filter((dep) => dep.kind === 'blocks')
        .map((dep) => repos.tasks.findById(dep.blocksTaskId)?.key ?? null)
        .filter((key): key is string => key !== null),
    // Resolve a task's assignee/reporter UUID to its stable HANDLE for the
    // frontmatter — the handle is what `rebuildTasks` upserts against.
    (actorId) => repos.actors.findById(actorId)?.handle ?? actorId,
  );
  sync.setFlushPolicy({
    volume: config.sync.agent_buffer_flush_count,
    intervalMs: config.sync.agent_buffer_flush_seconds * 1000,
  });
  sync.setMode(syncMode ?? SyncMode.Push);

  const syncRebuild = new SyncRebuild(
    repos.tasks,
    repos.actors,
    repos.projects,
    repos.epics,
    repos.sprints,
    repos.decisions,
    repos.dependencies,
    repos.labels,
    repos.observations,
    repos.memories,
    repos.skills,
    {
      projectRoot,
      backlogDir: config.paths.backlog,
      roadmapDir: config.paths.roadmap,
      sprintsDir: config.paths.sprints,
      observationsDir: config.paths.observations,
      memoryDir: config.paths.memory,
      skillsDir: config.paths.skills,
    },
    new Set(infra.stateMachine.getWorkflow().states),
    auditCore.audit,
    repos.provenanceLinks,
    (kind: string) => auditCore.auditQuery.run({ kind }),
  );

  return { sync, syncRebuild, roadmapMirror };
}
