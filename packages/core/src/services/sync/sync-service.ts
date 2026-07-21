import { existsSync, mkdirSync, readdirSync, renameSync, unlinkSync } from 'node:fs';
import path from 'node:path';

import type { Task } from '../../domain/entities/task.js';
import type { SyncBuffer } from '../../storage/buffer/sync-buffer.js';
import type { MarkdownIo } from '../../storage/markdown/markdown-io.js';
import type { TaskRepository } from '../../storage/sqlite/repositories/task-repository.js';

/**
 * Sync mode: immediate write or buffered.
 *
 * - `Push` is used by the CLI; every mutation lands on disk before the
 *   command returns.
 * - `Buffer` is used by the MCP server: pending entries are written to
 *   `.app/buffer.jsonl` and flushed on timer, volume threshold, or
 *   `agent_run_end`.
 */
export enum SyncMode {
  Push = 'push',
  Buffer = 'buffer',
}

/**
 * Filesystem layout the sync service should use to derive markdown paths.
 */
export interface SyncPaths {
  readonly projectRoot: string;
  readonly backlogDir: string;
}

/**
 * Resolves a task's epic/sprint links to their human keys for the
 * markdown frontmatter. The link is the target's committed id — the id now
 * survives a clone (the mirror carries it), so it is the collision-free,
 * version-controlled reference. Returns `null` for an unset link.
 */
export type TaskLinkResolver = (task: Task) => {
  readonly epicId: string | null;
  readonly sprintId: string | null;
};

/**
 * Resolves the labels currently on a task for the markdown frontmatter.
 * Labels live in a join table, not on the task row, so the resolver lets
 * the sync service stay decoupled from the label repository (mirroring
 * {@link TaskLinkResolver}). Returns `[]` for a task with no labels.
 */
export type TaskLabelResolver = (task: Task) => readonly string[];

/**
 * Resolves the keys of the tasks a task is blocked by, for the markdown
 * frontmatter `depends_on:` list. Edges live in the `dependencies` table
 * (git-ignored, keyed by regenerated UUIDs), so serialising them by the
 * stable blocker key is the only way they survive a fresh clone. The
 * resolver keeps the sync service decoupled from the dependency repository
 * (mirroring {@link TaskLinkResolver}). Returns `[]` when the task depends
 * on nothing.
 */
export type TaskDependencyResolver = (task: Task) => readonly string[];

/**
 * Resolves an actor id (UUID) to its stable HANDLE for the task mirror.
 * The mirror must serialise the handle, not the id: actor ids are regenerated
 * on a fresh clone, so a serialised id read back as a handle would upsert a
 * bogus actor (the id-string becomes the handle). Serialising the handle lets
 * the rebuild's `actors.upsert(handle)` round-trip to the same actor. Returns
 * the id unchanged if it cannot be resolved (defensive; keeps a value).
 */
export type ActorHandleResolver = (actorId: string) => string;

/**
 * Auto-flush thresholds. The MCP server overrides these from
 * `mnema.config.json`.
 */
export interface SyncFlushPolicy {
  /** Maximum buffered entries before an automatic flush. */
  readonly volume: number;
  /** Maximum time (ms) since the last flush before forcing one. */
  readonly intervalMs: number;
}

const DEFAULT_FLUSH_POLICY: SyncFlushPolicy = {
  volume: 50,
  intervalMs: 30_000,
};

/**
 * Synchronises SQLite state to markdown files, one file per task,
 * grouped by state under `backlogDir/<STATE>/<ID>.md`.
 *
 * In Push mode every mutation flushes synchronously; in Buffer mode the
 * service persists pending updates to the {@link SyncBuffer} and flushes
 * lazily based on {@link SyncFlushPolicy} or explicit calls to
 * {@link flushAll}.
 */
export class SyncService {
  private mode: SyncMode = SyncMode.Push;
  private lastFlushAt = Date.now();
  private flushPolicy: SyncFlushPolicy = DEFAULT_FLUSH_POLICY;

  constructor(
    private readonly taskRepository: TaskRepository,
    private readonly markdownIo: MarkdownIo,
    private readonly paths: SyncPaths,
    private readonly buffer: SyncBuffer | null = null,
    // Optional so existing callers/tests keep working without epic/sprint
    // wiring; when absent the links are simply written as null.
    private readonly resolveLinks: TaskLinkResolver | null = null,
    // Optional for the same reason; when absent no `labels` key is written.
    private readonly resolveLabels: TaskLabelResolver | null = null,
    // Optional for the same reason; when absent `depends_on` is written as [].
    private readonly resolveDependencies: TaskDependencyResolver | null = null,
    // Optional for the same reason; when absent the actor id is written as-is
    // (pre-fix behaviour). When present, assignee/reporter serialise as handles
    // so they round-trip to the same actor on a fresh clone.
    private readonly resolveActorHandle: ActorHandleResolver | null = null,
  ) {}

  /**
   * Selects the active sync mode for subsequent operations.
   *
   * @param mode - Mode to apply
   */
  setMode(mode: SyncMode): void {
    if (mode === SyncMode.Buffer && this.buffer === null) {
      throw new Error('Buffer mode requires a SyncBuffer instance');
    }
    this.mode = mode;
  }

  /**
   * Returns the current sync mode.
   */
  getMode(): SyncMode {
    return this.mode;
  }

  /**
   * Configures the auto-flush policy for Buffer mode.
   *
   * @param policy - Volume and interval thresholds
   */
  setFlushPolicy(policy: SyncFlushPolicy): void {
    this.flushPolicy = policy;
  }

  /**
   * Updates (or queues) the markdown file for a single task.
   *
   * In Push mode the markdown is rewritten synchronously. In Buffer
   * mode the entry is appended to the persistent buffer and an
   * auto-flush check is performed.
   *
   * @param taskId - Committed id of the task whose markdown should regenerate
   * @param meta - Optional context (action, run_id) recorded in buffer
   */
  syncTask(taskId: string, meta: { action?: string; runId?: string } = {}): void {
    if (this.mode === SyncMode.Push) {
      this.flushOne(taskId);
      return;
    }

    if (this.buffer === null) {
      throw new Error('Buffer mode without a buffer instance — invariant violated');
    }
    const task = this.taskRepository.findById(taskId);
    if (task === null) return;

    this.buffer.append({
      v: 1,
      at: new Date().toISOString(),
      kind: 'task_synced',
      taskKey: taskId,
      mdTarget: this.pathForTask(task),
      action: meta.action,
      runId: meta.runId,
    });

    this.maybeAutoFlush();
  }

  /**
   * Flushes every pending entry in the buffer to disk.
   *
   * No-op in Push mode (nothing buffered) or when no buffer is
   * configured. Empties the buffer atomically once everything was
   * written.
   */
  flushAll(): void {
    if (this.buffer === null) return;
    // drain() takes the cooperative lock and empties the buffer in one
    // atomic critical section, so a parallel flush from another MCP server
    // cannot replay the same entries. But the markdown writes below happen
    // AFTER the buffer is already cleared — if one throws (or the process
    // dies) mid-loop, the un-written entries would be lost. So on failure
    // we re-append the failing entry and every entry after it back to the
    // buffer before rethrowing: a later flushAll/recover replays them, and
    // nothing is dropped.
    const entries = this.buffer.drain();
    if (entries.length === 0) {
      this.lastFlushAt = Date.now();
      return;
    }
    const buffer = this.buffer;
    const seen = new Set<string>();
    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i];
      if (entry === undefined) continue;
      if (seen.has(entry.taskKey)) continue;
      try {
        this.flushOne(entry.taskKey);
      } catch (error) {
        // Put back this entry and all not-yet-processed ones (raw, so a
        // deduped-but-unwritten key is not lost) for the next flush.
        for (let j = i; j < entries.length; j += 1) {
          const remaining = entries[j];
          if (remaining !== undefined) buffer.append(remaining);
        }
        throw error;
      }
      seen.add(entry.taskKey);
    }
    this.lastFlushAt = Date.now();
  }

  /**
   * Recreates the markdown mirror for every active task whose `.md`
   * file is missing from its expected `backlogDir/<STATE>/<ID>.md`
   * path, rebuilding from the SQLite row (the source of truth). Existing
   * mirrors are left untouched — this only heals drift, it does not
   * reformat content a human may have edited locally. Returns the keys
   * whose mirror was just written.
   *
   * Mirrors {@link SkillService.rebuildMirrors} and the other entity
   * rebuilds, extended to the backlog's per-state directory layout.
   *
   * @returns Task keys whose mirror file was created during this call
   */
  rebuildMirrors(): string[] {
    const rebuilt: string[] = [];
    for (const task of this.taskRepository.findAllActive()) {
      if (existsSync(this.pathForTask(task))) continue;
      this.flushOne(task.id);
      rebuilt.push(task.id);
    }
    return rebuilt;
  }

  /**
   * Re-applies any leftover entries from a previous run. Idempotent —
   * each entry is replayed by writing the current task state to its
   * markdown target.
   */
  recover(): void {
    if (this.buffer === null) return;
    if (this.buffer.size() === 0) return;
    this.flushAll();
  }

  /**
   * Resolves the absolute markdown path a task should live at.
   *
   * The task's `state` names a subdirectory of the backlog, and since
   * migration 004 dropped the DB CHECK on `tasks.state`, a crafted state
   * (`../../etc`) could otherwise steer the write outside the backlog
   * root. The resolved path is asserted to stay within that root — a
   * defence in depth beyond the rebuild-time state validation, covering
   * every write/relocate/delete that goes through here.
   *
   * @param task - Task to locate
   * @returns Absolute path under the configured backlog directory
   * @throws Error if `state` would escape the backlog root
   */
  pathForTask(task: Task): string {
    const backlogRoot = path.resolve(this.paths.projectRoot, this.paths.backlogDir);
    // The mirror is named by the committed id (like observations), so it
    // survives a clone and never collides on a merge.
    const target = path.resolve(backlogRoot, task.state, `${task.id}.md`);
    if (!isWithin(backlogRoot, target)) {
      throw new Error(
        `refusing to write task ${task.id}: state '${task.state}' escapes the backlog directory`,
      );
    }
    return target;
  }

  private flushOne(taskId: string): void {
    const task = this.taskRepository.findById(taskId);
    if (task === null) {
      // Either the row is unknown or it was just soft-deleted. In both
      // cases drop any markdown still sitting under the state folders so
      // the on-disk layout matches the database.
      this.removeMarkdownForId(taskId);
      return;
    }

    const targetPath = this.pathForTask(task);
    this.ensureDir(path.dirname(targetPath));
    this.relocateIfStateChanged(task, targetPath);

    const existing = this.markdownIo.read(targetPath);
    const links = this.resolveLinks?.(task) ?? { epicId: null, sprintId: null };
    const labels = this.resolveLabels?.(task) ?? [];
    const dependsOn = this.resolveDependencies?.(task) ?? [];
    // Serialise actors as stable HANDLES, not regenerated ids, so they survive
    // a fresh clone. Falls back to the id when no resolver is wired.
    const resolveHandle = this.resolveActorHandle;
    const actors = {
      assignee:
        task.assigneeId === null ? null : (resolveHandle?.(task.assigneeId) ?? task.assigneeId),
      reporter: resolveHandle?.(task.reporterId) ?? task.reporterId,
    };
    this.markdownIo.write(targetPath, {
      mnemaData: serialiseTask(task, links, labels, dependsOn, actors),
      otherFrontmatter: existing.otherFrontmatter,
      content: existing.content.length > 0 ? existing.content : `# ${task.title}\n`,
    });
  }

  private removeMarkdownForId(taskId: string): void {
    const root = path.join(this.paths.projectRoot, this.paths.backlogDir);
    if (!existsSync(root)) return;
    // The mirror is named by the committed id, so the removal is a direct
    // unlink of `<id>.md` — it can only be in one state folder, but the folder
    // is not known here (the row may be gone), so every state dir is checked.
    for (const stateDir of readdirSync(root, { withFileTypes: true })) {
      if (!stateDir.isDirectory()) continue;
      const candidate = path.join(root, stateDir.name, `${taskId}.md`);
      if (existsSync(candidate)) unlinkSync(candidate);
    }
  }

  private maybeAutoFlush(): void {
    if (this.buffer === null) return;

    if (this.buffer.size() >= this.flushPolicy.volume) {
      this.flushAll();
      return;
    }

    if (Date.now() - this.lastFlushAt >= this.flushPolicy.intervalMs) {
      this.flushAll();
    }
  }

  private ensureDir(dir: string): void {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  private relocateIfStateChanged(task: Task, targetPath: string): void {
    if (existsSync(targetPath)) return;

    const root = path.join(this.paths.projectRoot, this.paths.backlogDir);
    if (!existsSync(root)) return;

    for (const stateDir of safeReaddir(root)) {
      const candidate = path.join(root, stateDir, `${task.id}.md`);
      if (candidate === targetPath) continue;
      if (!existsSync(candidate)) continue;

      this.ensureDir(path.dirname(targetPath));
      renameSync(candidate, targetPath);
      return;
    }
  }
}

function serialiseTask(
  task: Task,
  links: { readonly epicId: string | null; readonly sprintId: string | null },
  labels: readonly string[],
  dependsOn: readonly string[],
  // Actor HANDLES (not ids) so assignee/reporter round-trip on a fresh clone.
  actors: { readonly assignee: string | null; readonly reporter: string },
): Record<string, unknown> {
  return {
    // The committed identity: the v7 UUID, written first so it survives a
    // clone (the rebuild adopts it instead of minting a new one). It is the
    // only identity — the human-facing handle is an alias derived from it.
    id: task.id,
    state: task.state,
    title: task.title,
    description: task.description,
    acceptance_criteria: [...task.acceptanceCriteria],
    labels: [...labels],
    depends_on: [...dependsOn],
    estimate: task.estimate,
    context_budget: task.contextBudget,
    assignee: actors.assignee,
    reporter: actors.reporter,
    epic_id: links.epicId,
    sprint_id: links.sprintId,
    reopen_count: task.reopenCount,
    metadata: { ...task.metadata },
    // Git link: persist the STABLE identifiers — branch and PR — so a
    // fresh clone keeps them across a `sync` rebuild. The commit list is
    // volatile (it would churn the markdown on every observer pass) and is
    // re-derived by `mnema watch --git`, so it is intentionally NOT serialized.
    // `!= null` guards both null and undefined (a partial task shape).
    ...(task.gitBranch != null ? { git_branch: task.gitBranch } : {}),
    ...(task.gitPr != null ? { git_pr: { url: task.gitPr.url, state: task.gitPr.state } } : {}),
    created_at: task.createdAt,
    closed_at: task.closedAt,
    updated_at: task.updatedAt,
  };
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

// Helper used to drop an old markdown when a task is hard-deleted upstream.
// Exported for service-level cleanup paths and tests.
export function removeTaskMarkdown(filePath: string): void {
  if (existsSync(filePath)) {
    unlinkSync(filePath);
  }
}

/**
 * True when `target` is `root` itself or lives strictly inside it, after
 * resolving both. Used to keep task markdown writes contained to the
 * backlog directory even when a task's state is hostile (`../../…`).
 *
 * @param root - The containing directory (already absolute)
 * @param target - The candidate path (already absolute)
 */
function isWithin(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}
