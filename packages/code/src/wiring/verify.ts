/**
 * The `mnema verify` wiring: what it declares, and what it prints.
 *
 * The one verdict the CLI does not word itself. What `runVerify` returns is a
 * summary of what could and could not be proven, and it goes out VERBATIM — the
 * surface never re-words a guarantee, because a re-wording is where "local
 * integrity" quietly becomes "verified". The issues under it are the evidence, and
 * a broken chain is a non-zero exit.
 */

import type { Command } from 'commander';
import { runVerify } from '../commands/verify.js';
import { fact } from '../presentation/detail.js';
import { here } from './context.js';
import { reportRefusal } from './report.js';
import type { Wiring } from './verb.js';

/** Registers `mnema verify` on the program. */
export function registerVerify(program: Command, wiring: Wiring): void {
  const { io } = wiring;
  program
    .command('verify')
    .description("verify the current project's chain")
    .action(() => {
      const result = runVerify(here());
      if (!result.ok) {
        reportRefusal(io, { reason: 'NO_PROJECT' });
        return;
      }
      // Print the verdict's own honest summary verbatim — the CLI never upgrades
      // the guarantee. A broken chain is a non-zero exit.
      io.out(result.result.summary);
      if (!result.result.ok) {
        for (const issue of result.result.issues) {
          io.err(fact(`issue [${issue.layer}] ${issue.tail}#${issue.seq}: ${issue.detail}`));
        }
        io.fail();
      }
    });
}
