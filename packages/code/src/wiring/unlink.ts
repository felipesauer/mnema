/**
 * The `mnema unlink` wiring: what it declares, and what it prints.
 *
 * `mnema unlink <subject> <target> --rel <label> --reason "<why>"` — take a link back. The edge is
 * named exactly as `mnema link` takes it; the reason is a required flag, since a retraction that
 * cannot say why is not recorded. It follows the link to the tree it was recorded in, so it takes
 * no `--scope`.
 */

import type { Command } from 'commander';
import { RECORD_CONTRACT_HELP } from '../recorded-content.js';
import { here } from './context.js';
import { noSuchRecord } from './no-such-record.js';
import { onOneLine } from './on-one-line.js';
import { declaredAgent } from './options.js';
import { reportRecorded, reportRefusal } from './report.js';
import { PIN_REFUSED } from './run-pin.js';
import { type Declared, mutatesTheRecord, type Wiring } from './verb.js';

/**
 * The `--which` help of this verb: the shared one points at `--scope` for where the fact lands,
 * and a link's retraction has none — it lands where the link is.
 */
const WHICH_ON_AN_UNLINK =
  'the agent that executed this, when an agent (a script, a CI step) is driving ' +
  'mnema — omit it when you are acting directly. It names the executor only: a ' +
  'retraction follows the link to the tree it was recorded in. A value that names no ' +
  'agent (an unset variable) is refused, never credited to you.';

/** Registers `mnema unlink` on the program. */
export function registerUnlink(program: Command, wiring: Wiring): Declared {
  const { io, pinnedRun } = wiring;
  const unlink = program
    .command('unlink')
    .description(
      'take a link back, keeping it in the record (only the identity that recorded it; follows the link)',
    )
    .argument('<subject>', 'the entity the link originates from')
    .argument('<target>', 'what the link points at, as it was linked')
    .requiredOption('--rel <label>', 'the relation, as it was linked')
    .requiredOption('--reason <text>', 'why it is taken back')
    .option('--which <agent>', WHICH_ON_AN_UNLINK, declaredAgent)
    .addHelpText('after', RECORD_CONTRACT_HELP)
    .action(
      async (
        subject: string,
        target: string,
        opts: { rel: string; reason: string; which?: string },
      ) => {
        const { runUnlink } = await import('../commands/unlink.js');
        const run = pinnedRun();
        if (run === PIN_REFUSED) {
          io.fail();
          return;
        }
        const result = runUnlink(here(), {
          subject,
          target,
          rel: opts.rel,
          reason: opts.reason,
          ...(opts.which !== undefined ? { which: opts.which } : {}),
          ...(run !== undefined ? { run } : {}),
        });
        if (result.ok) {
          // Three of the caller's values, so each goes through the collapse (see `onOneLine`).
          io.out(onOneLine`Retracted link ${result.subject} —${result.rel}→ ${result.target}`);
          reportRecorded(result, io);
          return;
        }
        reportRefusal(wiring, result, {
          UNKNOWN_LINK: noSuchRecord('link', `${subject} —${opts.rel}→ ${target}`),
        });
      },
    );
  return mutatesTheRecord(unlink);
}
