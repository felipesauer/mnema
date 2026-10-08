/**
 * The `mnema task next` wiring: what it declares, and what it prints.
 *
 * `mnema task next <task-id> [--json]` — the moves the workflow allows the
 * task next. No actor: the answer is a property of the task's state. An unknown
 * id is refused honestly; a terminal task reports "no legal moves".
 *
 * It is a subcommand of `task`, hung on it by `registerTask`, and it reads nothing of the
 * group's flags: it creates nothing and moves nothing, so a `--scope` or a `--which` written
 * on the line is refused rather than accepted and dropped (`from-the-group.ts`).
 */

import type { Command } from 'commander';
import { itemLine } from '../presentation/items.js';
import { here } from './context.js';
import { fromTheGroup, REFUSED, takesFromItsGroup } from './from-the-group.js';
import { noSuchRecord } from './no-such-record.js';
import { onOneLine } from './on-one-line.js';
import { reportRefusal } from './report.js';
import { type Declared, readsTheRecord, type Wiring } from './verb.js';

/** Registers `mnema task next` on the `task` group. */
export function registerNextActions(task: Command, wiring: Wiring): Declared {
  const { io, render } = wiring;
  const next = task
    .command('next')
    .description('show the moves the workflow allows a task next (records nothing)')
    .argument('<task-id>', 'the task id (the value shown when it was created)')
    .option('--json', 'emit the faithful list of next actions as JSON');
  takesFromItsGroup(next, {
    refuses: {
      '--scope': 'it records nothing, so there is no tree to choose.',
      '--which': 'it records nothing, so there is no agent to name.',
    },
  });
  next.action(async (id: string, opts: { json?: boolean }) => {
    if ((await fromTheGroup(next, wiring)) === REFUSED) return;
    const { linkBreakNotice } = await import('./integrity.js');
    const { runNextActions } = await import('../commands/next-actions.js');
    const result = runNextActions(here(), { id });
    if (!result.ok) {
      reportRefusal(wiring, result, { UNKNOWN_TASK: noSuchRecord('task', id) });
      return;
    }
    // BEFORE the answer, and on the other stream — so it survives a pipe, and so
    // `--json` stays the machine-readable thing it promises to be.
    for (const line of linkBreakNotice(result.linkBreaks)) io.err(render(line));
    if (opts.json === true) {
      io.out(JSON.stringify(result.actions, null, 2));
      return;
    }
    // The id is whatever was typed after the verb, and it LEADS a line the moves are
    // listed under: a break in it used to write a heading of its own with this
    // reading's own items beneath it (see {@link onOneLine}).
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
  return readsTheRecord(next);
}
