/**
 * The `mnema resume` wiring: what it declares, and what it prints.
 *
 * `mnema resume --actor <id> [--json]` — where the actor left off: their latest
 * run (open OR ended), plus their current focus.
 */

import type { Command } from 'commander';
import { runResume } from '../commands/resume.js';
import { fact } from '../presentation/detail.js';
import { NO_RUNS_HINT, runAgeSuffix } from '../presentation/runs.js';
import { here } from './context.js';
import { writeLines } from './io.js';
import { reportRefusal } from './report.js';
import type { Wiring } from './verb.js';

/** Registers `mnema resume` on the program. */
export function registerResume(program: Command, wiring: Wiring): void {
  const { io } = wiring;
  program
    .command('resume')
    .description('show where an actor left off (their latest run, open or ended)')
    .requiredOption('--actor <id>', 'the anchor id whose last run to show (from `mnema verify`)')
    .option('--json', 'emit the faithful resume object as JSON')
    .action((opts: { actor: string; json?: boolean }) => {
      const result = runResume(here(), { actor: opts.actor });
      if (!result.ok) {
        reportRefusal(io, { reason: 'NO_PROJECT' });
        return;
      }
      if (opts.json === true) {
        io.out(JSON.stringify(result.resume, null, 2));
        return;
      }
      const { lastRun, focus } = result.resume;
      if (lastRun === null) {
        // Not "no runs YET": for a person working the CLI directly that reads as
        // a state about to change, and it never will — nor should it.
        io.out(`${result.resume.actor} has no runs.`);
        writeLines(io, NO_RUNS_HINT);
        return;
      }
      const state = lastRun.open ? 'open' : 'ended';
      io.out(
        `${result.resume.actor} last run ${lastRun.id} (${state})` +
          `${lastRun.goal !== undefined ? ` — ${lastRun.goal}` : ''}` +
          // Only while it is OPEN: an ended run reports its own end, and an age
          // beside that would read as time still passing in it.
          `${lastRun.open ? runAgeSuffix(lastRun) : ''}`,
      );
      io.out(fact(`${focus.openRuns.length} run(s) still open`));
    });
}
