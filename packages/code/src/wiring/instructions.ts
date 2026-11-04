/**
 * The `mnema instructions` wiring: what it declares, and what it prints.
 *
 * `mnema instructions` writes the block of standing instructions (ADR-46) into the files an agent
 * host reads at the start of a session, in the project the working directory is in; `--check` says
 * what each file holds and writes nothing; `--remove` takes the block out. One line a file. A file
 * whose block somebody edited is left as it is and said, and the run exits 1; so does a `--check`
 * that finds a file without this version's block.
 *
 * IT READS THE RECORD'S SIDE OF NOTHING: what it writes are the person's files, the way
 * `mnema doctor --fix` writes a host's settings, so it is declared a read of the record.
 */

import type { Command } from 'commander';
import { fact } from '../presentation/detail.js';
import { here } from './context.js';
import { HOSTS_HELP, HOSTS_NOT_UNDERSTOOD, HOSTS_OFFERED, HOSTS_WORDS } from './init.js';
import { reportRefusal, reportUsage } from './report.js';
import { type Declared, readsTheRecord, type Wiring } from './verb.js';

/** Registers `mnema instructions` on the program. */
export function registerInstructions(program: Command, wiring: Wiring): Declared {
  const { io, render } = wiring;
  const verb = program
    .command('instructions')
    .description(
      'write the mnema instructions into the files an agent host reads (AGENTS.md and its kin), check them, or remove them',
    )
    .option('--check', 'say what each file holds of the instructions, and write nothing')
    .option('--remove', 'take the instructions out of each file')
    .option('--hosts <list>', HOSTS_HELP)
    .option(
      '--all-hosts',
      'write AGENTS.md and the three files of mnema’s own, asking nothing and whichever are there',
    )
    .addHelpText(
      'after',
      [
        '',
        'The files:',
        '  AGENTS.md, created where there is none; CLAUDE.md, .claude/CLAUDE.md and GEMINI.md where',
        '  they exist; and three files of mnema’s own: .claude/rules/mnema-instructions.md,',
        '  .github/instructions/mnema-instructions.instructions.md and',
        '  .cursor/rules/mnema-instructions.mdc.',
        '',
        'The instructions sit between <!-- mnema:begin … --> and <!-- mnema:end -->, after what a',
        'file of yours holds; nothing outside the markers is changed. A block whose text is not one',
        'mnema wrote is left as it is and said, never overwritten; so is a link that leaves the',
        'project or leads nowhere, and a file that cannot be read or written (said with why, and',
        'the command to try again). `mnema init` writes them when it founds a project, and never',
        'again.',
        '',
        'The files on disk are the choice: where some of AGENTS.md and the three files of mnema’s own',
        'hold the instructions, those are written, checked and removed, and the others are not',
        'expected; where none does, a terminal is asked which hosts (arrows and space to mark, Enter',
        'to confirm; a CLAUDE.md or GEMINI.md that exists is a mark of its own), and without one all',
        'four are written. --all-hosts writes all four, whichever are there. --hosts writes only the hosts',
        'it names (claude, cursor, vscode, codex; a person’s CLAUDE.md or GEMINI.md under the host that',
        'is named), which is how to add the block to one file without writing the others.',
      ].join('\n'),
    )
    .action(
      async (opts: { check?: boolean; remove?: boolean; allHosts?: boolean; hosts?: string }) => {
        if (opts.check === true && opts.remove === true) {
          reportUsage(wiring, '--check and --remove cannot be given together.');
          return;
        }
        if (opts.allHosts === true && (opts.remove === true || opts.check === true)) {
          reportUsage(wiring, '--all-hosts writes, and cannot be given with --check or --remove.');
          return;
        }
        if (
          opts.hosts !== undefined &&
          (opts.remove === true || opts.check === true || opts.allHosts === true)
        ) {
          reportUsage(
            wiring,
            '--hosts writes, and cannot be given with --check, --remove or --all-hosts.',
          );
          return;
        }
        const { dirname } = await import('node:path');
        const { resolveTrees } = await import('@mnema/core');
        const ctx = here();
        const project = resolveTrees(ctx.cwd, ctx.env).projectPublic;
        if (project === undefined) {
          reportRefusal(wiring, { reason: 'NO_PROJECT' });
          return;
        }
        const root = dirname(project);
        const {
          changeLine,
          checkInstructions,
          leftOut,
          leftOutLine,
          chosenOnDisk,
          EVERY_HOST_FILE,
          instructionsAreCurrent,
          removeInstructions,
          stateLine,
          writeInstructions,
        } = await import('../commands/instructions.js');
        if (opts.check === true) {
          const files = checkInstructions(root);
          for (const file of files) io.out(render(fact(stateLine(file))));
          const out = leftOut(root);
          if (out.length > 0) io.out(render(fact(leftOutLine(out))));
          if (!instructionsAreCurrent(files)) io.fail();
          return;
        }
        let choice: readonly string[] | undefined;
        let yours: readonly string[] | undefined;
        if (opts.allHosts === true) choice = EVERY_HOST_FILE;
        else if (opts.hosts !== undefined) {
          // THE SAME PARSER AND THE SAME MARKS AS `mnema init --hosts` (`init/hosts.ts`, `init/flow.ts`): the hosts
          // named, and a person's file under them where it exists, and nothing written to the rest.
          const { readHostsFlag, ownFilesOf, yoursOf } = await import('../init/hosts.js');
          const { detectAround } = await import('../init/detect.js');
          const { marksForHosts } = await import('../init/flow.js');
          const asked = readHostsFlag(opts.hosts);
          if (!asked.ok) {
            reportRefusal(wiring, {
              reason: 'REFUSED',
              code: HOSTS_NOT_UNDERSTOOD,
              message: `"${asked.unknown}" is not a host this writes for. --hosts takes ${HOSTS_OFFERED.join(', ')} (several, separated by commas), or one of ${HOSTS_WORDS.join(', ')}. Nothing was written.`,
            });
            return;
          }
          const marks = marksForHosts(detectAround(root), asked.hosts, asked.detected);
          choice = ownFilesOf(marks);
          yours = yoursOf(marks);
        } else if (
          opts.remove !== true &&
          chosenOnDisk(root).length === 0 &&
          io.aPersonIsHere === true &&
          io.terminal !== undefined
        ) {
          // THE FILES ON DISK ARE THE CHOICE: with one of them there, this updates what is there and asks
          // nothing; with none, and a person at a terminal, it asks what `mnema init` asks, on the same
          // screen, and the person's own files (`CLAUDE.md` and its kin) are marks the person can leave off.
          const { detectAround } = await import('../init/detect.js');
          const { askTheHosts, defaultMarks } = await import('../init/flow.js');
          const { ownFilesOf, yoursOf } = await import('../init/hosts.js');
          const { leftLine } = await import('../init/screens.js');
          const around = detectAround(root);
          const asking = { io, render, terminal: io.terminal };
          const answer = await askTheHosts(
            asking,
            around,
            defaultMarks(around),
            'Which agent hosts should the mnema instructions be written for?',
            [leftLine('Left. Nothing was written.')],
          );
          if (answer.kind === 'left') return;
          choice = ownFilesOf(answer.answer);
          yours = yoursOf(answer.answer);
        }
        const files =
          opts.remove === true ? removeInstructions(root) : writeInstructions(root, choice, yours);
        for (const file of files) io.out(render(fact(changeLine(file))));
        if (opts.remove !== true && choice === undefined && yours === undefined) {
          const out = leftOut(root);
          if (out.length > 0) io.out(render(fact(leftOutLine(out))));
        }
        if (files.some((file) => file.did === 'refused' || file.did === 'failed')) io.fail();
      },
    );
  return readsTheRecord(verb);
}
