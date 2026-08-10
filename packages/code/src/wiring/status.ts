/**
 * The `mnema status` wiring: what it declares, and what it prints.
 *
 * `mnema status --actor <id> [--json]` — where things stand: where the actor left off,
 * the actionable work, the adopted patterns, the decisions in force, and what is waiting
 * on somebody to rule on it.
 *
 * It is the OPENING read, and it is the same one the agent surface has always had — the
 * MCP's `bootstrap` tool and this verb call one derivation (`commands/status.ts`). The
 * name differs because the reader does: `bootstrap` is what an agent's opening call is
 * called, and `status` is what a person types when they want to know where things stand.
 */

import type { Command } from 'commander';
import { here } from './context.js';
import { writeLines } from './io.js';
import { ACTOR_HELP } from './options.js';
import { reportRefusal } from './report.js';
import { type Declared, readsTheRecord, type Wiring } from './verb.js';

/** Registers `mnema status` on the program. */
export function registerStatus(program: Command, wiring: Wiring): Declared {
  const { io, render } = wiring;
  const status = program
    .command('status')
    .description('show where things stand: the work, what governs, what awaits a ruling')
    .requiredOption('--actor <id>', `the identity whose session to report — ${ACTOR_HELP}`)
    .option('--json', 'emit the faithful opening context as JSON')
    .action(async (opts: { actor: string; json?: boolean }) => {
      const { anchorText } = await import('../anchors.js');
      const { runStatus } = await import('../commands/status.js');
      const { statusReport } = await import('../presentation/status.js');
      const result = runStatus(here(), { actor: opts.actor });
      if (!result.ok) {
        reportRefusal(wiring, result);
        return;
      }
      if (opts.json === true) {
        // The faithful object, byte for byte what the agent surface serves — which is
        // the property that keeps one derivation from becoming two.
        io.out(JSON.stringify(result.status, null, 2));
        return;
      }
      writeLines(
        io,
        statusReport(render, result.status, anchorText(result.anchors, result.status.resume.actor)),
      );
    });
  return readsTheRecord(status);
}
