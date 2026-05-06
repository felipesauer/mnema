import type { Command } from 'commander';
import pc from 'picocolors';

import type { Task } from '../../domain/entities/task.js';
import { withCliContext } from '../cli-context.js';

interface InboxOptions {
  readonly json?: boolean;
}

/**
 * Registers `mnema inbox`, the human attention queue.
 *
 * Lists tasks waiting on review and tasks currently blocked. Decisions
 * pending review will join the inbox in Phase 7 once `DecisionService`
 * is implemented.
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
      .action(async (options: InboxOptions) => {
        await withCliContext(({ container }) => {
          const view = container.inbox.view();

          if (options.json === true) {
            process.stdout.write(`${JSON.stringify(view, null, 2)}\n`);
            return;
          }

          const sections: string[] = [];
          sections.push(formatSection('Awaiting review', view.awaitingReview, pc.yellow('⚠')));
          sections.push(formatSection('Blocked', view.blocked, pc.red('⚠')));

          const empty = view.awaitingReview.length === 0 && view.blocked.length === 0;
          if (empty) {
            process.stdout.write(`${pc.dim('Inbox is empty — nothing waiting on you.')}\n`);
            return;
          }
          process.stdout.write(`${sections.filter((s) => s.length > 0).join('\n\n')}\n`);
        });
      });
  }
}

function formatSection(label: string, tasks: readonly Task[], badge: string): string {
  if (tasks.length === 0) return '';
  const lines: string[] = [];
  lines.push(`${badge} ${pc.bold(label)} (${tasks.length})`);
  for (const task of tasks) {
    const since = humanAge(task.updatedAt);
    lines.push(`  ${pc.bold(task.key.padEnd(12))} ${task.title.padEnd(40)} ${pc.dim(since)}`);
  }
  return lines.join('\n');
}

function humanAge(iso: string): string {
  const ageMs = Date.now() - Date.parse(iso);
  if (Number.isNaN(ageMs) || ageMs < 0) return iso;
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
