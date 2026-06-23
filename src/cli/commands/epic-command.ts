import type { Command } from 'commander';
import type { Epic } from '../../domain/entities/epic.js';
import { EpicState } from '../../domain/enums/epic-state.js';
import { printError } from '../../errors/error-printer.js';
import type { MnemaError } from '../../errors/mnema-error.js';
import { pc } from '../../utils/colors.js';
import { withCliContext, withMutatingCliContext } from '../cli-context.js';
import { formatCoverage } from '../formatters/coverage-formatter.js';

interface CreateOptions {
  readonly title: string;
  readonly description?: string;
}

interface ListOptions {
  readonly state?: string;
}

/**
 * Registers the `mnema epic` command group.
 *
 * Subcommands:
 * - `epic create --title=...`           → create an OPEN epic
 * - `epic show <key>`                   → render the epic + its task keys
 * - `epic list [--state=OPEN|CLOSED]`   → list epics
 * - `epic close <key>`                  → close an OPEN epic
 * - `epic add <epicKey> <taskKey>`      → attach a task to an epic
 * - `epic remove <epicKey> <taskKey>`   → detach a task from an epic
 */
export class EpicCommand {
  /**
   * Attaches the `epic` command group to the root program.
   *
   * @param program - Root Commander program
   */
  register(program: Command): void {
    const group = program.command('epic').alias('epics').description('Manage epics');

    group
      .command('create')
      .description('Create a new epic in OPEN state')
      .requiredOption('--title <title>', 'Epic title')
      .option('--description <text>', 'Epic description')
      .action(async (options: CreateOptions) => {
        await withMutatingCliContext(({ container, config }) => {
          const result = container.epic.create({
            projectKey: config.project.key,
            title: options.title,
            description: options.description,
            actor: container.identity.getDefaultActor(),
          });
          renderEpic(result, 'created');
        });
      });

    group
      .command('show <key>')
      .description('Show an epic together with the keys of its tasks')
      .action(async (key: string) => {
        await withCliContext(({ container }) => {
          const result = container.epic.show(key);
          if (!result.ok) {
            process.exit(printError(result.error));
          }
          process.stdout.write(`${formatEpicView(result.value.epic, result.value.taskKeys)}\n`);
        });
      });

    group
      .command('list')
      .description('List epics of the current project')
      .option('--state <state>', 'Filter by state (OPEN/CLOSED)')
      .action(async (options: ListOptions) => {
        await withCliContext(({ container, config }) => {
          const state = parseState(options.state);
          const epics = container.epic.list(config.project.key, state);
          if (epics.length === 0) {
            process.stdout.write(`${pc.dim('(no epics yet)')}\n`);
            return;
          }
          process.stdout.write(`${epics.map(formatEpicRow).join('\n')}\n`);
        });
      });

    group
      .command('close <key>')
      .description('Close an OPEN epic')
      .action(async (key: string) => {
        await withMutatingCliContext(({ container }) => {
          const result = container.epic.close({
            epicKey: key,
            actor: container.identity.getDefaultActor(),
          });
          renderEpic(result, 'closed');
        });
      });

    group
      .command('add <epicKey> <taskKey>')
      .description('Attach a task to an epic')
      .action(async (epicKey: string, taskKey: string) => {
        await withMutatingCliContext(({ container }) => {
          const result = container.epic.addTask({
            epicKey,
            taskKey,
            actor: container.identity.getDefaultActor(),
          });
          if (!result.ok) {
            process.exit(printError(result.error));
          }
          process.stdout.write(`${pc.green('✓')} ${taskKey} attached to ${epicKey}\n`);
        });
      });

    group
      .command('remove <epicKey> <taskKey>')
      .description('Remove a task from its epic')
      .action(async (epicKey: string, taskKey: string) => {
        await withMutatingCliContext(({ container }) => {
          const result = container.epic.removeTask({
            epicKey,
            taskKey,
            actor: container.identity.getDefaultActor(),
          });
          if (!result.ok) {
            process.exit(printError(result.error));
          }
          process.stdout.write(`${pc.green('✓')} ${taskKey} removed from epic\n`);
        });
      });

    group
      .command('coverage <key>')
      .description('Report how many of the epic tasks are in a terminal state')
      .action(async (key: string) => {
        await withCliContext(({ container }) => {
          const result = container.coverage.forEpic(key);
          if (!result.ok) {
            process.exit(printError(result.error));
          }
          process.stdout.write(`${formatCoverage(`Epic ${key}`, result.value)}\n`);
        });
      });
  }
}

function parseState(raw: string | undefined): EpicState | undefined {
  if (raw === undefined) return undefined;
  const values = Object.values(EpicState) as string[];
  if (!values.includes(raw)) {
    process.stderr.write(`${pc.red('error:')} unknown state \`${raw}\`\n`);
    process.exit(2);
  }
  return raw as EpicState;
}

function renderEpic(
  result: { ok: true; value: Epic } | { ok: false; error: MnemaError },
  verb: string,
): void {
  if (!result.ok) {
    process.exit(printError(result.error));
  }
  process.stdout.write(
    `${pc.green('✓')} epic ${pc.bold(result.value.key)} ${verb} ${pc.dim(`[${result.value.state}]`)}\n`,
  );
}

function formatEpicRow(epic: Epic): string {
  return `${pc.bold(epic.key.padEnd(20))} ${epic.state.padEnd(8)} ${epic.title}`;
}

function formatEpicView(epic: Epic, taskKeys: readonly string[]): string {
  const lines: string[] = [];
  lines.push(`${pc.bold('Epic:')} ${epic.key}`);
  lines.push(`${pc.bold('Title:')} ${epic.title}`);
  lines.push(`${pc.bold('State:')} ${epic.state}`);
  if (epic.description !== null) {
    lines.push('');
    lines.push(epic.description);
  }
  lines.push('');
  lines.push(`${pc.bold(`Tasks (${taskKeys.length}):`)}`);
  if (taskKeys.length === 0) {
    lines.push(`  ${pc.dim('(no tasks attached)')}`);
  } else {
    for (const key of taskKeys) {
      lines.push(`  ${pc.bold(key)}`);
    }
  }
  return lines.join('\n');
}
