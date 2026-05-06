import { existsSync, mkdirSync, readdirSync, renameSync, unlinkSync } from 'node:fs';
import path from 'node:path';

import type { Task } from '../domain/entities/task.js';
import type { MarkdownIo } from '../storage/markdown/markdown-io.js';
import type { TaskRepository } from '../storage/sqlite/repositories/task-repository.js';

/**
 * Sync mode: immediate write or buffered.
 *
 * - `Push` is used by the CLI; every mutation lands on disk before the
 *   command returns.
 * - `Buffer` is reserved for the MCP server; queued entries flush on
 *   timer, volume, or `agent_run_end`. Implemented in Phase 5.
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
 * Synchronises SQLite state to markdown files, one file per task,
 * grouped by state under `backlogDir/<STATE>/<KEY>.md`.
 */
export class SyncService {
  private mode: SyncMode = SyncMode.Push;

  constructor(
    private readonly taskRepository: TaskRepository,
    private readonly markdownIo: MarkdownIo,
    private readonly paths: SyncPaths,
  ) {}

  /**
   * Selects the active sync mode for subsequent operations.
   *
   * @param mode - Mode to apply
   */
  setMode(mode: SyncMode): void {
    this.mode = mode;
  }

  /**
   * Returns the current sync mode.
   */
  getMode(): SyncMode {
    return this.mode;
  }

  /**
   * Updates the markdown file for a single task. In Push mode this
   * happens synchronously; in Buffer mode it is a no-op for now and
   * will be wired to the persistent buffer in Phase 5.
   *
   * @param taskKey - Task whose markdown should be regenerated
   */
  syncTask(taskKey: string): void {
    if (this.mode !== SyncMode.Push) return;

    const task = this.taskRepository.findByKey(taskKey);
    if (task === null) return;

    const targetPath = this.pathForTask(task);
    this.ensureDir(path.dirname(targetPath));

    this.relocateIfStateChanged(task, targetPath);
    this.markdownIo.write(targetPath, {
      mnemaData: serialiseTask(task),
      otherFrontmatter: this.markdownIo.read(targetPath).otherFrontmatter,
      content: this.markdownIo.read(targetPath).content || `# ${task.title}\n`,
    });
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

  private ensureDir(dir: string): void {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * If the markdown for `task.key` exists in a different state folder,
   * move it to the new one so the filesystem mirrors the task state.
   */
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

function serialiseTask(task: Task): Record<string, unknown> {
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
