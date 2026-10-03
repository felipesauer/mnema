/**
 * The wiring of the git bridge: `mnema trailer`, `mnema commits`, `mnema why` and `mnema aging`.
 *
 * A commit carries the change and the record carries the reasoning; the bridge between them is a
 * trailer in the commit message, `Mnema-Decision: <ADR-n | id>`. `trailer` prints the line for
 * a decision so a person does not type an id; `commits`, `why` and `aging` read the git log against
 * the record AS THEY ARE ASKED. None of the four writes to the record — not a pointer to a commit,
 * not a count — because a commit can disappear in a rebase and a signed pointer at nothing cannot
 * be checked. They sit among the reads: no `--actor`, and `NO_PROJECT` outside a project.
 *
 * A directory with no git work tree is not an error for any of them: the page says there is no git
 * here and the exit is clean.
 */

import type { Command } from 'commander';
import { here } from './context.js';
import { writeLines } from './io.js';
import { reportRefusal, reportUsage } from './report.js';
import { type Declared, readsTheRecord, type Wiring } from './verb.js';

/** The wording of the two refusals every verb here can answer with. */
function nameRefusals(
  refusal:
    | { readonly reason: 'NO_SUCH_DECISION'; readonly typed: string }
    | {
        readonly reason: 'AMBIGUOUS_LABEL';
        readonly typed: string;
        readonly ids: readonly string[];
      },
): Record<string, string> {
  return refusal.reason === 'NO_SUCH_DECISION'
    ? { NO_SUCH_DECISION: `No decision ${refusal.typed} here.` }
    : {
        AMBIGUOUS_LABEL: `${refusal.typed} is carried by ${refusal.ids.length} decisions here (${refusal.ids.join(', ')}). Use the id of the one you mean.`,
      };
}

/** Registers `mnema trailer`. */
export function registerTrailer(program: Command, wiring: Wiring): Declared {
  const { io } = wiring;
  const trailer = program
    .command('trailer')
    .description('print the commit trailer that ties a commit to a decision')
    .argument('<decision>', 'the decision, by id or by ADR label')
    .option('--id', 'carry the id instead of the label')
    .option('--json', 'emit the line as JSON')
    .action(async (decision: string, opts: { id?: boolean; json?: boolean }) => {
      const { runTrailer } = await import('../commands/trailer.js');
      const result = runTrailer(here(), { decision, byId: opts.id === true });
      if (!result.ok) {
        reportRefusal(wiring, result, result.reason === 'NO_PROJECT' ? {} : nameRefusals(result));
        return;
      }
      if (opts.json === true) {
        io.out(JSON.stringify({ line: result.line }, null, 2));
        return;
      }
      // The line and nothing else, so `$(mnema trailer ADR-4)` is the trailer.
      io.out(result.line);
    });
  return readsTheRecord(trailer);
}

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
        const { linkBreaks: _, ...reading } = result;
        io.out(JSON.stringify(reading, null, 2));
        return;
      }
      writeLines(io, commitsReport(render, result));
    });
  return readsTheRecord(commits);
}

/** Registers `mnema why`. */
export function registerWhy(program: Command, wiring: Wiring): Declared {
  const { io, render } = wiring;
  const why = program
    .command('why')
    .description('show under which decisions a file or a commit stands')
    .argument('<file|commit>', 'a path (it wins when it exists) or a commit name')
    .option('--json', 'emit the faithful reading as JSON')
    .action(async (target: string, opts: { json?: boolean }) => {
      const { linkBreakNotice } = await import('./integrity.js');
      const { runWhy } = await import('../commands/why.js');
      const { whyReport } = await import('../presentation/git-bridge.js');
      const result = runWhy(here(), { target });
      if (!result.ok) {
        reportRefusal(wiring, result, {});
        return;
      }
      for (const line of linkBreakNotice(result.linkBreaks)) io.err(render(line));
      if (opts.json === true) {
        const { linkBreaks: _, ...reading } = result;
        io.out(JSON.stringify(reading, null, 2));
        return;
      }
      writeLines(io, whyReport(render, result));
    });
  return readsTheRecord(why);
}

/** Registers `mnema aging`. */
export function registerAging(program: Command, wiring: Wiring): Declared {
  const { io, render } = wiring;
  const aging = program
    .command('aging')
    .description('show accepted decisions whose addressed paths changed in many commits since')
    .option('--min-commits <n>', 'commits on its paths since acceptance to be listed (default 20)')
    .option('--json', 'emit the faithful reading as JSON')
    .action(async (opts: { minCommits?: string; json?: boolean }) => {
      const { linkBreakNotice } = await import('./integrity.js');
      const { runAging, DEFAULT_MIN_COMMITS } = await import('../commands/aging.js');
      const { agingReport } = await import('../presentation/git-bridge.js');
      const asked = opts.minCommits === undefined ? DEFAULT_MIN_COMMITS : Number(opts.minCommits);
      if (!Number.isInteger(asked) || asked < 1) {
        reportUsage(wiring, `Not a number of commits: ${opts.minCommits}`);
        return;
      }
      const result = runAging(here(), { minCommits: asked });
      if (!result.ok) {
        reportRefusal(wiring, result, {});
        return;
      }
      for (const line of linkBreakNotice(result.linkBreaks)) io.err(render(line));
      if (opts.json === true) {
        const { linkBreaks: _, ...reading } = result;
        io.out(JSON.stringify(reading, null, 2));
        return;
      }
      writeLines(io, agingReport(render, result));
    });
  return readsTheRecord(aging);
}
