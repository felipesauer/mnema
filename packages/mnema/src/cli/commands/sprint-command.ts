import type { Sprint } from '@mnema/core/domain/entities/sprint.js';
import type { SprintMetric } from '@mnema/core/domain/entities/sprint-metric.js';
import type { Task } from '@mnema/core/domain/entities/task.js';
import { deriveAlias } from '@mnema/core/domain/entity-alias.js';
import { printError } from '@mnema/core/errors/error-printer.js';
import type { MnemaError } from '@mnema/core/errors/mnema-error.js';
import { pc } from '@mnema/core/utils/colors.js';
import type { Command } from 'commander';
import { withCliContext, withMutatingCliContext } from '../cli-context.js';
import { formatCoverage } from '../formatters/coverage-formatter.js';
import { parseFiniteNumber, parseNonNegativeInt } from '../option-parsers.js';

interface PlanOptions {
  readonly name: string;
  readonly goal?: string;
  readonly startsAt?: string;
  readonly endsAt?: string;
  readonly capacity?: number;
}

interface MetricOptions {
  readonly name: string;
  readonly target: number;
  readonly baseline?: number;
  readonly unit?: string;
  readonly due?: string;
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
      .option('--capacity <points>', 'Capacity in story points', parseNonNegativeInt)
      .action(async (options: PlanOptions) => {
        await withMutatingCliContext(({ container, config }) => {
          const result = container.sprint.plan({
            projectKey: config.project.key,
            name: options.name,
            goal: options.goal,
            startsAt: options.startsAt,
            endsAt: options.endsAt,
            capacity: options.capacity,
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
      .command('cancel <key>')
      .description('Cancel a planned or active sprint (retire without completing)')
      .requiredOption('--reason <text>', 'Why the sprint is being retired')
      .option(
        '--expected-updated-at <iso>',
        "Optimistic-concurrency token: must equal the sprint's current `updatedAt` or the transition is rejected with CONFLICT",
      )
      .action(
        async (
          key: string,
          options: { readonly reason: string; readonly expectedUpdatedAt?: string },
        ) => {
          await withMutatingCliContext(({ container }) => {
            const result = container.sprint.cancel({
              sprintKey: key,
              reason: options.reason,
              actor: container.identity.getDefaultActor(),
              expectedUpdatedAt: options.expectedUpdatedAt,
            });
            renderSprint(result, 'canceled');
          });
        },
      );

    group
      .command('show <key>')
      .description('Show a sprint together with its tasks')
      .action(async (key: string) => {
        await withCliContext(({ container }) => {
          const result = container.sprint.show(key);
          if (!result.ok) {
            process.exit(printError(result.error));
          }
          const view = result.value;
          process.stdout.write(`${formatSprintView(view.sprint, view.tasks, view.metrics)}\n`);
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
      .command('add-tasks <sprintKey> <taskKeys...>')
      .description('Attach several tasks to a sprint (best-effort; reports per-task failures)')
      .action(async (sprintKey: string, taskKeys: string[]) => {
        await withMutatingCliContext(({ container }) => {
          let added = 0;
          let failed = 0;
          for (const taskKey of taskKeys) {
            const result = container.sprint.addTask({
              sprintKey,
              taskKey,
              actor: container.identity.getDefaultActor(),
            });
            if (result.ok) {
              added += 1;
              process.stdout.write(`${pc.green('✓')} ${taskKey} attached to ${sprintKey}\n`);
            } else {
              failed += 1;
              process.stderr.write(`${pc.yellow('!')} ${taskKey}: ${result.error.kind}\n`);
            }
          }
          process.stdout.write(`${pc.dim(`${added} attached, ${failed} failed`)}\n`);
          if (failed > 0) process.exitCode = 1;
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

    group
      .command('metric <key>')
      .description(
        'Add a measurable metric to a sprint (name + target, optional baseline/unit/due)',
      )
      .requiredOption('--name <name>', 'Metric name, e.g. "p95 latency"')
      .requiredOption('--target <n>', 'Target value to reach', parseFiniteNumber)
      .option('--baseline <n>', 'Starting value', parseFiniteNumber)
      .option('--unit <unit>', 'Unit, e.g. ms, %, count')
      .option('--due <iso>', 'Due date (ISO8601)')
      .action(async (key: string, options: MetricOptions) => {
        await withMutatingCliContext(({ container }) => {
          const result = container.sprint.addMetric({
            sprintKey: key,
            name: options.name,
            target: options.target,
            baseline: options.baseline ?? null,
            unit: options.unit ?? null,
            dueDate: options.due ?? null,
            actor: container.identity.getDefaultActor(),
          });
          if (!result.ok) {
            process.exit(printError(result.error));
          }
          process.stdout.write(
            `${pc.green('✓')} metric "${result.value.name}" added to ${key} ${pc.dim(`(target ${result.value.target}${result.value.unit !== null ? ` ${result.value.unit}` : ''})`)}\n`,
          );
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
    `${pc.green('✓')} sprint ${pc.bold(deriveAlias('sprint', result.value.id))} ${verb} ${pc.dim(`[${result.value.state}]`)}\n`,
  );
}

function formatSprintRow(sprint: Sprint): string {
  return `${pc.bold(deriveAlias('sprint', sprint.id).padEnd(22))} ${sprint.state.padEnd(8)} ${sprint.name}`;
}

function formatSprintView(
  sprint: Sprint,
  tasks: readonly Task[],
  metrics: readonly SprintMetric[],
): string {
  const lines: string[] = [];
  lines.push(`${pc.bold('Sprint:')} ${deriveAlias('sprint', sprint.id)}`);
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
      lines.push(
        `  ${pc.bold(deriveAlias('task', task.id).padEnd(12))} ${task.state.padEnd(13)} ${task.title}`,
      );
    }
  }
  if (metrics.length > 0) {
    lines.push('');
    lines.push(`${pc.bold(`Metrics (${metrics.length}):`)}`);
    for (const m of metrics) {
      const unit = m.unit !== null ? ` ${m.unit}` : '';
      const baseline = m.baseline !== null ? `${m.baseline}${unit} → ` : '';
      const due = m.dueDate !== null ? pc.dim(` by ${m.dueDate}`) : '';
      lines.push(`  ${pc.bold(m.name)}: ${baseline}${m.target}${unit}${due}`);
    }
  }
  return lines.join('\n');
}
