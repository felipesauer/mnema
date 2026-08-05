/**
 * The `mnema focus` wiring: what it declares, and what it prints.
 *
 * `mnema focus --actor <id> [--json]` — the actor's open runs (what they are
 * touching now). Reports ONLY that actor's runs — never another's.
 */

import type { Command } from 'commander';
import { anchorText } from '../anchors.js';
import { runFocus } from '../commands/focus.js';
import { itemLine } from '../presentation/items.js';
import { renderPlain } from '../presentation/plain.js';
import { NO_RUNS_HINT, runAgeSuffix } from '../presentation/runs.js';
import { oneLine } from '../served-patterns.js';
import { here } from './context.js';
import { writeLines } from './io.js';
import { ACTOR_HELP } from './options.js';
import { reportRefusal } from './report.js';
import type { Wiring } from './verb.js';

/** Registers `mnema focus` on the program. */
export function registerFocus(program: Command, wiring: Wiring): void {
  const { io } = wiring;
  program
    .command('focus')
    .description("show an actor's open runs (what they are touching now)")
    .requiredOption('--actor <id>', `the identity whose focus to show — ${ACTOR_HELP}`)
    .option('--json', 'emit the faithful focus object as JSON')
    .action((opts: { actor: string; json?: boolean }) => {
      const result = runFocus(here(), { actor: opts.actor });
      if (!result.ok) {
        reportRefusal(io, result);
        return;
      }
      if (opts.json === true) {
        io.out(JSON.stringify(result.focus, null, 2));
        return;
      }
      // Human summary — one line per open run, and one line per run is what the
      // reader counts by: the agent and the goal are both text an actor wrote, so
      // either one holding a newline would print a run this record never opened
      // (see {@link oneLine}). `--json` carries both as written.
      //
      // An actor with nothing open is stated plainly, not left as silent empty
      // output, and told what a run IS: most people working the CLI directly will
      // never have one, and an unexplained empty answer reads as something missing
      // rather than as the truth (see {@link NO_RUNS_HINT}).
      const { openRuns } = result.focus;
      const actor = anchorText(result.anchors, result.focus.actor);
      if (openRuns.length === 0) {
        io.out(`${actor} has no open runs.`);
        writeLines(io, NO_RUNS_HINT);
        return;
      }
      io.out(`${actor} — ${openRuns.length} open run(s):`);
      for (const run of openRuns) {
        // The age and the idleness are what tell ten leftover runs apart from the
        // one being worked in, and they ride the run's OWN line — one line per run
        // stays the rule a reader counts by. `thisSession` is NOT printed: a read
        // opens no run, so it is false in every line here, and a constant is noise
        // rather than honesty (`--json` carries it, being the faithful object).
        io.out(
          renderPlain(
            itemLine([
              run.id,
              `${oneLine(run.agent)}` +
                `${run.goal !== undefined ? ` — ${oneLine(run.goal)}` : ''}` +
                runAgeSuffix(run),
            ]),
          ),
        );
      }
    });
}
