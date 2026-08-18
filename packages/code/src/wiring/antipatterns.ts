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
 *
 * THE PATTERN MOVES ARE THREE COUNTS AND THEY ARE ALL THREE ALWAYS PRINTED, which is
 * the opposite call from the one above and rests on what a zero MEANS in each place. A
 * missing label collision is nothing — there was no clash. A zero here is one of the
 * three answers the reading gives, and a report that printed only the middle one would
 * leave a reader believing every move it did not name had been checked. The three
 * together are the truth table, and the last of them is the reading's own limit: a move
 * whose run recorded no consultation at all is NOT OBSERVABLE, never a move made
 * without consulting.
 *
 * The ids of the accused are pointed at on a line of their own, for the same reason the
 * label collision names its rules and printed under the same condition — only when
 * there is one. It is the one line here that asserts something, and the words that
 * assert it appear nowhere else on the page: a reading whose accusing sentence is also
 * a column header accuses on every record it is ever run over.
 *
 * THE NOTE CLOSES THE PAGE and it is not a footer, exactly as `usage`'s closing
 * statement is not. It says what a consultation comes from and therefore what its
 * absence can mean, and it is on the page rather than in the `--help` because a count
 * of "moves with none" read without it is a list of names.
 */

import type { Command } from 'commander';
import { statement } from '../presentation/verdict.js';
import { here } from './context.js';
import { onOneLine } from './on-one-line.js';
import { reportRefusal } from './report.js';
import { type Declared, readsTheRecord, type Wiring } from './verb.js';

/** Registers `mnema antipatterns` on the program. */
export function registerAntipatterns(program: Command, wiring: Wiring): Declared {
  const { io, render } = wiring;
  const antipatterns = program
    .command('antipatterns')
    .description('show recurring shapes in the record (reopens, supersessions, deprecations)')
    .option('--json', 'emit the faithful shapes with their evidence as JSON')
    .action(async (opts: { json?: boolean }) => {
      const { runAntipatterns } = await import('../commands/antipatterns.js');
      const result = runAntipatterns(here());
      if (!result.ok) {
        reportRefusal(wiring, result);
        return;
      }
      if (opts.json === true) {
        // The shapes, and the reading that rides beside them under a name of its own.
        // The note travels INSIDE the JSON for the reason it is on the page: whoever
        // pipes this into something else is the reader most likely to never see the
        // prose beside it.
        io.out(JSON.stringify({ ...result.patterns, patternMoves: result.moves }, null, 2));
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
      const moves = result.moves;
      io.out(render(statement('reopened tasks', String(reopenedTasks.length))));
      io.out(render(statement('superseded decisions', String(supersededDecisions.length))));
      io.out(render(statement('deprecated skills', String(deprecatedSkills.length))));
      io.out(
        render(
          statement(
            'pattern moves with a consultation in the same run',
            String(moves.consulted.length),
          ),
        ),
      );
      io.out(
        render(
          statement(
            'pattern moves with none, in a run that recorded others',
            String(moves.movedWithoutConsulting.length),
          ),
        ),
      );
      io.out(
        render(
          statement(
            'pattern moves in a run with no consultation at all',
            String(moves.notObservable.length),
          ),
        ),
      );
      if (skillCandidates.length > 0) {
        io.out(
          render(
            statement(
              'skill candidates (reopened >1×)',
              skillCandidates.map((f) => onOneLine`${f.entityId}`).join(', '),
            ),
          ),
        );
      }
      if (moves.movedWithoutConsulting.length > 0) {
        // The one assertion on this page, and the only place its words appear. The id
        // is the record's and the action is a closed word of the skill workflow, so
        // neither can hold a break today — collapsed anyway, for the reason the sibling
        // list above it is: the rule is about a value that came out of the record.
        io.out(
          render(
            statement(
              'moved without consulting it',
              moves.movedWithoutConsulting
                .map((move) => onOneLine`${move.skill} (${move.action})`)
                .join(', '),
            ),
          ),
        );
      }
      for (const collision of labelCollisions) {
        // Both fields are read out of the record, and a record can be appended to by
        // anything holding a key — so neither reaches the line as it was written. The
        // candidates above are the same kind of value and had no collapse at all: two
        // sibling readings, one of which had paid the rule and the other had not.
        io.out(
          render(
            statement(
              onOneLine`label naming more than one rule (${collision.adr})`,
              collision.ids.map((id) => onOneLine`${id}`).join(', '),
            ),
          ),
        );
      }
      // The blank line then the note, the shape `usage` closes with: what the counts
      // above can and cannot mean, in the answer rather than beside it.
      io.out('');
      io.out(moves.note);
    });
  return readsTheRecord(antipatterns);
}
