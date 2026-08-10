/**
 * The `mnema resume` wiring: what it declares, and what it prints.
 *
 * `mnema resume --actor <id> [--json]` — where the actor left off: their latest
 * run (open OR ended), plus their current focus.
 */

import type { Command } from 'commander';
import { fact } from '../presentation/detail.js';
import { lastRunPhrase, NO_RUNS_HINT, openRunsPhrase } from '../presentation/runs.js';
import { here } from './context.js';
import { writeLines } from './io.js';
import { ACTOR_HELP } from './options.js';
import { reportRefusal } from './report.js';
import { type Declared, readsTheRecord, type Wiring } from './verb.js';

/** Registers `mnema resume` on the program. */
export function registerResume(program: Command, wiring: Wiring): Declared {
  const { io, render } = wiring;
  const resume = program
    .command('resume')
    .description('show where an actor left off (their latest run, open or ended)')
    .requiredOption('--actor <id>', `the identity whose last run to show — ${ACTOR_HELP}`)
    .option('--json', 'emit the faithful resume object as JSON')
    .action(async (opts: { actor: string; json?: boolean }) => {
      const { anchorText } = await import('../anchors.js');
      const { runResume } = await import('../commands/resume.js');
      const result = runResume(here(), { actor: opts.actor });
      if (!result.ok) {
        reportRefusal(wiring, result);
        return;
      }
      if (opts.json === true) {
        io.out(JSON.stringify(result.resume, null, 2));
        return;
      }
      const { lastRun } = result.resume;
      const actor = anchorText(result.anchors, result.resume.actor);
      if (lastRun === null) {
        // Not "no runs YET": for a person working the CLI directly that reads as
        // a state about to change, and it never will — nor should it.
        io.out(`${actor} has no runs.`);
        writeLines(io, NO_RUNS_HINT.map(render));
        return;
      }
      // The actor LEADS the line here and heads the answer in `status`, which is why
      // the phrase begins after them and is composed in one place (see
      // {@link lastRunPhrase}).
      io.out(`${actor} ${lastRunPhrase(lastRun)}`);
      io.out(render(fact(openRunsPhrase(result.resume))));
    });
  return readsTheRecord(resume);
}
