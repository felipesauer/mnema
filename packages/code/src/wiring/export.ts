/**
 * The `mnema export` wiring: what it declares, and what it writes.
 *
 * `mnema export [--from --to --who --which]` — the record as a feed of audit facts, one
 * OCSF Entity Management event per line, for a SIEM that is not this machine.
 *
 * IT HAS NO `--json`, and the absence is the declaration. Every other read offers a human
 * summary and a faithful object behind a flag; this verb has no human summary to offer —
 * its whole output is the machine's, and NDJSON is what a SIEM ingests. A flag would
 * suggest there is another shape, and there is not.
 *
 * IT HAS NO `--format` EITHER. There is one format, chosen and argued for where the
 * mapping lives. A flag with a single value is a promise of a second one; the day a second
 * arrives, it earns the flag then.
 *
 * NDJSON means one object per line and nothing around it — no array wrapper, no trailing
 * comma, no header. A consumer reads a line, parses a line, and a truncated file costs the
 * last record rather than all of them.
 */

import type { Command } from 'commander';
import { here } from './context.js';
import { ACTOR_HELP } from './options.js';
import { reportRefusal } from './report.js';
import { type Declared, readsTheRecord, type Wiring } from './verb.js';

/** Registers `mnema export` on the program. */
export function registerExport(program: Command, wiring: Wiring): Declared {
  const { io } = wiring;
  const exported = program
    .command('export')
    .description('emit the record as an OCSF audit feed (NDJSON, envelope only — never a body)')
    .option('--from <iso>', 'include only facts at or after this ISO-8601 instant')
    .option('--to <iso>', 'include only facts at or before this ISO-8601 instant')
    .option('--who <id>', `include only facts authorized by this identity — ${ACTOR_HELP}`)
    // A FILTER over who already acted, not a declaration of who is acting — so it carries
    // no `declaredAgent` parser, exactly as `accountability`'s does not: nothing is being
    // attributed here, and a value naming no recorded agent is an empty feed, which is
    // what every filter with no match gives.
    .option('--which <agent>', 'include only facts executed by this agent')
    .action(async (opts: { from?: string; to?: string; who?: string; which?: string }) => {
      const { runExport } = await import('../commands/export.js');
      const result = runExport(here(), {
        ...(opts.from !== undefined ? { from: opts.from } : {}),
        ...(opts.to !== undefined ? { to: opts.to } : {}),
        ...(opts.who !== undefined ? { who: opts.who } : {}),
        ...(opts.which !== undefined ? { which: opts.which } : {}),
      });
      if (!result.ok) {
        reportRefusal(wiring, result);
        return;
      }
      // One line per event, each a complete JSON object. `JSON.stringify` with no spacing
      // is what keeps that true: a pretty-printed object spans lines, and the format's one
      // rule is that a line is a record.
      for (const event of result.events) io.out(JSON.stringify(event));
    });
  return readsTheRecord(exported);
}
