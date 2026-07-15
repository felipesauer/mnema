import type { Command } from 'commander';

import { withCliContext } from '../cli-context.js';
import { printArchiveResult } from './doctor-command.js';

/**
 * Registers `mnema archive`, the opt-in "move old finished task mirrors out of
 * the way" command.
 *
 * DONE and CANCELED are live states with live SQLite rows, so their `.md`
 * mirrors are never deleted (deletion is gated on the row being gone) and a
 * committed backlog accrues every finished task forever. This command MOVES —
 * never deletes — the mirrors of terminal tasks older than
 * `archive.terminal_after_months` into `backlog/.archive/<STATE>/`, out of the
 * active state folders. The dot-prefixed archive folder is inert to every
 * backlog scanner, so the moved file survives a later `mnema sync` and the
 * SQLite row (the source of truth) is never touched.
 *
 * Dry-run by default (like `mnema upgrade`): it prints the plan and changes
 * nothing until `--yes`. The identical logic is also reachable via
 * `mnema doctor --archive-terminal`.
 */
export class ArchiveCommand {
  /**
   * Attaches the `archive` subcommand to the root program.
   *
   * @param program - Root Commander program
   */
  register(program: Command): void {
    program
      .command('archive')
      .description(
        'Move mirrors of DONE/CANCELED tasks older than `archive.terminal_after_months` ' +
          'out of the active state folders into backlog/.archive/ (never deletes, keeps the ' +
          'SQLite row). Shows the plan and changes nothing unless `--yes` is given.',
      )
      .option('--yes', 'Skip the dry run and actually move the mirrors', false)
      .action(async (options: { readonly yes?: boolean }) => {
        await withCliContext(({ container, config }) => {
          const result = container.archive.archiveTerminalMirrors({
            months: config.archive.terminal_after_months,
            dryRun: options.yes !== true,
          });
          printArchiveResult(result, config.archive.terminal_after_months);
        });
      });
  }
}
