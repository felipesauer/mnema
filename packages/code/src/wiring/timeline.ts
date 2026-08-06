/**
 * The `mnema timeline` wiring: what it declares, and what it prints.
 *
 * `mnema timeline <id> [--json]` — the entity's whole story across the trees:
 * every event where it is the subject, plus those that refer to it (an
 * observation `about` it, a link whose `target` is it). An id no event touches
 * yields an empty history — a valid answer, not a refusal.
 */

import type { Command } from 'commander';
import { asWhen, itemLine } from '../presentation/items.js';
import { here } from './context.js';
import { reportRefusal } from './report.js';
import type { Wiring } from './verb.js';

/** Registers `mnema timeline` on the program. */
export function registerTimeline(program: Command, wiring: Wiring): void {
  const { io, render } = wiring;
  program
    .command('timeline')
    .description("show an entity's history across the trees (subject, about, target)")
    .argument('<id>', 'the entity id (a task, decision, skill, memory, …)')
    .option('--json', 'emit the faithful timeline entries as JSON')
    .action(async (id: string, opts: { json?: boolean }) => {
      const { anchorText } = await import('../anchors.js');
      const { runTimeline } = await import('../commands/timeline.js');
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
      if (result.entries.length === 0) {
        io.out(`No history recorded for ${id}.`);
        return;
      }
      io.out(`${id} — ${result.entries.length} event(s):`);
      for (const entry of result.entries) {
        io.out(
          render(
            itemLine([
              // A whole instant leads every line here, and it is the widest column of
              // the read — said as an instant, the kind and the role beside it become
              // what a story reads as. Nothing else on the line is an id: the `who`
              // is an identity written through its anchor, which is a NAME a reader is
              // meant to read (see `anchors.ts`).
              asWhen(entry.at),
              entry.kind,
              `[${entry.role}]`,
              anchorText(result.anchors, entry.who),
            ]),
          ),
        );
      }
    });
}
