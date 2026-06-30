import { type Command, Option } from 'commander';
import type { DependencyKind } from '../../domain/entities/dependency.js';
import type { Task } from '../../domain/entities/task.js';
import { EVIDENCE_KINDS, type EvidenceKind } from '../../domain/entities/task-evidence.js';
import type { TaskState } from '../../domain/enums/task-state.js';
import { ErrorCode } from '../../errors/error-codes.js';
import { printError } from '../../errors/error-printer.js';
import type { MnemaError } from '../../errors/mnema-error.js';
import { pc } from '../../utils/colors.js';
import { withCliContext, withMutatingCliContext } from '../cli-context.js';
import { formatHistory, type HistoryFormat } from '../formatters/history-formatter.js';
import { formatTaskBlock, formatTaskList } from '../formatters/task-formatter.js';
import type { TimestampMode } from '../formatters/timestamp-formatter.js';
import { parseIntInRange, parseNonNegativeInt, parsePositiveInt } from '../option-parsers.js';

interface CreateOptions {
  readonly title: string;
  readonly description?: string;
  readonly acceptance?: string[];
  // estimate/contextBudget/priority are pre-parsed to numbers by the option
  // argParsers (parseNonNegativeInt / parseIntInRange), so bad input is
  // rejected at parse time and never reaches the action as a string.
  readonly estimate?: number;
  readonly contextBudget?: number;
  readonly priority?: number;
  readonly assignee?: string;
  readonly label?: string[];
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
  readonly limit?: number;
}

interface DependsOptions {
  readonly kind?: string;
}

interface ReadyOptions {
  readonly sprint?: string;
}

interface EvidenceOptions {
  readonly criterion?: number;
  readonly kind?: string;
  readonly ref?: string;
  readonly note?: string;
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
      .option('--estimate <points>', 'Estimate in story points', parseNonNegativeInt)
      .option(
        '--context-budget <tokens>',
        'Estimated context cost in tokens (distinct from estimate)',
        parseNonNegativeInt,
      )
      .option('--priority <n>', 'Priority 1..5 (default 3)', parseIntInRange(1, 5))
      .option('--assignee <handle>', 'Assignee handle')
      .option('--label <label...>', 'Transversal label, e.g. area:api (repeat for multiple)')
      .action(async (options: CreateOptions) => {
        await withMutatingCliContext(({ container, config }) => {
          const result = container.task.create({
            projectKey: config.project.key,
            title: options.title,
            description: options.description,
            acceptanceCriteria: options.acceptance ?? [],
            estimate: options.estimate ?? null,
            contextBudget: options.contextBudget ?? null,
            priority: options.priority ?? 3,
            assigneeId: options.assignee ?? null,
            actor: container.identity.getDefaultActor(),
          });
          if (result.ok && options.label !== undefined && options.label.length > 0) {
            const labelled = container.label.setLabels({
              taskKey: result.value.key,
              labels: options.label,
              actor: container.identity.getDefaultActor(),
            });
            if (!labelled.ok) {
              process.exit(printError(labelled.error));
            }
          }
          renderTaskResult(result, (id) => container.identity.resolveHandle(id));
        });
      });

    group
      .command('assign')
      .description('Assign a task to an actor, or clear it with --clear')
      .argument('<key>', 'Task key, e.g. WEBAPP-42')
      .option('--to <handle>', 'Assignee handle (or UUID)')
      .option('--clear', 'Remove the current assignee')
      .action(async (key: string, options: { to?: string; clear?: boolean }) => {
        await withMutatingCliContext(({ container }) => {
          const result = container.task.assign({
            taskKey: key,
            assignee: options.clear === true ? null : (options.to ?? null),
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
        'Move a task via a workflow action. Pass payload either as ' +
          '`field=value` positionals (shell-quoted) or as repeated ' +
          '`--field name=value` flags — the latter handles values with ' +
          'spaces cleanly, since the shell delivers the whole token ' +
          'after `--field` intact. Values with a comma are split into ' +
          'arrays (`--field acceptance_criteria="A,B,C"`); single-item ' +
          'arrays need either a trailing comma or the field repeated. ' +
          'Only fields the action gate requires are validated; extras ' +
          'ride along to the audit log so payloads stay forward- ' +
          'compatible with MCP.',
      )
      .option(
        '-f, --field <pair...>',
        'Field assignment in `name=value` form. Repeat for multiple ' +
          'fields; whitespace inside `value` is preserved (unlike the ' +
          'positional form, which the shell tokenises before we see it).',
      )
      .action(
        async (
          key: string,
          action: string,
          fields: string[],
          options: { readonly field?: string[] },
        ) => {
          await withMutatingCliContext(({ container }) => {
            // The flag form is the safe one — `--field "title=foo bar"`
            // arrives as a single token. Merge it with the positional
            // form (`field=value`) so callers can mix the two; the
            // positional path is kept for backward compatibility with
            // scripts written before the `--field` flag existed.
            const payload = parseFieldArgs([...fields, ...(options.field ?? [])]);
            const result = container.task.transition({
              taskKey: key,
              action,
              payload,
              actor: container.identity.getDefaultActor(),
            });
            renderTaskResult(result, (id) => container.identity.resolveHandle(id));
          });
        },
      );

    group
      .command('history <key>')
      .description('Show the chronological audit trail of a single task')
      .option('--json', 'Render as JSONL (one event per line)', false)
      .option('--iso', 'Show timestamps as ISO8601 instead of relative', false)
      .option('--limit <n>', 'Limit the number of events returned', parsePositiveInt)
      .action(async (key: string, options: HistoryOptions) => {
        await withCliContext(({ container }) => {
          const lookup = container.task.findByKey(key);
          if (!lookup.ok) {
            process.exit(printError(lookup.error));
          }

          const events = container.auditQuery.run({
            taskKey: lookup.value.key,
            limit: options.limit,
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

    group
      .command('depends <key> <blocksKey>')
      .description('Declare that <key> is blocked by <blocksKey> (or another relationship kind)')
      .option('--kind <kind>', 'blocks | relates_to | duplicates | parent_of', 'blocks')
      .action(async (key: string, blocksKey: string, options: DependsOptions) => {
        await withMutatingCliContext(({ container }) => {
          const result = container.dependency.link({
            taskKey: key,
            blocksTaskKey: blocksKey,
            kind: options.kind as DependencyKind | undefined,
            actor: container.identity.getDefaultActor(),
          });
          if (!result.ok) {
            process.exit(printError(result.error));
          }
          process.stdout.write(
            `${pc.green('✓')} ${key} ${pc.dim(`depends on (${result.value.kind})`)} ${blocksKey}\n`,
          );
        });
      });

    group
      .command('ready')
      .description('List tasks ready to pick up (pickable state, all blockers terminal)')
      .option('--sprint <key>', 'Scope to a single sprint')
      .action(async (options: ReadyOptions) => {
        await withCliContext(({ container }) => {
          const result = container.dependency.ready(options.sprint);
          if (!result.ok) {
            process.exit(printError(result.error));
          }
          process.stdout.write(`${formatTaskList(result.value)}\n`);
        });
      });

    group
      .command('label <key> [labels...]')
      .description('Set the transversal labels on a task (replaces all; omit labels to clear)')
      .action(async (key: string, labels: string[]) => {
        await withMutatingCliContext(({ container }) => {
          const result = container.label.setLabels({
            taskKey: key,
            labels,
            actor: container.identity.getDefaultActor(),
          });
          if (!result.ok) {
            process.exit(printError(result.error));
          }
          const shown = result.value.length > 0 ? result.value.join(', ') : pc.dim('(no labels)');
          process.stdout.write(`${pc.green('✓')} ${key} ${pc.dim('labels:')} ${shown}\n`);
        });
      });

    group
      .command('labels')
      .description('List the label catalogue with the number of active tasks carrying each')
      .action(async () => {
        await withCliContext(({ container }) => {
          const counts = container.label.counts();
          if (counts.length === 0) {
            process.stdout.write(`${pc.dim('No labels yet.')}\n`);
            return;
          }
          for (const { name, count } of counts) {
            process.stdout.write(`  ${pc.bold(String(count).padStart(4))}  ${name}\n`);
          }
        });
      });

    group
      .command('evidence <key>')
      .description(
        'List a task acceptance criteria with their evidence, or attach evidence with --ref',
      )
      .option(
        '--criterion <i>',
        '0-based criterion index (required to attach)',
        parseNonNegativeInt,
      )
      .addOption(
        new Option('--kind <kind>', 'Evidence kind').choices([...EVIDENCE_KINDS]).default('other'),
      )
      .option('--ref <ref>', 'The path / route / commit / url to attach as evidence')
      .option('--note <text>', 'Optional note for the evidence')
      .action(async (key: string, options: EvidenceOptions) => {
        if (options.ref !== undefined) {
          await withMutatingCliContext(({ container }) => {
            const result = container.taskEvidence.attach({
              taskKey: key,
              criterionIndex: options.criterion ?? -1,
              kind: options.kind as EvidenceKind | undefined,
              ref: options.ref ?? '',
              note: options.note ?? null,
              actor: container.identity.getDefaultActor(),
            });
            if (!result.ok) {
              process.exit(printError(result.error));
            }
            process.stdout.write(
              `${pc.green('✓')} evidence attached to ${key} criterion ${result.value.criterionIndex} ${pc.dim(`(${result.value.kind})`)}\n`,
            );
          });
          return;
        }
        await withCliContext(({ container }) => {
          const result = container.taskEvidence.forTask(key);
          if (!result.ok) {
            process.exit(printError(result.error));
            return;
          }
          for (const c of result.value.criteria) {
            const mark = c.evidence.length > 0 ? pc.green('✓') : pc.yellow('○');
            process.stdout.write(`${mark} [${c.index}] ${c.criterion}\n`);
            for (const e of c.evidence) {
              process.stdout.write(`    ${pc.dim(`${e.kind}:`)} ${e.ref}\n`);
            }
          }
          if (result.value.orphaned.length > 0) {
            process.stdout.write(
              `${pc.yellow('!')} ${result.value.orphaned.length} orphaned evidence row(s) ${pc.dim('(criteria changed after attach)')}\n`,
            );
            for (const e of result.value.orphaned) {
              process.stdout.write(`    ${pc.dim(`[${e.criterionIndex}] ${e.kind}:`)} ${e.ref}\n`);
            }
          }
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
