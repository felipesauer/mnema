/**
 * The `mnema memory` wiring: what it declares, and what it prints.
 *
 * `mnema memory "<content>"` — capture a memory. The content is a positional:
 * this is quick capture (jrnl/todo.txt), where the content IS the command and
 * competes with no label, so it needs no flag.
 */

import type { Command } from 'commander';
import { RECORD_CONTRACT_HELP } from '../recorded-content.js';
import { addBodySourceOptions } from './body-source.js';
import { here } from './context.js';
import { scopeOption } from './enumerated.js';
import { REFUSED } from './from-the-group.js';
import { declaredAgent, INVALID, parseScope, WHICH_HELP } from './options.js';
import { reportRecorded, reportRefusal } from './report.js';
import { PIN_REFUSED } from './run-pin.js';
import { type Declared, mutatesTheRecord, type Wiring } from './verb.js';

/** Registers `mnema memory` on the program. */
export function registerMemory(program: Command, wiring: Wiring): Declared {
  const { io, pinnedRun } = wiring;
  const memory = program
    .command('memory')
    .description('capture a memory in the current project')
    .argument('[content]', 'the memory to record (or give it with --stdin or --body-file)')
    .addOption(
      scopeOption(
        'memory',
        'Defaults to public; an agent that declares itself with --which defaults to private.',
      ),
    )
    .option('--which <agent>', WHICH_HELP, declaredAgent)
    .addHelpText('after', RECORD_CONTRACT_HELP);
  addBodySourceOptions(memory, 'memory');
  memory.action(
    async (
      typed: string | undefined,
      opts: { scope?: string; which?: string; stdin?: boolean; bodyFile?: string },
    ) => {
      const { bodyFrom } = await import('./body-source.js');
      const content = await bodyFrom(wiring, 'memory', 'as an argument', {
        typed,
        stdin: opts.stdin,
        bodyFile: opts.bodyFile,
      });
      if (content === REFUSED) return;
      const { runMemory } = await import('../commands/memory.js');
      const scope = parseScope(opts.scope, wiring);
      if (scope === INVALID) return;
      const run = pinnedRun();
      if (run === PIN_REFUSED) {
        io.fail();
        return;
      }
      const result = runMemory(here(), {
        content,
        ...(scope !== undefined ? { scope } : {}),
        ...(opts.which !== undefined ? { which: opts.which } : {}),
        ...(run !== undefined ? { run } : {}),
      });
      if (result.ok) {
        io.out(`Captured memory ${result.id}`);
        reportRecorded(result, io);
        return;
      }
      reportRefusal(wiring, result);
    },
  );
  return mutatesTheRecord(memory);
}
