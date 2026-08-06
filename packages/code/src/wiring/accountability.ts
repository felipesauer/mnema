/**
 * The `mnema accountability` wiring: what it declares, and what it prints.
 *
 * `mnema accountability [--from --to --who --which] [--json]` — who authorized
 * what over the whole record. No filter = everything (git shortlog -sn); the
 * flags only narrow. The human summary is one level (total, and one line per
 * who with their count); the nested byKind/byWhich is in --json.
 */

import type { Command } from 'commander';
import { itemLine } from '../presentation/items.js';
import { here } from './context.js';
import { ACTOR_HELP } from './options.js';
import { reportRefusal } from './report.js';
import type { Wiring } from './verb.js';

/** Registers `mnema accountability` on the program. */
export function registerAccountability(program: Command, wiring: Wiring): void {
  const { io, render } = wiring;
  program
    .command('accountability')
    .description('show who authorized what across the record (optionally windowed/filtered)')
    .option('--from <iso>', 'include only facts at or after this ISO-8601 instant')
    .option('--to <iso>', 'include only facts at or before this ISO-8601 instant')
    .option('--who <id>', `count only facts authorized by this identity — ${ACTOR_HELP}`)
    // The one `--which` that is NOT a declaration of who acted but a FILTER over
    // who already did, so it carries no {@link declaredAgent}: nothing is being
    // attributed here, and a value that matches no recorded agent is an empty
    // answer, which is what every other filter with no match gives too.
    .option('--which <agent>', 'count only facts executed by this agent')
    .option('--json', 'emit the faithful account object as JSON')
    .action(
      async (opts: {
        from?: string;
        to?: string;
        who?: string;
        which?: string;
        json?: boolean;
      }) => {
        const { anchorText } = await import('../anchors.js');
        const { runAccountability } = await import('../commands/accountability.js');
        const result = runAccountability(here(), {
          ...(opts.from !== undefined ? { from: opts.from } : {}),
          ...(opts.to !== undefined ? { to: opts.to } : {}),
          ...(opts.who !== undefined ? { who: opts.who } : {}),
          ...(opts.which !== undefined ? { which: opts.which } : {}),
        });
        if (!result.ok) {
          reportRefusal(wiring, result);
          return;
        }
        if (opts.json === true) {
          io.out(JSON.stringify(result.account, null, 2));
          return;
        }
        // Human summary — one level. The total and one line per author with their
        // count; the per-kind and per-agent breakdown stays in --json.
        const { total, byWho } = result.account;
        io.out(`${total} fact(s) · ${byWho.length} author(s)`);
        for (const account of byWho) {
          io.out(
            render(itemLine([anchorText(result.anchors, account.who), String(account.total)])),
          );
        }
      },
    );
}
