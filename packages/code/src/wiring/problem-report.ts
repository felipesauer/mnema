/**
 * The `mnema report` wiring: what it declares, and what it prints.
 *
 * It reads and writes nothing of the record. It shows the report of the last internal error,
 * whole, and keeps the person's answer to it in a file of this machine (`commands/report.ts`).
 */

import type { Command } from 'commander';
import { here } from './context.js';
import { refusalSentence } from './report.js';
import { type Declared, readsTheRecord, type Wiring } from './verb.js';

/** Registers `mnema report` on the program. */
export function registerProblemReport(program: Command, wiring: Wiring): Declared {
  const { io, render } = wiring;
  const verb = program
    .command('report')
    .description(
      'show, whole, what mnema would say about its own last internal error, and keep your answer to it (sends nothing)',
    )
    .option('--decline', 'refuse reports of this kind of error: it is not offered again')
    .option('--off', 'switch reporting off on this machine: nothing is logged or offered')
    .option('--on', 'switch reporting back on')
    .addHelpText(
      'after',
      [
        '',
        'The report is built from a short list of facts — mnema’s version, Node’s, the platform, the name',
        'of the verb, the kind of error, where in mnema it happened — and from nothing else: no record',
        'content, no path, no name, no address, no message. It is refused whole if it would carry any.',
        'mnema makes no network request and opens no browser: the text is shown and saved to a file and,',
        'at a terminal, a link is printed that opens GitHub’s form with the report in it — nothing is',
        'sent until you press Submit there.',
        'What was logged, what you declined and the switch live in the global tree’s directory, beside',
        'the record and not in it.',
      ].join('\n'),
    )
    .action(async (options: { decline?: boolean; off?: boolean; on?: boolean }) => {
      const { runReport } = await import('../commands/report.js');
      const outcome = runReport(
        { ...here(), aPersonIsHere: io.aPersonIsHere === true },
        {
          decline: options.decline === true,
          off: options.off === true,
          on: options.on === true,
        },
      );
      if (outcome.refused) {
        io.err(render(refusalSentence(outcome.lines.join(' '))));
        io.fail();
        return;
      }
      for (const line of outcome.lines) io.out(line);
    });
  return readsTheRecord(verb);
}
