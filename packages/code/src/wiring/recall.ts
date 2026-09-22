/**
 * The `mnema recall` wiring: what it declares, and what it prints.
 *
 * `mnema recall` — the latest memories and observations recorded for this project, out of
 * every tree this machine holds for it, as the markdown a session opens with beside the
 * document `mnema brief` prints. The plugin's second `SessionStart` handler runs it; a
 * person runs it to see what that session is handed.
 *
 * IT TAKES NO OPTIONS, and the absences are decided the way `brief`'s are. No `--scope`:
 * what it reads is every tree, and that is the point of it — a note an agent records lands
 * in the tree that does not travel, and a scope flag would be a way to leave out exactly
 * the notes this verb exists to bring back. No `--limit`: the cut is the index's own, so
 * this text and `mnema search --kind memory` cannot disagree about which notes are the
 * latest. No `--json`: `mnema search --json` already is that answer, byte for byte.
 *
 * IT IS NOT A FILE, AND THE HELP SAYS SO BEFORE ANYTHING ELSE. It prints what was kept on
 * this machine as well as what was committed, so redirecting it into a tracked file would
 * put a machine's private notes into the repository — which is the defect `mnema brief` was
 * corrected for, and why this is a verb of its own and not a flag of that one.
 *
 * AND IT PRINTS NOTHING WHEN NOTHING IS RECORDED, with a zero exit: a session in a project
 * with no notes is handed no text, and a person who ran it has been told the same thing by
 * the empty answer. Its two refusals are `brief`'s — outside a project, and switched off —
 * in `brief`'s words ({@link switchedOff}), on stderr with a non-zero exit, which is what
 * the plugin's handler treats as silence.
 */

import type { Command } from 'commander';
import { switchedOff } from './brief.js';
import { here } from './context.js';
import { writeLines } from './io.js';
import { reportRefusal } from './report.js';
import { type Declared, readsTheRecord, type Wiring } from './verb.js';

/** Registers `mnema recall` on the program. */
export function registerRecall(program: Command, wiring: Wiring): Declared {
  const { io, render } = wiring;
  const recall = program
    .command('recall')
    .description('print the latest notes recorded here as markdown, for an agent to read')
    .addHelpText(
      'after',
      [
        '',
        'It prints to stdout and writes nothing. It is what a session opens with beside the',
        'document `mnema brief` prints: the memories and the observations recorded for this',
        'project, newest first, one line each — out of EVERY tree this machine holds for it,',
        'the committed one, this machine’s own and your personal one.',
        'So it is NOT a file to commit: `mnema brief` carries the committed record and is',
        'written to be redirected into one; this carries what was kept on this machine too.',
        '',
        'Each line is the one the record already knows a note by — an observation’s topic,',
        'the start of a memory — with the id `mnema show <id>` reads whole. The newest of',
        'each kind, cut where `mnema search` cuts, and it says how many there are in all',
        'when there are more.',
        'It prints NOTHING when nothing is recorded, so a session opens with nothing added.',
        'It can be switched off (`mnema switch off recall-document`), and then it refuses.',
      ].join('\n'),
    )
    .action(async () => {
      const { linkBreakNotice } = await import('./integrity.js');
      const { runRecall } = await import('../commands/recall.js');
      const { recallDocument } = await import('../presentation/recall.js');
      const result = runRecall(here());
      if (!result.ok) {
        reportRefusal(
          wiring,
          result,
          result.reason === 'SWITCHED_OFF' ? { SWITCHED_OFF: switchedOff(result) } : {},
        );
        return;
      }
      // On `err`, as `brief` puts it: the state of the record's proof qualifies the notes,
      // and the plugin's handler hands that stream over under them when the verb succeeded.
      for (const line of linkBreakNotice(result.linkBreaks)) io.err(render(line));
      writeLines(io, recallDocument(result));
    });
  return readsTheRecord(recall);
}
