import type { Command } from 'commander';
import pc from 'picocolors';

import type { Task } from '../../domain/entities/task.js';
import type { TaskState } from '../../domain/enums/task-state.js';
import { ErrorCode } from '../../errors/error-codes.js';
import { printError } from '../../errors/error-printer.js';
import type { MnemaError } from '../../errors/mnema-error.js';
import { withCliContext, withMutatingCliContext } from '../cli-context.js';
import { formatHistory, type HistoryFormat } from '../formatters/history-formatter.js';
import { formatTaskBlock, formatTaskList } from '../formatters/task-formatter.js';
import type { TimestampMode } from '../formatters/timestamp-formatter.js';

interface CreateOptions {
  readonly title: string;
  readonly description?: string;
  readonly acceptance?: string[];
  readonly estimate?: string;
  readonly priority?: string;
  readonly assignee?: string;
}

interface ListOptions {
  readonly state?: string;
}

interface DeleteOptions {
  readonly restore?: boolean;
}

interface HistoryOptions {
  readonly json?: boolean;
  readonly iso?: boolean;
  readonly limit?: string;
}

/**
 * Registers the `mnema task` command group on the given Commander program.
 *
 * Subcommands implemented in this MVP:
 * - `task create` — flag-driven creation in the workflow's initial state
 * - `task list` — lists tasks, optionally filtered by state
 * - `task show <key>` — prints a single task in detail
 * - `task move <key> <action> [field=value...]` — invokes a workflow action
 */
export class TaskCommand {
  /**
   * Attaches the `task` command group to the root program.
   *
   * @param program - Root Commander program
   */
  register(program: Command): void {
    const group = program.command('task').alias('tasks').description('Manage tasks');

    group
      .command('create')
      .description("Create a task in the workflow's initial state")
      .requiredOption('--title <text>', 'Task title')
      .option('--description <text>', 'Optional description')
      .option('--acceptance <criterion...>', 'Acceptance criterion (repeat for multiple)')
      .option('--estimate <points>', 'Estimate in story points')
      .option('--priority <n>', 'Priority 1..5 (default 3)')
      .option('--assignee <handle>', 'Assignee handle')
      .action(async (options: CreateOptions) => {
        await withMutatingCliContext(({ container, config }) => {
          const result = container.task.create({
            projectKey: config.project.key,
            title: options.title,
            description: options.description,
            acceptanceCriteria: options.acceptance ?? [],
            estimate: options.estimate !== undefined ? Number(options.estimate) : null,
            priority: options.priority !== undefined ? Number(options.priority) : 3,
            assigneeId: options.assignee ?? null,
            actor: container.identity.getDefaultActor(),
          });
          renderTaskResult(result, (id) => container.identity.resolveHandle(id));
        });
      });

    group
      .command('list')
      .description('List tasks, optionally filtered by state')
      .option('--state <state>', 'Filter by state from the active workflow')
      .action(async (options: ListOptions) => {
        await withCliContext(({ container }) => {
          let filter: { state?: TaskState } = {};
          if (options.state !== undefined) {
            const given = options.state;
            const workflow = container.stateMachine.getWorkflow();
            const allowed = workflow.states;
            // States are case-sensitive by design (the workflow may
            // declare `In Progress` or `состояние1` verbatim). Look up
            // the input literally first; if that fails, fall back to a
            // case-insensitive match so legacy `--state draft` keeps
            // working on workflows that use uppercase names.
            const exact = allowed.includes(given) ? given : null;
            const ci =
              exact === null
                ? (allowed.find((s) => s.toLowerCase() === given.toLowerCase()) ?? null)
                : null;
            const resolved = exact ?? ci;
            if (resolved === null) {
              process.exit(
                printError({
                  kind: ErrorCode.InvalidWorkflowState,
                  workflow: workflow.name,
                  given,
                  allowed,
                }),
              );
            }
            filter = { state: resolved as TaskState };
          }
          const tasks = container.task.list(filter);
          process.stdout.write(`${formatTaskList(tasks)}\n`);
        });
      });

    group
      .command('show <key>')
      .description('Show a single task')
      .action(async (key: string) => {
        await withCliContext(({ container }) => {
          renderTaskResult(container.task.findByKey(key), (id) =>
            container.identity.resolveHandle(id),
          );
        });
      });

    group
      .command('move <key> <action> [fields...]')
      .description(
        'Move a task via a workflow action. Pass payload as `field=value` ' +
          'pairs. Values with a comma are split into arrays (e.g. ' +
          '`acceptance_criteria="One,Two,Three"`); single-item arrays need ' +
          'either a trailing comma or the field repeated. Only fields the ' +
          'action gate requires are validated; extra fields ride along to ' +
          'the audit log so payloads stay forward-compatible with MCP.',
      )
      .action(async (key: string, action: string, fields: string[]) => {
        await withMutatingCliContext(({ container }) => {
          const payload = parseFieldArgs(fields);
          const result = container.task.transition({
            taskKey: key,
            action,
            payload,
            actor: container.identity.getDefaultActor(),
          });
          renderTaskResult(result, (id) => container.identity.resolveHandle(id));
        });
      });

    group
      .command('history <key>')
      .description('Show the chronological audit trail of a single task')
      .option('--json', 'Render as JSONL (one event per line)', false)
      .option('--iso', 'Show timestamps as ISO8601 instead of relative', false)
      .option('--limit <n>', 'Limit the number of events returned')
      .action(async (key: string, options: HistoryOptions) => {
        await withCliContext(({ container }) => {
          const lookup = container.task.findByKey(key);
          if (!lookup.ok) {
            process.exit(printError(lookup.error));
          }

          const events = container.auditQuery.run({
            taskKey: lookup.value.key,
            limit: options.limit !== undefined ? Number(options.limit) : undefined,
          });

          const format: HistoryFormat = options.json === true ? 'json' : 'human';
          const mode: TimestampMode = options.iso === true ? 'iso' : 'relative';

          if (events.length === 0) {
            process.stdout.write(`${pc.dim('(no audit events for this task)')}\n`);
            return;
          }

          const display = (handle: string): string => container.identity.getDisplayFor(handle);
          process.stdout.write(`${formatHistory(events, format, mode, display)}\n`);
        });
      });

    group
      .command('delete <key>')
      .description('Soft-delete a task. Pass --restore to bring it back.')
      .option('--restore', 'Restore a previously deleted task', false)
      .action(async (key: string, options: DeleteOptions) => {
        await withMutatingCliContext(({ container }) => {
          const result =
            options.restore === true
              ? container.task.restore({
                  taskKey: key,
                  actor: container.identity.getDefaultActor(),
                })
              : container.task.softDelete({
                  taskKey: key,
                  actor: container.identity.getDefaultActor(),
                });
          renderTaskResult(result, (id) => container.identity.resolveHandle(id));
        });
      });
  }
}

function renderTaskResult(
  result: { ok: true; value: Task } | { ok: false; error: MnemaError },
  resolveHandle: (id: string) => string | null,
): void {
  if (!result.ok) {
    process.exit(printError(result.error));
  }
  process.stdout.write(`${formatTaskBlock(result.value, resolveHandle)}\n`);
}

/**
 * Parses `name=value` positional fields into a plain object.
 *
 * - Numeric strings are converted to numbers.
 * - `true`/`false` are converted to booleans.
 * - Comma-separated values are split into arrays.
 * - When the same key appears multiple times, values accumulate into
 *   an array (handy for `acceptance_criteria=A acceptance_criteria=B`).
 * - Dashes in keys are normalised to underscores so workflow gate
 *   field names match.
 *
 * @param fields - Raw positional arguments captured by Commander
 * @returns Parsed payload object suitable for `task.transition`
 */
function parseFieldArgs(fields: readonly string[]): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const arg of fields) {
    const eq = arg.indexOf('=');
    if (eq === -1) continue;
    const rawKey = arg.slice(0, eq).replace(/^-+/, '');
    if (rawKey.length === 0) continue;
    const key = rawKey.replace(/-/g, '_');
    const value = coerceValue(arg.slice(eq + 1));

    if (key in payload) {
      const existing = payload[key];
      payload[key] = Array.isArray(existing) ? [...existing, value] : [existing, value];
    } else {
      payload[key] = value;
    }
  }
  return payload;
}

function coerceValue(raw: string): unknown {
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw.includes(',')) {
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  return raw;
}
