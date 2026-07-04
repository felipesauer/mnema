import type { Command } from 'commander';

import { pc } from '../../utils/colors.js';
import { checkForUpdate, fetchLatestVersion } from '../../utils/version-check.js';

/**
 * Registers `mnema update`, whose `check` subcommand queries the npm
 * registry for a newer published version (ADR-40).
 *
 * This is an EXPLICIT, on-demand network action: it runs regardless of the
 * `features.update_check` config flag (which only governs the automatic
 * check inside `mnema doctor`). The offline / zero-telemetry default is
 * preserved — the user asked, so the one outbound request is expected. It
 * never transmits usage data (a single GET for the published version) and is
 * fail-open: an offline machine gets a clear "could not check" line, not an
 * error.
 */
export class UpdateCommand {
  /**
   * Attaches the `update` command group to the root program.
   *
   * @param program - Root Commander program
   */
  register(program: Command): void {
    const group = program.command('update').description('Check for a newer published mnema');

    group
      .command('check')
      .description('Query npm for a newer mnema version (explicit, on-demand network request)')
      .action(async () => {
        const result = checkForUpdate(await fetchLatestVersion());
        if (result.latest === null) {
          process.stdout.write(`${pc.dim(result.message)}\n`);
          return;
        }
        const mark = result.updateAvailable ? pc.yellow('⬆') : pc.green('✔');
        process.stdout.write(`${mark}  ${result.message}\n`);
      });
  }
}
