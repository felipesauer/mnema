import type { Command } from 'commander';

import { pc } from '../../utils/colors.js';
import { withCliContext } from '../cli-context.js';
import { writeAgentsMd } from '../templates/agents-md.js';

/**
 * Registers `mnema agents`, the command group for the generated
 * `AGENTS.md` operating manual.
 *
 * `agents sync` regenerates the Mnema-managed block from the current
 * package version — the recovery path after `npm i -g @felipesauer/mnema`
 * brings new guidance that an existing project's `AGENTS.md` predates.
 * Only the block between the `MNEMA:START` / `MNEMA:END` markers is
 * rewritten; everything the user wrote around it is preserved.
 */
export class AgentsCommand {
  /**
   * Attaches the `agents` command group to the root program.
   *
   * @param program - Root Commander program
   */
  register(program: Command): void {
    const group = program.command('agents').description('Manage the generated AGENTS.md manual');

    group
      .command('sync')
      .description('Regenerate the Mnema-managed block of AGENTS.md (preserves your own content)')
      .action(async () => {
        await withCliContext(({ config, projectRoot }) => {
          const outcome = writeAgentsMd(projectRoot, config);
          const message =
            outcome === 'created'
              ? 'AGENTS.md created'
              : outcome === 'appended'
                ? 'AGENTS.md managed block appended (no markers were present)'
                : 'AGENTS.md managed block updated';
          process.stdout.write(`${pc.green('✓')} ${message}\n`);
        });
      });
  }
}
