/**
 * The `mnema retract` wiring: what it declares, and what it prints.
 *
 * `mnema retract <id> --reason "<why>"` — take a memory or an observation back. The id is a
 * positional, the reason a required flag: a retraction that cannot say why is not recorded.
 * It follows the note to the tree it was written in, so it takes no `--scope`.
 */

import type { Command } from 'commander';
import { RECORD_CONTRACT_HELP } from '../recorded-content.js';
import { here } from './context.js';
import { noSuchRecord } from './no-such-record.js';
import { declaredAgent, WHICH_HELP } from './options.js';
import { reportRecorded, reportRefusal } from './report.js';
import { PIN_REFUSED } from './run-pin.js';
import { type Declared, mutatesTheRecord, type Wiring } from './verb.js';

/** Registers `mnema retract` on the program. */
export function registerRetract(program: Command, wiring: Wiring): Declared {
  const { io, pinnedRun } = wiring;
  const retract = program
    .command('retract')
    .description(
      'take a memory or an observation back, keeping it in the record (follows the note; takes no --scope)',
    )
    .argument('<id>', 'the id of the memory or observation to retract')
    .requiredOption('--reason <text>', 'why it is taken back')
    .option('--which <agent>', WHICH_HELP, declaredAgent)
    .addHelpText('after', RECORD_CONTRACT_HELP)
    .action(async (id: string, opts: { reason: string; which?: string }) => {
      const { runRetract } = await import('../commands/retract.js');
      const run = pinnedRun();
      if (run === PIN_REFUSED) {
        io.fail();
        return;
      }
      const result = runRetract(here(), {
        id,
        reason: opts.reason,
        ...(opts.which !== undefined ? { which: opts.which } : {}),
        ...(run !== undefined ? { run } : {}),
      });
      if (result.ok) {
        io.out(`Retracted ${result.note} ${result.id}`);
        reportRecorded(result, io);
        return;
      }
      reportRefusal(wiring, result, { UNKNOWN_NOTE: noSuchRecord('record', id) });
    });
  return mutatesTheRecord(retract);
}
