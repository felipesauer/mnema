import type { Command } from 'commander';
import pc from 'picocolors';

import { IdentityService } from '../../services/identity-service.js';

interface SetOptions {
  readonly display?: string;
}

/**
 * Registers `mnema identity`, the user-scoped command group for
 * managing the local default actor stored in
 * `~/.config/mnema/identity.json`.
 *
 * Subcommands:
 * - `set <handle> [--display "Name"]` writes the default
 * - `whoami` shows the active actor and where it comes from
 * - `unset` removes the default
 *
 * The group is project-agnostic by design: it operates on per-user
 * config and never opens the project SQLite database.
 */
export class IdentityCommand {
  /**
   * Attaches the `identity` command group to the root program.
   *
   * @param program - Root Commander program
   */
  register(program: Command): void {
    const group = program.command('identity').description('Manage your default actor handle');

    group
      .command('set <handle>')
      .description('Persist <handle> as the default actor in ~/.config/mnema/identity.json')
      .option('--display <name>', 'Optional human-readable display name')
      .action((handle: string, options: SetOptions) => {
        const service = makeIdentityService();
        try {
          service.setDefaultActor(handle, options.display);
        } catch (error) {
          process.stderr.write(`${pc.red('error:')} ${(error as Error).message}\n`);
          process.exit(2);
        }
        const resolved = service.resolveDefaultActor();
        const envWarning =
          resolved.source === 'env'
            ? `\n${pc.yellow('note:')} MNEMA_ACTOR=${process.env.MNEMA_ACTOR} is set in your environment and overrides the config file.`
            : '';
        process.stdout.write(
          `${pc.green('✓')} default actor set to ${pc.bold(handle)} ${pc.dim(`(${resolved.configPath})`)}${envWarning}\n`,
        );
      });

    group
      .command('whoami')
      .description('Show the active actor handle and where it came from')
      .action(() => {
        const service = makeIdentityService();
        const resolved = service.resolveDefaultActor();
        if (resolved.actor === null) {
          process.stdout.write(
            `${pc.dim('(no identity configured)')}\n${pc.dim('hint:')} run \`mnema identity set <handle>\` or export MNEMA_ACTOR\n`,
          );
          process.exit(0);
        }

        const sourceLabel =
          resolved.source === 'env' ? `MNEMA_ACTOR env var` : `${resolved.configPath}`;
        process.stdout.write(`${pc.bold(resolved.actor)} ${pc.dim(`(from ${sourceLabel})`)}\n`);
      });

    group
      .command('unset')
      .description('Remove the default actor from ~/.config/mnema/identity.json')
      .action(() => {
        const service = makeIdentityService();
        service.unsetDefaultActor();
        process.stdout.write(`${pc.green('✓')} default actor cleared\n`);
      });
  }
}

/**
 * Builds an IdentityService configured for filesystem-only operations.
 * The ActorRepository dependency is unused by the methods this command
 * group exercises (`set`, `whoami`, `unset`), so we pass a stub that
 * throws if anything reaches into it — making accidental misuse loud.
 */
function makeIdentityService(): IdentityService {
  const stub = {
    upsert: () => {
      throw new Error('identity command must not touch the actor repository');
    },
    findById: () => {
      throw new Error('identity command must not touch the actor repository');
    },
  };
  return new IdentityService(stub as never);
}
