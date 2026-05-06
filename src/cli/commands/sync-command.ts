import type { Command } from 'commander';
import pc from 'picocolors';

import { withCliContext } from '../cli-context.js';

/**
 * Registers `mnema sync`, which rebuilds the SQLite cache from the
 * markdowns under `backlog/<STATE>/<KEY>.md`.
 */
export class SyncCommand {
  /**
   * Attaches the `sync` subcommand to the root program.
   *
   * @param program - Root Commander program
   */
  register(program: Command): void {
    program
      .command('sync')
      .description('Rebuild the SQLite cache from markdown files (idempotent)')
      .action(async () => {
        await withCliContext(({ config, container }) => {
          const summary = container.syncRebuild.run(config.project.key);
          process.stdout.write(
            `${pc.green('✓')} sync complete  scanned=${summary.tasksScanned}  upserted=${summary.tasksUpserted}\n`,
          );
          for (const skipped of summary.skipped) {
            process.stderr.write(`${pc.yellow('!')} skipped ${skipped.file}: ${skipped.reason}\n`);
          }
        });
      });
  }
}
