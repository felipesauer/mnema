/**
 * The `mnema promote` wiring: what it declares, and what it prints.
 *
 * One verb, two acts. WITHOUT an id it reads: `--workspace <path...>` names the projects
 * and it lists what recurs in them, with the same words and in force, appending nothing.
 * WITH an id it writes: `<id> --evidence <path>:<id> …` copies that pattern or decision to
 * this machine's global tree as a proposal and cites every instance it rests on
 * (`commands/promote.ts` has the whole of why).
 *
 * IT IS DECLARED A WRITE, because one of its two acts is, and a verb is classified by the
 * most it can do. So the console, which dispatches only to verbs that declare they read,
 * refuses it and says to run it outside — which is right for the second act and a small
 * cost for the first: what the console offers in its place is the sentence that says there
 * is something to list (`repl/promotable.ts`).
 *
 * IT IS THE CLI'S AND NOT THE AGENT'S. A verb an agent could call to move a pattern to the
 * file every project reads would invite the agent to promote; promoting is the person's
 * gesture, which is why the evidence is typed by them.
 */

import type { Command } from 'commander';
import { RECORD_CONTRACT_HELP } from '../recorded-content.js';
import { here } from './context.js';
import { writeLines } from './io.js';
import { reportRecorded, reportRefusal, reportUsage } from './report.js';
import { PIN_REFUSED } from './run-pin.js';
import { type Declared, mutatesTheRecord, type Wiring } from './verb.js';

const PROMOTE_HELP = [
  '',
  'Two acts:',
  '  mnema promote --workspace <path...>',
  '      lists what is in force, with the same words, in the committed record of two or',
  '      more of the projects you name. It writes nothing. The set is what you name and is',
  '      never searched for; a pattern or decision counts only if it is in force (adopted,',
  '      accepted) and only through the committed tree — a project’s private tree is',
  '      neither counted nor cited, because the copy goes where every project reads.',
  '  mnema promote <id> --evidence <path>:<id>',
  '      copies <id>, which is in the project you stand in, to this machine’s global tree;',
  '      repeat --evidence for each other project.',
  '      It is born proposed, carries no address, and cites each id given (and <id>) as',
  '      derived-from. It refuses, and appends nothing, anything the listing would not show.',
  '      Nothing is moved: the originals stay where they are. Adopt the copy with the verb',
  '      that moves a skill or a decision.',
  '"Same words" is compared after NFC, trimming and collapsing whitespace, and not after',
  'that: a skill is its name and body, a decision its title and rationale.',
].join('\n');

/** Registers `mnema promote` on the program. */
export function registerPromote(program: Command, wiring: Wiring): Declared {
  const { io, render, pinnedRun } = wiring;
  const promote = program
    .command('promote')
    .description('list what recurs across projects, or copy one pattern to the global tree')
    .argument('[id]', 'the pattern or decision in this project to copy to the global tree')
    .option(
      '--workspace <path...>',
      'list the patterns and decisions in force, with the same words, in the committed ' +
        'record of the projects at these paths (writes nothing)',
    )
    .option(
      '--evidence <path:id>',
      'with <id>: another project and the id of the same pattern there (repeatable)',
      (value: string, previous: string[] = []) => [...previous, value],
    )
    .addHelpText('after', PROMOTE_HELP)
    .addHelpText('after', RECORD_CONTRACT_HELP);
  promote.action(
    async (id: string | undefined, opts: { workspace?: string[]; evidence?: string[] }) => {
      if (id === undefined) {
        if (opts.evidence !== undefined) {
          reportUsage(
            wiring,
            '`--evidence` is for copying one id, and none was given',
            'Run `mnema promote <id> --evidence <path>:<id>`, or `mnema promote --workspace <path...>` to list.',
          );
          return;
        }
        if (opts.workspace === undefined) {
          reportUsage(
            wiring,
            'name the projects to read, or the id to promote',
            'Run `mnema promote --workspace <path...>` to list what recurs, then `mnema promote <id> --evidence <path>:<id>`.',
          );
          return;
        }
        const { runPromoteList } = await import('../commands/promote.js');
        const { promotionCandidates } = await import('../presentation/promoted.js');
        writeLines(
          io,
          promotionCandidates(render, runPromoteList(here(), { named: opts.workspace })),
        );
        return;
      }
      if (opts.workspace !== undefined) {
        reportUsage(
          wiring,
          '`--workspace` lists and `<id>` copies, and they are two acts',
          'List with `mnema promote --workspace <path...>`; copy with `mnema promote <id> --evidence <path>:<id>`.',
        );
        return;
      }
      const run = pinnedRun();
      if (run === PIN_REFUSED) {
        io.fail();
        return;
      }
      const { runPromote } = await import('../commands/promote.js');
      const { promotionDone } = await import('../presentation/promoted.js');
      const result = runPromote(here(), {
        id,
        evidence: opts.evidence ?? [],
        ...(run !== undefined ? { run } : {}),
      });
      if (result.ok) {
        writeLines(io, promotionDone(render, result));
        reportRecorded(result, io);
        return;
      }
      reportRefusal(wiring, result);
    },
  );
  return mutatesTheRecord(promote);
}
