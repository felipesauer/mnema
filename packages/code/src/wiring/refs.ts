/**
 * The `mnema refs` wiring: what it declares, and what it prints.
 *
 * `mnema refs <id> [--direction --depth] [--json]` — the graph reading of the
 * same index `timeline` reads: not the events that touch an entity but the
 * ENTITIES it connects to. One verb, two shapes: the default is the
 * neighbourhood (one hop, either way), and a direction with more depth is a
 * lineage. It says when the depth cut the answer, and reports a far end no tree
 * ever authored as unresolved rather than dropping it.
 */

import { REFERENCE_DEFAULT_DEPTH, REFERENCE_MAX_DEPTH } from '@mnema/copilot';
import type { Command } from 'commander';
import { REFERENCE_DIRECTIONS } from '../reference-directions.js';
import { here } from './context.js';
import { enumeratedOption, listed } from './enumerated.js';
import { writeLines } from './io.js';
import { reportRefusal, reportUsage } from './report.js';
import type { Wiring } from './verb.js';

/** Registers `mnema refs` on the program. */
export function registerReferences(program: Command, wiring: Wiring): void {
  const { io, render } = wiring;
  program
    .command('refs')
    .description('show what an entity is connected to across the trees')
    .argument('<id>', 'the entity id (a task, decision, memory, skill, …)')
    .addOption(
      enumeratedOption(
        '--direction <way>',
        `which way to follow edges: ${listed(REFERENCE_DIRECTIONS)}`,
        REFERENCE_DIRECTIONS,
      ).default('both'),
    )
    .option(
      '--depth <n>',
      `how many hops (max ${REFERENCE_MAX_DEPTH})`,
      String(REFERENCE_DEFAULT_DEPTH),
    )
    .option('--json', 'emit the faithful graph as JSON')
    .action(async (id: string, opts: { direction?: string; depth?: string; json?: boolean }) => {
      const { runReferences } = await import('../commands/references.js');
      const { referenceReport } = await import('../presentation/references.js');
      const depth = Number.parseInt(opts.depth ?? '', 10);
      if (Number.isNaN(depth)) {
        reportUsage(wiring, `Not a number of hops: ${opts.depth}`);
        return;
      }
      const result = runReferences(here(), {
        id,
        depth,
        ...(opts.direction !== undefined ? { direction: opts.direction } : {}),
      });
      if (!result.ok) {
        // Through the SHARED refusal, wording only the reason this verb knows about.
        // It used to write both of its own by hand, one of them re-typing the funnel's
        // own `NO_PROJECT` sentence — which is how a refusal ends up being the one line
        // on the surface that does not look like a refusal. `said` is keyed by reason,
        // so the bad direction still names the value it refused.
        reportRefusal(
          wiring,
          result,
          result.reason === 'NO_PROJECT'
            ? {}
            : {
                [result.reason]:
                  `Not a direction: ${result.direction}. ` +
                  `One of: ${REFERENCE_DIRECTIONS.join(', ')}.`,
              },
        );
        return;
      }
      if (opts.json === true) {
        io.out(JSON.stringify(result.graph, null, 2));
        return;
      }
      writeLines(io, referenceReport(render, result.graph));
    });
}
