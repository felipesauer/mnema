/**
 * The `mnema resume` wiring: what it declares, and what it prints.
 *
 * `mnema resume --actor <id> [--json]` — where the actor left off: their latest
 * run (open OR ended), and the runs they still have open, one line each.
 *
 * It is also the answer to "what is this actor touching now", which used to be a verb of its
 * own (`focus`): the object this derives CONTAINS the open runs, so a second verb printed a
 * part of what this one already had. The list is printed under the count, and `--json` was
 * always the whole object.
 */

import type { Command } from 'commander';
import { fact } from '../presentation/detail.js';
import { asId, itemLine } from '../presentation/items.js';
import {
  lastRunPhrase,
  NO_RUNS_HINT,
  openRunsPhrase,
  runAgeSuffix,
  wroteSuffix,
} from '../presentation/runs.js';
import { here } from './context.js';
import { writeLines } from './io.js';
import { onOneLine } from './on-one-line.js';
import { ACTOR_HELP } from './options.js';
import { reportRefusal } from './report.js';
import { type Declared, readsTheRecord, type Wiring } from './verb.js';

/** Registers `mnema resume` on the program. */
export function registerResume(program: Command, wiring: Wiring): Declared {
  const { io, render } = wiring;
  const resume = program
    .command('resume')
    .description('show where an actor left off, and the runs they still have open')
    .requiredOption(
      '--actor <id>',
      `the identity whose last run and open runs to show — ${ACTOR_HELP}`,
    )
    .option('--json', 'emit the faithful resume object as JSON')
    .action(async (opts: { actor: string; json?: boolean }) => {
      const { anchorText } = await import('../anchors.js');
      const { linkBreakNotice } = await import('./integrity.js');
      const { runResume } = await import('../commands/resume.js');
      const result = runResume(here(), { actor: opts.actor });
      if (!result.ok) {
        reportRefusal(wiring, result);
        return;
      }
      // BEFORE the answer, and on the other stream — so it survives a pipe, and so
      // `--json` stays the machine-readable thing it promises to be.
      for (const line of linkBreakNotice(result.linkBreaks)) io.err(render(line));
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
      // One line per open run, and one line per run is what the reader counts by: the agent and
      // the goal are both text an actor wrote, so either one holding a newline would print a run
      // this record never opened (see {@link onOneLine}). `--json` carries both as written.
      //
      // The age and the idleness are what tell ten leftover runs apart from the one being worked
      // in, and they ride the run's OWN line. And WHAT each one wrote, from the same module,
      // because what tells two leftover runs apart is what happened inside them. The clause is
      // `wroteSuffix`'s and not this file's — `status` prints the same words through
      // `lastRunPhrase`, and a second wording here is the drift that module exists to prevent.
      // `thisSession` is NOT printed: a read opens no run, so it is false in every line, and a
      // constant is noise rather than honesty.
      for (const run of result.resume.focus.openRuns) {
        io.out(
          render(
            itemLine([
              // The run id is what `mnema run end` takes, and it is the half of this line
              // nobody reads: said as an id, it stops competing with the agent and the goal.
              asId(run.id),
              // The dash before the goal is a chunk of its own template rather than the head of
              // an interpolated fragment: a value is what gets collapsed, and a collapse would
              // eat the space this one opens with.
              onOneLine`${run.agent}` +
                (run.goal !== undefined ? onOneLine` — ${run.goal}` : '') +
                runAgeSuffix(run) +
                wroteSuffix(run),
            ]),
          ),
        );
      }
    });
  return readsTheRecord(resume);
}
