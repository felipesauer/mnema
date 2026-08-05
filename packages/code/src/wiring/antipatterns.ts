/**
 * The `mnema antipatterns` wiring: what it declares, and what it prints.
 *
 * `mnema antipatterns [--json]` — recurring shapes with their evidence. The
 * human summary is a count per category plus the candidate ids pointed at; the
 * full evidence per finding is in --json. It POINTS, never CONCLUDES.
 *
 * A label naming more than one rule is the one shape printed as its own line rather
 * than as a count, and the ids are the reason: a reader told that a citation is
 * ambiguous and not told which rules hold the label cannot do anything about it. It
 * is printed only when there is one — an always-present "labels: 0" would be a line
 * every reader of every project learns to skip.
 */

import type { Command } from 'commander';
import { runAntipatterns } from '../commands/antipatterns.js';
import { statement } from '../presentation/verdict.js';
import { oneLine } from '../served-patterns.js';
import { here } from './context.js';
import { reportRefusal } from './report.js';
import type { Wiring } from './verb.js';

/** Registers `mnema antipatterns` on the program. */
export function registerAntipatterns(program: Command, wiring: Wiring): void {
  const { io, render } = wiring;
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
      const {
        reopenedTasks,
        supersededDecisions,
        deprecatedSkills,
        skillCandidates,
        labelCollisions,
      } = result.patterns;
      io.out(render(statement('reopened tasks', String(reopenedTasks.length))));
      io.out(render(statement('superseded decisions', String(supersededDecisions.length))));
      io.out(render(statement('deprecated skills', String(deprecatedSkills.length))));
      if (skillCandidates.length > 0) {
        io.out(
          render(
            statement(
              'skill candidates (reopened >1×)',
              skillCandidates.map((f) => f.entityId).join(', '),
            ),
          ),
        );
      }
      for (const collision of labelCollisions) {
        // Both fields are read out of the record, and a record can be appended to by
        // anything holding a key — so neither reaches the line as it was written.
        io.out(
          render(
            statement(
              `label naming more than one rule (${oneLine(collision.adr)})`,
              collision.ids.map((id) => oneLine(id)).join(', '),
            ),
          ),
        );
      }
    });
}
