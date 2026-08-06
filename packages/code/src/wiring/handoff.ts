/**
 * The `mnema handoff` wiring: what it declares, and what it prints.
 *
 * `mnema handoff <task> <from> <to>` — record a handoff on a task. Three
 * positionals: all short ids/labels, none a body of text. It mints no id (the
 * subject IS the task), so the report echoes the fact. `from == to` is
 * legitimate (a chat restart) and the `task` reference is not validated.
 */

import type { Command } from 'commander';
import { RECORD_CONTRACT_HELP } from '../recorded-content.js';
import { here } from './context.js';
import { scopeOption } from './enumerated.js';
import { declaredAgent, INVALID, parseScope, WHICH_HELP } from './options.js';
import { reportRecorded, reportRefusal } from './report.js';
import { PIN_REFUSED } from './run-pin.js';
import type { Wiring } from './verb.js';

/** Registers `mnema handoff` on the program. */
export function registerHandoff(program: Command, wiring: Wiring): void {
  const { io, pinnedRun } = wiring;
  program
    .command('handoff')
    .description('record a handoff on a task in the current project')
    .argument('<task>', 'the task the handoff is about')
    .argument('<from>', 'the agent handing off')
    .argument('<to>', 'the agent taking over (may equal <from>: a chat restart)')
    .addOption(
      scopeOption(
        'handoff',
        'Omitted, a handoff lands in the public tree (coordination between actors).',
      ),
    )
    // The agent RECORDING the handoff, which is not necessarily either of the two
    // agents it is about — `<from>`/`<to>` are the subject, `--which` is the author.
    .option('--which <agent>', WHICH_HELP, declaredAgent)
    .addHelpText('after', RECORD_CONTRACT_HELP)
    .action(
      async (task: string, from: string, to: string, opts: { scope?: string; which?: string }) => {
        const { runHandoff } = await import('../commands/handoff.js');
        const scope = parseScope(opts.scope, wiring);
        if (scope === INVALID) return;
        const run = pinnedRun();
        if (run === PIN_REFUSED) {
          io.fail();
          return;
        }
        const result = runHandoff(here(), {
          task,
          fromAgent: from,
          toAgent: to,
          ...(scope !== undefined ? { scope } : {}),
          ...(opts.which !== undefined ? { which: opts.which } : {}),
          ...(run !== undefined ? { run } : {}),
        });
        if (result.ok) {
          // No id to report — a handoff has no standalone identity. Echo the fact.
          io.out(`Recorded handoff on ${result.task}: ${result.fromAgent} → ${result.toAgent}`);
          reportRecorded(result, io);
          return;
        }
        reportRefusal(wiring, result);
      },
    );
}
