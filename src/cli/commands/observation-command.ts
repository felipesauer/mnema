import type { Command } from 'commander';
import { pc } from '../../utils/colors.js';

import { withCliContext } from '../cli-context.js';

interface ListOptions {
  readonly topic?: string;
  readonly task?: string;
  readonly since?: string;
  readonly limit?: string;
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
    const group = program.command('observation').description('Read agent-recorded observations');

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
