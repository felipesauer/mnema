import { existsSync, mkdirSync, readdirSync, renameSync, unlinkSync } from 'node:fs';
import path from 'node:path';

import type { Task } from '../domain/entities/task.js';
import type { SyncBuffer } from '../storage/buffer/sync-buffer.js';
import type { MarkdownIo } from '../storage/markdown/markdown-io.js';
import type { TaskRepository } from '../storage/sqlite/repositories/task-repository.js';

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
 * markdown frontmatter. The database stores internal UUIDs, but those are
 * regenerated on a fresh clone — the stable, version-controlled reference
 * is the key (e.g. `WEBAPP-EPIC-3`). Returns `null` for an unset link.
 */
export type TaskLinkResolver = (task: Task) => {
  readonly epicKey: string | null;
  readonly sprintKey: string | null;
};

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
 * grouped by state under `backlogDir/<STATE>/<KEY>.md`.
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
   * @param taskKey - Task whose markdown should be regenerated
   * @param meta - Optional context (action, run_id) recorded in buffer
   */
  syncTask(taskKey: string, meta: { action?: string; runId?: string } = {}): void {
    if (this.mode === SyncMode.Push) {
      this.flushOne(taskKey);
      return;
    }

    if (this.buffer === null) {
      throw new Error('Buffer mode without a buffer instance — invariant violated');
    }
    const task = this.taskRepository.findByKey(taskKey);
    if (task === null) return;

    this.buffer.append({
      v: 1,
      at: new Date().toISOString(),
      kind: 'task_synced',
      taskKey,
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
    // drain() takes the cooperative lock so a parallel flush from
    // another MCP server cannot replay the same entries.
    const entries = this.buffer.drain();
    if (entries.length === 0) {
      this.lastFlushAt = Date.now();
      return;
    }
    const seen = new Set<string>();
    for (const entry of entries) {
      if (seen.has(entry.taskKey)) continue;
      this.flushOne(entry.taskKey);
      seen.add(entry.taskKey);
    }
    this.lastFlushAt = Date.now();
  }

  /**
   * Recreates the markdown mirror for every active task whose `.md`
   * file is missing from its expected `backlogDir/<STATE>/<KEY>.md`
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
      this.flushOne(task.key);
      rebuilt.push(task.key);
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
   * @param task - Task to locate
   * @returns Absolute path under the configured backlog directory
   */
  pathForTask(task: Task): string {
    return path.join(this.paths.projectRoot, this.paths.backlogDir, task.state, `${task.key}.md`);
  }

  private flushOne(taskKey: string): void {
    const task = this.taskRepository.findByKey(taskKey);
    if (task === null) {
      // Either the row is unknown or it was just soft-deleted. In both
      // cases drop any markdown still sitting under the state folders so
      // the on-disk layout matches the database.
      this.removeMarkdownForKey(taskKey);
      return;
    }

    const targetPath = this.pathForTask(task);
    this.ensureDir(path.dirname(targetPath));
    this.relocateIfStateChanged(task, targetPath);

    const existing = this.markdownIo.read(targetPath);
    const links = this.resolveLinks?.(task) ?? { epicKey: null, sprintKey: null };
    this.markdownIo.write(targetPath, {
      mnemaData: serialiseTask(task, links),
      otherFrontmatter: existing.otherFrontmatter,
      content: existing.content.length > 0 ? existing.content : `# ${task.title}\n`,
    });
  }

  private removeMarkdownForKey(taskKey: string): void {
    const root = path.join(this.paths.projectRoot, this.paths.backlogDir);
    if (!existsSync(root)) return;
    for (const stateDir of readdirSync(root, { withFileTypes: true })) {
      if (!stateDir.isDirectory()) continue;
      const candidate = path.join(root, stateDir.name, `${taskKey}.md`);
      if (existsSync(candidate)) {
        unlinkSync(candidate);
      }
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
      const candidate = path.join(root, stateDir, `${task.key}.md`);
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
  links: { readonly epicKey: string | null; readonly sprintKey: string | null },
): Record<string, unknown> {
  return {
    key: task.key,
    state: task.state,
    title: task.title,
    description: task.description,
    acceptance_criteria: [...task.acceptanceCriteria],
    estimate: task.estimate,
    priority: task.priority,
    assignee: task.assigneeId,
    reporter: task.reporterId,
    epic_key: links.epicKey,
    sprint_key: links.sprintKey,
    reopen_count: task.reopenCount,
    metadata: { ...task.metadata },
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
