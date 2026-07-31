/**
 * The `mnema link` wiring: what it declares, and what it prints.
 *
 * `mnema link <subject> <target> --rel <label>` — link one entity to another.
 * subject and target are positionals (short ids); the relation is a flag. The
 * relation is an OPEN string — the recommended set (supersedes, relates-to,
 * derived-from, contradicts) is documentation, not enforcement, so no enum. It
 * mints no id (a link is an edge), so the report echoes the fact. Neither
 * reference is validated — a link is legitimately cross-tree.
 */

import type { Command } from 'commander';
import { runLink } from '../commands/link.js';
import { RECORD_CONTRACT_HELP } from '../recorded-content.js';
import { here } from './context.js';
import { declaredAgent, INVALID, parseScope, WHICH_HELP } from './options.js';
import { reportRefusal, reportReplacement } from './report.js';
import { PIN_REFUSED } from './run-pin.js';
import type { Wiring } from './verb.js';

/** Registers `mnema link` on the program. */
export function registerLink(program: Command, wiring: Wiring): void {
  const { io, pinnedRun } = wiring;
  program
    .command('link')
    .description('link one piece of knowledge to another in the current project')
    .argument('<subject>', 'the entity that originates the link')
    .argument('<target>', 'the entity linked to')
    .requiredOption(
      '--rel <label>',
      'the relation (recommended: supersedes, relates-to, derived-from, contradicts; ' +
        'any label is accepted)',
    )
    .option(
      '--scope <scope>',
      'where the link is born: public (team-visible), private (this machine), ' +
        'or global (personal, cross-project). Defaults to public.',
    )
    .option('--which <agent>', WHICH_HELP, declaredAgent)
    .addHelpText('after', RECORD_CONTRACT_HELP)
    .action(
      (subject: string, target: string, opts: { rel: string; scope?: string; which?: string }) => {
        const scope = parseScope(opts.scope, io);
        if (scope === INVALID) {
          io.fail();
          return;
        }
        const run = pinnedRun();
        if (run === PIN_REFUSED) {
          io.fail();
          return;
        }
        const result = runLink(here(), {
          subject,
          target,
          rel: opts.rel,
          ...(scope !== undefined ? { scope } : {}),
          ...(opts.which !== undefined ? { which: opts.which } : {}),
          ...(run !== undefined ? { run } : {}),
        });
        if (result.ok) {
          // No id to report — a link is an edge, not an entity. Echo the fact.
          io.out(`Linked ${result.subject} —${result.rel}→ ${result.target}`);
          reportReplacement(result, io);
          return;
        }
        reportRefusal(io, result);
      },
    );
}
