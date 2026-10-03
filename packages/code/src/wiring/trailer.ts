/**
 * The `mnema trailer` wiring: what it declares, and what it prints.
 *
 * `mnema trailer <decision> [--id] [--json]` prints the commit trailer that ties a commit to a
 * decision — `Mnema-Decision: ADR-4` — and nothing else, so `$(mnema trailer ADR-4)` IS the line.
 * It writes no commit and records nothing; `commits`, `why` and `aging` read the trailers back out
 * of the git log when asked. A read: no `--actor`, `NO_PROJECT` outside a project.
 */

import type { Command } from 'commander';
import { here } from './context.js';
import { nameRefusals } from './no-such-decision.js';
import { reportRefusal } from './report.js';
import { type Declared, readsTheRecord, type Wiring } from './verb.js';

/** Registers `mnema trailer`. */
export function registerTrailer(program: Command, wiring: Wiring): Declared {
  const { io, render } = wiring;
  const trailer = program
    .command('trailer')
    .description('print the commit trailer that ties a commit to a decision')
    .argument('<decision>', 'the decision, by id or by ADR label')
    .option('--id', 'carry the id instead of the label')
    .option('--json', 'emit the line as JSON')
    .action(async (decision: string, opts: { id?: boolean; json?: boolean }) => {
      const { linkBreakNotice } = await import('./integrity.js');
      const { runTrailer } = await import('../commands/trailer.js');
      const result = runTrailer(here(), { decision, byId: opts.id === true });
      if (!result.ok) {
        reportRefusal(wiring, result, result.reason === 'NO_PROJECT' ? {} : nameRefusals(result));
        return;
      }
      for (const line of linkBreakNotice(result.linkBreaks)) io.err(render(line));
      if (opts.json === true) {
        io.out(JSON.stringify({ line: result.line }, null, 2));
        return;
      }
      // The line and nothing else, so `$(mnema trailer ADR-4)` is the trailer.
      io.out(result.line);
    });
  return readsTheRecord(trailer);
}
