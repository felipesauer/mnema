import path from 'node:path';

import type { Config } from '../config/config-schema.js';
import { RoadmapMirror } from '../services/sync/roadmap-mirror.js';
import { SyncRebuild } from '../services/sync/sync-rebuild.js';
import { SyncMode, SyncService } from '../services/sync/sync-service.js';
import { SyncBuffer } from '../storage/buffer/sync-buffer.js';
import { MarkdownIo } from '../storage/markdown/markdown-io.js';
import { LAYOUT } from '../utils/layout.js';
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
  const stateDir = path.join(projectRoot, LAYOUT.state);
  const syncBuffer = new SyncBuffer(stateDir);
  const roadmapMirror = new RoadmapMirror({
    projectRoot,
    roadmapDir: LAYOUT.roadmap,
    sprintsDir: LAYOUT.sprints,
  });

  const sync = new SyncService(
    repos.tasks,
    new MarkdownIo(),
    { projectRoot, backlogDir: LAYOUT.backlog },
    syncBuffer,
    // A task's epic/sprint links are the committed IDs — the ids now survive a
    // clone (the mirror carries them), so they are the collision-free reference
    // the rebuild resolves by, in place of the human key.
    (task) => ({
      epicId: task.epicId,
      sprintId: task.sprintId,
    }),
    // Resolve a task's labels for the frontmatter `labels:` list.
    (task) => repos.labels.findNamesByTask(task.id),
    // The ids of the tasks this one is blocked by, for the `depends_on:` list.
    // Only `blocks`-kind edges gate readiness, so only they are mirrored; the
    // blocker's id is committed, so a clone relinks the same edge.
    (task) =>
      repos.dependencies
        .findByTask(task.id)
        .filter((dep) => dep.kind === 'blocks')
        .map((dep) => dep.blocksTaskId),
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
      backlogDir: LAYOUT.backlog,
      roadmapDir: LAYOUT.roadmap,
      sprintsDir: LAYOUT.sprints,
      observationsDir: LAYOUT.observations,
      memoryDir: LAYOUT.memory,
      skillsDir: LAYOUT.skills,
    },
    new Set(infra.stateMachine.getWorkflow().states),
    auditCore.audit,
    repos.provenanceLinks,
    (kind: string) => auditCore.auditQuery.run({ kind }),
  );

  return { sync, syncRebuild, roadmapMirror };
}
