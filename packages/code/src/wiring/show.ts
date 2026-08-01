/**
 * The `mnema show` wiring: what it declares, and what it prints.
 *
 * `mnema show <id> [--json]` — the whole record behind an id from `search`.
 * Serves a skill's body too: on this surface the reader is CURATING patterns,
 * and refusing them the text of the thing they are reviewing would make the
 * curation impossible (the agent's surface makes the opposite call, for the
 * opposite reason — see `runShow`).
 */

import type { Command } from 'commander';
import { runShow } from '../commands/show.js';
import { recordReport } from '../presentation/record.js';
import { here } from './context.js';
import { writeLines } from './io.js';
import { reportRefusal } from './report.js';
import type { Wiring } from './verb.js';

/** Registers `mnema show` on the program. */
export function registerShow(program: Command, wiring: Wiring): void {
  const { io } = wiring;
  program
    .command('show')
    .description('show one whole record by id (the body a search only pointed at)')
    .argument('<id>', 'the record id (from `mnema search`)')
    .option('--json', 'emit the faithful record as JSON')
    .action((id: string, opts: { json?: boolean }) => {
      const result = runShow(here(), { id });
      if (!result.ok) {
        reportRefusal(io, result, { UNKNOWN_RECORD: `No record ${id} here.` });
        return;
      }
      if (opts.json === true) {
        io.out(JSON.stringify(result.record, null, 2));
        return;
      }
      writeLines(
        io,
        recordReport(result.record, {
          anchors: result.anchors,
          ...(result.consultations !== undefined ? { consultations: result.consultations } : {}),
        }),
      );
    });
}
