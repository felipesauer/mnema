/**
 * The `mnema task` wiring: what it declares, and what it prints.
 *
 * `task` is a group of five subcommands: one creates (`mnema task create "<title>"`), one
 * moves an existing task through the workflow (`mnema task move <action> <id>`), one records a
 * handoff on it (`task handoff`), and two ask the workflow what it allows (`task next` lists the
 * moves, `task guard` rehearses one). The group does nothing on its own: it used to
 * create with the title typed right after its name, and a group that takes a free
 * word cannot refuse a mistyped subcommand (`mnema task moveZZZ` created a task
 * called `moveZZZ`); `one-voice-for-a-no.test.ts` holds that no group does. Create takes an optional `--scope` — the
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
 * record should name. Which of the two is which is declared once, beside the move,
 * and read by the move, its refusal and the completion (`from-the-group.ts`).
 */

import type { Command } from 'commander';
import { RECORD_CONTRACT_HELP } from '../recorded-content.js';
import { here } from './context.js';
import {
  actionsRequiring,
  enumeratedArgument,
  listed,
  scopeOption,
  TASK_ACTIONS,
} from './enumerated.js';
import { fromTheGroup, REFUSED, takesFromItsGroup } from './from-the-group.js';
import { registerGuard } from './guard.js';
import { registerHandoff } from './handoff.js';
import { createsBy } from './misuse.js';
import { registerNextActions } from './next.js';
import { noSuchRecord } from './no-such-record.js';
import {
  declaredAgent,
  INVALID,
  parseScope,
  WHICH_HELP,
  WHICH_ON_SUBCOMMAND_HELP,
} from './options.js';
import { reportRecorded, reportRefusal, reportReplacement } from './report.js';
import { PIN_REFUSED } from './run-pin.js';
import { type Declared, groupOf, mutatesTheRecord, type Wiring } from './verb.js';

/** Registers `mnema task` on the program. */
export function registerTask(program: Command, wiring: Wiring): Declared {
  const { io, pinnedRun } = wiring;
  const task = program
    .command('task')
    .description('create a task, move it, hand it over, or ask what the workflow allows next')
    .addOption(
      scopeOption('task', 'Omitted, a task lands in the public tree (the team’s work board).'),
    )
    .option('--which <agent>', WHICH_HELP, declaredAgent)
    .addHelpText('after', RECORD_CONTRACT_HELP);

  // `task create <title>` — the verb the agent's surface calls `create_task`. The group used
  // to create with the title typed right after its name, and a group that takes a free word
  // cannot refuse a mistyped subcommand: `mnema task moveZZZ` created a task called `moveZZZ`.
  // Its flags are its own, so its `--help` lists them; written after `create` they still land
  // on the group, which declares the same two, and are read from there (`decision import` has
  // the same shape).
  const create = task
    .command('create')
    .description('create a task in the current project')
    .argument('<title>', 'the task title')
    .addOption(
      scopeOption('task', 'Omitted, a task lands in the public tree (the team’s work board).'),
    )
    .option('--which <agent>', WHICH_HELP, declaredAgent)
    .addHelpText('after', RECORD_CONTRACT_HELP);
  createsBy(create);
  create.action(async (title: string) => {
    const given = await fromTheGroup<{ scope?: string; which?: string }>(create, wiring);
    if (given === REFUSED) return;
    const { runTask } = await import('../commands/task.js');
    const scope = parseScope(given.scope, wiring);
    if (scope === INVALID) return;
    const run = pinnedRun();
    if (run === PIN_REFUSED) {
      io.fail();
      return;
    }
    const result = runTask(here(), {
      title,
      ...(scope !== undefined ? { scope } : {}),
      ...(given.which !== undefined ? { which: given.which } : {}),
      ...(run !== undefined ? { run } : {}),
    });
    if (result.ok) {
      io.out(`Created task ${result.alias} (${result.id})`);
      reportRecorded(result, io);
      return;
    }
    reportRefusal(wiring, result);
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
  // the move REJECTS it explicitly rather than silently ignoring it — and so every
  // flag of the group it does not read (`from-the-group.ts`).
  const move = task
    .command('move')
    .description('move a task through the workflow (follows the task; takes no --scope)')
    .addArgument(enumeratedArgument('<action>', 'the transition', TASK_ACTIONS))
    .argument('<id>', 'the task id (the value shown when it was created)')
    .option('--reason <text>', `why (required by ${listed(actionsRequiring('task', 'reason'))})`)
    .option(
      '--note <text>',
      `what was done (required by ${listed(actionsRequiring('task', 'note'))})`,
    )
    .option(
      '--feedback <text>',
      `what must change (required by ${listed(actionsRequiring('task', 'feedback'))})`,
    )
    .addHelpText('after', WHICH_ON_SUBCOMMAND_HELP)
    .addHelpText('after', RECORD_CONTRACT_HELP);
  takesFromItsGroup(move, {
    takes: ['--which'],
    refuses: { '--scope': 'a move follows the task to the tree it was born in.' },
  });
  move.action(
    async (
      action: string,
      id: string,
      opts: { reason?: string; note?: string; feedback?: string },
    ) => {
      // Both `--scope` and `--which` on a move are parsed into `task`'s options
      // (the parent), because that is where they are declared. Their verdicts
      // differ: a `--scope` means the caller tried to scope a move, which the model
      // forbids — the move follows the entity's home tree, not a chosen scope — so
      // it is rejected; a `--which` is the agent that executed the move, which the
      // record should name, so it is forwarded.
      const given = await fromTheGroup<{ which?: string }>(move, wiring);
      if (given === REFUSED) return;
      const { runTaskTransition } = await import('../commands/task-transition.js');
      const { movedLine } = await import('../moved-record.js');
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
        ...(given.which !== undefined ? { which: given.which } : {}),
        ...(run !== undefined ? { run } : {}),
      });
      if (result.ok) {
        io.out(movedLine('task', result.alias, result.id, result.to));
        reportReplacement(result, io);
        return;
      }
      reportRefusal(wiring, result, { UNKNOWN_TASK: noSuchRecord('task', id) });
    },
  );

  // The three that used to be verbs of their own: a handoff is recorded on a task, and the other
  // two ask the task's workflow what it allows. They hang on the group and read its flags the way
  // `create` and `move` do. Each answers for itself, and the group is a write because three of
  // its members are (`verb.ts`): the console runs the two that read and refuses the rest.
  const handoff = registerHandoff(task, wiring);
  const next = registerNextActions(task, wiring);
  const guard = registerGuard(task, wiring);
  return groupOf(task, [mutatesTheRecord(create), mutatesTheRecord(move), handoff, next, guard]);
}
