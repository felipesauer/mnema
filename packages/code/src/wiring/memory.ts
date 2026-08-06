/**
 * The `mnema memory` wiring: what it declares, and what it prints.
 *
 * `mnema memory "<content>"` — capture a memory. The content is a positional:
 * this is quick capture (jrnl/todo.txt), where the content IS the command and
 * competes with no label, so it needs no flag.
 */

import type { Command } from 'commander';
import { RECORD_CONTRACT_HELP } from '../recorded-content.js';
import { here } from './context.js';
import { declaredAgent, INVALID, parseScope, WHICH_HELP } from './options.js';
import { reportRecorded, reportRefusal } from './report.js';
import { PIN_REFUSED } from './run-pin.js';
import type { Wiring } from './verb.js';

/** Registers `mnema memory` on the program. */
export function registerMemory(program: Command, wiring: Wiring): void {
  const { io, pinnedRun } = wiring;
  program
    .command('memory')
    .description('capture a memory in the current project')
    .argument('<content>', 'the memory to record')
    .option(
      '--scope <scope>',
      'where the memory is born: public (team-visible), private (this machine), ' +
        'or global (personal, cross-project). Defaults to public; an agent that ' +
        'declares itself with --which defaults to private.',
    )
    .option('--which <agent>', WHICH_HELP, declaredAgent)
    .addHelpText('after', RECORD_CONTRACT_HELP)
    .action(async (content: string, opts: { scope?: string; which?: string }) => {
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
    });
}
