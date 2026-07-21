import type { Decision } from '@mnema/core/domain/entities/decision.js';
import type { Task } from '@mnema/core/domain/entities/task.js';
import { deriveAlias } from '@mnema/core/domain/entity-alias.js';
import type { SlaBreach, WipBreach } from '@mnema/core/services/backlog/inbox-service.js';
import { pc } from '@mnema/core/utils/colors.js';
import type { Command } from 'commander';
import { withCliContext } from '../cli-context.js';
import { formatTimestamp, type TimestampMode } from '../formatters/timestamp-formatter.js';

interface InboxOptions {
  readonly json?: boolean;
  readonly iso?: boolean;
}

/**
 * Registers `mnema inbox`, the human attention queue.
 *
 * Lists tasks waiting on review, tasks currently blocked, and decisions
 * still in `proposed` status (waiting on accept/reject).
 */
export class InboxCommand {
  /**
   * Attaches the `inbox` subcommand to the root program.
   *
   * @param program - Root Commander program
   */
  register(program: Command): void {
    program
      .command('inbox')
      .description('Show tasks that need human attention (review, blocked)')
      .option('--json', 'Print the inbox as JSON', false)
      .option('--iso', 'Show timestamps as ISO8601 instead of relative', false)
      .action(async (options: InboxOptions) => {
        await withCliContext(({ container }) => {
          const view = container.inbox.view();

          if (options.json === true) {
            process.stdout.write(`${JSON.stringify(view, null, 2)}\n`);
            return;
          }

          const mode: TimestampMode = options.iso === true ? 'iso' : 'relative';
          const sections: string[] = [];
          // SLA breaches lead: they are the overdue cut, not just "waiting".
          sections.push(formatBreaches(view.slaBreaches));
          // WIP breaches are a state-level overflow signal, distinct from per-task SLA.
          sections.push(formatWipBreaches(view.wipBreaches));
          sections.push(
            formatSection('Awaiting review', view.awaitingReview, pc.yellow('⚠'), mode),
          );
          sections.push(formatSection('Blocked', view.blocked, pc.red('⚠'), mode));
          sections.push(formatDecisionSection(view.pendingDecisions, mode));

          const empty =
            view.awaitingReview.length === 0 &&
            view.blocked.length === 0 &&
            view.pendingDecisions.length === 0 &&
            view.slaBreaches.length === 0 &&
            view.wipBreaches.length === 0;
          if (empty) {
            process.stdout.write(`${pc.dim('Inbox is empty — nothing waiting on you.')}\n`);
            return;
          }
          process.stdout.write(`${sections.filter((s) => s.length > 0).join('\n\n')}\n`);
        });
      });
  }
}

function formatSection(
  label: string,
  tasks: readonly Task[],
  badge: string,
  mode: TimestampMode,
): string {
  if (tasks.length === 0) return '';
  const lines: string[] = [];
  lines.push(`${badge} ${pc.bold(label)} (${tasks.length})`);
  for (const task of tasks) {
    const since = formatTimestamp(task.updatedAt, mode);
    lines.push(
      `  ${pc.bold(deriveAlias('task', task.id).padEnd(12))} ${task.title.padEnd(40)} ${pc.dim(since)}`,
    );
  }
  return lines.join('\n');
}

function formatBreaches(breaches: readonly SlaBreach[]): string {
  if (breaches.length === 0) return '';
  const lines: string[] = [];
  lines.push(`${pc.red('▲')} ${pc.bold('SLA breached')} (${breaches.length})`);
  for (const b of breaches) {
    const over = `${b.age_days}d in ${b.state}, SLA ${b.sla_days}d`;
    lines.push(`  ${pc.bold(b.key.padEnd(12))} ${b.title.padEnd(40)} ${pc.red(over)}`);
  }
  return lines.join('\n');
}

function formatWipBreaches(breaches: readonly WipBreach[]): string {
  if (breaches.length === 0) return '';
  const lines: string[] = [];
  lines.push(`${pc.yellow('▲')} ${pc.bold('WIP limit exceeded')} (${breaches.length})`);
  for (const b of breaches) {
    lines.push(
      `  ${pc.bold(b.state.padEnd(14))} ${pc.yellow(`${b.count}/${b.limit}`)} ${pc.dim(b.keys.join(', '))}`,
    );
  }
  return lines.join('\n');
}

function formatDecisionSection(decisions: readonly Decision[], mode: TimestampMode): string {
  if (decisions.length === 0) return '';
  const lines: string[] = [];
  lines.push(`${pc.cyan('●')} ${pc.bold('Pending decisions')} (${decisions.length})`);
  for (const decision of decisions) {
    lines.push(
      `  ${pc.bold(decision.key.padEnd(16))} ${decision.title.padEnd(40)} ${pc.dim(formatTimestamp(decision.at, mode))}`,
    );
  }
  return lines.join('\n');
}
