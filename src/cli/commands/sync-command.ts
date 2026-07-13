import type { Command } from 'commander';
import { pc } from '../../utils/colors.js';

import { withMutatingCliContext } from '../cli-context.js';

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
        await withMutatingCliContext(({ config, container }) => {
          const summary = container.syncRebuild.run(config.project.key);
          process.stdout.write(
            `${pc.green('✓')} sync complete  ` +
              `tasks=${summary.tasksScanned}/${summary.tasksUpserted}  ` +
              `epics=${summary.epics.scanned}/${summary.epics.upserted}  ` +
              `sprints=${summary.sprints.scanned}/${summary.sprints.upserted}  ` +
              `decisions=${summary.decisions.scanned}/${summary.decisions.upserted}  ` +
              `memories=${summary.memories.scanned}/${summary.memories.upserted}  ` +
              `skills=${summary.skills.scanned}/${summary.skills.upserted}  ` +
              `${pc.dim('(scanned/upserted)')}\n`,
          );
          for (const skipped of summary.skipped) {
            process.stderr.write(`${pc.yellow('!')} skipped ${skipped.file}: ${skipped.reason}\n`);
          }
          for (const conflict of summary.conflicts) {
            process.stderr.write(
              `${pc.red('✗')} ${conflict.key} mirrored in ${conflict.states.length} state dirs ` +
                `(${conflict.states.join(', ')}) — state left unchanged. ` +
                `Run ${pc.bold('mnema doctor')} to resolve the duplicate.\n`,
            );
          }
        });
      });
  }
}
