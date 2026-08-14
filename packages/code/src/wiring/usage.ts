/**
 * The `mnema usage` wiring: what it declares, and what it prints.
 *
 * IT IS CALLED `usage.ts` BECAUSE THE VERB IS, and the file that had the name is called
 * `misuse.ts` now. That is not tidying: `every-refusal-is-red.test.ts` asserts that every
 * wiring module which can refuse hangs a command of its own NAME on the program, and it
 * went red the moment this verb arrived under any other file name. The name it took was
 * already held by the parser's no — the module that gives every command one voice for a
 * usage ERROR — which never declared a verb, so nothing had made the collision visible
 * before. The half that moved is the one whose subject the new name says better: what
 * lives there is a {@link Misuse}, and it was called `Misuse` already.
 *
 * NO OPTIONS AT ALL, in this slice. Not `--json`: the verb exists for a person
 * accounting for what work cost, the agent surface has no tool for it and will not get
 * one, and an option with no caller is the defect A2 names. Not `--which` either, and
 * that one is worth stating: every write carries it so an agent can name itself, and
 * this writes nothing — there is no executor to record, because there is no record.
 *
 * IT IS DECLARED AMONG THE READS AND IT IS THE ONLY ONE THAT LEAVES THE RECORD. Every
 * other read on this surface answers out of the chain and could be checked by anyone
 * holding a clone; this one opens a file the host wrote, on this machine, which no
 * clone has and which the host will delete. That is not a reason to hide it — the
 * number is real and somebody has to account for it — it is the reason the output ends
 * by saying what it is.
 */

import type { Command } from 'commander';
import { here } from './context.js';
import { writeLines } from './io.js';
import { reportRefusal } from './report.js';
import { type Declared, readsTheRecord, type Wiring } from './verb.js';

/** Registers `mnema usage` on the program. */
export function registerUsage(program: Command, wiring: Wiring): Declared {
  const { io, render } = wiring;
  const usage = program
    .command('usage')
    .description("what each run cost, read from this machine's Claude Code transcripts")
    .addHelpText(
      'after',
      [
        '',
        'What each line says, and what it does not:',
        '  Tokens and the model id. Never dollars — no price table is carried here.',
        "  One host session in the run's window is attributed and named, so you can check it.",
        '  More than one is named and NOT attributed: there is no tie-break that is not invented.',
        '  None says `no transcript`, never `0` — no record of the cost is not a cost of zero.',
        '  Nothing is recorded: the chain has no field for this, and reading writes nothing.',
      ].join('\n'),
    )
    .action(async () => {
      const { runUsage } = await import('../commands/usage.js');
      const { usageReport } = await import('../presentation/usage.js');
      const result = runUsage(here());
      if (!result.ok) {
        // The one refusal it has, and it takes the surface's own wording for it: a
        // reader who is in the wrong directory is told the same sentence by every verb
        // that needs a project, which is the point of there being one.
        reportRefusal(wiring, result);
        return;
      }
      writeLines(io, usageReport(render, result));
    });

  return readsTheRecord(usage);
}
