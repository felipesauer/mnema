/**
 * The `mnema next-actions` wiring: what it declares, and what it prints.
 *
 * `mnema next-actions <task-id> [--json]` — the moves the workflow allows the
 * task next. No actor: the answer is a property of the task's state. An unknown
 * id is refused honestly; a terminal task reports "no legal moves".
 */

import type { Command } from 'commander';
import { itemLine } from '../presentation/items.js';
import { here } from './context.js';
import { reportRefusal } from './report.js';
import { type Declared, readsTheRecord, type Wiring } from './verb.js';

/** Registers `mnema next-actions` on the program. */
export function registerNextActions(program: Command, wiring: Wiring): Declared {
  const { io, render } = wiring;
  const nextActions = program
    .command('next-actions')
    .description('show the moves the workflow allows a task next')
    .argument('<task-id>', 'the task id (the value shown when it was created)')
    .option('--json', 'emit the faithful list of next actions as JSON')
    .action(async (id: string, opts: { json?: boolean }) => {
      const { runNextActions } = await import('../commands/next-actions.js');
      const result = runNextActions(here(), { id });
      if (!result.ok) {
        const { noSuchRecord } = await import('./no-such-record.js');
        reportRefusal(wiring, result, { UNKNOWN_TASK: noSuchRecord('task', id) });
        return;
      }
      if (opts.json === true) {
        io.out(JSON.stringify(result.actions, null, 2));
        return;
      }
      // The id is whatever was typed after the verb, and it LEADS a line the moves are
      // listed under: a break in it used to write a heading of its own with this
      // reading's own items beneath it (see {@link onOneLine}).
      const { onOneLine } = await import('./on-one-line.js');
      if (result.actions.length === 0) {
        io.out(onOneLine`Task ${id} is terminal — no legal moves.`);
        return;
      }
      io.out(onOneLine`Task ${id} — ${result.actions.length} legal move(s):`);
      for (const action of result.actions) {
        const needs = action.requires.length > 0 ? ` (needs ${action.requires.join(', ')})` : '';
        io.out(render(itemLine([`${action.action} → ${action.to}${needs}`])));
      }
    });
  return readsTheRecord(nextActions);
}
