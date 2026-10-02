/**
 * The `mnema corrections` wiring: what it declares, and what it prints.
 *
 * `mnema corrections` reads the payload a host hands a `Stop` hook, on stdin, finds in the transcript
 * it names the places where a person corrected the agent, and records each as a proposed decision in
 * this machine's private tree. It prints the reply the host reads: one line saying how many and under
 * which labels, or `{}`. The command is `commands/corrections.ts`; the plugin's handler runs it.
 *
 * A HOST RUNS IT, NOT A PERSON, so it is `before-a-write`'s shape: it exits 0 on every outcome that is
 * not a misuse of the verb itself, and what it could not do goes to the second stream. It is a WRITE,
 * and says so — the one verb a hook runs that appends to the record without anybody typing it — and it
 * does nothing at all until `mnema switch on user-corrections`.
 */

import type { Command } from 'commander';
import { here } from './context.js';
import { type Declared, mutatesTheRecord, type Wiring } from './verb.js';

/** Registers `mnema corrections` on the program. */
export function registerCorrections(program: Command, wiring: Wiring): Declared {
  const { io, render } = wiring;
  const verb = program
    .command('corrections')
    .description(
      'record what a person corrected in a session as proposed decisions, for a Stop hook',
    )
    .addHelpText(
      'after',
      [
        '',
        'What it reads and what it does:',
        '  The JSON a host hands a Stop hook on stdin, with the transcript it names. It finds the',
        '  prompts that open by correcting the agent — "no, …", "stop …", "do not …", "that is',
        '  wrong", "use … instead", in English and Portuguese — and records each as a proposed',
        '  decision in this machine’s private tree, citing the session and the line, at most five',
        '  at a time and never the same line twice. No model is called; a match is a guess that a',
        '  person accepts or rejects.',
        '  On stdout, the reply the host reads: a `systemMessage` saying how many were recorded and',
        '  under which labels, or {}.',
        '  It does nothing until `mnema switch on user-corrections`, because it reads what a person',
        '  typed. With the channel off, or outside a project, it records nothing.',
      ].join('\n'),
    )
    .action(async () => {
      const { runCorrections } = await import('../commands/corrections.js');
      const { fact } = await import('../presentation/detail.js');
      const payload = io.input === undefined ? '' : await io.input();
      const done = runCorrections(here(), { payload });
      for (const note of done.notes) io.err(render(fact(note, 0)));
      io.out(JSON.stringify(done.reply));
    });
  return mutatesTheRecord(verb);
}
