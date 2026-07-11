import path from 'node:path';

import type { Command } from 'commander';
import { parseTimeBound } from '../../services/audit-query.js';
import { AuditTail } from '../../services/audit-tail.js';
import { pc } from '../../utils/colors.js';
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
  readonly git?: boolean;
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
      .option(
        '--git',
        'Also observe git (MNEMA-ADR-49): read-only, link the unambiguous in-progress task to the current branch + commits. Off by default; never writes .git.',
        false,
      )
      .action(async (options: WatchOptions) => {
        await withCliContext(async ({ config, projectRoot, container }) => {
          const auditDir = path.join(projectRoot, config.paths.audit);
          const format = pickFormat(options);
          const mode: TimestampMode = options.iso === true ? 'iso' : 'relative';
          const display = (handle: string): string => container.identity.getDisplayFor(handle);

          // Opt-in git observer. Runs once on start and after each audit
          // event (the moments the link could change — a task started, a
          // commit noted). Read-only and idempotent, so re-running is cheap;
          // fail-open, so a git hiccup never disturbs the tail.
          const gitEnabled = options.git === true || config.git?.watch === true;
          const observeGit = (): void => {
            if (!gitEnabled) return;
            // Fail-open, as the docstring promises: this runs inside the audit
            // handler, so an uncaught throw (a SQLite write error, a corrupt
            // git_commits column in rowToTask) would surface as an unhandled
            // rejection and could tear down the tail. Swallow it — a git hiccup
            // must never disturb the live tail.
            try {
              const actor = container.identity.resolveDefaultActor().actor;
              if (actor === null) return;
              const result = container.gitObserver.observe(projectRoot, actor);
              if (result.linkedTaskKey !== null) {
                // Persist the branch/pr to the task markdown ONLY when the link
                // actually changed, so it survives a fresh clone (ADR-49)
                // without churning the file on every idle observer pass.
                if (result.changed) {
                  container.sync.syncTask(result.linkedTaskKey, { action: 'git_observed' });
                }
                process.stdout.write(
                  `${pc.dim(`  git: linked ${result.linkedTaskKey} → this branch`)}\n`,
                );
              }
            } catch {
              // Intentionally silent: the observer is best-effort metadata.
            }
          };
          observeGit();

          const tail = new AuditTail(
            auditDir,
            (event) => {
              process.stdout.write(`${formatEvent(event, format, mode, display)}\n`);
              observeGit();
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
