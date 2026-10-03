/**
 * The `mnema aging` wiring: what it declares, and what it prints.
 *
 * `mnema aging [--min-commits <n>] [--json]` — accepted decisions whose addressed paths changed in
 * at least n commits since the acceptance. It POINTS, never CONCLUDES: the page counts commits and
 * says nothing of the decision. Read when asked, never written down.
 */

import type { Command } from 'commander';
import { here } from './context.js';
import { writeLines } from './io.js';
import { reportRefusal, reportUsage } from './report.js';
import { type Declared, readsTheRecord, type Wiring } from './verb.js';

/** Registers `mnema aging`. */
export function registerAging(program: Command, wiring: Wiring): Declared {
  const { io, render } = wiring;
  const aging = program
    .command('aging')
    .description('show accepted decisions whose addressed paths changed in many commits since')
    .option('--min-commits <n>', 'commits on its paths since acceptance to be listed (default 20)')
    .option('--json', 'emit the faithful reading as JSON')
    .action(async (opts: { minCommits?: string; json?: boolean }) => {
      const { linkBreakNotice } = await import('./integrity.js');
      const { runAging, DEFAULT_MIN_COMMITS } = await import('../commands/aging.js');
      const { agingReport } = await import('../presentation/git-bridge.js');
      const asked = opts.minCommits === undefined ? DEFAULT_MIN_COMMITS : Number(opts.minCommits);
      if (!Number.isInteger(asked) || asked < 1) {
        reportUsage(wiring, `Not a number of commits: ${opts.minCommits}`);
        return;
      }
      const result = runAging(here(), { minCommits: asked });
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
      writeLines(io, agingReport(render, result));
    });
  return readsTheRecord(aging);
}
