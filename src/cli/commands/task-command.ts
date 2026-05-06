import path from 'node:path';
import type { Command } from 'commander';
import { ConfigLoader } from '../../config/config-loader.js';
import type { Task } from '../../domain/entities/task.js';
import type { TaskState } from '../../domain/enums/task-state.js';
import { ErrorCode } from '../../errors/error-codes.js';
import { printError } from '../../errors/error-printer.js';
import type { MnemaError } from '../../errors/mnema-error.js';
import { createServiceContainer, type ServiceContainer } from '../../services/service-container.js';
import { migrationsDir } from '../../utils/asset-paths.js';
import { formatTaskBlock, formatTaskList } from '../formatters/task-formatter.js';

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

/**
 * Registers the `mnema task` command group on the given Commander program.
 *
 * Subcommands implemented in this MVP:
 * - `task create` — flag-driven creation in the workflow's initial state
 * - `task list` — lists tasks, optionally filtered by state
 * - `task show <key>` — prints a single task in detail
 * - `task move <key> <action> [--field=value...]` — invokes a workflow action
 */
export class TaskCommand {
  /**
   * Attaches the `task` command group to the root program.
   *
   * @param program - Root Commander program
   */
  register(program: Command): void {
    const group = program.command('task').description('Manage tasks');

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
        await this.withContainer(async (container, config) => {
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
          return resultToTaskOutput(result);
        });
      });

    group
      .command('list')
      .description('List tasks, optionally filtered by state')
      .option('--state <state>', 'Filter by state (e.g. DRAFT, READY)')
      .action(async (options: ListOptions) => {
        await this.withContainer(async (container) => {
          const filter =
            options.state !== undefined ? { state: options.state.toUpperCase() as TaskState } : {};
          const tasks = container.task.list(filter);
          process.stdout.write(`${formatTaskList(tasks)}\n`);
          return null;
        });
      });

    group
      .command('show <key>')
      .description('Show a single task')
      .action(async (key: string) => {
        await this.withContainer(async (container) => {
          const result = container.task.findByKey(key);
          return resultToTaskOutput(result);
        });
      });

    group
      .command('move <key> <action> [fields...]')
      .description('Move a task via a workflow action. Pass payload as `field=value` pairs.')
      .action(async (key: string, action: string, fields: string[]) => {
        await this.withContainer(async (container) => {
          const payload = parseFieldArgs(fields);
          const result = container.task.transition({
            taskKey: key,
            action,
            payload,
            actor: container.identity.getDefaultActor(),
          });
          return resultToTaskOutput(result);
        });
      });
  }

  private async withContainer(
    handler: (
      container: ServiceContainer,
      config: ReturnType<ConfigLoader['load']>,
    ) => Promise<{ task?: Task } | null>,
  ): Promise<void> {
    const loader = new ConfigLoader();
    const configFile = loader.findConfigFile();
    if (configFile === null) {
      process.exit(printError({ kind: ErrorCode.ConfigNotFound, currentDir: process.cwd() }));
    }

    const config = loader.load();
    const projectRoot = path.dirname(configFile);
    const container = createServiceContainer(config, projectRoot, {
      migrationsDir: migrationsDir(),
    });

    try {
      const out = await handler(container, config);
      if (out !== null && out.task !== undefined) {
        process.stdout.write(`${formatTaskBlock(out.task)}\n`);
      }
    } finally {
      container.close();
    }
  }
}

function resultToTaskOutput(
  result: { ok: true; value: Task } | { ok: false; error: MnemaError },
): { task: Task } | null {
  if (!result.ok) {
    process.exit(printError(result.error));
  }
  return { task: result.value };
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
