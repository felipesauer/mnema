/**
 * The `mnema observe` wiring: what it declares, and what it prints.
 *
 * `mnema observe <about> --topic "<t>" --text "<obs>"` — record an observation
 * about an entity. `about` is a positional (a short id); the topic and the text
 * are flags — the text would compete with about/topic for the tail of the line,
 * so it is named (the `gh issue comment --body` convention). `about` is NOT
 * validated — a dangling reference is honest cross-tree.
 */

import type { Command } from 'commander';
import { RECORD_CONTRACT_HELP } from '../recorded-content.js';
import { here } from './context.js';
import { declaredAgent, INVALID, parseScope, WHICH_HELP } from './options.js';
import { reportRecorded, reportRefusal } from './report.js';
import { PIN_REFUSED } from './run-pin.js';
import type { Wiring } from './verb.js';
import { scopeOption } from './vocabulary.js';

/** Registers `mnema observe` on the program. */
export function registerObserve(program: Command, wiring: Wiring): void {
  const { io, pinnedRun } = wiring;
  program
    .command('observe')
    .description('record an observation about an entity in the current project')
    .argument('<about>', 'the id of the entity being observed (a task, decision, …)')
    .requiredOption('--topic <label>', 'a short topic label')
    .requiredOption('--text <text>', 'the observation itself')
    .addOption(
      scopeOption(
        'observation',
        'Defaults to public; an agent that declares itself with --which defaults to private.',
      ),
    )
    .option('--which <agent>', WHICH_HELP, declaredAgent)
    .addHelpText('after', RECORD_CONTRACT_HELP)
    .action(
      async (
        about: string,
        opts: { topic: string; text: string; scope?: string; which?: string },
      ) => {
        const { runObserve } = await import('../commands/observe.js');
        const scope = parseScope(opts.scope, wiring);
        if (scope === INVALID) return;
        const run = pinnedRun();
        if (run === PIN_REFUSED) {
          io.fail();
          return;
        }
        const result = runObserve(here(), {
          about,
          topic: opts.topic,
          text: opts.text,
          ...(scope !== undefined ? { scope } : {}),
          ...(opts.which !== undefined ? { which: opts.which } : {}),
          ...(run !== undefined ? { run } : {}),
        });
        if (result.ok) {
          io.out(`Recorded observation ${result.id} about ${about}`);
          reportRecorded(result, io);
          return;
        }
        reportRefusal(wiring, result);
      },
    );
}
