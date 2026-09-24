/**
 * The `mnema accountability` wiring: what it declares, and what it prints.
 *
 * `mnema accountability [--from --to --who --which] [--json]` — who authorized
 * what over the whole record. No filter = everything (git shortlog -sn); the
 * flags only narrow. The human summary is one level (total, and one line per
 * who with their count); the nested byKind/byWhich is in --json. Beside each
 * author, both forms carry where and when its identity was founded beside
 * others, from one selection (`foundedBesideOf`).
 */

import type { Command } from 'commander';
import { itemLine } from '../presentation/items.js';
import { windowGloss, windowHelp } from '../vocabulary.js';
import { here } from './context.js';
import { ACTOR_HELP } from './options.js';
import { reportRefusal } from './report.js';
import { type Declared, readsTheRecord, type Wiring } from './verb.js';

/** Registers `mnema accountability` on the program. */
export function registerAccountability(program: Command, wiring: Wiring): Declared {
  const { io, render } = wiring;
  const accountability = program
    .command('accountability')
    .description('show who authorized what across the record (optionally windowed/filtered)')
    .option('--from <iso>', windowGloss('from', 'fact'))
    .option('--to <iso>', windowGloss('to', 'fact'))
    .addHelpText('after', windowHelp('fact'))
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
        const { linkBreakNotice } = await import('./integrity.js');
        const { foundedBesideOf, runAccountability } = await import(
          '../commands/accountability.js'
        );
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
        // BEFORE the answer, and on the other stream — so it survives a pipe, and so
        // `--json` stays the machine-readable thing it promises to be.
        for (const line of linkBreakNotice(result.linkBreaks)) io.err(render(line));
        if (opts.json === true) {
          // The account, and in each author's entry the foundings the line below prints beside
          // that author: every one in a tree where other identities were already founded, with
          // the tree, the instant, and the identities that were there. Always present, empty
          // for an author who founded first, so a reader can tell "none" from "not reported".
          io.out(
            JSON.stringify(
              {
                ...result.account,
                byWho: result.account.byWho.map((account) => ({
                  ...account,
                  foundedBeside: foundedBesideOf(result, account.who),
                })),
              },
              null,
              2,
            ),
          );
          return;
        }
        // Human summary — one level. The total and one line per author with their
        // count; the per-kind and per-agent breakdown stays in --json.
        //
        // AND, BESIDE AN AUTHOR WHOSE IDENTITY WAS FOUNDED WHERE OTHERS ALREADY WERE, where and
        // when: the count says there are two authors, and this says which one arrived second —
        // somebody new, or the same person under another key, which only the reader can tell.
        const { total, byWho } = result.account;
        io.out(`${total} fact(s) · ${byWho.length} author(s)`);
        for (const account of byWho) {
          const founded = foundedBesideOf(result, account.who).map(
            ({ scope, at, besides }) =>
              `founded beside ${besides.length} other(s) in the ${scope} tree, ${at}`,
          );
          io.out(
            render(
              itemLine([
                anchorText(result.anchors, account.who),
                String(account.total),
                ...founded,
              ]),
            ),
          );
        }
      },
    );
  return readsTheRecord(accountability);
}
