import type { Command } from 'commander';

import { withCliContext } from '../cli-context.js';
import { formatHistory, type HistoryFormat } from '../formatters/history-formatter.js';
import type { TimestampMode } from '../formatters/timestamp-formatter.js';

interface HistoryOptions {
  readonly since?: string;
  readonly until?: string;
  readonly actor?: string;
  readonly via?: string;
  readonly run?: string;
  readonly kind?: string;
  readonly limit?: string;
  readonly table?: boolean;
  readonly json?: boolean;
  readonly iso?: boolean;
}

/**
 * Registers `mnema history`, a static view over the audit log.
 *
 * Filters mirror `audit query`'s shape but the output is geared
 * towards human reading: events are formatted compactly and consecutive
 * task_created events from the same run are collapsed to one line.
 */
export class HistoryCommand {
  /**
   * Attaches the `history` subcommand to the root program.
   *
   * @param program - Root Commander program
   */
  register(program: Command): void {
    program
      .command('history')
      .description('Show past activity from the audit log (formatted for humans)')
      .option('--since <when>', 'Lower bound — `today`, `1h`, `24h`, `7d` or ISO8601')
      .option('--until <when>', 'Upper bound — same syntax as --since')
      .option('--actor <handle>', 'Filter by actor handle')
      .option('--via <handle>', 'Filter by agent (via) handle')
      .option('--run <runId>', 'Filter by agent run id')
      .option('--kind <kind>', 'Filter by event kind (e.g. task_transitioned)')
      .option('--limit <n>', 'Limit the number of results')
      .option('--table', 'Render as an aligned table', false)
      .option('--json', 'Render as JSONL (one event per line)', false)
      .option('--iso', 'Show timestamps as ISO8601 instead of relative', false)
      .action(async (options: HistoryOptions) => {
        await withCliContext(({ container }) => {
          const since = normaliseSince(options.since);
          const events = container.auditQuery.run({
            kind: options.kind,
            actor: options.actor,
            via: options.via,
            run: options.run,
            since,
            until: options.until,
            limit: options.limit !== undefined ? Number(options.limit) : undefined,
          });

          const format = pickFormat(options);
          const mode: TimestampMode = options.iso === true ? 'iso' : 'relative';
          process.stdout.write(`${formatHistory(events, format, mode)}\n`);
        });
      });
  }
}

function pickFormat(options: HistoryOptions): HistoryFormat {
  if (options.json === true) return 'json';
  if (options.table === true) return 'table';
  return 'human';
}

/**
 * Translates friendly tokens like `today` / `yesterday` into a value
 * `AuditQuery` understands. Other strings are forwarded as-is.
 */
function normaliseSince(value: string | undefined): string | Date | undefined {
  if (value === undefined) return undefined;
  if (value === 'today') {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return start;
  }
  if (value === 'yesterday') {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - 1);
    return start;
  }
  return value;
}
