/**
 * The `mnema timeline` wiring: what it declares, and what it prints.
 *
 * `mnema timeline <id> [--json]` — the entity's whole story across the trees:
 * every event where it is the subject, plus those that refer to it (an
 * observation `about` it, a link whose `target` is it). An id no event touches
 * yields an empty history — a valid answer, not a refusal.
 */

import type { Command } from 'commander';
import { here } from './context.js';
import { onOneLine } from './on-one-line.js';
import { reportRefusal } from './report.js';
import { type Declared, readsTheRecord, type Wiring } from './verb.js';

/** Registers `mnema timeline` on the program. */
export function registerTimeline(program: Command, wiring: Wiring): Declared {
  const { io, render } = wiring;
  const timeline = program
    .command('timeline')
    .description("show an entity's history across the trees (subject, about, target)")
    .argument('<id>', 'the entity id (a task, decision, skill, memory, …)')
    .option('--json', 'emit the faithful timeline entries as JSON')
    .action(async (id: string, opts: { json?: boolean }) => {
      const { anchorText } = await import('../anchors.js');
      const { runTimeline } = await import('../commands/timeline.js');
      // Loaded when the verb runs, not while the program is being declared: this
      // module reaches the chain for the reader that turns a move's fields into text,
      // and a static import here would put that on the floor every invocation pays.
      const { historyLine, saidLine } = await import('../presentation/occurrence.js');
      const result = runTimeline(here(), { id });
      if (!result.ok) {
        reportRefusal(wiring, result);
        return;
      }
      if (opts.json === true) {
        io.out(JSON.stringify(result.entries, null, 2));
        return;
      }
      // Human summary — one line per event: when, what kind, the role by which the
      // entity appears, and who authorized it. The typed payload is in --json.
      //
      // The id is the caller's own word and it is not validated here — an id no event
      // touches is a valid answer, not a refusal — so it reaches both of these lines as
      // typed, and the second one HEADS the list (see {@link onOneLine}).
      if (result.entries.length === 0) {
        io.out(onOneLine`No history recorded for ${id}.`);
        return;
      }
      io.out(onOneLine`${id} — ${result.entries.length} event(s):`);
      // One line per event — when, what kind, the role the queried entity appears
      // by, and who authorized it — and under it, INDENTED, what that move said when
      // it said anything. Both lines are composed in `presentation/occurrence.ts`,
      // which is where a value that enters a line is collapsed; this layer hands over
      // the values and prints what comes back.
      for (const entry of result.entries) {
        io.out(render(historyLine(entry, anchorText(result.anchors, entry.who))));
        const said = saidLine(entry.event);
        if (said !== undefined) io.out(render(said));
      }
    });
  return readsTheRecord(timeline);
}
