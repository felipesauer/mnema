/**
 * The `mnema commits` wiring: what it declares, and what it prints.
 *
 * `mnema commits <decision> [--json]` — the commits that cite a decision by trailer and, apart, the
 * commits that touched the paths it addresses, read from git when asked. Nothing is written to the
 * record: a commit can vanish in a rebase, and a signed pointer at nothing cannot be checked. A
 * directory with no git work tree is answered with a sentence saying so, and exit 0.
 */

import type { Command } from 'commander';
import { here } from './context.js';
import { writeLines } from './io.js';
import { nameRefusals } from './no-such-decision.js';
import { reportRefusal } from './report.js';
import { type Declared, readsTheRecord, type Wiring } from './verb.js';

/** Registers `mnema commits`. */
export function registerCommits(program: Command, wiring: Wiring): Declared {
  const { io, render } = wiring;
  const commits = program
    .command('commits')
    .description('show the commits that cite a decision and those that touched what it addresses')
    .argument('<decision>', 'the decision, by id or by ADR label')
    .option('--json', 'emit the faithful reading as JSON')
    .action(async (decision: string, opts: { json?: boolean }) => {
      const { linkBreakNotice } = await import('./integrity.js');
      const { runCommits } = await import('../commands/commits.js');
      const { commitsReport } = await import('../presentation/git-bridge.js');
      const result = runCommits(here(), { decision });
      if (!result.ok) {
        reportRefusal(wiring, result, result.reason === 'NO_PROJECT' ? {} : nameRefusals(result));
        return;
      }
      for (const line of linkBreakNotice(result.linkBreaks)) io.err(render(line));
      if (opts.json === true) {
        const { linkBreaks: _breaks, ok: _ok, ...reading } = result;
        io.out(JSON.stringify(reading, null, 2));
        return;
      }
      writeLines(io, commitsReport(render, result));
    });
  return readsTheRecord(commits);
}
