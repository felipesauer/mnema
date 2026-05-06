import type { Command } from 'commander';
import pc from 'picocolors';

import { withCliContext } from '../cli-context.js';

interface QueryOptions {
  readonly kind?: string;
  readonly actor?: string;
  readonly via?: string;
  readonly run?: string;
  readonly since?: string;
  readonly until?: string;
  readonly limit?: string;
  readonly json?: boolean;
}

/**
 * Registers `mnema audit query` for ad-hoc inspection of the audit log.
 */
export class AuditCommand {
  /**
   * Attaches the `audit` command group to the root program.
   *
   * @param program - Root Commander program
   */
  register(program: Command): void {
    const group = program.command('audit').description('Inspect the audit log');

    group
      .command('query')
      .description('Query the audit log with optional filters')
      .option('--kind <kind>', 'Filter by event kind (e.g. task_transitioned)')
      .option('--actor <handle>', 'Filter by actor handle')
      .option('--via <handle>', 'Filter by agent (via) handle')
      .option('--run <runId>', 'Filter by agent run id')
      .option('--since <duration>', 'Lower bound — `30s`, `2h`, `7d` or ISO8601')
      .option('--until <duration>', 'Upper bound — same syntax as --since')
      .option('--limit <n>', 'Limit the number of results')
      .option('--json', 'Print events as raw JSONL', false)
      .action(async (options: QueryOptions) => {
        await withCliContext(({ container }) => {
          const events = container.auditQuery.run({
            kind: options.kind,
            actor: options.actor,
            via: options.via,
            run: options.run,
            since: options.since,
            until: options.until,
            limit: options.limit !== undefined ? Number(options.limit) : undefined,
          });

          if (options.json === true) {
            for (const event of events) {
              process.stdout.write(`${JSON.stringify(event)}\n`);
            }
            return;
          }

          if (events.length === 0) {
            process.stdout.write(`${pc.dim('(no matching events)')}\n`);
            return;
          }

          for (const event of events) {
            const subject =
              event.via !== undefined
                ? `${event.actor} ${pc.dim('via')} ${event.via}`
                : event.actor;
            const data = JSON.stringify(event.data);
            process.stdout.write(
              `${pc.dim(event.at)}  ${pc.cyan(event.kind)}  ${subject}  ${pc.dim(data)}\n`,
            );
          }
        });
      });
  }
}
