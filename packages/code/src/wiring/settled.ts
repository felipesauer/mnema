/**
 * The `mnema settled` wiring: what it declares, and what it prints.
 *
 * `mnema settled` reads the payload a host hands a hook after its question tool ran, on stdin, and
 * prints the reply that host reads: one sentence of fact for the agent, that a question to the
 * person was answered and which tool records a choice, or `{}`. The command is
 * `commands/settled.ts`; the plugin's handler runs it.
 *
 * A HOST RUNS IT, NOT A PERSON, so it is `handback`'s shape: it exits 0 on every outcome that is not
 * a misuse of the verb itself. It is a read, and records nothing.
 */

import type { Command } from 'commander';
import { here } from './context.js';
import { type Declared, readsTheRecord, type Wiring } from './verb.js';

/** Registers `mnema settled` on the program. */
export function registerSettled(program: Command, wiring: Wiring): Declared {
  const { io } = wiring;
  const verb = program
    .command('settled')
    .description(
      'say to the agent, after a question to the person was answered, which tool records a choice',
    )
    .option(
      '--reply <shape>',
      'flat: a top-level additionalContext, for a host that reads that and not the nested one',
    )
    .addHelpText(
      'after',
      [
        '',
        'What it reads and what it prints:',
        '  The JSON a host hands a hook after a tool ran (PostToolUse, or AfterTool in Gemini',
        '  CLI) on stdin. When the tool is one a host asks the person a question through',
        '  (AskUserQuestion, request_user_input, ask_user, question), it prints the reply the host',
        '  reads: an additionalContext saying that a question was answered, that `record_decision`',
        '  records a choice it settled, and that nothing was recorded from the answer. Otherwise,',
        '  outside a project, or with the channel off, it prints {}.',
        '  It reads which tool ran and never the answer, and writes nothing. It can be switched off',
        '  with `mnema switch off choice-settled`.',
      ].join('\n'),
    )
    .action(async (options: { readonly reply?: string }) => {
      const { runSettled } = await import('../commands/settled.js');
      const payload = io.input === undefined ? '' : await io.input();
      const reply = options.reply === 'flat' ? 'flat' : undefined;
      const done = runSettled(here(), { payload, reply });
      io.out(JSON.stringify(done.reply));
    });
  return readsTheRecord(verb);
}
