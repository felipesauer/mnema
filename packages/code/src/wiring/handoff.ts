/**
 * The `mnema task handoff` wiring: what it declares, and what it prints.
 *
 * `mnema task handoff <task> <from> <to>` — record a handoff on a task. Three
 * positionals: all short ids/labels, none a body of text. It mints no id (the
 * subject IS the task), so the report echoes the fact. `from == to` is
 * legitimate (a chat restart) and the `task` reference is not validated.
 *
 * It is a subcommand of `task`, hung on it by `registerTask`, and it declares `--scope` and
 * `--which` as `task create` does: both land on the group wherever they are written, and are
 * read from there (`from-the-group.ts`).
 */

import type { Command } from 'commander';
import { RECORD_CONTRACT_HELP } from '../recorded-content.js';
import { here } from './context.js';
import { scopeOption } from './enumerated.js';
import { fromTheGroup, REFUSED } from './from-the-group.js';
import { onOneLine } from './on-one-line.js';
import { declaredAgent, INVALID, parseScope, WHICH_HELP } from './options.js';
import { reportRecorded, reportRefusal } from './report.js';
import { PIN_REFUSED } from './run-pin.js';
import type { Wiring } from './verb.js';

/** Registers `mnema task handoff` on the `task` group. */
export function registerHandoff(task: Command, wiring: Wiring): void {
  const { io, pinnedRun } = wiring;
  const handoff = task
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
    .action(async (taskId: string, from: string, to: string) => {
      const given = await fromTheGroup<{ scope?: string; which?: string }>(handoff, wiring);
      if (given === REFUSED) return;
      const { runHandoff } = await import('../commands/handoff.js');
      const scope = parseScope(given.scope, wiring);
      if (scope === INVALID) return;
      const run = pinnedRun();
      if (run === PIN_REFUSED) {
        io.fail();
        return;
      }
      const result = runHandoff(here(), {
        task: taskId,
        fromAgent: from,
        toAgent: to,
        ...(scope !== undefined ? { scope } : {}),
        ...(given.which !== undefined ? { which: given.which } : {}),
        ...(run !== undefined ? { run } : {}),
      });
      if (result.ok) {
        // No id to report — a handoff has no standalone identity. Echo the fact.
        //
        // Three positionals, all the caller's: the task and the two agents. The two
        // agents are the sharpest of them — they are NAMES rather than ids, so a
        // reader has nothing to check a forged second line against (see
        // {@link onOneLine}).
        io.out(
          onOneLine`Recorded handoff on ${result.task}: ${result.fromAgent} → ${result.toAgent}`,
        );
        reportRecorded(result, io);
        return;
      }
      reportRefusal(wiring, result);
    });
}
