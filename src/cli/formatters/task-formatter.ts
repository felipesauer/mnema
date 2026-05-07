import pc from 'picocolors';

import type { Task } from '../../domain/entities/task.js';

/**
 * Looks up an actor handle from its internal id. Returns `null` when
 * unknown — the formatter falls back to a short prefix of the id so the
 * line never breaks layout.
 */
export type ActorHandleLookup = (id: string) => string | null;

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
 * @param resolveHandle - Optional id → handle resolver. When omitted (or
 *   when it returns `null`) the actor id is rendered truncated.
 * @returns Multi-line string ready for stdout
 */
export function formatTaskBlock(task: Task, resolveHandle?: ActorHandleLookup): string {
  const head = `${pc.bold(task.key)}  ${pc.cyan(task.state)}  ${task.title}`;
  const lines: string[] = [head];

  const meta: string[] = [];
  meta.push(`reporter: ${displayActor(task.reporterId, resolveHandle)}`);
  if (task.assigneeId !== null) {
    meta.push(`assignee: ${displayActor(task.assigneeId, resolveHandle)}`);
  }
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

function displayActor(id: string, resolveHandle: ActorHandleLookup | undefined): string {
  if (resolveHandle === undefined) return id.slice(0, 8);
  const handle = resolveHandle(id);
  return handle ?? id.slice(0, 8);
}
