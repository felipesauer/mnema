/**
 * The `mnema why` wiring: what it declares, and what it prints.
 *
 * `mnema why <file|commit> [--json]` — for a file, the rules in force that address it and the
 * commits with a decision trailer that touched it; for a commit, the decisions its trailers cite
 * and the rules in force on what it changed. Read when asked, never written down.
 */

import type { Command } from 'commander';
import { here } from './context.js';
import { writeLines } from './io.js';
import { reportRefusal } from './report.js';
import { type Declared, readsTheRecord, type Wiring } from './verb.js';

/** Registers `mnema why`. */
export function registerWhy(program: Command, wiring: Wiring): Declared {
  const { io, render } = wiring;
  const why = program
    .command('why')
    .description('show under which decisions a file or a commit stands')
    .argument('<file|commit>', 'a path (it wins when it exists) or a commit name')
    .option('--json', 'emit the faithful reading as JSON')
    .action(async (target: string, opts: { json?: boolean }) => {
      const { linkBreakNotice } = await import('./integrity.js');
      const { runWhy } = await import('../commands/why.js');
      const { whyReport } = await import('../presentation/git-bridge.js');
      const result = runWhy(here(), { target });
      if (!result.ok) {
        reportRefusal(wiring, result, {});
        return;
      }
      for (const line of linkBreakNotice(result.linkBreaks)) io.err(render(line));
      if (opts.json === true) {
        const { linkBreaks: _breaks, ok: _ok, ...reading } = result;
        io.out(JSON.stringify(reading, null, 2));
        return;
      }
      writeLines(io, whyReport(render, result));
    });
  return readsTheRecord(why);
}
