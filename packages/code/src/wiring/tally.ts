/**
 * The `mnema tally` wiring: what it declares, and what it prints.
 *
 * `mnema tally` reads the payload a host hands a `Stop` hook, on stdin,
 * and prints the reply that host reads, on stdout: one line saying how many files the session's
 * own tool calls wrote and how many decisions were recorded since it opened, and `{}` when there is
 * nothing to count. It keeps the session journal (`session-journal.ts`) as it goes: a file on this
 * machine, outside the record, which is why the verb still says it reads the record and no more. The command is `commands/tally.ts`; the plugin's handler runs it.
 *
 * A HOST RUNS IT, NOT A PERSON, so it is `before-a-write`'s shape: it exits 0 on every outcome that
 * is not a misuse of the verb itself, and what it has to say about a payload it could not read goes
 * to the second stream, which the host logs and nobody decides by. It takes no option: the event is
 * in the payload, and a flag that said which event a payload was would be a second opinion about it.
 */

import type { Command } from 'commander';
import { here } from './context.js';
import { type Declared, readsTheRecord, type Wiring } from './verb.js';

/** Registers `mnema tally` on the program. */
export function registerTally(program: Command, wiring: Wiring): Declared {
  const { io, render } = wiring;
  const verb = program
    .command('tally')
    .description('answer a host’s Stop hook with what the session wrote and recorded')
    .addHelpText(
      'after',
      [
        '',
        'What it reads and what it prints:',
        '  The JSON a host hands a hook on stdin, with the transcript it names. On stdout, the reply',
        '  the host reads: a `systemMessage` saying how many files this session’s own tool calls',
        '  wrote and how many decisions were recorded in this project since it opened, or {} when',
        '  the hook is not Stop, the session wrote no file in the last response, there is no project',
        '  here, or the transcript cannot be read.',
        '  It writes nothing to the record. When the hook names its session it also keeps a small file on',
        '  this machine, the session journal (ids and counts, never what was said), and reads the',
        '  transcript from where the last reading stopped. `mnema switch off session-tally` stops the',
        '  line and `mnema switch off session-journal` stops the file.',
      ].join('\n'),
    )
    .action(async () => {
      const { runSessionTally } = await import('../commands/tally.js');
      const { fact } = await import('../presentation/detail.js');
      const payload = io.input === undefined ? '' : await io.input();
      const done = runSessionTally(here(), { payload });
      for (const note of done.notes) io.err(render(fact(note, 0)));
      io.out(JSON.stringify(done.reply));
    });
  return readsTheRecord(verb);
}
