/**
 * The `mnema site` wiring: what it declares, and what it writes.
 *
 * `mnema site --out <dir>` — the project's committed record as one HTML file, with the
 * verifier inside it.
 *
 * IT HAS NO `--private` OR `--global`. The page is meant to be published, and what is
 * published is what the repository already shows everyone; an option that put a private tree
 * into it would be the one way to leak a note, so it does not exist. It writes `index.html`
 * under the directory named and nothing else, and records nothing in the record.
 */

import type { Command } from 'commander';
import { siteNotice, siteReport } from '../presentation/site.js';
import { here } from './context.js';
import { writeLines } from './io.js';
import { reportRefusal } from './report.js';
import { type Declared, readsTheRecord, type Wiring } from './verb.js';

/** Registers `mnema site` on the program. */
export function registerSite(program: Command, wiring: Wiring): Declared {
  const { io, render } = wiring;
  const site = program
    .command('site')
    .description(
      "write the project's committed record as one HTML page that verifies itself in the browser (records nothing)",
    )
    .requiredOption('--out <dir>', 'the directory index.html is written under')
    .addHelpText(
      'after',
      [
        '',
        'The page holds the committed (public) tree and nothing else: no private tree, no',
        "machine-global tree — and all of that tree's text, so publish it only where the",
        'repository itself may be read. It lists the decisions in force (a control shows the',
        'rest), their history and who authorized them, and the stored events. It also carries',
        'the files the record is made of, and the browser runs the same verifier as',
        '`mnema verify` over them, with no request and no key: the sentence on the page is the',
        'one `mnema verify` gives a fresh clone. It checks the chain and the checkpoint',
        'signatures; it does not check the lists on the page against the files. Everything is',
        'inside the one file: no script or style comes from elsewhere.',
        '',
        'Examples:',
        '  mnema site --out dist/record     write dist/record/index.html',
      ].join('\n'),
    )
    .action(async (opts: { out: string }) => {
      const { runSite } = await import('../commands/site.js');
      const result = runSite(here(), { out: opts.out });
      if (!result.ok) {
        reportRefusal(
          wiring,
          result,
          'message' in result ? { [result.reason]: result.message } : {},
        );
        return;
      }
      writeLines(io, siteReport(render, result));
      for (const line of siteNotice(result)) io.err(render(line));
    });
  return readsTheRecord(site);
}
