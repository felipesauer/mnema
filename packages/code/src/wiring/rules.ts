/**
 * The `mnema rules` wiring: what it declares, and what it prints.
 *
 * `mnema rules <path> [--json]` — the reverse reading of the relations whose target
 * is a path (`ADDRESS_RELATIONS`: `governs` and `asks-for-a-person`). It said "the ONE
 * relation" until the gate shipped as a second label of the same shape, and this page
 * has reported both ever since. `refs` walks outward from an id; this walks inward from
 * a place in the code and answers which recorded rules govern it, most specific first.
 *
 * It CHARGES NOTHING. It refuses no move, blocks no write and grades no work; what
 * it reports is the id a later charge would have to cite. Three numbers ride on
 * every answer — how many rules cover the path, how many address the project at all,
 * and how many address something the working tree no longer holds — so an empty
 * list is an answer and never a silence.
 *
 * A relative path is resolved against the working directory, which is what a person
 * typing one means. It sits among the intelligence reads: read-only, no `--actor`,
 * and `NO_PROJECT` outside a project, because an address is relative to a root.
 */

import type { Command } from 'commander';
import { here } from './context.js';
import { writeLines } from './io.js';
import { reportRefusal } from './report.js';
import { type Declared, readsTheRecord, type Wiring } from './verb.js';

/** Registers `mnema rules` on the program. */
export function registerRules(program: Command, wiring: Wiring): Declared {
  const { io, render } = wiring;
  const rules = program
    .command('rules')
    .description('show which recorded rules govern a path, and which address nothing')
    .argument('<path>', 'the path to ask about, relative to here or absolute')
    .option('--json', 'emit the faithful reading as JSON')
    .action(async (path: string, opts: { json?: boolean }) => {
      const { runRules } = await import('../commands/rules.js');
      const { rulesReport } = await import('../presentation/rules.js');
      const result = runRules(here(), { path });
      if (!result.ok) {
        reportRefusal(wiring, result, {});
        return;
      }
      if (opts.json === true) {
        io.out(JSON.stringify(result.governed, null, 2));
        return;
      }
      writeLines(io, rulesReport(render, result.governed));
    });
  return readsTheRecord(rules);
}
