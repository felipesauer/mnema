import type { Command } from 'commander';
import type { Sprint } from '../../domain/entities/sprint.js';
import type { Task } from '../../domain/entities/task.js';
import { printError } from '../../errors/error-printer.js';
import type { MnemaError } from '../../errors/mnema-error.js';
import { pc } from '../../utils/colors.js';
import { withCliContext, withMutatingCliContext } from '../cli-context.js';
import { formatCoverage } from '../formatters/coverage-formatter.js';

interface PlanOptions {
  readonly name: string;
  readonly goal?: string;
  readonly startsAt?: string;
  readonly endsAt?: string;
  readonly capacity?: string;
}

/**
 * Registers the `mnema sprint` command group.
 *
 * Subcommands:
 * - `sprint plan --name=...`  → create a `PLANNED` sprint
 * - `sprint start <key>`      → activate a sprint
 * - `sprint close <key>`      → close the active sprint
 * - `sprint show <key>`       → render a sprint plus its task list
 * - `sprint list`             → list every sprint of the project
 * - `sprint add <key> <task>` → attach a task to a sprint
 * - `sprint remove <key> <task>` → detach a task from a sprint
 */
export class SprintCommand {
  /**
   * Attaches the `sprint` command group to the root program.
   *
   * @param program - Root Commander program
   */
  register(program: Command): void {
    const group = program.command('sprint').alias('sprints').description('Manage sprints');

    group
      .command('plan')
      .description('Plan a new sprint (PLANNED state)')
      .requiredOption('--name <name>', 'Sprint name')
      .option('--goal <text>', 'Sprint goal')
      .option('--starts-at <iso>', 'Planned start date (ISO8601)')
      .option('--ends-at <iso>', 'Planned end date (ISO8601)')
      .option('--capacity <points>', 'Capacity in story points')
      .action(async (options: PlanOptions) => {
        await withMutatingCliContext(({ container, config }) => {
          const result = container.sprint.plan({
            projectKey: config.project.key,
            name: options.name,
            goal: options.goal,
            startsAt: options.startsAt,
            endsAt: options.endsAt,
            capacity: options.capacity !== undefined ? Number(options.capacity) : undefined,
            actor: container.identity.getDefaultActor(),
          });
          renderSprint(result, 'planned');
        });
      });

    group
      .command('start <key>')
      .description('Activate a planned sprint')
      .option(
        '--expected-updated-at <iso>',
        "Optimistic-concurrency token: must equal the sprint's current `updatedAt` or the transition is rejected with CONFLICT",
      )
      .action(async (key: string, options: { readonly expectedUpdatedAt?: string }) => {
        await withMutatingCliContext(({ container }) => {
          const result = container.sprint.start({
            sprintKey: key,
            actor: container.identity.getDefaultActor(),
            expectedUpdatedAt: options.expectedUpdatedAt,
          });
          renderSprint(result, 'started');
        });
      });

    group
      .command('close <key>')
      .description('Close an active sprint')
      .option(
        '--expected-updated-at <iso>',
        "Optimistic-concurrency token: must equal the sprint's current `updatedAt` or the transition is rejected with CONFLICT",
      )
      .action(async (key: string, options: { readonly expectedUpdatedAt?: string }) => {
        await withMutatingCliContext(({ container }) => {
          const result = container.sprint.close({
            sprintKey: key,
            actor: container.identity.getDefaultActor(),
            expectedUpdatedAt: options.expectedUpdatedAt,
          });
          renderSprint(result, 'closed');
        });
      });

    group
      .command('show <key>')
      .description('Show a sprint together with its tasks')
      .action(async (key: string) => {
        await withCliContext(({ container }) => {
          const view = container.sprint.show(key);
          if (view === null) {
            process.stdout.write(`${pc.dim(`Sprint ${key} not found`)}\n`);
            return;
          }
          process.stdout.write(`${formatSprintView(view.sprint, view.tasks)}\n`);
        });
      });

    group
      .command('list')
      .description('List sprints of the current project')
      .action(async () => {
        await withCliContext(({ container, config }) => {
          const sprints = container.sprint.list(config.project.key);
          if (sprints.length === 0) {
            process.stdout.write(`${pc.dim('(no sprints yet)')}\n`);
            return;
          }
          process.stdout.write(`${sprints.map(formatSprintRow).join('\n')}\n`);
        });
      });

    group
      .command('add <sprintKey> <taskKey>')
      .description('Attach a task to a sprint')
      .action(async (sprintKey: string, taskKey: string) => {
        await withMutatingCliContext(({ container }) => {
          const result = container.sprint.addTask({
            sprintKey,
            taskKey,
            actor: container.identity.getDefaultActor(),
          });
          if (!result.ok) {
            process.exit(printError(result.error));
          }
          process.stdout.write(`${pc.green('✓')} ${taskKey} attached to ${sprintKey}\n`);
        });
      });

    group
      .command('remove <sprintKey> <taskKey>')
      .description('Remove a task from its sprint')
      .action(async (sprintKey: string, taskKey: string) => {
        await withMutatingCliContext(({ container }) => {
          const result = container.sprint.removeTask({
            sprintKey,
            taskKey,
            actor: container.identity.getDefaultActor(),
          });
          if (!result.ok) {
            process.exit(printError(result.error));
          }
          process.stdout.write(`${pc.green('✓')} ${taskKey} removed from sprint\n`);
        });
      });

    group
      .command('coverage <key>')
      .description('Report how many of the sprint tasks are in a terminal state')
      .action(async (key: string) => {
        await withCliContext(({ container }) => {
          const result = container.coverage.forSprint(key);
          if (!result.ok) {
            process.exit(printError(result.error));
          }
          process.stdout.write(`${formatCoverage(`Sprint ${key}`, result.value)}\n`);
        });
      });
  }
}

function renderSprint(
  result: { ok: true; value: Sprint } | { ok: false; error: MnemaError },
  verb: string,
): void {
  if (!result.ok) {
    process.exit(printError(result.error));
  }
  process.stdout.write(
    `${pc.green('✓')} sprint ${pc.bold(result.value.key)} ${verb} ${pc.dim(`[${result.value.state}]`)}\n`,
  );
}

function formatSprintRow(sprint: Sprint): string {
  return `${pc.bold(sprint.key.padEnd(22))} ${sprint.state.padEnd(8)} ${sprint.name}`;
}

function formatSprintView(sprint: Sprint, tasks: readonly Task[]): string {
  const lines: string[] = [];
  lines.push(`${pc.bold('Sprint:')} ${sprint.key}`);
  lines.push(`${pc.bold('Name:')} ${sprint.name}`);
  if (sprint.goal !== null) lines.push(`${pc.bold('Goal:')} ${sprint.goal}`);
  lines.push(`${pc.bold('State:')} ${sprint.state}`);
  if (sprint.startsAt !== null) lines.push(`${pc.bold('Starts:')} ${sprint.startsAt}`);
  if (sprint.endsAt !== null) lines.push(`${pc.bold('Ends:')} ${sprint.endsAt}`);
  if (sprint.capacity !== null) lines.push(`${pc.bold('Capacity:')} ${sprint.capacity}`);
  lines.push('');
  lines.push(`${pc.bold(`Tasks (${tasks.length}):`)}`);
  if (tasks.length === 0) {
    lines.push(`  ${pc.dim('(no tasks attached)')}`);
  } else {
    for (const task of tasks) {
      lines.push(`  ${pc.bold(task.key.padEnd(12))} ${task.state.padEnd(13)} ${task.title}`);
    }
  }
  return lines.join('\n');
}
