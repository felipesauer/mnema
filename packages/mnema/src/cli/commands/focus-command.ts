import { pc } from '@mnema/core/utils/colors.js';
import type { Command } from 'commander';
import { withCliContext } from '../cli-context.js';

interface FocusOptions {
  readonly json?: boolean;
  readonly actor?: string;
}

/**
 * Registers `mnema focus`, a one-line re-pull of the current focus.
 *
 * `context_bootstrap` gives direction once; over a long session that
 * drifts. This is the cheap re-pull — the task in progress to resume, or
 * the next one to start. Meant to be wired into a periodic or pre-edit
 * reminder by a client that wants the rail always present.
 */
export class FocusCommand {
  /**
   * Attaches the `focus` subcommand to the root program.
   *
   * @param program - Root Commander program
   */
  register(program: Command): void {
    program
      .command('focus')
      .description('Print a one-line focus: the task to resume, or the next to start')
      .option('--json', 'Print the focus as JSON', false)
      .option('--actor <handle>', 'Scope in-progress work to this actor (defaults to identity)')
      .action(async (options: FocusOptions) => {
        await withCliContext(({ container }) => {
          const focus = container.focus.current(options.actor);
          if (options.json === true) {
            process.stdout.write(`${JSON.stringify(focus, null, 2)}\n`);
            return;
          }
          const badge =
            focus.focus === 'resume'
              ? pc.yellow('▶')
              : focus.focus === 'start'
                ? pc.cyan('○')
                : pc.dim('·');
          process.stdout.write(`${badge} ${focus.line}\n`);
        });
      });
  }
}
