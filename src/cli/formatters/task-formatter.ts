import pc from 'picocolors';

import type { Task } from '../../domain/entities/task.js';

/**
 * Renders a single task as a multi-line block for terminal output.
 *
 * Format:
 * ```
 * WEBAPP-42  IN_PROGRESS  Implement OAuth login
 *   reporter: daniel · estimate: 5
 *   description: Add support for Google OAuth flow.
 *   acceptance:
 *     - Users can login with Google
 * ```
 *
 * @param task - Task to render
 * @returns Multi-line string ready for stdout
 */
export function formatTaskBlock(task: Task): string {
  const head = `${pc.bold(task.key)}  ${pc.cyan(task.state)}  ${task.title}`;
  const lines: string[] = [head];

  const meta: string[] = [];
  meta.push(`reporter: ${task.reporterId}`);
  if (task.assigneeId !== null) meta.push(`assignee: ${task.assigneeId}`);
  if (task.estimate !== null) meta.push(`estimate: ${task.estimate}`);
  meta.push(`priority: ${task.priority}`);
  lines.push(`  ${pc.dim(meta.join(' · '))}`);

  if (task.description !== null && task.description.length > 0) {
    lines.push(`  ${task.description}`);
  }
  if (task.acceptanceCriteria.length > 0) {
    lines.push(`  acceptance:`);
    for (const ac of task.acceptanceCriteria) {
      lines.push(`    - ${ac}`);
    }
  }

  return lines.join('\n');
}

/**
 * Renders a list of tasks as a compact table-like view.
 *
 * @param tasks - Tasks to render
 * @returns Multi-line string ready for stdout
 */
export function formatTaskList(tasks: readonly Task[]): string {
  if (tasks.length === 0) {
    return pc.dim('(no tasks)');
  }

  return tasks
    .map((t) => `${pc.bold(t.key.padEnd(12))} ${pc.cyan(t.state.padEnd(13))} ${t.title}`)
    .join('\n');
}
