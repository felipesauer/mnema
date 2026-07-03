import type { Command } from 'commander';
import { printError } from '../../errors/error-printer.js';
import { pc } from '../../utils/colors.js';

import { withCliContext, withMutatingCliContext } from '../cli-context.js';
import { collectRepeatable } from '../option-helpers.js';

interface ListOptions {
  readonly topic?: string;
  readonly task?: string;
  readonly since?: string;
  readonly limit?: string;
}

interface RecordOptions {
  readonly topic?: readonly string[];
  readonly task?: string;
}

/**
 * Registers `mnema observation`, the CLI front for the append-only
 * observation log that agents write to via `observation_record`.
 *
 * Subcommands:
 * - `observation list` — newest first, filterable by topic, task or time
 */
export class ObservationCommand {
  /**
   * Attaches the `observation` command group to the root program.
   *
   * @param program - Root Commander program
   */
  register(program: Command): void {
    const group = program.command('observation').description('Record and read observations');

    group
      .command('record <content>')
      .description('Record an observation (a note-to-future-self, newest-first log)')
      .option('--topic <topic>', 'Topic tag (repeatable)', collectRepeatable, [])
      .option('--task <key>', 'Relate to a task by key')
      .action(async (content: string, options: RecordOptions) => {
        await withMutatingCliContext(({ container }) => {
          const result = container.observation.record({
            content,
            topics: options.topic,
            relatedTaskKey: options.task,
            actor: container.identity.getDefaultActor(),
            via: 'cli',
          });
          if (!result.ok) {
            process.exit(printError(result.error));
          }
          const o = result.value;
          const topics = o.topics.length > 0 ? ` [${o.topics.join(', ')}]` : '';
          process.stdout.write(`${pc.green('✓')} observation recorded${pc.dim(topics)}\n`);
        });
      });

    group
      .command('list')
      .description('List observations, newest first')
      .option('--topic <topic>', 'Filter by topic')
      .option('--task <key>', 'Filter by related task key')
      .option('--since <iso>', 'Lower bound ISO 8601 timestamp')
      .option('--limit <n>', 'Maximum number of rows')
      .action(async (options: ListOptions) => {
        await withCliContext(({ container }) => {
          const limit = options.limit !== undefined ? Number(options.limit) : undefined;
          const observations = container.observation.list({
            topic: options.topic,
            relatedTaskKey: options.task,
            since: options.since,
            limit: limit !== undefined && Number.isFinite(limit) && limit > 0 ? limit : undefined,
          });
          if (observations.length === 0) {
            process.stdout.write(`${pc.dim('no observations recorded yet')}\n`);
            return;
          }
          for (const o of observations) {
            const topics = o.topics.length > 0 ? `[${o.topics.join(', ')}]` : '';
            process.stdout.write(`${pc.dim(o.at)} ${topics}\n  ${o.content}\n`);
          }
        });
      });
  }
}
