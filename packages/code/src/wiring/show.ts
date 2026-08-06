/**
 * The `mnema show` wiring: what it declares, and what it prints.
 *
 * `mnema show <id> [--json]` — the whole record behind an id from `search`.
 * Serves a skill's body too, in EVERY state: on this surface the reader is CURATING
 * patterns, and refusing them the text of the thing they are reviewing would make the
 * curation impossible (the agent's surface serves a body through the `skills` tool,
 * which records the reading and refuses the two closed states — see `runShow`).
 */

import type { Command } from 'commander';
import { here } from './context.js';
import { writeLines } from './io.js';
import { reportRefusal } from './report.js';
import { type Declared, readsTheRecord, type Wiring } from './verb.js';

/** Registers `mnema show` on the program. */
export function registerShow(program: Command, wiring: Wiring): Declared {
  const { io, render } = wiring;
  const show = program
    .command('show')
    .description('show one whole record by id (the body a search only pointed at)')
    .argument('<id>', 'the record id (from `mnema search`)')
    .option('--json', 'emit the faithful record as JSON')
    .action(async (id: string, opts: { json?: boolean }) => {
      const { runShow } = await import('../commands/show.js');
      const { recordReport } = await import('../presentation/record.js');
      const result = runShow(here(), { id });
      if (!result.ok) {
        reportRefusal(wiring, result, { UNKNOWN_RECORD: `No record ${id} here.` });
        return;
      }
      if (opts.json === true) {
        io.out(JSON.stringify(result.record, null, 2));
        return;
      }
      writeLines(
        io,
        recordReport(render, result.record, {
          anchors: result.anchors,
          ...(result.consultations !== undefined ? { consultations: result.consultations } : {}),
        }),
      );
    });
  return readsTheRecord(show);
}
