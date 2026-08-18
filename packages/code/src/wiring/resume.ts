/**
 * The `mnema resume` wiring: what it declares, and what it prints.
 *
 * `mnema resume --actor <id> [--json]` — where the actor left off: their latest
 * run (open OR ended), plus their current focus.
 */

import type { Command } from 'commander';
import { fact } from '../presentation/detail.js';
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
      const { onOneLine } = await import('./on-one-line.js');
      // LOADED HERE AND NOT AT MODULE SCOPE, for the reason `on-one-line.ts` is:
      // `presentation/runs.js` collapses the goal it words, so it reaches
      // `served-patterns.ts` and through it `@mnema/copilot`. Declared eagerly, that
      // edge would sit in the floor of `mnema --version`, which is what
      // `tests/the-floor-is-the-declaration.test.ts` exists to refuse.
      const { lastRunPhrase, NO_RUNS_HINT, openRunsPhrase } = await import(
        '../presentation/runs.js'
      );
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
      //
      // The PHRASE is what goes through the collapse, not the actor: an anchor cannot
      // hold a newline and a run's GOAL is text somebody typed, and the goal reaches
      // this line inside the phrase. The goal is collapsed a second time here and that
      // is not redundancy to remove: `lastRunPhrase` collapses the goal because the
      // OTHER reading prints the phrase too (`presentation/runs.ts`), and this tag
      // collapses whatever the phrase turns out to hold. Both are classified —
      // `tests/a-line-of-success-is-one-line.test.ts` for this line,
      // `tests/the-line-a-reading-words-is-one-line.test.ts` for the phrase.
      io.out(onOneLine`${actor} ${lastRunPhrase(lastRun)}`);
      io.out(render(fact(openRunsPhrase(result.resume))));
    });
  return readsTheRecord(resume);
}
