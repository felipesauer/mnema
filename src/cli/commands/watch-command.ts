import path from 'node:path';

import type { Command } from 'commander';
import { parseTimeBound } from '../../services/audit-query.js';
import { AuditTail } from '../../services/audit-tail.js';
import { withCliContext } from '../cli-context.js';
import { formatEvent, type HistoryFormat } from '../formatters/history-formatter.js';
import type { TimestampMode } from '../formatters/timestamp-formatter.js';

interface WatchOptions {
  readonly kind?: string;
  readonly actor?: string;
  readonly via?: string;
  readonly run?: string;
  readonly catchup?: string;
  readonly table?: boolean;
  readonly json?: boolean;
  readonly iso?: boolean;
}

/**
 * Registers `mnema watch`, the live tail of the audit log.
 *
 * Stateless by design — every invocation re-watches from the current
 * end of file, except when `--catchup=<duration>` is provided, in
 * which case the tail first replays matching events from the last N
 * minutes/hours/days before going live.
 *
 * Exits cleanly on SIGINT (Ctrl+C); the tail's filesystem watcher is
 * detached so the next invocation starts fresh.
 */
export class WatchCommand {
  /**
   * Attaches the `watch` subcommand to the root program.
   *
   * @param program - Root Commander program
   */
  register(program: Command): void {
    program
      .command('watch')
      .description('Live tail of the audit log (Ctrl+C to stop)')
      .option('--kind <kind>', 'Filter by event kind')
      .option('--actor <handle>', 'Filter by actor handle')
      .option('--via <handle>', 'Filter by agent (via) handle')
      .option('--run <runId>', 'Filter by agent run id')
      .option('--catchup <duration>', 'Replay matching events from N units ago first (e.g. 5m)')
      .option('--table', 'Render as an aligned table', false)
      .option('--json', 'Render as JSONL (one event per line)', false)
      .option('--iso', 'Show timestamps as ISO8601 instead of relative', false)
      .action(async (options: WatchOptions) => {
        await withCliContext(async ({ config, projectRoot }) => {
          const auditDir = path.join(projectRoot, config.paths.audit);
          const format = pickFormat(options);
          const mode: TimestampMode = options.iso === true ? 'iso' : 'relative';

          const tail = new AuditTail(
            auditDir,
            (event) => {
              process.stdout.write(`${formatEvent(event, format, mode)}\n`);
            },
            {
              kind: options.kind,
              actor: options.actor,
              via: options.via,
              run: options.run,
            },
          );

          if (options.catchup !== undefined) {
            const sinceMs = parseTimeBound(options.catchup);
            if (sinceMs !== null) {
              await tail.replaySince(new Date(sinceMs));
            }
          }

          await tail.start();

          await new Promise<void>((resolve) => {
            const close = (): void => {
              tail.stop();
              resolve();
            };
            process.on('SIGINT', close);
            process.on('SIGTERM', close);
          });
        });
      });
  }
}

function pickFormat(options: WatchOptions): HistoryFormat {
  if (options.json === true) return 'json';
  if (options.table === true) return 'table';
  return 'human';
}
