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
import { addBodySourceOptions } from './body-source.js';
import { here } from './context.js';
import { scopeOption } from './enumerated.js';
import { REFUSED } from './from-the-group.js';
import { onOneLine } from './on-one-line.js';
import { declaredAgent, INVALID, parseScope, WHICH_HELP } from './options.js';
import { idOrRefuse, reportRecorded, reportRefusal } from './report.js';
import { PIN_REFUSED } from './run-pin.js';
import { type Declared, mutatesTheRecord, type Wiring } from './verb.js';

/** Registers `mnema observe` on the program. */
export function registerObserve(program: Command, wiring: Wiring): Declared {
  const { io, pinnedRun } = wiring;
  const observe = program
    .command('observe')
    .description('record an observation about an entity in the current project')
    .argument('<about>', 'the id of the entity being observed (a task, decision, …)')
    .requiredOption('--topic <label>', 'a short topic label')
    .option('--text <text>', 'the observation itself (or give it with --stdin or --body-file)')
    .addOption(
      scopeOption(
        'observation',
        'Defaults to public; an agent that declares itself with --which defaults to private.',
      ),
    )
    .option('--which <agent>', WHICH_HELP, declaredAgent)
    .addHelpText('after', RECORD_CONTRACT_HELP);
  addBodySourceOptions(observe, 'observation');
  observe.action(
    async (
      about: string,
      opts: {
        topic: string;
        text?: string;
        scope?: string;
        which?: string;
        stdin?: boolean;
        bodyFile?: string;
      },
    ) => {
      const { bodyFrom } = await import('./body-source.js');
      const text = await bodyFrom(wiring, 'observation', 'with --text', {
        typed: opts.text,
        stdin: opts.stdin,
        bodyFile: opts.bodyFile,
      });
      if (text === REFUSED) return;
      const { runObserve } = await import('../commands/observe.js');
      const scope = parseScope(opts.scope, wiring);
      if (scope === INVALID) return;
      const run = pinnedRun();
      if (run === PIN_REFUSED) {
        io.fail();
        return;
      }
      const named = await idOrRefuse(wiring, about);
      if (named === undefined) return;
      const result = runObserve(here(), {
        about: named,
        topic: opts.topic,
        text,
        ...(scope !== undefined ? { scope } : {}),
        ...(opts.which !== undefined ? { which: opts.which } : {}),
        ...(run !== undefined ? { run } : {}),
      });
      if (result.ok) {
        // The id is minted here; `about` is the positional, and the doc above says it
        // is NOT validated — a dangling reference is honest cross-tree. So the value
        // reaches this line exactly as typed (see {@link onOneLine}).
        io.out(onOneLine`Recorded observation ${result.id} about ${about}`);
        reportRecorded(result, io);
        return;
      }
      reportRefusal(wiring, result);
    },
  );
  return mutatesTheRecord(observe);
}
