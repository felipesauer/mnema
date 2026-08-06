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
import type { Wiring } from './verb.js';

/** Registers `mnema next-actions` on the program. */
export function registerNextActions(program: Command, wiring: Wiring): void {
  const { io, render } = wiring;
  program
    .command('next-actions')
    .description('show the moves the workflow allows a task next')
    .argument('<task-id>', 'the task id (the value shown when it was created)')
    .option('--json', 'emit the faithful list of next actions as JSON')
    .action(async (id: string, opts: { json?: boolean }) => {
      const { runNextActions } = await import('../commands/next-actions.js');
      const result = runNextActions(here(), { id });
      if (!result.ok) {
        reportRefusal(wiring, result, { UNKNOWN_TASK: `No task ${id} here.` });
        return;
      }
      if (opts.json === true) {
        io.out(JSON.stringify(result.actions, null, 2));
        return;
      }
      if (result.actions.length === 0) {
        io.out(`Task ${id} is terminal — no legal moves.`);
        return;
      }
      io.out(`Task ${id} — ${result.actions.length} legal move(s):`);
      for (const action of result.actions) {
        const needs = action.requires.length > 0 ? ` (needs ${action.requires.join(', ')})` : '';
        io.out(render(itemLine([`${action.action} → ${action.to}${needs}`])));
      }
    });
}
