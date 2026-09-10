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
import { fact } from '../presentation/detail.js';
import { globalTreeGloss, windowGloss, windowHelp } from '../vocabulary.js';
import { here } from './context.js';
import { ACTOR_HELP } from './options.js';
import { reportRefusal } from './report.js';
import { type Declared, readsTheRecord, type Wiring } from './verb.js';

/** Registers `mnema export` on the program. */
export function registerExport(program: Command, wiring: Wiring): Declared {
  const { io, render } = wiring;
  const exported = program
    .command('export')
    .description('emit the record as an OCSF audit feed (NDJSON, envelope only — never a body)')
    .option('--from <iso>', windowGloss('from', 'fact'))
    .option('--to <iso>', windowGloss('to', 'fact'))
    .addHelpText('after', windowHelp('fact'))
    .option('--who <id>', `include only facts authorized by this identity — ${ACTOR_HELP}`)
    // A FILTER over who already acted, not a declaration of who is acting — so it carries
    // no `declaredAgent` parser, exactly as `accountability`'s does not: nothing is being
    // attributed here, and a value naming no recorded agent is an empty feed, which is
    // what every filter with no match gives.
    .option('--which <agent>', 'include only facts executed by this agent')
    .option('--global', globalTreeGloss('and this is the only read that leaves the machine'), false)
    .action(
      async (opts: {
        from?: string;
        to?: string;
        who?: string;
        which?: string;
        global: boolean;
      }) => {
        const { runExport } = await import('../commands/export.js');
        const result = runExport(here(), {
          ...(opts.from !== undefined ? { from: opts.from } : {}),
          ...(opts.to !== undefined ? { to: opts.to } : {}),
          ...(opts.who !== undefined ? { who: opts.who } : {}),
          ...(opts.which !== undefined ? { which: opts.which } : {}),
          global: opts.global,
        });
        if (!result.ok) {
          reportRefusal(wiring, result);
          return;
        }
        // WHAT THE FEED COVERS, on the channel the feed is not on. NDJSON has no header
        // and no line declares the set, so a filtered feed is byte-indistinguishable
        // from a complete one — "no global fact exists" and "the global tree was left
        // out" arrive identical. It goes to stderr because stdout carries the feed: a
        // consumer piping this into a SIEM must receive records and nothing else, and
        // whoever is watching the terminal is the party who needs to know what they are
        // about to forward.
        io.err(render(fact(`covering: ${result.trees.join(', ')}`)));
        // One line per event, each a complete JSON object. `JSON.stringify` with no spacing
        // is what keeps that true: a pretty-printed object spans lines, and the format's one
        // rule is that a line is a record.
        for (const event of result.events) io.out(JSON.stringify(event));
      },
    );
  return readsTheRecord(exported);
}
