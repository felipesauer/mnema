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
import { REFERENCE_DIRECTIONS, runReferences } from '../commands/references.js';
import { referenceReport } from '../presentation/references.js';
import { here } from './context.js';
import { writeLines } from './io.js';
import { NO_PROJECT } from './report.js';
import type { Wiring } from './verb.js';

/** Registers `mnema refs` on the program. */
export function registerReferences(program: Command, wiring: Wiring): void {
  const { io } = wiring;
  program
    .command('refs')
    .description('show what an entity is connected to across the trees')
    .argument('<id>', 'the entity id (a task, decision, memory, skill, …)')
    .option(
      '--direction <way>',
      `which way to follow edges: ${REFERENCE_DIRECTIONS.join(', ')}`,
      'both',
    )
    .option(
      '--depth <n>',
      `how many hops (max ${REFERENCE_MAX_DEPTH})`,
      String(REFERENCE_DEFAULT_DEPTH),
    )
    .option('--json', 'emit the faithful graph as JSON')
    .action((id: string, opts: { direction?: string; depth?: string; json?: boolean }) => {
      const depth = Number.parseInt(opts.depth ?? '', 10);
      if (Number.isNaN(depth)) {
        io.err(`Not a number of hops: ${opts.depth}`);
        io.fail();
        return;
      }
      const result = runReferences(here(), {
        id,
        depth,
        ...(opts.direction !== undefined ? { direction: opts.direction } : {}),
      });
      if (!result.ok) {
        // The bad direction names the value it refused, which is why this one is
        // worded here rather than through the shared refusal.
        if (result.reason === 'NO_PROJECT') {
          io.err(NO_PROJECT);
        } else {
          io.err(
            `Not a direction: ${result.direction}. One of: ${REFERENCE_DIRECTIONS.join(', ')}.`,
          );
        }
        io.fail();
        return;
      }
      if (opts.json === true) {
        io.out(JSON.stringify(result.graph, null, 2));
        return;
      }
      writeLines(io, referenceReport(result.graph));
    });
}
