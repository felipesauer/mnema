import type { Command } from 'commander';

import { pc } from '../../utils/colors.js';
import { withCliContext } from '../cli-context.js';

/**
 * Registers the `mnema commands` group: list and show the versioned slash
 * commands defined under `.mnema/commands/`. Read-only — it surfaces the
 * definitions; it does not run the steps. Parity with the `commands_list`
 * / `command_show` MCP tools.
 */
export class CommandsCommand {
  /**
   * Attaches the `commands` group to the root program.
   *
   * @param program - Root Commander program
   */
  register(program: Command): void {
    const group = program.command('commands').description('Versioned slash commands');

    group
      .command('list')
      .description('List versioned commands defined under .mnema/commands/')
      .action(async () => {
        await withCliContext(({ container }) => {
          const { commands, skipped } = container.commandDefinition.list();
          if (commands.length === 0 && skipped.length === 0) {
            process.stdout.write(`${pc.dim('no commands defined in .mnema/commands/')}\n`);
            return;
          }
          for (const c of commands) {
            process.stdout.write(
              `${pc.bold(c.name)}  ${pc.dim(`(${c.steps.length} step(s))`)}\n  ${c.description}\n`,
            );
          }
          for (const s of skipped) {
            process.stdout.write(`${pc.yellow('skipped:')} ${pc.dim(s.file)} — ${s.reason}\n`);
          }
        });
      });

    group
      .command('show <name>')
      .description('Show a versioned command and its ordered steps')
      .action(async (name: string) => {
        await withCliContext(({ container }) => {
          const command = container.commandDefinition.show(name);
          if (command === null) {
            process.stdout.write(`${pc.dim(`no command named ${name}`)}\n`);
            return;
          }
          process.stdout.write(`${pc.bold(command.name)} — ${pc.dim(command.description)}\n`);
          command.steps.forEach((step, i) => {
            process.stdout.write(`  ${pc.cyan(`${i + 1}.`)} mnema ${step}\n`);
          });
          if (command.body.length > 0) {
            process.stdout.write(`\n${command.body}\n`);
          }
        });
      });
  }
}
