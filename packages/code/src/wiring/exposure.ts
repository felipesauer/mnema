/**
 * The `mnema exposure` wiring: what it declares, and what it prints.
 *
 * `mnema exposure [--json]` — which records hold something shaped like a
 * credential. The fourth intelligence read, and the only one about the record's
 * PAST: everything written before the content door existed was written with no
 * defense, and in a committed tree that past is what decides the damage.
 *
 * It prints WHERE and never WHAT — id, kind, tree, instant, class — in the human
 * summary and in `--json` alike. Printing the value would move the credential
 * into a CI log or a scrollback, which is to say it would make the report the
 * second disclosure. The read cannot do it: what it returns holds no value.
 */

import type { Command } from 'commander';
import { exposureReport } from '../presentation/exposure.js';
import { here } from './context.js';
import { writeLines } from './io.js';
import { reportRefusal } from './report.js';
import type { Wiring } from './verb.js';

/** Registers `mnema exposure` on the program. */
export function registerExposure(program: Command, wiring: Wiring): void {
  const { io, render } = wiring;
  program
    .command('exposure')
    .description('show which records hold something shaped like a credential (never the value)')
    .option('--json', 'emit the faithful report as JSON (still without any value)')
    .action(async (opts: { json?: boolean }) => {
      const { runExposure } = await import('../commands/exposure.js');
      const result = runExposure(here());
      if (!result.ok) {
        reportRefusal(wiring, result);
        return;
      }
      if (opts.json === true) {
        io.out(JSON.stringify(result.report, null, 2));
        return;
      }
      writeLines(io, exposureReport(render, result.report));
    });
}
