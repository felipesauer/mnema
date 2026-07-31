/**
 * The `mnema antipatterns` wiring: what it declares, and what it prints.
 *
 * `mnema antipatterns [--json]` — recurring shapes with their evidence. The
 * human summary is a count per category plus the candidate ids pointed at; the
 * full evidence per finding is in --json. It POINTS, never CONCLUDES.
 */

import type { Command } from 'commander';
import { runAntipatterns } from '../commands/antipatterns.js';
import { statement } from '../presentation/verdict.js';
import { here } from './context.js';
import { reportRefusal } from './report.js';
import type { Wiring } from './verb.js';

/** Registers `mnema antipatterns` on the program. */
export function registerAntipatterns(program: Command, wiring: Wiring): void {
  const { io } = wiring;
  program
    .command('antipatterns')
    .description('show recurring shapes in the record (reopens, supersessions, deprecations)')
    .option('--json', 'emit the faithful shapes with their evidence as JSON')
    .action((opts: { json?: boolean }) => {
      const result = runAntipatterns(here());
      if (!result.ok) {
        reportRefusal(io, result);
        return;
      }
      if (opts.json === true) {
        io.out(JSON.stringify(result.patterns, null, 2));
        return;
      }
      // Human summary — one level: a count per category, then the skill candidates
      // as pointed-at ids. Nothing calls a count good or bad; the evidence per
      // finding is in --json.
      const { reopenedTasks, supersededDecisions, deprecatedSkills, skillCandidates } =
        result.patterns;
      io.out(statement('reopened tasks', String(reopenedTasks.length)));
      io.out(statement('superseded decisions', String(supersededDecisions.length)));
      io.out(statement('deprecated skills', String(deprecatedSkills.length)));
      if (skillCandidates.length > 0) {
        io.out(
          statement(
            'skill candidates (reopened >1×)',
            skillCandidates.map((f) => f.entityId).join(', '),
          ),
        );
      }
    });
}
