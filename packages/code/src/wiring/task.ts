/**
 * The `mnema task` wiring: what it declares, and what it prints.
 *
 * `task` is a group: its default action creates (`mnema task "<title>"`),
 * and its one subcommand moves an existing task through the workflow
 * (`mnema task move <action> <id>`). Create takes an optional `--scope` — the
 * per-action override for where the task is born; omitted, the KIND decides, and a
 * task is the team's board, so it lands in the tree that travels. `move` takes NO
 * scope: a move follows the entity to the tree it was born in, never a scope the
 * caller picks.
 *
 * `--which` is declared HERE, on the group, and serves both the create and the
 * move: commander hands a group's option to the group wherever it appears on the
 * line, so the move reads it off the parent (see {@link
 * WHICH_ON_SUBCOMMAND_HELP}). Unlike `--scope`, which the move rejects, `--which`
 * is honored on a move — the agent that executed a transition is exactly what the
 * record should name.
 */

import type { Command } from 'commander';
import { runTask } from '../commands/task.js';
import { runTaskTransition } from '../commands/task-transition.js';
import { movedLine } from '../moved-record.js';
import { RECORD_CONTRACT_HELP } from '../recorded-content.js';
import { here } from './context.js';
import {
  declaredAgent,
  INVALID,
  parseScope,
  WHICH_HELP,
  WHICH_ON_SUBCOMMAND_HELP,
} from './options.js';
import { reportRecorded, reportRefusal, reportReplacement } from './report.js';
import { PIN_REFUSED } from './run-pin.js';
import type { Wiring } from './verb.js';

/** Registers `mnema task` on the program. */
export function registerTask(program: Command, wiring: Wiring): void {
  const { io, pinnedRun } = wiring;
  const task = program
    .command('task')
    .description('create a task in the current project')
    .argument('<title>', 'the task title')
    .option(
      '--scope <scope>',
      'where the task is born: public (team-visible), private (this machine), ' +
        'or global (personal, cross-project). Omitted, a task lands in the ' +
        'public tree (the team’s work board).',
    )
    .option('--which <agent>', WHICH_HELP, declaredAgent)
    .addHelpText('after', RECORD_CONTRACT_HELP)
    .action((title: string, opts: { scope?: string; which?: string }) => {
      const scope = parseScope(opts.scope, io);
      if (scope === INVALID) {
        io.fail();
        return;
      }
      const run = pinnedRun();
      if (run === PIN_REFUSED) {
        io.fail();
        return;
      }
      const result = runTask(here(), {
        title,
        ...(scope !== undefined ? { scope } : {}),
        ...(opts.which !== undefined ? { which: opts.which } : {}),
        ...(run !== undefined ? { run } : {}),
      });
      if (result.ok) {
        io.out(`Created task ${result.alias} (${result.id})`);
        reportRecorded(result, io);
        return;
      }
      reportRefusal(io, result);
    });

  // One generic move: the action is an argument the gate validates, not a
  // hardcoded per-action command. The surface knows nothing of the transition
  // table — it forwards the action string and whichever proof flag was given,
  // and prints the gate's own verdict (the new state, or a typed refusal).
  //
  // A move takes NO `--scope`: a transition follows the entity to the tree it
  // was born in, never a scope the caller picks — routing it elsewhere would
  // split the task's history across the public/private boundary. Because `move`
  // sits under `task`, commander lets `task`'s `--scope` be parsed here too, so
  // the move REJECTS it explicitly (read off the parent's opts) rather than
  // silently ignoring it.
  const move = task
    .command('move')
    .description('move a task through the workflow (follows the task; takes no --scope)')
    .argument(
      '<action>',
      'the transition (submit, start, block, unblock, submit_review, ' +
        'request_changes, approve, complete, cancel, reopen)',
    )
    .argument('<id>', 'the task id (the value shown when it was created)')
    .option('--reason <text>', 'why (required by cancel, block, reopen)')
    .option('--note <text>', 'what was done (required by complete, approve)')
    .option('--feedback <text>', 'what must change (required by request_changes)')
    .addHelpText('after', WHICH_ON_SUBCOMMAND_HELP)
    .addHelpText('after', RECORD_CONTRACT_HELP);
  move.action(
    (action: string, id: string, opts: { reason?: string; note?: string; feedback?: string }) => {
      // Both `--scope` and `--which` on a move are parsed into `task`'s options
      // (the parent), because that is where they are declared. Their verdicts
      // differ: a `--scope` means the caller tried to scope a move, which the model
      // forbids — the move follows the entity's home tree, not a chosen scope — so
      // it is rejected; a `--which` is the agent that executed the move, which the
      // record should name, so it is forwarded.
      const parentOpts = (move.parent?.opts() ?? {}) as { scope?: string; which?: string };
      if (parentOpts.scope !== undefined) {
        io.err('`task move` takes no --scope: a move follows the task to the tree it was born in.');
        io.fail();
        return;
      }
      const run = pinnedRun();
      if (run === PIN_REFUSED) {
        io.fail();
        return;
      }
      const result = runTaskTransition(here(), {
        id,
        action,
        proof: {
          ...(opts.reason !== undefined ? { reason: opts.reason } : {}),
          ...(opts.note !== undefined ? { note: opts.note } : {}),
          ...(opts.feedback !== undefined ? { feedback: opts.feedback } : {}),
        },
        ...(parentOpts.which !== undefined ? { which: parentOpts.which } : {}),
        ...(run !== undefined ? { run } : {}),
      });
      if (result.ok) {
        io.out(movedLine('task', result.alias, result.id, result.to));
        reportReplacement(result, io);
        return;
      }
      reportRefusal(io, result, { UNKNOWN_TASK: `No task ${id} here.` });
    },
  );
}
