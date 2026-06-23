import type { Task } from '../../domain/entities/task.js';
import { pc } from '../../utils/colors.js';
import { formatTimestamp, type TimestampMode } from './timestamp-formatter.js';

/**
 * Looks up an actor handle from its internal id. Returns `null` when
 * unknown — the formatter falls back to a short prefix of the id so the
 * line never breaks layout.
 */
export type ActorHandleLookup = (id: string) => string | null;

/**
 * Looks up a sprint or epic key from its internal id. Returns `null`
 * when unknown — formatters render the truncated id in that case.
 */
export type EntityKeyLookup = (id: string) => string | null;

/**
 * Optional dependencies that decorate {@link formatTaskBlock} output
 * with human-readable references (handles, sprint keys, epic keys) and
 * timestamp formatting. Each is independent — pass only what is
 * available and the formatter degrades gracefully.
 */
export interface FormatTaskDeps {
  readonly resolveHandle?: ActorHandleLookup;
  readonly resolveSprintKey?: EntityKeyLookup;
  readonly resolveEpicKey?: EntityKeyLookup;
  readonly timestampMode?: TimestampMode;
}

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
export function formatTaskBlock(task: Task, deps: FormatTaskDeps | ActorHandleLookup = {}): string {
  // Backwards-compatible: the previous signature took the handle
  // resolver positionally. Detect that shape and adapt.
  const opts: FormatTaskDeps = typeof deps === 'function' ? { resolveHandle: deps } : deps;
  const { resolveHandle, resolveSprintKey, resolveEpicKey, timestampMode = 'relative' } = opts;

  const head = `${pc.bold(task.key)}  ${pc.cyan(task.state)}  ${task.title}`;
  const lines: string[] = [head];

  const meta: string[] = [];
  meta.push(`reporter: ${displayActor(task.reporterId, resolveHandle)}`);
  if (task.assigneeId !== null) {
    meta.push(`assignee: ${displayActor(task.assigneeId, resolveHandle)}`);
  }
  if (task.estimate !== null) meta.push(`estimate: ${task.estimate}`);
  if (task.contextBudget !== null) meta.push(`context_budget: ${task.contextBudget}`);
  meta.push(`priority: ${task.priority}`);
  if (task.reopenCount > 0) meta.push(`reopened: ${task.reopenCount}x`);
  lines.push(`  ${pc.dim(meta.join(' · '))}`);

  if (task.sprintId !== null || task.epicId !== null) {
    const refs: string[] = [];
    if (task.sprintId !== null) {
      refs.push(`sprint: ${displayEntity(task.sprintId, resolveSprintKey)}`);
    }
    if (task.epicId !== null) {
      refs.push(`epic: ${displayEntity(task.epicId, resolveEpicKey)}`);
    }
    if (refs.length > 0) lines.push(`  ${pc.dim(refs.join(' · '))}`);
  }

  if (task.description !== null && task.description.length > 0) {
    lines.push(`  ${task.description}`);
  }
  if (task.acceptanceCriteria.length > 0) {
    lines.push(`  acceptance:`);
    for (const ac of task.acceptanceCriteria) {
      lines.push(`    - ${ac}`);
    }
  }

  const timestamps: string[] = [];
  timestamps.push(`created: ${formatTimestamp(task.createdAt, timestampMode)}`);
  if (task.updatedAt !== task.createdAt) {
    timestamps.push(`updated: ${formatTimestamp(task.updatedAt, timestampMode)}`);
  }
  lines.push(`  ${pc.dim(timestamps.join(' · '))}`);

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

function displayEntity(id: string, lookup: EntityKeyLookup | undefined): string {
  if (lookup === undefined) return id.slice(0, 8);
  const key = lookup(id);
  return key ?? id.slice(0, 8);
}
