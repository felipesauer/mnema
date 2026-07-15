import type { Command } from 'commander';

import type { Config } from '../../config/config-schema.js';
import { renderHookCommand } from '../../services/integrity/domain-event-dispatcher.js';
import { fingerprintHooks, hasAnyHook } from '../../services/integrity/hook-trust.js';
import { pc } from '../../utils/colors.js';
import { withCliContext } from '../cli-context.js';

/** The event names that actually carry at least one hook. */
function hookEventNames(hooks: Config['hooks']): string[] {
  return Object.entries(hooks)
    .filter(([, list]) => list.length > 0)
    .map(([event]) => event);
}

/**
 * Registers `mnema hooks`, the human-in-the-loop gate for domain-event
 * hooks. Because the project `mnema.config.json` is inside the repo and
 * writable by agents, a configured hooks block is inert until a human
 * approves *these exact hooks* here. Any later edit to the block changes
 * its fingerprint and revokes the approval automatically.
 *
 * Subcommands:
 * - `show` prints the configured hooks, their fingerprint, and whether
 *   they are currently approved.
 * - `approve` records the current hooks block as trusted to execute.
 */
export class HooksCommand {
  register(program: Command): void {
    const group = program
      .command('hooks')
      .description('Review and approve domain-event hooks (approve / show)');

    group
      .command('show')
      .description('Show configured hooks, their fingerprint, and approval status')
      .action(async () => {
        await withCliContext(({ config, container }) => {
          const { hooks } = config;
          if (!hasAnyHook(hooks)) {
            console.log(pc.dim('No hooks configured.'));
            return;
          }
          const trusted = container.hookTrust.isTrusted(hooks);
          for (const [event, list] of Object.entries(hooks)) {
            if (list.length === 0) continue;
            console.log(pc.bold(event));
            for (const hook of list) {
              console.log(`  ${renderHookCommand(hook)}`);
            }
          }
          console.log('');
          console.log(`fingerprint: ${pc.dim(fingerprintHooks(hooks))}`);
          console.log(
            trusted
              ? pc.green('status: approved — hooks will run')
              : pc.yellow('status: NOT approved — hooks are inert until `mnema hooks approve`'),
          );
        });
      });

    group
      .command('approve')
      .description('Approve the current hooks block so it is trusted to execute')
      .action(async () => {
        await withCliContext(({ config, container }) => {
          const { hooks } = config;
          if (!hasAnyHook(hooks)) {
            console.log(pc.dim('No hooks configured — nothing to approve.'));
            return;
          }
          if (container.hookTrust.isTrusted(hooks)) {
            console.log(pc.green('Hooks already approved — no change.'));
            return;
          }
          const fingerprint = container.hookTrust.approve(hooks);
          // Record the approval on the audit chain so a later unapproved
          // edit is not just inert but visibly un-attested in the history.
          container.audit.write({
            kind: 'hooks_approved',
            actor: container.identity.getDefaultActor(),
            data: { fingerprint, events: hookEventNames(hooks) },
          });
          console.log(pc.green('Hooks approved.'));
          console.log(`fingerprint: ${pc.dim(fingerprint)}`);
          console.log(
            pc.dim('Editing the hooks block later revokes this approval until you re-approve.'),
          );
        });
      });
  }
}
